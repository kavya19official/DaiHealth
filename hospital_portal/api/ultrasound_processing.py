"""Durable, single-frame analysis using the existing scan record and ML service."""
import asyncio
from datetime import timedelta
import logging
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from starlette.concurrency import run_in_threadpool

from . import schema as s
from .ultrasound import QUALITY_REASONS, REASONS, aware, unavailable, utc

scans = s.ultrasound_workspace_scan
STAGES = ("quality", "model_loading", "preprocessing", "inference", "report")
ACTIVE = ("queued", "claimed", *STAGES)
PREDICTIONS = {"prediction", "priority_review", "low_confidence", "plane_analysis"}


def queued():
    return {"state": "queued", "steps": [], "reasons": []}


def review_flag(analysis):
    state = analysis.get("state")
    if state == "quality_issue":
        rationale = [REASONS[code] for code in analysis.get("reasons", []) if code in QUALITY_REASONS]
    elif state == "model_unavailable":
        rationale = [REASONS[code] for code in analysis.get("reasons", []) if code in REASONS]
    elif state == "plane_analysis":
        rationale = ["The model estimates the view in the uploaded image. Your care team interprets the scan."]
    elif state in PREDICTIONS:
        rationale = ["The research model classifies archive labels. Clinical interpretation requires your care team."]
        if "low_confidence" in analysis.get("reasons", []):
            rationale.append("The top model score was below its research review threshold.")
    else:
        return None
    return dict(category="review_recommended", reasons=rationale)


def assessment(analysis):
    """Public projection. Archive classes and probabilities stay in the clinician payload."""
    state = analysis.get("state")
    quality = analysis.get("quality") or {}
    demo = bool((analysis.get("measurements") or {}).get("demo"))
    problems = [code for code in analysis.get("reasons", []) if code in QUALITY_REASONS]
    if state == "quality_issue" and not demo:
        grade = "poor"
    elif not demo and quality.get("width") and quality.get("height"):
        strong = (min(quality["width"], quality["height"]) >= 144 and quality.get("std", 0) >= 12
                  and quality.get("dynamic_range", 0) >= 42 and quality.get("focus", 0) >= 3)
        grade = "good" if strong else "acceptable"
    else:
        grade = None
    return dict(state=state, grade=grade, issues=problems,
                image_checks_passed=True if grade in {"good", "acceptable"} else
                False if grade == "poor" else None,
                steps=[step for step in analysis.get("steps", []) if step in STAGES],
                started_at=analysis.get("started_at"), finished_at=analysis.get("finished_at"),
                stage_times=analysis.get("stage_times", {}),
                flag=None if demo else analysis.get("flag") or review_flag(analysis),
                planes=analysis.get("planes") if state == "plane_analysis" and not demo else None,
                model_ran=state in PREDICTIONS, requires_doctor_review=True)


def claim(engine, recovery_runtime=None):
    state = scans.c.analysis["state"].as_string()
    if recovery_runtime:
        eligible = and_(state == "model_unavailable",
                        scans.c.analysis["recovery_runtime"].as_string().is_distinct_from(recovery_runtime),
                        scans.c.analysis["measurements"]["demo"].as_boolean().is_not(True),
                        scans.c.image_ciphertext.is_not(None), scans.c.image_expires_at > utc(),
                        scans.c.started_at.is_(None), scans.c.reviewed_at.is_(None), scans.c.released_at.is_(None))
    else:
        eligible = or_(state == "queued", and_(state.in_(ACTIVE[1:]),
                                              scans.c.updated_at < utc() - timedelta(minutes=2)))
    with engine.begin() as conn:
        row = conn.execute(select(scans.c.id, scans.c.analysis, scans.c.image_expires_at,
                                  scans.c.image_ciphertext).where(eligible)
                           .order_by(scans.c.created_at, scans.c.id).limit(1)).mappings().first()
        if not row:
            return None
        lease = uuid4().hex
        started = utc()
        attempted_runtime = recovery_runtime or row["analysis"].get("recovery_runtime")
        values = dict(analysis={**queued(), "state": "claimed", "lease": lease,
                                "started_at": started.isoformat(), "recovery_runtime": attempted_runtime},
                      updated_at=started)
        if recovery_runtime:
            values["revision"] = scans.c.revision + 1
        acquired = conn.execute(update(scans).where(scans.c.id == row["id"], eligible)
                                .values(**values)).rowcount
        if acquired and recovery_runtime:
            conn.execute(s.audit_log.insert().values(
                action="workspace_analysis_recovered", entity_type="ultrasound_workspace_scan",
                entity_id=row["id"], details={"previous_state": "model_unavailable", "runtime": recovery_runtime},
            ))
        return (row, lease, started.isoformat(), attempted_runtime) if acquired else None


async def process_next(engine, service, recovery_runtime=None):
    item = await run_in_threadpool(claim, engine, recovery_runtime)
    if not item:
        return False
    row, lease, started, attempted_runtime = item
    stage_times = {}

    def persist(result, final=False):
        now = utc()
        result = {**result, "steps": list(stage_times), "stage_times": dict(stage_times), "started_at": started}
        if attempted_runtime:
            result["recovery_runtime"] = attempted_runtime
        if final:
            result.update(finished_at=now.isoformat(), flag=review_flag(result))
        else:
            result["lease"] = lease
        with engine.begin() as conn:
            changed = conn.execute(update(scans).where(scans.c.id == row["id"],
                scans.c.analysis["lease"].as_string() == lease)
                .values(analysis=result, updated_at=now)).rowcount
            if changed and final:
                conn.execute(s.audit_log.insert().values(
                    action="workspace_analysis_finished", entity_type="ultrasound_workspace_scan",
                    entity_id=row["id"], details={"state": result["state"]},
                ))

    async def progress(stage):
        if stage in STAGES and stage not in stage_times:
            stage_times[stage] = utc().isoformat()
            await run_in_threadpool(persist, {"state": stage, "reasons": []})

    if not row["image_ciphertext"] or aware(row["image_expires_at"]) <= utc():
        result = unavailable("inference_unavailable")
    else:
        try:
            image = await run_in_threadpool(service.decrypt, row["id"], row["image_ciphertext"])
            result = await service.analyze(image, progress)
        except Exception:
            logging.getLogger(__name__).exception("Ultrasound analysis job failed")
            result = unavailable("inference_unavailable")
    await progress("report")
    await run_in_threadpool(persist, result.model_dump(exclude_none=True), True)
    return True


async def analysis_loop(engine, service):
    while True:
        try:
            if await process_next(engine, service):
                continue
            status = await service.model_status()
            runtime = status.get("runtime")
            if status.get("state") == "ready" and status.get("model") == "sononet16" and runtime:
                if await process_next(engine, service, recovery_runtime=runtime):
                    continue
        except Exception:
            logging.getLogger(__name__).exception("Ultrasound analysis queue unavailable")
        await asyncio.sleep(0.5)
