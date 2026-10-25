"""DAI phase-one foundation: authenticated, scoped, audited synthetic portal."""

import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import re
import jwt
from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, update, delete, func, or_
from . import schema as s
from .db import database, initialize
from .security import ROLES, CLINICAL, digest, verify_password
from .staff_scope import effective_staff, facility_staff

LABEL = "Simulated on synthetic data"
UTC = timezone.utc
bearer = HTTPBearer(auto_error=False)


def utc():
    return datetime.now(UTC)


def aware(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def create_app(engine=None):
    engine = engine or database()
    demo = os.getenv("DAI_DEMO", "false").lower() == "true"
    secret = os.getenv("JWT_SECRET")
    if not secret:
        if not demo:
            raise RuntimeError("JWT_SECRET is required outside explicit DAI_DEMO mode")
        secret = secrets.token_urlsafe(48)
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters")

    @asynccontextmanager
    async def lifespan(app):
        initialize(engine)
        # Keep the persisted permission catalogue aligned with the application policy.
        with engine.begin() as c:
            existing = set(
                c.execute(
                    select(s.role_permission.c.role, s.role_permission.c.permission)
                ).all()
            )
            for role, permissions in ROLES.items():
                for permission in permissions:
                    if (role, permission) not in existing:
                        c.execute(
                            s.role_permission.insert().values(
                                role=role,
                                permission=permission,
                                source_id=role + ":" + permission,
                            )
                        )
        seed_demo_requests(engine)
        yield

    app = FastAPI(
        title="DAI Hospital Readiness API", version="0.1.0", lifespan=lifespan
    )
    app.state.engine = engine

    def one(table, identifier, c):
        try:
            UUID(identifier)
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(422, "A valid UUID is required")
        row = (
            c.execute(select(table).where(table.c.id == identifier)).mappings().first()
        )
        if not row:
            raise HTTPException(404, "Record not found")
        return dict(row)

    def audit(c, actor, action, entity, identifier, details=None):
        c.execute(
            s.audit_log.insert().values(
                actor_id=actor["id"],
                action=action,
                entity_type=entity,
                entity_id=identifier,
                details={
                    **(details or {}),
                    "facility_id": (details or {}).get(
                        "facility_id", actor.get("facility_id")
                    ),
                },
            )
        )

    def issue(c, u, response, impersonator=None, previous_session=None):
        sid = str(uuid4())
        refresh = secrets.token_urlsafe(48)
        c.execute(
            s.auth_session.insert().values(
                id=sid,
                user_id=u["id"],
                refresh_hash=digest(refresh),
                expires_at=utc() + timedelta(days=7),
                revoked=False,
                impersonated_by=impersonator,
            )
        )
        if previous_session:
            membership_id = c.scalar(
                select(s.session_scope.c.affiliation_id).where(
                    s.session_scope.c.session_id == previous_session
                )
            )
            if membership_id:
                c.execute(
                    s.session_scope.insert().values(
                        session_id=sid, affiliation_id=membership_id
                    )
                )
        token = jwt.encode(
            {
                "sub": u["id"],
                "sid": sid,
                "iss": "dai-hospital",
                "aud": "dai-portal",
                "iat": utc(),
                "exp": utc() + timedelta(minutes=10),
            },
            secret,
            algorithm="HS256",
        )
        response.set_cookie(
            "dai_refresh",
            refresh,
            httponly=True,
            secure=not demo,
            samesite="strict",
            path="/api/auth",
            max_age=604800,
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": 600,
            "user": public_user(u),
            "data_label": LABEL,
        }

    def public_user(u):
        return {
            k: u[k]
            for k in (
                "id",
                "name",
                "email",
                "role",
                "facility_id",
                "unit_id",
                "department_id",
                "verified",
            )
        }

    def affiliation_context(c, u, session_id=None):
        membership = None
        if session_id:
            membership = (
                c.execute(
                    select(s.staff_affiliation)
                    .join(
                        s.session_scope,
                        s.session_scope.c.affiliation_id == s.staff_affiliation.c.id,
                    )
                    .where(s.session_scope.c.session_id == session_id)
                )
                .mappings()
                .first()
            )
        if membership is None:
            membership = (
                c.execute(
                    select(s.staff_affiliation).where(
                        s.staff_affiliation.c.user_id == u["id"],
                        s.staff_affiliation.c.facility_id == u["facility_id"],
                    )
                )
                .mappings()
                .first()
            )
        if membership:
            if membership["user_id"] != u["id"] or not membership["active"]:
                raise HTTPException(403, "Facility access is inactive")
            u = {
                **u,
                **{
                    k: membership[k]
                    for k in (
                        "facility_id",
                        "department_id",
                        "unit_id",
                        "role",
                        "verified",
                        "registration_no",
                    )
                },
            }
        return u

    def actor(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None:
            raise HTTPException(401, "Authentication required")
        try:
            payload = jwt.decode(
                credentials.credentials,
                secret,
                algorithms=["HS256"],
                issuer="dai-hospital",
                audience="dai-portal",
            )
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired access token")
        with engine.connect() as c:
            session = (
                c.execute(
                    select(s.auth_session).where(s.auth_session.c.id == payload["sid"])
                )
                .mappings()
                .first()
            )
            if (
                not session
                or session["revoked"]
                or aware(session["expires_at"]) <= utc()
                or session["user_id"] != payload["sub"]
            ):
                raise HTTPException(401, "Session expired")
            u = affiliation_context(c, one(s.user, payload["sub"], c), session["id"])
            if u["role"] not in ROLES:
                raise HTTPException(403, "Unknown role")
            if u["role"] in CLINICAL and (
                not u["verified"] or not u["registration_no"] or not u["department_id"]
            ):
                raise HTTPException(403, "Clinical credentials require verification")
            return {**u, "session_id": session["id"]}

    def require(permission):
        def check(u=Depends(actor)):
            if permission not in ROLES[u["role"]]:
                raise HTTPException(403, "Permission denied")
            return u

        return check

    def scope(u, facility_id):
        if u["facility_id"] != facility_id:
            raise HTTPException(403, "Outside your facility scope")

    def clinical_scope(u, m):
        scope(u, m["registered_facility_id"])
        if u["role"] in CLINICAL and m["assigned_unit_id"] != u["unit_id"]:
            raise HTTPException(
                403, "Outside your assigned unit; a consult link is required"
            )
        if u["role"] == "resident" and m["assigned_doctor_id"] != u["id"]:
            raise HTTPException(403, "Outside your assigned patients")

    @app.middleware("http")
    async def synthetic_label(request, call_next):
        response = await call_next(request)
        response.headers["X-DAI-Data-Label"] = LABEL
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "database": engine.dialect.name,
            "data_label": LABEL,
            "phase": "foundation",
            "demo_auth_delivery": demo,
            "postgres_acceptance": (
                "pending" if engine.dialect.name != "postgresql" else "available"
            ),
        }

    class Login(BaseModel):
        email: str = Field(max_length=180)
        password: str = Field(max_length=200)

    @app.post("/api/auth/login")
    def login(body: Login):
        with engine.begin() as c:
            u = (
                c.execute(select(s.user).where(s.user.c.email == body.email.lower()))
                .mappings()
                .first()
            )
            if not u or not verify_password(body.password, u["password_hash"]):
                raise HTTPException(401, "Invalid credentials")
            recent = c.scalar(
                select(func.count())
                .select_from(s.auth_challenge)
                .where(
                    s.auth_challenge.c.user_id == u["id"],
                    s.auth_challenge.c.created_at > utc() - timedelta(minutes=5),
                )
            )
            if recent >= 5:
                raise HTTPException(
                    429, "Too many OTP requests; retry after five minutes"
                )
            if not demo:
                raise HTTPException(
                    503,
                    "External OTP provider has not been configured; access is closed",
                )
            otp = f"{secrets.randbelow(1000000):06d}"
            cid = str(uuid4())
            c.execute(
                s.auth_challenge.insert().values(
                    id=cid,
                    user_id=u["id"],
                    otp_hash=digest(otp),
                    expires_at=utc() + timedelta(minutes=5),
                    attempts=0,
                    consumed=False,
                )
            )
            return {
                "challenge_id": cid,
                "demo_otp": otp,
                "data_label": LABEL,
                "message": "Demo OTP delivery is simulated. This code is never sent to a real phone.",
            }

    class OTP(BaseModel):
        challenge_id: str
        code: str = Field(pattern=r"^\d{6}$")

    @app.post("/api/auth/otp")
    def verify_otp(body: OTP, response: Response):
        failed = False
        result = None
        with engine.begin() as c:
            challenge = one(s.auth_challenge, body.challenge_id, c)
            if (
                challenge["consumed"]
                or challenge["attempts"] >= 5
                or aware(challenge["expires_at"]) <= utc()
            ):
                raise HTTPException(401, "OTP expired or locked")
            advanced = c.execute(
                update(s.auth_challenge)
                .where(
                    s.auth_challenge.c.id == body.challenge_id,
                    s.auth_challenge.c.attempts == challenge["attempts"],
                    s.auth_challenge.c.consumed.is_(False),
                )
                .values(attempts=challenge["attempts"] + 1)
            )
            if advanced.rowcount != 1:
                raise HTTPException(409, "OTP challenge changed; retry verification")
            if not secrets.compare_digest(digest(body.code), challenge["otp_hash"]):
                failed = True
            else:
                c.execute(
                    update(s.auth_challenge)
                    .where(s.auth_challenge.c.id == body.challenge_id)
                    .values(consumed=True)
                )
                u = affiliation_context(c, one(s.user, challenge["user_id"], c))
                if u["role"] in CLINICAL and (
                    not u["verified"]
                    or not u["registration_no"]
                    or not u["department_id"]
                ):
                    raise HTTPException(
                        403, "Clinical credentials require verification"
                    )
                audit(c, u, "login", "portal_user", u["id"])
                result = issue(c, u, response)
        if failed:
            raise HTTPException(401, "Incorrect OTP")
        return result

    def same_origin(request):
        origin = request.headers.get("origin")
        allowed = os.getenv("DAI_WEB_ORIGIN", "http://localhost:3000")
        if origin and origin != allowed:
            raise HTTPException(403, "Untrusted origin")
        if request.headers.get("x-dai-client") != "portal":
            raise HTTPException(403, "Portal request header required")

    @app.post("/api/auth/refresh")
    def refresh(request: Request, response: Response):
        same_origin(request)
        value = request.cookies.get("dai_refresh", "")
        with engine.begin() as c:
            session = (
                c.execute(
                    select(s.auth_session)
                    .where(s.auth_session.c.refresh_hash == digest(value))
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if (
                not session
                or session["revoked"]
                or aware(session["expires_at"]) <= utc()
            ):
                raise HTTPException(401, "Refresh session expired")
            rotated = c.execute(
                update(s.auth_session)
                .where(
                    s.auth_session.c.id == session["id"],
                    s.auth_session.c.revoked.is_(False),
                )
                .values(revoked=True)
            )
            if rotated.rowcount != 1:
                raise HTTPException(401, "Refresh session already rotated")
            return issue(
                c,
                affiliation_context(
                    c, one(s.user, session["user_id"], c), session["id"]
                ),
                response,
                session["impersonated_by"],
                previous_session=session["id"],
            )

    @app.post("/api/auth/logout")
    def logout(response: Response, u=Depends(actor)):
        with engine.begin() as c:
            c.execute(
                update(s.auth_session)
                .where(s.auth_session.c.id == u["session_id"])
                .values(revoked=True)
            )
        response.delete_cookie("dai_refresh", path="/api/auth")
        return {"status": "logged_out"}

    @app.get("/api/me")
    def me(u=Depends(actor)):
        return {
            **public_user(u),
            "permissions": sorted(ROLES[u["role"]]),
            "demo": demo,
            "data_label": LABEL,
        }

    @app.get("/api/demo/roles")
    def demo_roles(u=Depends(require("demo.switch"))):
        if not demo:
            raise HTTPException(404)
        return {"roles": list(ROLES), "data_label": LABEL}

    class RoleSwitch(BaseModel):
        role: str

    @app.post("/api/demo/switch")
    def switch(body: RoleSwitch, response: Response, u=Depends(actor)):
        if not demo:
            raise HTTPException(404)
        with engine.begin() as c:
            session = one(s.auth_session, u["session_id"], c)
            admin_id = session["impersonated_by"] or (
                u["id"] if u["role"] == "hospital_admin" else None
            )
            if not admin_id or one(s.user, admin_id, c)["role"] != "hospital_admin":
                raise HTTPException(403, "Administrator demo session required")
            target = (
                c.execute(
                    select(s.user).where(s.user.c.source_id == "demo:" + body.role)
                )
                .mappings()
                .first()
            )
            if not target:
                raise HTTPException(400, "Unknown demo role")
            c.execute(
                update(s.auth_session)
                .where(s.auth_session.c.id == u["session_id"])
                .values(revoked=True)
            )
            audit(
                c,
                u,
                "demo_role_switch",
                "portal_user",
                target["id"],
                {"accepted_role": body.role, "originating_admin": admin_id},
            )
            return issue(c, target, response, admin_id)

    @app.get("/api/facilities")
    def facilities(u=Depends(require("facility.read"))):
        with engine.connect() as c:
            return {
                "items": [
                    dict(r)
                    for r in c.execute(
                        select(s.facility).where(s.facility.c.id == u["facility_id"])
                    ).mappings()
                ],
                "data_label": LABEL,
            }

    @app.get("/api/facilities/{fid}/structure")
    def structure(fid: str, u=Depends(require("facility.read"))):
        scope(u, fid)
        with engine.connect() as c:
            result = {"facility": one(s.facility, fid, c), "data_label": LABEL}
            for key, t in [
                ("departments", s.department),
                ("units", s.unit),
                ("wards", s.ward),
                ("clinics", s.clinic),
                ("critical_units", s.critical_unit),
                ("organisation", s.organisation_role),
            ]:
                result[key] = [
                    dict(r)
                    for r in c.execute(
                        select(t).where(t.c.facility_id == fid)
                    ).mappings()
                ]
            manifest = c.execute(select(s.seed_manifest)).mappings().first()
            result["provenance"] = dict(manifest) if manifest else None
            result["roles"] = [
                {"role": role, "permissions": sorted(permissions)}
                for role, permissions in ROLES.items()
            ]
            return result

    class FacilityPatch(BaseModel):
        model_config = ConfigDict(extra="forbid")
        name: str | None = Field(default=None, min_length=5, max_length=180)
        address: str | None = Field(default=None, max_length=500)
        emergency_24x7: bool | None = None
        sos_participating: bool | None = None
        nabh_status: str | None = None
        nabl_status: str | None = None
        capabilities: dict | None = None

    @app.patch("/api/facilities/{fid}")
    def facility_patch(
        fid: str, body: FacilityPatch, u=Depends(require("facility.write"))
    ):
        scope(u, fid)
        values = body.model_dump(exclude_none=True)
        if "name" in values and not values["name"].startswith("DAI SYNTHETIC "):
            raise HTTPException(400, "Keep the DAI SYNTHETIC name prefix")
        with engine.begin() as c:
            previous = one(s.facility, fid, c)
            if values:
                c.execute(
                    update(s.facility).where(s.facility.c.id == fid).values(**values)
                )
            audit(
                c,
                u,
                "update",
                "facility",
                fid,
                {"before": {k: previous[k] for k in values}, "after": values},
            )
            return one(s.facility, fid, c)

    # M1 editable structure: constrained field allowlists, all references stay in this facility.
    entities = {
        "departments": (s.department, {"name"}),
        "units": (
            s.unit,
            {
                "department_id",
                "code",
                "anc_day",
                "gynae_day",
                "opd_day",
                "ot_day",
                "ward_id",
                "gynae_ward_id",
                "labour_room_id",
                "room",
            },
        ),
        "clinics": (
            s.clinic,
            {"unit_id", "name", "day", "start_time", "end_time", "room"},
        ),
    }

    def clean_entity(kind, body, fid, c, creating, existing=None):
        if kind not in entities:
            raise HTTPException(404)
        t, allowed = entities[kind]
        if not body or set(body) - allowed:
            raise HTTPException(422, "Unknown or empty structure fields")
        required = {
            "departments": {"name"},
            "units": {"department_id", "code"},
            "clinics": {"unit_id", "name", "day", "start_time", "end_time", "room"},
        }[kind]
        if creating and not required <= set(body):
            raise HTTPException(422, "Missing required structure fields")
        merged = {**(existing or {}), **body}
        if any(key in body and body[key] is None for key in required):
            raise HTTPException(422, "Required fields cannot be null")
        for key, value in body.items():
            if key.endswith("_day") or key == "day":
                if value is not None and (
                    not isinstance(value, int)
                    or isinstance(value, bool)
                    or not 0 <= value <= 6
                ):
                    raise HTTPException(422, "Days must be integers 0 through 6")
            elif value is not None and not isinstance(value, str):
                raise HTTPException(422, "Text and linked IDs must be strings")
            if isinstance(value, str) and (not value.strip() or len(value) > 180):
                raise HTTPException(422, "Text must contain 1 to 180 characters")
            if key.endswith("_id") and value:
                target = (
                    s.department
                    if key == "department_id"
                    else s.unit if key == "unit_id" else s.ward
                )
                if one(target, value, c)["facility_id"] != fid:
                    raise HTTPException(
                        422, "Linked resource belongs to another facility"
                    )
        if kind == "clinics":
            for key in ("start_time", "end_time"):
                if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", merged.get(key, "")):
                    raise HTTPException(422, "Clinic times must use HH:MM")
            if merged["start_time"] >= merged["end_time"]:
                raise HTTPException(422, "Clinic must end after it starts")
        if kind == "units":
            for key in ("ward_id", "gynae_ward_id", "labour_room_id"):
                if merged.get(key):
                    w = one(s.ward, merged[key], c)
                    if w["department_id"] != merged["department_id"]:
                        raise HTTPException(422, "Unit and ward departments must match")
                    if key == "labour_room_id" and w["care_area"] != "Labour room":
                        raise HTTPException(422, "Choose a labour room for the unit")
        return t

    @app.post("/api/facilities/{fid}/structure/{kind}", status_code=201)
    def create_entity(
        fid: str, kind: str, body: dict, u=Depends(require("facility.write"))
    ):
        scope(u, fid)
        with engine.begin() as c:
            t = clean_entity(kind, body, fid, c, True)
            identifier = str(uuid4())
            c.execute(t.insert().values(id=identifier, facility_id=fid, **body))
            audit(c, u, "create", t.name, identifier)
            return one(t, identifier, c)

    @app.patch("/api/facilities/{fid}/structure/{kind}/{identifier}")
    def patch_entity(
        fid: str,
        kind: str,
        identifier: str,
        body: dict,
        u=Depends(require("facility.write")),
    ):
        scope(u, fid)
        with engine.begin() as c:
            if kind not in entities:
                raise HTTPException(404)
            existing = one(entities[kind][0], identifier, c)
            if existing["facility_id"] != fid:
                raise HTTPException(403)
            t = clean_entity(kind, body, fid, c, False, existing)
            c.execute(update(t).where(t.c.id == identifier).values(**body))
            audit(
                c,
                u,
                "update",
                t.name,
                identifier,
                {"before": {k: existing[k] for k in body}, "after": body},
            )
            return one(t, identifier, c)

    @app.delete("/api/facilities/{fid}/structure/{kind}/{identifier}")
    def delete_entity(
        fid: str, kind: str, identifier: str, u=Depends(require("facility.write"))
    ):
        scope(u, fid)
        if kind not in entities:
            raise HTTPException(404)
        from sqlalchemy.exc import IntegrityError

        try:
            with engine.begin() as c:
                t = entities[kind][0]
                if one(t, identifier, c)["facility_id"] != fid:
                    raise HTTPException(403)
                c.execute(delete(t).where(t.c.id == identifier))
                audit(c, u, "delete", t.name, identifier)
        except IntegrityError:
            raise HTTPException(
                409, "Structure is in use; move linked records before deleting"
            )
        return {"deleted": identifier}

    @app.get("/api/patients")
    def patients(
        limit: int = 25,
        offset: int = 0,
        q: str = "",
        u=Depends(require("patient.read")),
    ):
        if limit < 1 or limit > 100 or offset < 0 or len(q) > 100:
            raise HTTPException(422, "Invalid pagination")
        filters = [s.mother.c.registered_facility_id == u["facility_id"]]
        if u["role"] in CLINICAL:
            filters.append(s.mother.c.assigned_unit_id == u["unit_id"])
        if u["role"] == "resident":
            filters.append(s.mother.c.assigned_doctor_id == u["id"])
        if q.strip():
            filters.append(
                or_(
                    s.mother.c.details["name"]
                    .as_string()
                    .icontains(q.strip(), autoescape=True),
                    s.mother.c.source_id.icontains(q.strip(), autoescape=True),
                )
            )
        with engine.begin() as c:
            items = [
                dict(r)
                for r in c.execute(
                    select(s.mother)
                    .where(*filters)
                    .order_by(s.mother.c.id)
                    .offset(offset)
                    .limit(limit)
                ).mappings()
            ]
            for m in items:
                audit(c, u, "read", "mother", m["id"], {"view": "registry"})
            return {
                "items": items,
                "total": c.scalar(
                    select(func.count()).select_from(s.mother).where(*filters)
                ),
                "data_label": LABEL,
            }

    @app.get("/api/patients/{mid}")
    def patient(mid: str, u=Depends(require("patient.read"))):
        with engine.begin() as c:
            m = one(s.mother, mid, c)
            clinical_scope(u, m)
            children = [
                dict(r)
                for r in c.execute(
                    select(s.child).where(s.child.c.mother_id == mid)
                ).mappings()
            ]
            audit(c, u, "read", "mother", mid, {"view": "timeline"})
            for ch in children:
                audit(c, u, "read", "child", ch["id"], {"view": "timeline"})
            return {
                "mother": m,
                "children": children,
                "unit": one(s.unit, m["assigned_unit_id"], c),
                "doctor": public_user(one(s.user, m["assigned_doctor_id"], c)),
                "data_label": LABEL,
            }

    @app.get("/api/audit")
    def audit_view(u=Depends(require("audit.read"))):
        with engine.connect() as c:
            items = c.execute(
                select(s.audit_log)
                .join(s.user, s.audit_log.c.actor_id == s.user.c.id)
                .where(
                    or_(
                        s.audit_log.c.details["facility_id"].as_string()
                        == u["facility_id"],
                        (
                            s.audit_log.c.details["facility_id"].as_string().is_(None)
                            & (s.user.c.facility_id == u["facility_id"])
                        ),
                    )
                )
                .order_by(s.audit_log.c.created_at.desc())
                .limit(100)
            ).mappings()
            return {"items": [dict(r) for r in items], "data_label": LABEL}

    @app.get("/api/users")
    def users(u=Depends(require("user.verify"))):
        with engine.connect() as c:
            rows = facility_staff(c, u["facility_id"])
            return {
                "items": [
                    {
                        **public_user(row),
                        "registration_no": row["registration_no"],
                        "source_id": row["source_id"],
                    }
                    for row in rows
                ],
                "data_label": LABEL,
            }

    class Verification(BaseModel):
        verified: bool

    @app.post("/api/users/{identifier}/verify")
    def verify_user(
        identifier: str, body: Verification, u=Depends(require("user.verify"))
    ):
        with engine.begin() as c:
            target = effective_staff(c, one(s.user, identifier, c), u["facility_id"])
            scope(u, target["facility_id"])
            if (
                body.verified
                and target["role"] in CLINICAL
                and (not target["registration_no"] or not target["department_id"])
            ):
                raise HTTPException(
                    422, "Registration number and department are required"
                )
            membership = (
                c.execute(
                    select(s.staff_affiliation).where(
                        s.staff_affiliation.c.user_id == identifier,
                        s.staff_affiliation.c.facility_id == u["facility_id"],
                    )
                )
                .mappings()
                .first()
            )
            if membership:
                c.execute(
                    update(s.staff_affiliation)
                    .where(s.staff_affiliation.c.id == membership["id"])
                    .values(verified=body.verified, version=membership["version"] + 1)
                )
            else:
                c.execute(
                    update(s.user)
                    .where(s.user.c.id == identifier)
                    .values(verified=body.verified)
                )
            audit(
                c,
                u,
                "verify",
                "portal_user",
                identifier,
                {
                    "before": {"verified": target["verified"]},
                    "after": {"verified": body.verified},
                },
            )
            return {"verified": body.verified}

    from .administration import register_administration

    register_administration(app, engine, require, actor, audit, one, clinical_scope)

    from .workspace import register_workspace

    register_workspace(app, engine, require, audit, ROLES)
    from .coordination import register_coordination

    register_coordination(app, engine, require, audit, one, clinical_scope)
    from .sustainability import register as register_sustainability

    register_sustainability(app, engine, require, one, audit, facility_staff)

    from .forecasts import register_forecasts

    register_forecasts(app, engine, require, audit)
    from .demo_requests import register_demo_requests, seed_demo_requests
    register_demo_requests(app, engine, require, audit, secret)
    return app


app = create_app() if os.getenv("DAI_APP_FACTORY_ONLY") != "true" else None
