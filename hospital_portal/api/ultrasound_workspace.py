"""Private account-scoped ultrasound workspace, called by the DaiHealth gateway."""
import asyncio
import hashlib
import secrets
from datetime import timedelta
from typing import Literal
from uuid import UUID, uuid4

import jwt
from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from . import schema as s
from .ultrasound_processing import ACTIVE, assessment, queued
from .ultrasound import CACHE, FORMATS, MAX_BYTES, REASONS, aware, encode, utc

scans = s.ultrasound_workspace_scan
old = s.ultrasound_analysis
decisions = Literal["review_complete", "follow_up_needed", "replacement_requested"]
identifier = Field(gt=0, le=2147483647)
metadata = tuple(c for c in scans.c if c.name not in {"image_ciphertext", "image_digest", "source_id"})


class Grant(BaseModel):
    role: Literal["mother", "doctor"]
    actor: int = identifier
    patient: int = identifier
    doctor: int | None = None
    facilities: list[str] = Field(default_factory=list, max_length=100)
    facility: str = Field(default="", max_length=64)
    episode: str | None = Field(default=None, max_length=40)
    context: dict = Field(default_factory=dict)
    portal_patient: UUID | None = None
    portal_doctor: UUID | None = None
    offset: int = Field(default=0, ge=0, le=100000)


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    revision: int = Field(ge=1)
    decision: decisions
    note: str = Field(default="", max_length=2000)
    interpretation: Literal["confirmed", "corrected", "rejected", "independent"] | None = None
    findings: str = Field(min_length=5, max_length=2000)
    instructions: str = Field(min_length=5, max_length=2000)


class Revision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)


def audit(conn, grant, event, scan_id, **details):
    conn.execute(s.audit_log.insert().values(
        action=event, entity_type="ultrasound_workspace_scan", entity_id=scan_id,
        details={"workspace_actor_id": grant.actor, "workspace_role": grant.role,
                 "workspace_patient_id": grant.patient, **details},
    ))


def safe_record(row, role):
    released = bool(row["released_at"])
    analysis = row["analysis"] or {}
    processing = analysis.get("state") in ACTIVE
    record = dict(
        id=row["id"], created_at=aware(row["created_at"]), doctor_id=row["doctor_account_id"],
        image_available=row["image_available"] and aware(row["image_expires_at"]) > utc(),
        status="reviewed" if released else "under_review" if row["started_at"] else "pending",
        report=None,
        assessment=assessment(analysis),
        processing=processing,
        demo_image=bool(((row["analysis"] or {}).get("measurements") or {}).get("demo")),
    )
    if (analysis.get("state") == "model_unavailable" and record["image_available"]
            and not row["reviewed_at"] and not released and not record["demo_image"]):
        record["retry_revision"] = row["revision"]
    if released:
        record["report"] = dict(
            findings=row["findings"], instructions=row["instructions"], decision=row["decision"],
            released_at=aware(row["released_at"]),
            measurements=analysis.get("measurements"),
        )
    if role == "doctor":
        record.update(
            analysis={k: v for k, v in analysis.items() if k != "lease"},
            pregnancy_context=row["pregnancy_context"], revision=row["revision"],
            reasons=[] if processing else [REASONS[code] for code in
                (analysis.get("reasons") or (["research_prediction"] if analysis.get("probabilities") else []))
                if code in REASONS],
            draft=None if not row["reviewed_at"] else dict(
                findings=row["findings"], instructions=row["instructions"], decision=row["decision"],
                reviewed_at=aware(row["reviewed_at"]),
                interpretation=analysis.get("clinician_interpretation"),
            ),
            note=row["review_note"],
        )
    return record


