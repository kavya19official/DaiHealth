"""Patient-linked raster intake, private inference, and clinician review."""
import asyncio
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from io import BytesIO
from threading import BoundedSemaphore
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, HTTPException, Query, Request, Response
from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from . import schema as s
from .clinical_monitor import ACTIVE_STAGES, canonical_status, episode, fingerprint, scoped

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 16_000_000
FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
REASONS = {
    "small_image": "The raster is below the minimum dimensions.",
    "low_contrast": "The raster has low contrast.",
    "low_detail": "The raster has little measurable detail.",
    "low_confidence": "The highest archive-label score is below the review threshold.",
    "non_normal_archive_label_score": "The experimental archive-label scores reached the priority review threshold.",
    "no_approved_model": "No approved research model is configured. The image is available for manual review.",
    "model_load_or_inference_failed": "The configured research model could not return scores.",
    "inference_timeout": "The analysis service timed out. The image is available for manual review.",
    "inference_unavailable": "The analysis service was unavailable. The image is available for manual review.",
    "research_prediction": "Experimental archive-label scores are available for clinician review.",
}
QUALITY_REASONS = {"small_image", "low_contrast", "low_detail"}
CLASSES = ("normal", "benign", "malignant")
CACHE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
a, m = s.ultrasound_analysis, s.mother
SUMMARY_COLUMNS = tuple(column for column in a.c if column.name not in {
    "image_ciphertext", "image_digest", "uploaded_by", "source_id", "episode",
})


def utc():
    return datetime.now(timezone.utc)


def aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def encode(raw, media_type):
    try:
        with Image.open(BytesIO(raw), formats=list(FORMATS.values())) as image:
            if (image.format != FORMATS[media_type] or getattr(image, "n_frames", 1) != 1
                    or image.width * image.height > MAX_PIXELS):
                raise ValueError
            # Verify PNG checksums. Reopen for full raster decoding with every format.
            image.verify()
        with Image.open(BytesIO(raw), formats=[FORMATS[media_type]]) as image:
            image.load()
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            clean = Image.frombytes("RGB", rgb.size, rgb.tobytes())
            result = BytesIO()
            clean.save(result, format="PNG")
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, "Invalid, mismatched, or unsupported single-frame image") from None
    if result.tell() > MAX_BYTES:
        raise HTTPException(413, "Re-encoded image exceeds the storage limit")
    return result.getvalue()


