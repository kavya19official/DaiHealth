"""Scoped facility onboarding, availability and staff affiliations for the demo portal."""

import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from typing import Literal
from datetime import date
from pathlib import Path
import base64
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update, delete
from . import schema as s
from .security import ROLES, CLINICAL, digest, password_hash


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    organisation: str = Field(min_length=2, max_length=180)
    address: str = Field(min_length=5, max_length=500)
    pincode: str = Field(pattern=r"^\d{6}$")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    hours: str = Field(min_length=2, max_length=300)
    contact: str = Field(min_length=3, max_length=120)
    emergency_contact: str = Field(min_length=3, max_length=120)
    verification_documents: list[str] = Field(default_factory=list, max_length=20)
    reason: str = Field(min_length=5, max_length=500)
    version: int = Field(ge=0)


class Service(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    department_id: UUID
    clinician_id: UUID | None = None
    available: bool = True
    accepts_referrals: bool = False
    capacity: int = Field(ge=0, le=10000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    closure_reason: str = Field(default="", max_length=500)
    contact: str = Field(min_length=3, max_length=120)
    reason: str = Field(min_length=5, max_length=500)
    version: int = Field(default=0, ge=0)


class Staff(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=180)
    name: str = Field(min_length=2, max_length=120)
    role: str
    department_id: UUID | None = None
    unit_id: UUID | None = None
    registration_no: str = Field(default="", max_length=100)
    verified: bool = False
    active: bool = True
    reason: str = Field(min_length=5, max_length=500)
    version: int = Field(default=0, ge=0)


class PatientEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["visit", "care_plan", "referral", "test_status"]
    title: str = Field(min_length=3, max_length=180)
    notes: str = Field(min_length=5, max_length=4000)
    status: Literal["planned", "in_progress", "completed", "cancelled"]
    occurred_on: date
    reason: str = Field(min_length=5, max_length=500)
    version: int = Field(default=0, ge=0)


class Accept(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=12, max_length=128)


class ReferralCreate(BaseModel):
    mother_id: UUID
    to_facility_id: UUID
    reason: str = Field(min_length=5, max_length=1000)
    summary: str = Field(min_length=5, max_length=4000)


class ReferralUpdate(BaseModel):
    status: Literal["accepted", "rejected", "arrived", "completed"]
    notes: str = Field(min_length=5, max_length=2000)
    version: int = Field(ge=1)


def register_administration(app, engine, require, actor, audit, one, clinical_scope):
    def write():
        if os.getenv("DAI_DEMO", "false").lower() != "true":
            raise HTTPException(
                409, "Administration writes require explicit synthetic demo mode"
            )

    def department(c, fid, did, uid=None):
        if did and one(s.department, str(did), c)["facility_id"] != fid:
            raise HTTPException(403, "Department outside facility")
        if uid:
            unit = one(s.unit, str(uid), c)
            if unit["facility_id"] != fid or unit["department_id"] != str(did):
                raise HTTPException(403, "Unit does not belong to department")

    def save(c, u, kind, identifier, payload, version, reason):
        old = (
            c.execute(select(s.admin_record).where(s.admin_record.c.id == identifier))
            .mappings()
            .first()
        )
        if old and (old["facility_id"] != u["facility_id"] or old["kind"] != kind):
            raise HTTPException(403, "Outside facility scope")
        if (old["version"] if old else 0) != version:
            raise HTTPException(409, "Record changed; reload before saving")
        values = dict(
            facility_id=u["facility_id"],
            kind=kind,
            payload=payload,
            version=version + 1,
        )
        if old:
            result = c.execute(
                update(s.admin_record)
                .where(
                    s.admin_record.c.id == identifier,
                    s.admin_record.c.version == version,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                raise HTTPException(409, "Record changed; reload")
        else:
            c.execute(s.admin_record.insert().values(id=identifier, **values))
        audit(
            c,
            u,
            "correct" if old else "create",
            "administration",
            identifier,
            {
                "facility_id": u["facility_id"],
                "kind": kind,
                "reason": reason,
                "before": old["payload"] if old else None,
                "after": payload,
                "version": version + 1,
            },
        )
        return {"id": identifier, **values}

    @app.get("/api/administration")
    def overview(u=Depends(require("facility.write"))):
        with engine.begin() as c:
            records = [
                dict(r)
                for r in c.execute(
                    select(s.admin_record).where(
                        s.admin_record.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            staff = [
                {k: v for k, v in dict(r).items() if k != "invite_hash"}
                for r in c.execute(
                    select(s.staff_affiliation).where(
                        s.staff_affiliation.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            users = [
                {
                    k: v
                    for k, v in dict(r).items()
                    if k not in {"password_hash", "details"}
                }
                for r in c.execute(
                    select(s.user).where(s.user.c.facility_id == u["facility_id"])
                ).mappings()
            ]
            departments = [
                dict(r)
                for r in c.execute(
                    select(s.department).where(
                        s.department.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            units = [
                dict(r)
                for r in c.execute(
                    select(s.unit).where(s.unit.c.facility_id == u["facility_id"])
                ).mappings()
            ]
            audit(
                c,
                u,
                "read",
                "administration",
                u["facility_id"],
                {"facility_id": u["facility_id"]},
            )
            return dict(
                records=records,
                affiliations=staff,
                users=users,
                departments=departments,
                units=units,
                roles=sorted(ROLES),
            )

    @app.put("/api/administration/profile")
    def profile(body: Profile, u=Depends(require("facility.write"))):
        write()
        with engine.begin() as c:
            old = c.execute(
                select(s.admin_record.c.id).where(
                    s.admin_record.c.facility_id == u["facility_id"],
                    s.admin_record.c.kind == "profile",
                )
            ).scalar()
            result = save(
                c,
                u,
                "profile",
                old or str(uuid4()),
                body.model_dump(exclude={"version", "reason"}),
                body.version,
                body.reason,
            )
            c.execute(
                update(s.facility)
                .where(s.facility.c.id == u["facility_id"])
                .values(address=body.address, lat=body.latitude, lng=body.longitude)
            )
            return result

    @app.put("/api/administration/services/{identifier}")
    def service(identifier: UUID, body: Service, u=Depends(require("facility.write"))):
        write()
        if bool(body.starts_at) != bool(body.ends_at):
            raise HTTPException(422, "Both slot times are required")
        if body.starts_at and (
            body.starts_at.tzinfo is None
            or body.ends_at.tzinfo is None
            or body.ends_at <= body.starts_at
        ):
            raise HTTPException(
                422, "Slot needs timezone-aware times with end after start"
            )
        if not body.available and not body.closure_reason.strip():
            raise HTTPException(422, "A closure reason is required")
        with engine.begin() as c:
            department(c, u["facility_id"], body.department_id)
            if body.clinician_id:
                clinician = one(s.user, str(body.clinician_id), c)
                membership = (
                    c.execute(
                        select(s.staff_affiliation).where(
                            s.staff_affiliation.c.user_id == str(body.clinician_id),
                            s.staff_affiliation.c.facility_id == u["facility_id"],
                        )
                    )
                    .mappings()
                    .first()
                )
                target = membership or clinician
                if (
                    target["facility_id"] != u["facility_id"]
                    or not target["verified"]
                    or target["role"] not in CLINICAL
                    or target["department_id"] != str(body.department_id)
                    or (membership and not membership["active"])
                ):
                    raise HTTPException(
                        403, "Clinician must be active and verified in this department"
                    )
            return save(
                c,
                u,
                "service",
                str(identifier),
                body.model_dump(mode="json", exclude={"version", "reason"}),
                body.version,
                body.reason,
            )

    @app.put("/api/administration/staff")
    def staff(body: Staff, u=Depends(require("facility.write"))):
        write()
        if body.role not in ROLES:
            raise HTTPException(422, "Unknown role")
        if (
            body.role in CLINICAL
            and body.verified
            and (
                not body.registration_no.strip()
                or not body.department_id
                or not body.unit_id
            )
        ):
            raise HTTPException(
                422, "Verified clinicians require registration, department and unit"
            )
        with engine.begin() as c:
            department(c, u["facility_id"], body.department_id, body.unit_id)
            email = body.email.lower()
            person = (
                c.execute(select(s.user).where(s.user.c.email == email))
                .mappings()
                .first()
            )
            if person and person["id"] == u["id"]:
                raise HTTPException(
                    409, "Ask another administrator to change your access"
                )
            old = (
                c.execute(
                    select(s.staff_affiliation).where(
                        s.staff_affiliation.c.email == email,
                        s.staff_affiliation.c.facility_id == u["facility_id"],
                    )
                )
                .mappings()
                .first()
            )
            if (old["version"] if old else 0) != body.version:
                raise HTTPException(409, "Staff record changed; reload")
            token = secrets.token_urlsafe(32) if not person and body.active else None
            values = body.model_dump(mode="json", exclude={"reason", "version"})
            values.update(
                email=email,
                facility_id=u["facility_id"],
                user_id=person["id"] if person else None,
                version=body.version + 1,
                invite_hash=digest(token) if token else None,
                expires_at=(
                    datetime.now(timezone.utc) + timedelta(days=2) if token else None
                ),
            )
            identifier = old["id"] if old else str(uuid4())
            if old:
                result = c.execute(
                    update(s.staff_affiliation)
                    .where(
                        s.staff_affiliation.c.id == identifier,
                        s.staff_affiliation.c.version == body.version,
                    )
                    .values(**values)
                )
                if result.rowcount != 1:
                    raise HTTPException(409, "Staff record changed; reload")
            else:
                c.execute(s.staff_affiliation.insert().values(id=identifier, **values))
            if person:
                c.execute(
                    update(s.auth_session)
                    .where(s.auth_session.c.user_id == person["id"])
                    .values(revoked=True)
                )
            audit(
                c,
                u,
                "staff_access",
                "staff_affiliation",
                identifier,
                {
                    "facility_id": u["facility_id"],
                    "reason": body.reason,
                    "before": (
                        {
                            k: old[k]
                            for k in (
                                "role",
                                "active",
                                "verified",
                                "department_id",
                                "unit_id",
                            )
                        }
                        if old
                        else None
                    ),
                    "after": body.model_dump(mode="json", exclude={"reason"}),
                },
            )
            return {
                "id": identifier,
                "version": values["version"],
                "invitation_token": token,
                "delivery": "Copy invitation token; no email sent",
            }

    @app.post("/api/administration/invitations/accept")
    def accept(body: Accept):
        write()
        with engine.begin() as c:
            invite = (
                c.execute(
                    select(s.staff_affiliation)
                    .where(s.staff_affiliation.c.invite_hash == digest(body.token))
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if (
                not invite
                or not invite["active"]
                or not invite["expires_at"]
                or invite["expires_at"].replace(tzinfo=timezone.utc)
                <= datetime.now(timezone.utc)
            ):
                raise HTTPException(400, "Invitation expired or unavailable")
            if c.scalar(select(s.user.c.id).where(s.user.c.email == invite["email"])):
                raise HTTPException(
                    409, "Account already exists; administrator must link affiliation"
                )
            uid = str(uuid4())
            c.execute(
                s.user.insert().values(
                    id=uid,
                    facility_id=invite["facility_id"],
                    department_id=invite["department_id"],
                    unit_id=invite["unit_id"],
                    name=invite["name"],
                    email=invite["email"],
                    role=invite["role"],
                    registration_no=invite["registration_no"],
                    verified=invite["verified"],
                    password_hash=password_hash(body.password),
                )
            )
            c.execute(
                update(s.staff_affiliation)
                .where(s.staff_affiliation.c.id == invite["id"])
                .values(user_id=uid, invite_hash=None, expires_at=None)
            )
            audit(
                c,
                {"id": uid},
                "invitation_accepted",
                "staff_affiliation",
                invite["id"],
                {"facility_id": invite["facility_id"]},
            )
            return {"status": "accepted; sign in with password and simulated OTP"}

    @app.get("/api/affiliations")
    def affiliations(u=Depends(actor)):
        with engine.begin() as c:
            items = [
                dict(r)
                for r in c.execute(
                    select(
                        s.staff_affiliation.c.id,
                        s.staff_affiliation.c.facility_id,
                        s.staff_affiliation.c.role,
                        s.facility.c.name,
                    )
                    .join(
                        s.facility, s.facility.c.id == s.staff_affiliation.c.facility_id
                    )
                    .where(
                        s.staff_affiliation.c.user_id == u["id"],
                        s.staff_affiliation.c.active == True,
                    )
                ).mappings()
            ]
            home = one(s.user, u["id"], c)
            if not any(r["facility_id"] == home["facility_id"] for r in items):
                home_membership = (
                    c.execute(
                        select(s.staff_affiliation).where(
                            s.staff_affiliation.c.user_id == u["id"],
                            s.staff_affiliation.c.facility_id == home["facility_id"],
                        )
                    )
                    .mappings()
                    .first()
                )
                if not home_membership:
                    items.insert(
                        0,
                        {
                            "id": u["id"],
                            "facility_id": home["facility_id"],
                            "role": home["role"],
                            "name": one(s.facility, home["facility_id"], c)["name"],
                        },
                    )
            return {"items": items}

    @app.post("/api/affiliations/{identifier}/switch")
    def switch(identifier: UUID, u=Depends(actor)):
        with engine.begin() as c:
            if str(identifier) == u["id"]:
                c.execute(
                    delete(s.session_scope).where(
                        s.session_scope.c.session_id == u["session_id"]
                    )
                )
                audit(c, u, "switch_home_facility", "portal_user", u["id"])
                return {"status": "switched"}
            affiliation = one(s.staff_affiliation, str(identifier), c)
            if affiliation["user_id"] != u["id"] or not affiliation["active"]:
                raise HTTPException(403, "Affiliation unavailable")
            if affiliation["role"] in CLINICAL and not affiliation["verified"]:
                raise HTTPException(403, "Credentials require verification")
            old = c.execute(
                select(s.session_scope.c.id).where(
                    s.session_scope.c.session_id == u["session_id"]
                )
            ).scalar()
            if old:
                c.execute(
                    update(s.session_scope)
                    .where(s.session_scope.c.id == old)
                    .values(affiliation_id=str(identifier))
                )
            else:
                c.execute(
                    s.session_scope.insert().values(
                        session_id=u["session_id"], affiliation_id=str(identifier)
                    )
                )
            audit(
                c,
                u,
                "switch_facility",
                "staff_affiliation",
                str(identifier),
                {"facility_id": affiliation["facility_id"]},
            )
            return {"status": "switched"}

    @app.get("/api/patients/{mid}/staff-records")
    def patient_records(mid: UUID, u=Depends(require("care.read"))):
        with engine.begin() as c:
            m = one(s.mother, str(mid), c)
            clinical_scope(u, m)
            if not m["consent_flags"].get("care_coordination"):
                raise HTTPException(403, "Care coordination consent required")
            rows = [
                dict(r)
                for r in c.execute(
                    select(s.admin_record).where(
                        s.admin_record.c.facility_id == u["facility_id"],
                        s.admin_record.c.kind == "patient_entry",
                        s.admin_record.c.payload["mother_id"].as_string() == str(mid),
                    )
                ).mappings()
            ]
            audit(
                c,
                u,
                "read",
                "mother",
                str(mid),
                {"facility_id": u["facility_id"], "view": "staff_records"},
            )
            return {"items": rows}

    @app.put("/api/patients/{mid}/staff-records/{identifier}")
    def patient_record(
        mid: UUID,
        identifier: UUID,
        body: PatientEntry,
        u=Depends(require("care.write")),
    ):
        write()
        if u["role"] not in CLINICAL:
            raise HTTPException(403, "Clinical records require an authorised clinician")
        if body.occurred_on > date.today():
            raise HTTPException(422, "Record date cannot be in the future")
        with engine.begin() as c:
            m = one(s.mother, str(mid), c)
            clinical_scope(u, m)
            if not m["consent_flags"].get("care_coordination"):
                raise HTTPException(403, "Care coordination consent required")
            old = (
                c.execute(
                    select(s.admin_record).where(s.admin_record.c.id == str(identifier))
                )
                .mappings()
                .first()
            )
            if old and old["payload"].get("mother_id") != str(mid):
                raise HTTPException(403, "Record belongs to another patient")
            payload = body.model_dump(mode="json", exclude={"reason", "version"})
            payload.update(mother_id=str(mid), recorded_by=u["id"])
            return save(
                c,
                u,
                "patient_entry",
                str(identifier),
                payload,
                body.version,
                body.reason,
            )

    @app.post("/api/administration/documents")
    async def upload_document(request: Request, u=Depends(require("facility.write"))):
        write()
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > 5 * 1024 * 1024:
                raise HTTPException(413, "Maximum document size is 5 MB")
        if not content.startswith(b"%PDF-"):
            raise HTTPException(422, "Upload a PDF verification document")
        identifier = str(uuid4())
        root = Path(
            os.getenv(
                "DAI_ADMIN_DOCUMENTS",
                str(
                    Path(__file__).resolve().parents[2]
                    / ".local"
                    / "verification-documents"
                ),
            )
        )
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = root / identifier
        path.write_bytes(content)
        path.chmod(0o600)
        try:
            with engine.begin() as c:
                return save(
                    c,
                    u,
                    "document",
                    identifier,
                    {
                        "reference": "verification:" + identifier,
                        "size": len(content),
                        "media_type": "application/pdf",
                    },
                    0,
                    "Verification document uploaded",
                )
        except Exception:
            path.unlink(missing_ok=True)
            raise

    @app.get("/api/administration/documents/{identifier}")
    def document(identifier: UUID, u=Depends(require("facility.write"))):
        with engine.begin() as c:
            record = one(s.admin_record, str(identifier), c)
            if (
                record["kind"] != "document"
                or record["facility_id"] != u["facility_id"]
            ):
                raise HTTPException(403, "Outside facility scope")
            root = Path(
                os.getenv(
                    "DAI_ADMIN_DOCUMENTS",
                    str(
                        Path(__file__).resolve().parents[2]
                        / ".local"
                        / "verification-documents"
                    ),
                )
            )
            path = root / str(identifier)
            if not path.is_file():
                raise HTTPException(404, "Document unavailable")
            audit(
                c,
                u,
                "read",
                "verification_document",
                str(identifier),
                {"facility_id": u["facility_id"]},
            )
            return {
                "content": base64.b64encode(path.read_bytes()).decode(),
                "media_type": "application/pdf",
            }

    @app.get("/api/care-referrals")
    def referrals(u=Depends(require("care.read"))):
        with engine.begin() as c:
            rows = c.execute(
                select(s.referral).where(
                    (s.referral.c.from_facility_id == u["facility_id"])
                    | (s.referral.c.to_facility_id == u["facility_id"])
                )
            ).mappings()
            items = []
            for row in rows:
                # Only explicit new handoffs, not imported records, expose a consented packet.
                if not row["details"].get("staff_handoff"):
                    continue
                mother = one(s.mother, row["mother_id"], c)
                if not mother["consent_flags"].get("care_coordination"):
                    continue
                if row["from_facility_id"] == u["facility_id"]:
                    try:
                        clinical_scope(u, mother)
                    except HTTPException:
                        continue
                elif u["role"] == "resident":
                    continue
                elif (
                    u["role"] in CLINICAL
                    and row["details"].get("assigned_unit_id")
                    and row["details"].get("assigned_unit_id") != u["unit_id"]
                ):
                    continue
                items.append(dict(row))
                audit(
                    c,
                    u,
                    "read",
                    "referral",
                    row["id"],
                    {"facility_id": u["facility_id"]},
                )
            destinations = [
                {"id": r["id"], "name": r["name"]}
                for r in c.execute(select(s.facility)).mappings()
                if r["id"] != u["facility_id"]
            ]
            return {"items": items, "destinations": destinations}

    @app.post("/api/care-referrals")
    def create_referral(body: ReferralCreate, u=Depends(require("care.write"))):
        write()
        if u["role"] not in CLINICAL:
            raise HTTPException(403, "Referral initiation requires a clinician")
        if str(body.to_facility_id) == u["facility_id"]:
            raise HTTPException(422, "Select a different receiving facility")
        with engine.begin() as c:
            m = one(s.mother, str(body.mother_id), c)
            clinical_scope(u, m)
            if not m["consent_flags"].get("care_coordination"):
                raise HTTPException(403, "Care coordination consent required")
            one(s.facility, str(body.to_facility_id), c)
            identifier = str(uuid4())
            c.execute(
                s.referral.insert().values(
                    id=identifier,
                    from_facility_id=u["facility_id"],
                    to_facility_id=str(body.to_facility_id),
                    mother_id=str(body.mother_id),
                    reason=body.reason,
                    status="requested",
                    details={
                        "staff_handoff": True,
                        "summary": body.summary,
                        "version": 1,
                        "created_by": u["id"],
                    },
                )
            )
            audit(
                c,
                u,
                "create",
                "referral",
                identifier,
                {
                    "facility_id": u["facility_id"],
                    "to_facility_id": str(body.to_facility_id),
                    "reason": body.reason,
                    "version": 1,
                },
            )
            return {"id": identifier, "version": 1}

    @app.patch("/api/care-referrals/{identifier}")
    def referral_update(
        identifier: UUID, body: ReferralUpdate, u=Depends(require("care.write"))
    ):
        write()
        with engine.begin() as c:
            row = one(s.referral, str(identifier), c)
            if row["to_facility_id"] != u["facility_id"] or not row["details"].get(
                "staff_handoff"
            ):
                raise HTTPException(
                    403, "Only the receiving facility may update this handoff"
                )
            m = one(s.mother, row["mother_id"], c)
            if not m["consent_flags"].get("care_coordination"):
                raise HTTPException(403, "Care coordination consent revoked")
            # Receiving admin coordinates intake; consultant records completion.
            if u["role"] not in {"hospital_admin", "consultant"}:
                raise HTTPException(
                    403, "Receiving administrator or consultant required"
                )
            if body.status == "completed" and u["role"] != "consultant":
                raise HTTPException(
                    403, "Only a consultant records clinical completion"
                )
            if (
                row["details"].get("assigned_unit_id")
                and u["role"] == "consultant"
                and row["details"]["assigned_unit_id"] != u["unit_id"]
            ):
                raise HTTPException(403, "Outside assigned unit")
            allowed = {
                "requested": {"accepted", "rejected"},
                "accepted": {"arrived"},
                "arrived": {"completed"},
            }
            if body.status not in allowed.get(row["status"], set()):
                raise HTTPException(409, "Invalid referral transition")
            if row["details"]["version"] != body.version:
                raise HTTPException(409, "Referral changed; reload")
            details = {
                **row["details"],
                "version": body.version + 1,
                "outcome_notes": body.notes,
                "updated_by": u["id"],
            }
            if u["role"] == "consultant":
                details["assigned_unit_id"] = u["unit_id"]
            changed = c.execute(
                update(s.referral)
                .where(
                    s.referral.c.id == str(identifier),
                    s.referral.c.status == row["status"],
                    s.referral.c.details["version"].as_integer() == body.version,
                )
                .values(status=body.status, details=details)
            )
            if changed.rowcount != 1:
                raise HTTPException(409, "Referral changed; reload")
            audit(
                c,
                u,
                "transition",
                "referral",
                str(identifier),
                {
                    "facility_id": u["facility_id"],
                    "from_facility_id": row["from_facility_id"],
                    "before": {"status": row["status"], "details": row["details"]},
                    "after": {"status": body.status, "details": details},
                },
            )
            return {
                "id": str(identifier),
                "status": body.status,
                "version": details["version"],
            }
