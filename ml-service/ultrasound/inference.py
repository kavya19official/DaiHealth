"""Authenticated stateless inference on the existing DaiHealth ML service."""
import asyncio
import json
import math
import os
from pathlib import Path
import secrets
from threading import BoundedSemaphore

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import numpy as np
from PIL import Image
from scipy.special import softmax
from starlette.concurrency import run_in_threadpool

from .audit import CLASSES, VERSION, sha_file
from .imaging import MAX_BYTES, PREPROCESS, QUALITY, decode, preprocess, quality
from .training import LOW_CONFIDENCE, NON_NORMAL_SCORE, WEIGHTS

bearer = HTTPBearer(auto_error=False)
CACHE = {"Cache-Control": "no-store"}


def load_model(directory):
    metadata = json.loads((directory/"model.json").read_text())
    if (metadata.get("schema") != 1 or not metadata.get("research_only")
        or metadata.get("architecture") != "efficientnet_b0" or metadata.get("classes") != CLASSES
        or metadata.get("preprocess") != PREPROCESS or metadata.get("quality") != QUALITY
        or metadata.get("review_policy") != {"low_confidence":LOW_CONFIDENCE,"non_normal_score":NON_NORMAL_SCORE}):
        raise ValueError("Incompatible model manifest")
    # Only serve an audited and evaluated research artifact from a trusted local directory.
    approval = json.loads((directory/"release.json").read_text())
    if (approval.get("approved_for_research_inference") is not True
        or approval.get("model_manifest_sha256") != sha_file(directory/"model.json")
        or not isinstance(approval.get("reviewer"),str) or not approval["reviewer"].strip()):
        raise ValueError("Inference requires recorded evaluation review")
    if sha_file(directory/WEIGHTS) != metadata.get("weights_sha256") or (
        sha_file(directory/"report.json") != metadata.get("report_sha256")):
        raise ValueError("Model or evaluation artifact hash mismatch")
    audit_path=directory/"dataset_audit.json"
    if sha_file(audit_path)!=metadata.get("audit_sha256"):
        raise ValueError("Dataset audit hash mismatch")
    audit=json.loads(audit_path.read_text())
    if (audit.get("audit_version")!=VERSION or audit.get("blockers")!=[]
        or audit.get("patient_groups",{}).get("complete") is not True
        or audit.get("archive_sha256")!=metadata.get("archive_sha256")):
        raise ValueError("Dataset audit does not authorize an evaluated model")
    temperature = metadata.get("temperature")
    if type(temperature) not in (int,float) or not math.isfinite(temperature) or temperature<=0:
        raise ValueError("Invalid calibration temperature")
    import torch
    from torchvision.models import efficientnet_b0
    model = efficientnet_b0(weights=None)
    model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features,len(CLASSES))
    model.load_state_dict(torch.load(directory/WEIGHTS,map_location="cpu",weights_only=True))
    model.eval()

    def predict(image):
        with torch.inference_mode():
            logits=model(torch.from_numpy(preprocess(image)).unsqueeze(0))[0].numpy().astype(np.float64)
        return softmax(logits/temperature)

    return predict, approval["model_manifest_sha256"]


def score_image(predictor, model_id, image):
    scores = np.asarray(predictor(image), dtype=np.float64)
    if (scores.shape != (len(CLASSES),) or not np.isfinite(scores).all()
            or (scores < 0).any() or (scores > 1).any() or not np.isclose(scores.sum(), 1, atol=1e-6, rtol=0)):
        raise ValueError("Invalid model probabilities")
    index = int(scores.argmax())
    confidence = float(scores[index])
    reasons = []
    if confidence < LOW_CONFIDENCE:
        reasons.append("low_confidence")
    if index != 0 or scores[1:].sum() >= NON_NORMAL_SCORE:
        reasons.append("non_normal_archive_label_score")
    return dict(
        state="priority_review" if "non_normal_archive_label_score" in reasons
        else "low_confidence" if reasons else "prediction",
        label=CLASSES[index], probabilities=dict(zip(CLASSES, map(float, scores))),
        confidence=confidence, model_version=model_id, reasons=reasons,
    )


def register_inference(app, config=None, model_loader=load_model):
    config = os.environ if config is None else config
    key = config.get("DAI_ULTRASOUND_SERVICE_TOKEN", "")
    directory = config.get("DAI_ULTRASOUND_MODEL_DIR")
    busy = BoundedSemaphore(1)
    model = None

    def authorize(credential: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if (len(key) < 32 or credential is None or not secrets.compare_digest(
                credential.credentials.encode(), key.encode())):
            raise HTTPException(401, "Internal credential required",
                                headers={**CACHE, "WWW-Authenticate": "Bearer"})

    def run(raw, progress):
        nonlocal model
        progress("quality")
        try:
            image = decode(raw)
        except (ValueError, OSError, SyntaxError, Image.DecompressionBombError,
                Image.DecompressionBombWarning):
            raise HTTPException(422, "Invalid or unsupported raster image", headers=CACHE) from None
        stats, reasons = quality(image)
        if reasons:
            return dict(state="quality_issue", quality=stats, reasons=reasons)
        if not directory:
            return dict(state="model_unavailable", quality=stats, reasons=["no_approved_model"])
        try:
            if model is None:
                model = model_loader(Path(directory))
            predictor, model_id = model
            progress("inference")
            return dict(**score_image(predictor, model_id, image), quality=stats)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, ImportError, EOFError,
                AttributeError, OverflowError):
            model = None
            return dict(state="model_unavailable", quality=stats, reasons=["model_load_or_inference_failed"])

    @app.post("/internal/ultrasound/analyze", include_in_schema=False, dependencies=[Depends(authorize)])
    async def analyze(request: Request):
        if request.headers.get("content-type") != "image/png":
            raise HTTPException(415, "Expected a sanitized PNG image", headers=CACHE)
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "Image exceeds the byte limit", headers=CACHE)
            raw.extend(chunk)
        def analyze_one(progress):
            if not busy.acquire(blocking=False):
                raise HTTPException(503, "Ultrasound inference is busy", headers=CACHE)
            try:
                return run(bytes(raw), progress)
            finally:
                busy.release()

        if request.headers.get("accept") != "application/x-ndjson":
            return JSONResponse(await run_in_threadpool(analyze_one, lambda _: None), headers=CACHE)

        async def stream():
            events = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def progress(stage):
                loop.call_soon_threadsafe(events.put_nowait, {"stage": stage})

            async def work():
                try:
                    result = await run_in_threadpool(analyze_one, progress)
                    events.put_nowait({"result": result})
                except HTTPException as error:
                    events.put_nowait({"error": error.status_code})
                finally:
                    events.put_nowait(None)

            task = asyncio.create_task(work())
            try:
                while (event := await events.get()) is not None:
                    yield json.dumps(event, allow_nan=False) + "\n"
                await task
            finally:
                if not task.done():
                    task.cancel()

        return StreamingResponse(stream(), media_type="application/x-ndjson", headers=CACHE)
