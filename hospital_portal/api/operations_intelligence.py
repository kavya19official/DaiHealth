"""Facility-scoped, explainable, human-approved non-clinical operations plans."""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update, func

from . import schema as s
from .security import ROLES
from .staff_scope import facility_staff
from .operations.planner import solve, verify, cp_model
from .operations.agent import run_agent

UTC, IST = timezone.utc, ZoneInfo("Asia/Kolkata")
POLICY_PATH = Path(__file__).resolve().parent / "operations" / "policy.json"
POLICY = json.loads(POLICY_PATH.read_text())
ELIGIBLE_ROLES = {"hospital_admin", "quality_officer", "biomedical"}
for role in ("hospital_admin", "quality_officer"):
    ROLES[role].update({"operations.read", "operations.write"})


def now():
    return datetime.now(UTC)


def aware(d):
    return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)


def minute(d):
    return int(aware(d).timestamp() // 60)


def stamp(n):
    return datetime.fromtimestamp(n * 60, UTC).isoformat()


def demo_only():
    if os.getenv("DAI_DEMO") != "true":
        raise HTTPException(409, "Operations planning writes currently require explicit synthetic demo mode")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Availability(Input):
    staff_id: UUID
    starts_at: datetime
    ends_at: datetime
    domains: list[Literal["water", "energy", "waste"]] = Field(min_length=1, max_length=3)
    source: str = Field(min_length=3, max_length=300)

    @model_validator(mode="after")
    def valid_window(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Availability requires explicit time zones")
        if self.starts_at.second or self.ends_at.second or self.starts_at.microsecond or self.ends_at.microsecond:
            raise ValueError("Use whole-minute availability")
        if not now() < self.starts_at < self.ends_at <= now() + timedelta(days=15):
            raise ValueError("Declare future availability within the next 15 days")
        if self.ends_at - self.starts_at > timedelta(hours=12):
            raise ValueError("A declared window may not exceed 12 hours")
        return self


class WindowChange(Input):
    version: int = Field(ge=1)
    active: bool


class RunInput(Input):
    horizon_days: int = Field(default=7, ge=1, le=7)
    exclude_staff_ids: list[UUID] = Field(default_factory=list, max_length=20)
    allow_external_ai: bool = False


class Decision(Input):
    version: int = Field(ge=1)
    decision: Literal["approve", "reject"]
    note: str = Field(min_length=3, max_length=500)


def green_insights(rows):
    findings = []
    for metric in sorted({r["metric"] for r in rows}):
        series = sorted([r for r in rows if r["metric"] == metric and r["quality"] != "unavailable"], key=lambda r: r["period"])
        if len(series) < 2:
            continue
        prev, cur = series[-2:]
        current_month = datetime.fromisoformat(cur["period"] + "-01")
        previous_month = current_month.replace(day=1) - timedelta(days=1)
        if prev["period"] != previous_month.strftime("%Y-%m") or prev["quality"] != cur["quality"] or prev["source"] != cur["source"]:
            continue
        normalized = bool(prev.get("occupied_bed_days") and cur.get("occupied_bed_days"))
        old = prev["value"] / prev["occupied_bed_days"] if normalized else prev["value"]
        new = cur["value"] / cur["occupied_bed_days"] if normalized else cur["value"]
        if old <= 0:
            continue
        delta = (new - old) / old
        findings.append({"metric": metric, "period": cur["period"], "previous_period": prev["period"], "previous": old, "current": new, "change_percent": round(delta * 100, 3), "review_suggested": delta >= POLICY["resource_change_threshold"], "basis": "per occupied bed-day" if normalized else "absolute reported consumption", "quality": cur["quality"], "source": cur["source"], "reason": f"{metric}: {delta*100:.1f}% change in {'intensity per occupied bed-day' if normalized else 'reported totals'} across adjacent, same-source months. Review threshold: {POLICY['resource_change_threshold']*100:g}%. Not proof of waste or a hospital ranking."})
    return findings


def snapshot(c, facility_id, params):
    staff = sorted([p for p in facility_staff(c, facility_id) if p["verified"] and p["role"] in ELIGIBLE_ROLES], key=lambda p:p["id"])
    people = {p["id"]: p for p in staff}
    excluded = sorted(str(i) for i in params.exclude_staff_ids)
    if any(i not in people for i in excluded):
        raise HTTPException(422, "Excluded staff must be verified non-clinical staff in this facility")
    all_windows = [dict(w) for w in c.execute(select(s.operations_availability).where(s.operations_availability.c.facility_id == facility_id).order_by(s.operations_availability.c.id)).mappings()]
    end = now() + timedelta(days=params.horizon_days)
    windows = [{"id": w["id"], "staff_id": w["staff_id"], "start": max(minute(w["starts_at"]), minute(now()) + 1), "end": min(minute(w["ends_at"]), minute(end)), "domains": w["domains"], "source": w["source"], "version": w["version"]} for w in all_windows if w["active"] and w["staff_id"] in people and w["staff_id"] not in excluded and aware(w["ends_at"]) > now() and aware(w["starts_at"]) < end]
    if len(windows) > POLICY["max_windows"]:
        raise HTTPException(422, "Reduce active capacity to the configured planning window limit")
    assigned = [dict(a) for a in c.execute(select(s.operations_assignment).where(s.operations_assignment.c.facility_id == facility_id).order_by(s.operations_assignment.c.id)).mappings()]
    assigned_ids = {a["ticket_id"] for a in assigned}
    tickets = [dict(t) for t in c.execute(select(s.sustainability_ticket).where(s.sustainability_ticket.c.facility_id == facility_id, s.sustainability_ticket.c.status.in_(["open", "in_progress"])).order_by(s.sustainability_ticket.c.id)).mappings() if t["id"] not in assigned_ids]
    if len(tickets) > POLICY["max_jobs"]:
        raise HTTPException(422, "Reduce the open backlog to the configured planning limit")
    jobs = [{"id": t["id"], "title": t["title"], "domain": t["domain"], "duration": POLICY["duration_minutes"][t["kind"]], "points": POLICY["priority_points"][t["priority"]], "priority": t["priority"]} for t in tickets]
    blocked = [{"staff_id": a["staff_id"], "start": minute(a["starts_at"]), "end": minute(a["ends_at"])} for a in assigned if aware(a["ends_at"]) > now() and aware(a["starts_at"]) < end]
    measurements = [dict(r) for r in c.execute(select(s.sustainability_measurement).where(s.sustainability_measurement.c.facility_id == facility_id).order_by(s.sustainability_measurement.c.id)).mappings()]
    # Hash source timestamps/versions, not the current clock: advancing one minute alone
    # does not invalidate a still-future plan. Exact time feasibility is rechecked on approval.
    hash_sources = {"facility": facility_id, "policy": POLICY, "parameters": params.model_dump(mode="json"), "staff": [{"id": p["id"], "role": p["role"], "verified": p["verified"]} for p in staff], "windows": all_windows, "tickets": tickets, "assigned": assigned, "measurements": measurements}
    digest = hashlib.sha256(json.dumps(hash_sources, sort_keys=True, default=str).encode()).hexdigest()
    return {"input_hash": digest, "jobs": jobs, "windows": windows, "blocked": blocked, "staff": people, "insights": green_insights(measurements), "measurements": measurements}


def response_row(row):
    return {"id": row["id"], "state": row["state"], "version": row["version"], "created_at": aware(row["created_at"]).isoformat(), **row["payload"]}


def register(app, engine, require, audit, one):
    def lock(c, facility_id):
        c.execute(select(s.facility.c.id).where(s.facility.c.id == facility_id).with_for_update()).first()

    def usage(c, u, run_id, stats, cached, elapsed):
        c.execute(s.operations_ai_usage.insert().values(facility_id=u["facility_id"], actor_id=u["id"], run_id=run_id, cache_hit=cached, provider_attempts=0 if cached else stats["provider_attempts"], reported_total_tokens=0 if cached else stats["reported_total_tokens"], tool_calls=0 if cached else stats["tool_calls"], latency_ms=elapsed, source="cache" if cached else "local_and_optional_provider"))

    @app.get("/api/operations-intelligence")
    def dashboard(u=Depends(require("operations.read"))):
        with engine.begin() as c:
            snap = snapshot(c, u["facility_id"], RunInput())
            windows = [dict(w) for w in c.execute(select(s.operations_availability).where(s.operations_availability.c.facility_id == u["facility_id"]).order_by(s.operations_availability.c.starts_at.desc()).limit(40)).mappings()]
            for w in windows:
                w["starts_at"], w["ends_at"] = aware(w["starts_at"]).isoformat(), aware(w["ends_at"]).isoformat()
            runs = [response_row(dict(r)) for r in c.execute(select(s.operations_run).where(s.operations_run.c.facility_id == u["facility_id"], s.operations_run.c.actor_id == u["id"]).order_by(s.operations_run.c.created_at.desc()).limit(10)).mappings()]
            since = now() - timedelta(days=30)
            events = [dict(e) for e in c.execute(select(s.operations_ai_usage).where(s.operations_ai_usage.c.facility_id == u["facility_id"], s.operations_ai_usage.c.actor_id == u["id"], s.operations_ai_usage.c.created_at >= since)).mappings()]
            stats = {"requests": len(events), "cache_hits": sum(e["cache_hit"] for e in events), "provider_attempts": sum(e["provider_attempts"] for e in events), "reported_tokens": sum(e["reported_total_tokens"] or 0 for e in events), "unknown_token_requests": sum(e["provider_attempts"] > 0 and e["reported_total_tokens"] is None for e in events), "mean_latency_ms": round(sum(e["latency_ms"] for e in events) / len(events), 3) if events else None, "energy_kwh": None, "carbon_kg": None, "scope": "Your recorded operations requests in this facility, last 30 days; not all DAI AI traffic."}
            audit(c, u, "read", "operations_intelligence", u["facility_id"])
            return {"data_label": "Simulated on synthetic data", "reported_at": now(), "insights": snap["insights"], "measurements": snap["measurements"], "jobs": snap["jobs"], "windows": windows, "staff": [{"id": p["id"], "name": p["name"], "role": p["role"]} for p in snap["staff"].values()], "runs": runs, "usage": stats, "policy": POLICY, "solver_available": cp_model is not None, "external_ai_configured": bool(os.getenv("GEMINI_API_KEY") and os.getenv("DAI_OPERATIONS_AI_MODEL")), "write": "operations.write" in ROLES.get(u["role"], set()), "demo": os.getenv("DAI_DEMO") == "true"}

    @app.post("/api/operations-intelligence/availability", status_code=201)
    def declare(body: Availability, u=Depends(require("operations.write"))):
        demo_only()
        with engine.begin() as c:
            lock(c, u["facility_id"])
            staff = {p["id"]: p for p in facility_staff(c, u["facility_id"]) if p["verified"] and p["role"] in ELIGIBLE_ROLES}
            if str(body.staff_id) not in staff:
                raise HTTPException(422, "Choose verified non-clinical staff from this facility")
            identifier = str(uuid4())
            c.execute(s.operations_availability.insert().values(id=identifier, facility_id=u["facility_id"], declared_by=u["id"], version=1, staff_id=str(body.staff_id), starts_at=aware(body.starts_at), ends_at=aware(body.ends_at), domains=sorted(set(body.domains)), source=body.source))
            audit(c, u, "declare", "operations_availability", identifier)
            return {"id": identifier, "version": 1}

    @app.patch("/api/operations-intelligence/availability/{identifier}")
    def change_window(identifier: UUID, body: WindowChange, u=Depends(require("operations.write"))):
        demo_only()
        with engine.begin() as c:
            lock(c, u["facility_id"])
            row = one(s.operations_availability, str(identifier), c)
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(404, "Availability not found")
            changed = c.execute(update(s.operations_availability).where(s.operations_availability.c.id == str(identifier), s.operations_availability.c.version == body.version).values(active=body.active, version=body.version + 1))
            if changed.rowcount != 1:
                raise HTTPException(409, "Availability changed. Refresh before retrying.")
            audit(c, u, "availability_change", "operations_availability", str(identifier), {"active": body.active})
            return {"saved": True}

    @app.post("/api/operations-intelligence/runs")
    def propose(body: RunInput, u=Depends(require("operations.write"))):
        demo_only()
        started = time.perf_counter()
        with engine.begin() as c:
            snap = snapshot(c, u["facility_id"], body)
            existing = c.execute(select(s.operations_run).where(s.operations_run.c.facility_id == u["facility_id"], s.operations_run.c.actor_id == u["id"], s.operations_run.c.input_hash == snap["input_hash"], s.operations_run.c.state == "draft", s.operations_run.c.created_at >= now() - timedelta(minutes=POLICY["cache_minutes"])).order_by(s.operations_run.c.created_at.desc())).mappings().first()
            if existing and all(a["start"] > minute(now()) for a in existing["payload"]["plan"]["assignments"]):
                usage(c, u, existing["id"], existing["payload"]["usage"], True, round((time.perf_counter() - started) * 1000, 3))
                audit(c, u, "cache_hit", "operations_run", existing["id"])
                return {**response_row(existing), "cache_hit": True}
        result = run_agent(snap, POLICY, lambda: solve(snap["jobs"], snap["windows"], snap["blocked"], seconds=POLICY["solver_seconds"], seed=POLICY["seed"]), allow_external=body.allow_external_ai)
        for a in result["plan"]["assignments"]:
            j = next(j for j in snap["jobs"] if j["id"] == a["job_id"])
            a.update(title=j["title"], staff_name=snap["staff"][a["staff_id"]]["name"], starts_at=stamp(a["start"]), ends_at=stamp(a["end"]), reason=f"{j['priority']} priority ({j['points']} policy points), {j['duration']} planned minutes, declared {j['domain']} capability; fits availability without staff overlap. Duration is a configurable assumption, not a repair standard.")
        for item in result["plan"]["unscheduled"]:
            item["title"] = next(j["title"] for j in snap["jobs"] if j["id"] == item["job_id"])
        payload = {**result, "parameters": body.model_dump(mode="json"), "insights": snap["insights"], "input_hash": snap["input_hash"], "approval_required": True, "cache_hit": False, "policy_snapshot": POLICY, "assumptions": POLICY["assumptions"]}
        with engine.begin() as c:
            identifier = str(uuid4())
            c.execute(s.operations_run.insert().values(id=identifier, facility_id=u["facility_id"], actor_id=u["id"], input_hash=snap["input_hash"], state="draft", version=1, payload=payload))
            usage(c, u, identifier, result["usage"], False, round((time.perf_counter() - started) * 1000, 3))
            audit(c, u, "propose", "operations_run", identifier, {"solver": result["plan"]["source"], "provider_attempts": result["usage"]["provider_attempts"]})
            return {"id": identifier, "state": "draft", "version": 1, "created_at": now(), **payload}

    @app.post("/api/operations-intelligence/runs/{identifier}/decision")
    def decide(identifier: UUID, body: Decision, u=Depends(require("operations.write"))):
        demo_only()
        with engine.begin() as c:
            lock(c, u["facility_id"])
            row = one(s.operations_run, str(identifier), c)
            if row["facility_id"] != u["facility_id"] or row["actor_id"] != u["id"]:
                raise HTTPException(404, "Plan not found in your scope")
            if row["version"] != body.version or row["state"] != "draft":
                raise HTTPException(409, "Plan changed or was already decided. Refresh.")
            result = row["payload"]
            if body.decision == "approve":
                snap = snapshot(c, u["facility_id"], RunInput(**result["parameters"]))
                if snap["input_hash"] != row["input_hash"]:
                    raise HTTPException(409, "Source records changed. Generate a fresh plan before approval.")
                assignments = result["plan"]["assignments"]
                if not assignments:
                    raise HTTPException(422, "No feasible assignments to approve. Declare capacity or review unresolved jobs.")
                if any(a["start"] <= minute(now()) for a in assignments) or not verify(assignments, snap["jobs"], snap["windows"], snap["blocked"]):
                    raise HTTPException(409, "The plan no longer fits declared availability. Generate it again.")
                for a in assignments:
                    c.execute(s.operations_assignment.insert().values(facility_id=u["facility_id"], run_id=row["id"], ticket_id=a["job_id"], staff_id=a["staff_id"], availability_id=a["window_id"], starts_at=datetime.fromisoformat(a["starts_at"]), ends_at=datetime.fromisoformat(a["ends_at"])))
                    ticket = one(s.sustainability_ticket, a["job_id"], c)
                    c.execute(update(s.sustainability_ticket).where(s.sustainability_ticket.c.id == a["job_id"]).values(status="in_progress", details={**ticket["details"], "approved_plan": row["id"], "approved_by": u["id"], "approval_note": body.note}))
            c.execute(update(s.operations_run).where(s.operations_run.c.id == row["id"], s.operations_run.c.version == body.version).values(state="approved" if body.decision == "approve" else "rejected", version=body.version + 1))
            audit(c, u, body.decision, "operations_run", row["id"], {"note": body.note, "assignments": len(result["plan"]["assignments"]) if body.decision == "approve" else 0})
            return {"state": "approved" if body.decision == "approve" else "rejected", "version": body.version + 1}

    @app.post("/api/operations-intelligence/demo-scenario")
    def scenario(u=Depends(require("operations.write"))):
        demo_only()
        with engine.begin() as c:
            lock(c, u["facility_id"])
            key = "ops-demo:" + u["facility_id"]
            uid = lambda name: str(uuid5(NAMESPACE_URL, key + ":" + name))
            staff = [p for p in facility_staff(c, u["facility_id"]) if p["verified"] and p["role"] in ELIGIBLE_ROLES]
            staff.sort(key=lambda p: (p["role"] != "biomedical", p["id"]))
            if not staff:
                raise HTTPException(422, "No verified non-clinical staff in this facility")
            added = 0
            current = now().astimezone(IST).replace(day=1)
            last = current - timedelta(days=1)
            prior = last.replace(day=1) - timedelta(days=1)
            for period, factor in [(prior.strftime("%Y-%m"), 1), (last.strftime("%Y-%m"), 1.3)]:
                for metric, value in [("energy_kwh", 120000), ("water_m3", 3000), ("paper_sheets", 15000)]:
                    exists = c.scalar(select(s.sustainability_measurement.c.id).where(s.sustainability_measurement.c.facility_id == u["facility_id"], s.sustainability_measurement.c.period == period, s.sustainability_measurement.c.metric == metric))
                    if not exists:
                        c.execute(s.sustainability_measurement.insert().values(id=uid(period + metric), source_id=key + period + metric, facility_id=u["facility_id"], recorded_by=u["id"], period=period, metric=metric, value=round(value * (factor if metric == "energy_kwh" else 1)), quality="estimated", source="Synthetic operations workshop fixture", evidence="Deterministic demonstration observations; not a meter reading or real facility performance", occupied_bed_days=10000))
                        added += 1
            for kind, domain, title, priority in [("leak", "water", "Inspect reported tap leak", "elevated"), ("cooling", "energy", "Inspect cooling runtime", "elevated"), ("other", "waste", "Review paper segregation point", "routine")]:
                if not c.scalar(select(s.sustainability_ticket.c.id).where(s.sustainability_ticket.c.id == uid(kind))):
                    c.execute(s.sustainability_ticket.insert().values(id=uid(kind), source_id=key + kind, facility_id=u["facility_id"], opened_by=u["id"], kind=kind, domain=domain, title=title, status="open", priority=priority, details={"source": "Synthetic operations workshop fixture", "inspection_only": True}))
                    added += 1
            start = (now().astimezone(IST) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            for i, person in enumerate(staff[:2]):
                identifier = uid("availability-" + start.date().isoformat() + person["id"])
                if not c.scalar(select(s.operations_availability.c.id).where(s.operations_availability.c.id == identifier)):
                    c.execute(s.operations_availability.insert().values(id=identifier, source_id=key + identifier, facility_id=u["facility_id"], staff_id=person["id"], declared_by=u["id"], starts_at=aware(start + timedelta(hours=i)), ends_at=aware(start + timedelta(hours=i + 3)), domains=["water", "energy", "waste"], source="Synthetic workshop availability; inspection planning only", version=1))
                    added += 1
            audit(c, u, "seed_synthetic_workshop", "operations_intelligence", u["facility_id"], {"added": added})
            return {"added": added, "data_label": "Simulated on synthetic data"}