def register_workspace(app, engine, service, key, demo=False):
    def authorize(request):
        if not service.enabled:
            raise HTTPException(503, "Ultrasound is disabled")
        token = request.headers.get("x-dai-ultrasound-workspace", "")
        try:
            claims = jwt.decode(token, key, algorithms=["HS256"], issuer="dai-workspace",
                                audience="dai-ultrasound-workspace", options={"require": ["exp", "iat"]})
            grant = Grant.model_validate(claims)
            if (claims["path"] != request.url.path or claims["method"] != request.method
                    or grant.role == "mother" and grant.actor != grant.patient
                    or grant.role == "doctor" and grant.actor != grant.doctor):
                raise ValueError
            return grant, claims["sha256"]
        except (jwt.PyJWTError, ValidationError, ValueError, KeyError):
            raise HTTPException(401, "Workspace authorization required") from None

    def scope(grant):
        conditions = [scans.c.patient_account_id == grant.patient]
        if grant.role == "doctor":
            conditions += [scans.c.doctor_account_id == grant.actor,
                           scans.c.facility_ref.in_(grant.facilities)]
        return conditions

    def row_for(conn, grant, scan_id, *columns):
        row = conn.execute(select(*columns).where(*scope(grant), scans.c.id == scan_id)).mappings().first()
        if not row:
            raise HTTPException(404, "Scan not available")
        return row

    def legacy_rows(grant):
        if not demo or grant.role != "doctor" or not grant.portal_patient or not grant.portal_doctor:
            return None
        from .clinical_monitor import consent_scope
        m = s.mother
        d = s.user
        return old.join(m, old.c.mother_id == m.c.id).join(d, m.c.assigned_doctor_id == d.c.id), (
            m.c.id == str(grant.portal_patient), d.c.id == str(grant.portal_doctor),
            d.c.role.in_(("consultant", "resident")), d.c.verified.is_(True),
            d.c.registration_no.is_not(None), d.c.department_id.is_not(None),
            m.c.assigned_unit_id == d.c.unit_id, d.c.facility_id == old.c.facility_id,
            old.c.facility_id == m.c.registered_facility_id, consent_scope(True),
        )

    display = (*metadata, scans.c.image_ciphertext.is_not(None).label("image_available"))

    @app.get("/internal/ultrasound-workspace/scans", include_in_schema=False)
    def history(request: Request, response: Response):
        grant, _ = authorize(request)
        response.headers.update(CACHE)
        legacy = []
        with engine.begin() as conn:
            rows = conn.execute(select(*display).where(*scope(grant)).order_by(
                scans.c.created_at.desc(), scans.c.id).offset(grant.offset).limit(26)).mappings().all()
            for row in rows[:25]:
                audit(conn, grant, "workspace_read", row["id"])
            if transfer := legacy_rows(grant):
                source, conditions = transfer
                history = conn.execute(select(old.c.id, old.c.created_at, old.c.reviewed_at,
                    old.c.pregnancy_context, old.c.review_note, old.c.decision, old.c.analysis, old.c.image_expires_at,
                    old.c.image_ciphertext.is_not(None).label("image_available")).select_from(source)
                    .where(*conditions).order_by(old.c.created_at.desc(), old.c.id)
                    .offset(grant.offset).limit(26)).mappings().all()
                for record in history[:25]:
                    legacy.append(dict(record, image_available=record["image_available"] and
                                       aware(record["image_expires_at"]) > utc()))
                    audit(conn, grant, "workspace_read_archive", record["id"])
        return {"items": [safe_record(row, grant.role) for row in rows[:25]], "archived": legacy,
                "has_more": len(rows) > 25 or bool(legacy and len(history) > 25)}

    @app.get("/internal/ultrasound-workspace/scans/{scan_id}", include_in_schema=False)
    def detail(scan_id: UUID, request: Request, response: Response):
        grant, _ = authorize(request)
        response.headers.update(CACHE)
        with engine.connect() as conn:
            return safe_record(row_for(conn, grant, str(scan_id), *display), grant.role)

    async def body(request, maximum, digest):
        data = bytearray()
        try:
            async with asyncio.timeout(20):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > maximum:
                        raise HTTPException(413, "Request exceeds the upload limit")
                    data.extend(chunk)
        except (TimeoutError, ClientDisconnect):
            raise HTTPException(408, "Upload interrupted or timed out") from None
        if not secrets.compare_digest(hashlib.sha256(data).hexdigest(), digest):
            raise HTTPException(401, "Invalid workspace request")
        return bytes(data)

    @app.post("/internal/ultrasound-workspace/scans", include_in_schema=False, status_code=201)
    async def upload(request: Request, response: Response):
        grant, digest = authorize(request)
        response.headers.update(CACHE)
        media = request.headers.get("content-type")
        if media not in FORMATS:
            raise HTTPException(415, "Choose a PNG, JPEG, or WebP image")
        if not grant.episode or not grant.doctor or grant.facility not in grant.facilities:
            raise HTTPException(409, "Choose a verified care-team doctor and confirm sharing for this pregnancy")
        if not service.inflight.acquire(blocking=False):
            raise HTTPException(503, "Ultrasound intake is busy. Try again shortly.")
        try:
            raw = await body(request, MAX_BYTES, digest)
            png = await run_in_threadpool(encode, raw, media)
            image_digest = hashlib.sha256(png).hexdigest()
            matches = (scans.c.patient_account_id == grant.patient, scans.c.doctor_account_id == grant.doctor,
                       scans.c.facility_ref == grant.facility, scans.c.episode == grant.episode,
                       scans.c.image_digest == image_digest)

            def existing():
                with engine.connect() as conn:
                    return conn.execute(select(scans.c.id, scans.c.image_expires_at).where(*matches)).first()

            duplicate = await run_in_threadpool(existing)
            if duplicate:
                if aware(duplicate.image_expires_at) <= utc():
                    raise HTTPException(409, "An older copy of this frame expired. Submit a new capture.")
                response.status_code = 200
                return {"id": duplicate.id, "duplicate": True}
            scan_id = str(uuid4())
            encrypted = await run_in_threadpool(service.encrypt, scan_id, png)

            def save():
                with engine.begin() as conn:
                    conn.execute(scans.insert().values(
                        id=scan_id, patient_account_id=grant.patient, doctor_account_id=grant.doctor,
                        facility_ref=grant.facility, episode=grant.episode, image_digest=image_digest,
                        image_expires_at=utc()+timedelta(days=service.retention), image_ciphertext=encrypted,
                        analysis=queued(), pregnancy_context=grant.context, revision=1,
                    ))
                    audit(conn, grant, "workspace_upload", scan_id, sharing_confirmed=True,
                          workspace_doctor_id=grant.doctor, workspace_facility_ref=grant.facility)
            try:
                await run_in_threadpool(save)
            except IntegrityError:
                duplicate = await run_in_threadpool(existing)
                if not duplicate:
                    raise
                response.status_code = 200
                return {"id": duplicate.id, "duplicate": True}
            return {"id": scan_id, "duplicate": False}
        finally:
            service.inflight.release()

    @app.get("/internal/ultrasound-workspace/scans/{scan_id}/image", include_in_schema=False)
    def image(scan_id: UUID, request: Request):
        grant, _ = authorize(request)
        scan_id = str(scan_id)
        with engine.begin() as conn:
            row = conn.execute(select(scans.c.image_ciphertext, scans.c.image_expires_at)
                               .where(*scope(grant), scans.c.id == scan_id)).mappings().first()
            if not row and (transfer := legacy_rows(grant)):
                source, conditions = transfer
                row = conn.execute(select(old.c.image_ciphertext, old.c.image_expires_at).select_from(source)
                                   .where(*conditions, old.c.id == scan_id)).mappings().first()
            if not row:
                raise HTTPException(404, "Scan not available")
            if not row["image_ciphertext"] or aware(row["image_expires_at"]) <= utc():
                raise HTTPException(410, "This image has reached its retention limit")
            png = service.decrypt(scan_id, row["image_ciphertext"])
            audit(conn, grant, "workspace_image_read", scan_id)
        return Response(png, media_type="image/png", headers=CACHE)

    @app.post("/internal/ultrasound-workspace/scans/{scan_id}/{action}", include_in_schema=False)
    async def change(scan_id: UUID, action: Literal["start", "review", "release", "retry"],
                     request: Request, response: Response):
        grant, digest = authorize(request)
        response.headers.update(CACHE)
        if grant.role != "doctor" and action != "retry":
            raise HTTPException(403, "Clinician account required")
        scan_id = str(scan_id)
        raw = await body(request, 16000, digest)
        try:
            form = (Review if action == "review" else Revision).model_validate_json(raw)
        except ValidationError:
            raise HTTPException(422, "Provide the current revision and all required review fields") from None

        def save():
            with engine.begin() as conn:
                row = row_for(conn, grant, scan_id, *metadata)
                if row["released_at"] or row["revision"] != form.revision:
                    raise HTTPException(409, "This scan changed. Refresh its history.")
                if row["analysis"].get("state") in ACTIVE:
                    raise HTTPException(409, "Wait for the current analysis to finish")
                now = utc()
                values = {"revision": form.revision+1}
                if action == "start":
                    if row["started_at"]:
                        return
                    values["started_at"] = now
                elif action == "review":
                    if form.interpretation not in {None, "independent"} and not row["analysis"].get("probabilities"):
                        raise HTTPException(422, "Record an independent review when AI scores are unavailable")
                    values.update(analysis={**row["analysis"], "clinician_interpretation": form.interpretation},
                                  started_at=row["started_at"] or now, reviewed_at=now,
                                  decision=form.decision, review_note=form.note,
                                  findings=form.findings, instructions=form.instructions)
                elif action == "release":
                    if not row["reviewed_at"]:
                        raise HTTPException(409, "Save clinical findings before releasing the report")
                    values["released_at"] = now
                else:
                    if aware(row["image_expires_at"]) <= now:
                        raise HTTPException(410, "This image has reached its retention limit")
                    if (row["reviewed_at"] or row["analysis"]["state"] != "model_unavailable"
                            or (row["analysis"].get("measurements") or {}).get("demo")):
                        raise HTTPException(409, "Only unavailable analysis can be retried before review")
                    values["analysis"] = queued()
                changed = conn.execute(update(scans).where(*scope(grant), scans.c.id == scan_id,
                    scans.c.revision == form.revision, scans.c.released_at.is_(None)).values(**values)).rowcount
                if not changed:
                    raise HTTPException(409, "This scan changed. Refresh its history.")
                audit(conn, grant, "workspace_" + action, scan_id)
        await run_in_threadpool(save)
        return {"saved": True}