class Scores(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    state: Literal["quality_issue", "prediction", "priority_review", "low_confidence", "model_unavailable"]
    quality: dict[str, float] = Field(default_factory=dict)
    reasons: list[str] = Field(max_length=3)
    label: Literal["normal", "benign", "malignant"] | None = None
    probabilities: dict[str, float] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def consistent(self):
        if (set(self.quality) - {"width", "height", "std", "dynamic_range", "focus"}
                or set(self.reasons) - REASONS.keys()):
            raise ValueError("Unexpected analysis fields")
        if self.state in {"quality_issue", "model_unavailable"}:
            if any(value is not None for value in (self.label, self.probabilities, self.confidence, self.model_version)):
                raise ValueError("Scores unavailable")
            if (not self.reasons or self.state == "quality_issue" and not set(self.reasons) <= QUALITY_REASONS
                    or self.state == "model_unavailable" and not set(self.reasons) <= {
                        "no_approved_model", "model_load_or_inference_failed", "inference_timeout", "inference_unavailable"}):
                raise ValueError("Missing or invalid reason")
        else:
            scores = self.probabilities or {}
            if (set(scores) != set(CLASSES) or any(not 0 <= value <= 1 for value in scores.values())
                    or abs(sum(scores.values()) - 1) > 1e-6
                    or self.label != max(CLASSES, key=scores.__getitem__)
                    or self.confidence != scores[self.label] or not self.model_version):
                raise ValueError("Inconsistent scores")
            expected = set()
            if self.confidence < .80:
                expected.add("low_confidence")
            if self.label != "normal" or scores["benign"] + scores["malignant"] >= .30:
                expected.add("non_normal_archive_label_score")
            state = ("priority_review" if "non_normal_archive_label_score" in expected else
                     "low_confidence" if expected else "prediction")
            if self.state != state or set(self.reasons) != expected:
                raise ValueError("Inconsistent review policy")
        return self


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    decision: Literal["review_complete", "follow_up_needed", "replacement_requested"]
    note: str = Field(min_length=5, max_length=1000)


def unavailable(reason):
    return Scores(state="model_unavailable", reasons=[reason])


class Ultrasound:
    def __init__(self, config):
        self.enabled = config.get("DAI_ULTRASOUND_ENABLED") == "true"
        if not self.enabled:
            return
        key = config.get("DAI_ULTRASOUND_IMAGE_KEY", "")
        try:
            if len(key) != 64:
                raise ValueError
            decoded = bytes.fromhex(key)
            if len(decoded) != 32:
                raise ValueError
            self.cipher = AESGCM(decoded)
        except ValueError:
            raise RuntimeError("DAI_ULTRASOUND_IMAGE_KEY must be a 64-digit hex key") from None
        self.token = config.get("DAI_ULTRASOUND_SERVICE_TOKEN", "")
        if len(self.token) < 32:
            raise RuntimeError("DAI_ULTRASOUND_SERVICE_TOKEN must have at least 32 characters")
        origin = urlsplit(config.get("DAI_ULTRASOUND_ML_ORIGIN", "http://127.0.0.1:8200"))
        if (not origin.hostname or origin.username or origin.password or origin.query or origin.fragment
                or origin.path not in {"", "/"} or (origin.scheme != "https" and
                    (origin.scheme != "http" or origin.hostname not in {"127.0.0.1", "localhost", "::1"}))):
            raise RuntimeError("DAI_ULTRASOUND_ML_ORIGIN must be loopback HTTP or private HTTPS")
        self.url = origin.geturl().rstrip("/") + "/internal/ultrasound/analyze"
        self.retention = int(config.get("DAI_ULTRASOUND_IMAGE_RETENTION_DAYS", "30"))
        if not 1 <= self.retention <= 365:
            raise RuntimeError("DAI_ULTRASOUND_IMAGE_RETENTION_DAYS must be between 1 and 365")
        self.inflight = BoundedSemaphore(2)

    def encrypt(self, identifier, image):
        nonce = os.urandom(12)
        return nonce + self.cipher.encrypt(nonce, image, identifier.encode())

    def decrypt(self, identifier, payload):
        try:
            return self.cipher.decrypt(payload[:12], payload[12:], identifier.encode())
        except (InvalidTag, ValueError):
            raise HTTPException(503, "Private image could not be opened") from None

    async def analyze(self, png):
        try:
            async with asyncio.timeout(8):
                async with httpx.AsyncClient(timeout=7.5, trust_env=False) as client:
                    reply = await client.post(self.url, content=png, headers={
                        "Authorization": "Bearer " + self.token, "Content-Type": "image/png",
                    })
                    reply.raise_for_status()
                    return Scores.model_validate(reply.json())
        except (TimeoutError, httpx.TimeoutException):
            return unavailable("inference_timeout")
        except (httpx.HTTPError, ValueError):
            return unavailable("inference_unavailable")


def purge_expired(engine):
    with engine.begin() as conn:
        candidates = select(a.c.id).where(a.c.image_expires_at <= utc(),
                                        a.c.image_ciphertext.is_not(None)).limit(100)
        return conn.execute(update(a).where(a.c.id.in_(candidates))
                            .values(image_ciphertext=None, updated_at=a.c.updated_at)).rowcount


async def retention_loop(engine):
    while True:
        try:
            removed = await asyncio.to_thread(purge_expired, engine)
        except Exception as error:
            logging.getLogger(__name__).error("Ultrasound retention sweep failed (%s)", type(error).__name__)
            removed = 0
        await asyncio.sleep(1 if removed == 100 else 300)


def register_ultrasound(app, engine, require, audit, demo, service):
    def enabled():
        if not service.enabled:
            raise HTTPException(503, "Ultrasound intake is disabled")

    def patient_scope(user):
        return [*scoped(user, demo), m.c.assigned_unit_id.is_not(None)]

    def find_patient(conn, user, identifier, *, lock=False):
        stmt = select(m).where(m.c.id == identifier, *patient_scope(user))
        if lock:
            stmt = stmt.with_for_update(of=m)
        mother = conn.execute(stmt).mappings().first()
        if not mother:
            raise HTTPException(404, "No consented patient in your scope")
        return mother

    def selected(user, *columns):
        return select(*columns).join(m, m.c.id == a.c.mother_id).where(
            a.c.facility_id == m.c.registered_facility_id, *patient_scope(user))

    def find_analysis(conn, user, identifier, *columns, lock=False):
        stmt = selected(user, *columns).where(a.c.id == identifier)
        if lock:
            stmt = stmt.with_for_update(of=m)
        record = conn.execute(stmt).mappings().first()
        if not record:
            raise HTTPException(404, "No ultrasound record in your scope")
        return record

    def public_row(row):
        item = {column.name: row[column.name] for column in SUMMARY_COLUMNS}
        item["patient_name"] = row["patient_details"].get("name") or row["uhid"]
        item["uhid"] = row["uhid"]
        item["image_available"] = bool(row["has_image"]) and aware(row["image_expires_at"]) > utc()
        item["review_status"] = "reviewed" if row["reviewed_at"] else "pending"
        codes = item["analysis"]["reasons"] or ["research_prediction"]
        item["reasons"] = [REASONS[code] for code in codes]
        for key in ("created_at", "updated_at", "image_expires_at", "reviewed_at"):
            if item[key]:
                item[key] = aware(item[key])
        return item

    display = (*SUMMARY_COLUMNS, m.c.details.label("patient_details"), m.c.uhid,
               a.c.image_ciphertext.is_not(None).label("has_image"))

    @app.get("/api/ultrasound")
    def queue(reviewed: bool = False, offset: int = Query(0, ge=0, le=10000),
              u=Depends(require("ultrasound.read"))):
        if not service.enabled:
            return {"enabled": False, "items": [], "has_more": False}
        condition = a.c.reviewed_at.is_not(None) if reviewed else a.c.reviewed_at.is_(None)
        with engine.begin() as conn:
            rows = conn.execute(selected(u, *display).where(condition).order_by(
                a.c.priority.desc(), a.c.created_at.desc(), a.c.id).offset(offset).limit(26)).mappings().all()
            for row in rows[:25]:
                audit(conn, u, "read", "ultrasound_analysis", row["id"])
            return {"enabled": True, "items": [public_row(row) for row in rows[:25]], "has_more": len(rows) > 25}

    @app.get("/api/ultrasound/capability")
    def capability(u=Depends(require("ultrasound.read"))):
        return {"enabled": service.enabled}

    @app.get("/api/ultrasound/{identifier}")
    def detail(identifier: UUID, u=Depends(require("ultrasound.read"))):
        enabled()
        with engine.begin() as conn:
            row = find_analysis(conn, u, str(identifier), *display)
            audit(conn, u, "read", "ultrasound_analysis", row["id"])
            return public_row(row)

    @app.post("/api/ultrasound/patients/{mother_id}", status_code=201)
    async def upload(mother_id: UUID, request: Request, response: Response,
                     u=Depends(require("ultrasound.upload"))):
        enabled()
        mid = str(mother_id)

        def authorized():
            with engine.begin() as conn:
                mother = find_patient(conn, u, mid)
                anchor = episode(mother)
                if (canonical_status(mother["details"].get("stage")) not in ACTIVE_STAGES
                        or mother["details"].get("outcome_date") or not anchor):
                    raise HTTPException(409, "Upload requires an active pregnancy with a recorded episode or pregnancy dates")
                return anchor

        anchor = await run_in_threadpool(authorized)
        media_type = request.headers.get("content-type", "")
        if media_type not in FORMATS:
            raise HTTPException(415, "Use a PNG, JPEG, or WebP raster image")
        if not service.inflight.acquire(blocking=False):
            raise HTTPException(503, "Ultrasound intake is busy. Try again shortly.")
        try:
            raw = bytearray()
            try:
                async with asyncio.timeout(20):
                    async for chunk in request.stream():
                        if len(raw) + len(chunk) > MAX_BYTES:
                            raise HTTPException(413, "Image exceeds the 12 MiB limit")
                        raw.extend(chunk)
            except TimeoutError:
                raise HTTPException(408, "Image upload timed out") from None
            except ClientDisconnect:
                raise HTTPException(400, "Image upload was interrupted") from None
            png = await run_in_threadpool(encode, bytes(raw), media_type)
            digest = hashlib.sha256(png).hexdigest()
            matches = (a.c.mother_id == mid, a.c.facility_id == u["facility_id"],
                       a.c.episode == anchor, a.c.image_digest == digest)

            def check(conn, lock=False):
                mother = find_patient(conn, u, mid, lock=lock)
                if (episode(mother) != anchor or mother["details"].get("outcome_date")
                        or canonical_status(mother["details"].get("stage")) not in ACTIVE_STAGES):
                    raise HTTPException(409, "Pregnancy episode changed. Open the patient record again.")
                return mother

            def duplicate():
                with engine.begin() as conn:
                    check(conn)
                    return conn.scalar(select(a.c.id).where(*matches))

            old = await run_in_threadpool(duplicate)
            if old:
                response.status_code = 200
                return {"id": old, "duplicate": True}
            scores = await service.analyze(png)
            identifier = str(uuid4())
            ciphertext = await run_in_threadpool(service.encrypt, identifier, png)

            def persist():
                with engine.begin() as conn:
                    mother = check(conn, lock=True)
                    existing = conn.scalar(select(a.c.id).where(*matches))
                    if existing:
                        return existing, True
                    conn.execute(a.insert().values(
                        id=identifier, mother_id=mid, facility_id=u["facility_id"], uploaded_by=u["id"],
                        episode=anchor, image_digest=digest, image_ciphertext=ciphertext,
                        image_expires_at=utc() + timedelta(days=service.retention),
                        pregnancy_context={"stage": mother["details"].get("stage"),
                                           "gestation_weeks": mother["gestation_weeks"], "edd": mother["edd"]},
                        analysis=scores.model_dump(exclude_none=True), revision=1,
                        priority=2 if scores.state == "priority_review" else 1,
                    ))
                    audit(conn, u, "upload", "ultrasound_analysis", identifier, {
                        "mother_id": mid, "analysis_state": scores.state, "model_version": scores.model_version,
                    })
                    return identifier, False

            identifier, repeated = await run_in_threadpool(persist)
            if repeated:
                response.status_code = 200
            return {"id": identifier, "duplicate": repeated}
        finally:
            service.inflight.release()

    @app.get("/api/ultrasound/{identifier}/image")
    def image(identifier: UUID, u=Depends(require("ultrasound.read"))):
        enabled()
        key = str(identifier)
        with engine.begin() as conn:
            record = find_analysis(conn, u, key, a.c.image_ciphertext, a.c.image_expires_at)
            if not record["image_ciphertext"] or aware(record["image_expires_at"]) <= utc():
                raise HTTPException(410, "The image retention period has ended")
            png = service.decrypt(key, record["image_ciphertext"])
            audit(conn, u, "read_image", "ultrasound_analysis", key)
        return Response(png, media_type="image/png", headers=CACHE)

    @app.post("/api/ultrasound/{identifier}/retry")
    async def retry(identifier: UUID, u=Depends(require("ultrasound.upload"))):
        enabled()
        key = str(identifier)

        def read():
            with engine.begin() as conn:
                row = find_analysis(conn, u, key, a.c.analysis, a.c.revision, a.c.reviewed_at,
                                    a.c.image_ciphertext, a.c.image_expires_at)
                if row["reviewed_at"] or row["analysis"]["state"] != "model_unavailable":
                    raise HTTPException(409, "Only pending records with unavailable inference can be retried")
                if not row["image_ciphertext"] or aware(row["image_expires_at"]) <= utc():
                    raise HTTPException(410, "The image retention period has ended")
                audit(conn, u, "retry_requested", "ultrasound_analysis", key)
                return row

        if not service.inflight.acquire(blocking=False):
            raise HTTPException(503, "Ultrasound intake is busy. Try again shortly.")
        try:
            row = await run_in_threadpool(read)
            png = await run_in_threadpool(service.decrypt, key, row["image_ciphertext"])
            scores = await service.analyze(png)

            def save():
                with engine.begin() as conn:
                    find_analysis(conn, u, key, a.c.id, lock=True)
                    changed = conn.execute(update(a).where(a.c.id == key, a.c.revision == row["revision"],
                        a.c.reviewed_at.is_(None), a.c.image_expires_at > utc()).values(
                            revision=row["revision"] + 1, analysis=scores.model_dump(exclude_none=True),
                            priority=2 if scores.state == "priority_review" else 1)).rowcount
                    if not changed:
                        raise HTTPException(409, "This record changed while analysis was running")
                    audit(conn, u, "retry", "ultrasound_analysis", key, {
                        "revision": row["revision"] + 1, "analysis_state": scores.state,
                        "model_version": scores.model_version,
                    })

            await run_in_threadpool(save)
            return {"id": key, "state": scores.state}
        finally:
            service.inflight.release()

    @app.post("/api/ultrasound/{identifier}/review")
    def review(identifier: UUID, body: Review, u=Depends(require("ultrasound.review"))):
        enabled()
        key = str(identifier)
        note = body.note.strip()
        if len(note) < 5:
            raise HTTPException(422, "Enter a review note of at least five characters")
        with engine.begin() as conn:
            record = find_analysis(conn, u, key, a.c.mother_id, lock=True)
            reviewed_at = utc()
            changed = conn.execute(update(a).where(a.c.id == key, a.c.reviewed_at.is_(None),
                                                   a.c.revision == body.revision).values(
                reviewed_by=u["id"], reviewed_at=reviewed_at, decision=body.decision, review_note=note)).rowcount
            if not changed:
                raise HTTPException(409, "This analysis changed or was already reviewed. Refresh the record.")
            flags = s.clinical_monitor_flag
            flag = conn.execute(select(flags).where(flags.c.mother_id == record["mother_id"],
                flags.c.rule_key == "ultrasound:" + key, flags.c.active.is_(True))).mappings().first()
            if flag:
                evidence = flag["evidence"]
                evidence[0]["values"].update(review_status="reviewed", review_decision=body.decision)
                finding = {column: flag[column] for column in (
                    "rule_key", "rule_version", "priority", "summary", "action", "reference_url", "evidence",
                )}
                finding["summary"] = flag["summary"].replace(
                    "Ultrasound awaiting clinician review.", "Reviewed ultrasound.", 1)
                conn.execute(update(flags).where(flags.c.id == flag["id"]).values(
                    summary=finding["summary"], evidence=evidence, fingerprint=fingerprint(finding),
                    reviewed_by=u["id"], reviewed_at=reviewed_at, review_note=note))
            audit(conn, u, "review", "ultrasound_analysis", key, {
                "decision": body.decision, "revision": body.revision,
            })
        return {"reviewed": True}
