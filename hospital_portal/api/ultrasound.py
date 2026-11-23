"""Patient-linked raster intake, private inference, and clinician review."""
import asyncio
import hashlib
import logging
import os
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
