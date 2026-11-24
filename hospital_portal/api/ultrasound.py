"""Patient-linked raster intake, private inference, and clinician review."""
import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from io import BytesIO
from threading import BoundedSemaphore
from typing import Literal
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update

from . import schema as s

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 16_000_000
FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
REASONS = {
    "small_image": "The raster is below the minimum dimensions.",
    "low_contrast": "The raster has low contrast.",
    "low_detail": "The raster has little measurable detail.",
    "unusable_views": "The individual views did not pass the image quality checks.",
    "low_confidence": "The highest archive-label score is below the review threshold.",
    "non_normal_archive_label_score": "The experimental archive-label scores met a research review rule. These scores do not establish clinical urgency.",
    "no_approved_model": "No approved research model is configured. The image is available for manual review.",
    "model_load_or_inference_failed": "The configured research model could not return scores.",
    "inference_timeout": "The analysis service timed out. The image is available for manual review.",
    "inference_unavailable": "The analysis service was unavailable. The image is available for manual review.",
    "research_prediction": "Experimental archive-label scores are available for clinician review.",
}
QUALITY_REASONS = {"small_image", "low_contrast", "low_detail", "unusable_views"}
CLASSES = ("normal", "benign", "malignant")
CACHE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
a = s.ultrasound_analysis


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


class PlaneFinding(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    view: Literal["whole", "top", "bottom"]
    state: Literal["classified", "quality_issue"]
    label: Literal["three_vessel", "four_chamber", "abdomen", "background",
                   "brain_cerebellum", "brain_transventricular", "femur", "kidneys",
                   "lips", "left_outflow", "profile", "right_outflow",
                   "spine_coronal", "spine_sagittal"] | None = None
    score: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def consistent(self):
        if self.state == "classified":
            if self.label is None or self.score is None:
                raise ValueError("Plane result requires a label and score")
        elif self.label is not None or self.score is not None:
            raise ValueError("Skipped view cannot contain a score")
        return self


class Scores(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    state: Literal["quality_issue", "prediction", "priority_review", "low_confidence", "model_unavailable", "plane_analysis"]
    quality: dict[str, float] = Field(default_factory=dict)
    reasons: list[str] = Field(max_length=3)
    label: Literal["normal", "benign", "malignant"] | None = None
    probabilities: dict[str, float] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    planes: list[PlaneFinding] | None = Field(default=None, min_length=1, max_length=2)
    model_version: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def consistent(self):
        if (set(self.quality) - {"width", "height", "std", "dynamic_range", "focus"}
                or set(self.reasons) - REASONS.keys()):
            raise ValueError("Unexpected analysis fields")
        if self.state == "plane_analysis":
            views = tuple(view.view for view in self.planes or ())
            if (views not in {("whole",), ("top", "bottom")} or not self.model_version or self.reasons
                    or any(value is not None for value in (self.label, self.probabilities, self.confidence))
                    or not any(view.state == "classified" for view in self.planes)):
                raise ValueError("Inconsistent scan-view output")
            return self
        if self.planes is not None:
            raise ValueError("Unexpected scan-view output")
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
        self.origin = origin.geturl().rstrip("/") + "/internal/ultrasound"
        self.url = self.origin + "/analyze"
        self._status_cache = None
        self._status_expires = 0
        self._status_lock = asyncio.Lock()
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

    async def model_status(self):
        clock = asyncio.get_running_loop().time
        async with self._status_lock:
            if self._status_cache is not None and clock() < self._status_expires:
                return self._status_cache
            status = {"state": "service_unreachable"}
            try:
                async with asyncio.timeout(5):
                    async with httpx.AsyncClient(trust_env=False) as client:
                        reply = await client.get(self.origin + "/status", headers={
                            "Authorization": "Bearer " + self.token,
                        })
                        if reply.status_code == 200:
                            data = reply.json()
                            state = data.get("state") if isinstance(data, dict) else None
                            if state in ("disabled", "warming", "model_error"):
                                status = {"state": state}
                            elif state == "ready" and data.get("model") in ("sononet16", "archive"):
                                status = {"state": state, "model": data["model"]}
                                runtime = data.get("runtime")
                                if isinstance(runtime, str) and re.fullmatch(r"[a-z0-9-]{1,32}", runtime):
                                    status["runtime"] = runtime
                        elif reply.status_code == 404:
                            status = {"state": "service_outdated"}
                        elif reply.status_code in (401, 403):
                            status = {"state": "service_auth_error"}
            except (TimeoutError, httpx.HTTPError, ValueError):
                pass
            self._status_cache = status
            interval = {"service_unreachable": 1, "warming": 1, "model_error": 15}
            self._status_expires = clock() + interval.get(status["state"], 5)
            return status

    async def analyze(self, png, progress=None):
        try:
            async with asyncio.timeout(85):
                async with httpx.AsyncClient(timeout=httpx.Timeout(80, connect=5), trust_env=False) as client:
                    async with client.stream("POST", self.url, content=png, headers={
                        "Authorization": "Bearer " + self.token, "Content-Type": "image/png",
                        "Accept": "application/x-ndjson",
                    }) as reply:
                        reply.raise_for_status()
                        if reply.headers.get("content-type", "").split(";")[0] != "application/x-ndjson":
                            return Scores.model_validate_json(await reply.aread())
                        async for line in reply.aiter_lines():
                            event = json.loads(line)
                            if "error" in event:
                                return unavailable("inference_unavailable")
                            if "result" in event:
                                return Scores.model_validate(event["result"])
                            if progress and event.get("stage") in {"quality", "model_loading", "preprocessing", "inference"}:
                                await progress(event["stage"])
                        return unavailable("inference_unavailable")
        except (TimeoutError, httpx.TimeoutException):
            return unavailable("inference_timeout")
        except (httpx.HTTPError, ValueError):
            return unavailable("inference_unavailable")


def purge_expired(engine):
    with engine.begin() as conn:
        removed = 0
        for table in (a, s.ultrasound_workspace_scan):
            candidates = select(table.c.id).where(table.c.image_expires_at <= utc(),
                                                  table.c.image_ciphertext.is_not(None)).limit(100)
            removed += conn.execute(update(table).where(table.c.id.in_(candidates))
                .values(image_ciphertext=None, updated_at=table.c.updated_at)).rowcount
        return removed


async def retention_loop(engine):
    while True:
        try:
            removed = await asyncio.to_thread(purge_expired, engine)
        except Exception as error:
            logging.getLogger(__name__).error("Ultrasound retention sweep failed (%s)", type(error).__name__)
            removed = 0
        await asyncio.sleep(1 if removed >= 100 else 300)
