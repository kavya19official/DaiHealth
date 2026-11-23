"""Read-only observation adapters and a bounded, traceable clinical review queue."""

import asyncio
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import json
import logging
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select, update

from . import schema as s
from .clinical_monitor_rules import day, evaluate, evidence, numeric

logger = logging.getLogger(__name__)
ACTIVE_STAGES = {"t1", "t2", "t3", "pregnant", "antenatal"}
OPEN_STATUSES = {"open", "pending", "ordered", "scheduled", "overdue", "missed", "in_progress"}
FINAL_STATUSES = {"done", "completed", "final", "finalized", "verified", "released"}
DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "backend/data/dai-hospital.db"
INDIA = ZoneInfo("Asia/Kolkata")


def canonical_status(value):
    return str(value or "").strip().lower()


def text_value(value, size=100):
    return value.strip()[:size] if isinstance(value, str) and value.strip() else None


def consent_scope(demo):
    flags = s.mother.c.consent_flags
    permitted = flags["clinical_monitoring"].as_boolean()
    synthetic = flags["synthetic_demo"].as_boolean()
    return and_(flags["care_coordination"].as_boolean().is_(True), or_(
        permitted.is_(True) if demo else and_(permitted.is_(True), synthetic.is_not(True)),
        and_(permitted.is_(None), synthetic.is_(True)) if demo else False,
    ))


def scoped(user, demo):
    conditions = [
        s.mother.c.registered_facility_id == user["facility_id"],
        s.mother.c.assigned_unit_id == user["unit_id"],
        consent_scope(demo),
    ]
    if user["role"] == "resident":
        conditions.append(s.mother.c.assigned_doctor_id == user["id"])
    return conditions


@lru_cache(maxsize=4)
def source_digest(path, size, modified_ns):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle,"sha256").hexdigest()


def synthetic_rows(mothers, manifest):
    """Use the same read-only ledger as the existing synthetic clinical workspace."""
    eligible = {m["source_id"]: m["id"] for m in mothers
                if m["source_id"] and m["consent_flags"].get("synthetic_demo") is True}
    if not eligible or not manifest:
        return {}, {}
    path = Path(os.getenv("DAI_SOURCE_DB", str(DEFAULT_SOURCE))).resolve()
    stat = path.stat()
    if source_digest(path,stat.st_size,stat.st_mtime_ns) != manifest["source_sha256"]:
        raise ValueError("Synthetic source does not match the portal seed")
    visits = defaultdict(list)
    with closing(sqlite3.connect(path.as_uri()+"?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        snapshot = db.execute("SELECT value FROM hospital_metadata WHERE key='snapshot_at'").fetchone()
        if not snapshot or snapshot["value"][:10] != manifest["as_of_date"]:
            raise ValueError("Synthetic source snapshot does not match the portal seed")
        marks = ",".join("?" for _ in eligible)
        source_hospitals = {m["source_id"]: m["facility_source"] for m in mothers}
        profiles = {}
        for row in db.execute(f"""SELECT p.mother_id,p.lmp,p.edd,p.outcome_date,p.current_stage
            FROM pregnancies p WHERE p.mother_id IN ({marks})""", tuple(eligible)):
            profiles[eligible[row["mother_id"]]] = dict(row)
        for row in db.execute(f"""SELECT p.mother_id,a.visit_id,a.hospital_id,a.visit_date,
            a.bp_systolic,a.bp_diastolic,a.weight_kg FROM anc_visits a
            JOIN pregnancies p ON p.pregnancy_id=a.pregnancy_id
            WHERE p.mother_id IN ({marks})""", tuple(eligible)):
            recorded = day(row["visit_date"])
            if recorded and row["hospital_id"] == source_hospitals.get(row["mother_id"]):
                visits[eligible[row["mother_id"]]].append(dict(
                    id=row["visit_id"], source="synthetic ANC ledger · anc_visits", date=recorded,
                    sbp=row["bp_systolic"], dbp=row["bp_diastolic"], weight_kg=row["weight_kg"],
                ))
    return profiles, visits


def episode(mother):
    details = mother["details"]
    for value in (details.get("source_pregnancy_id"), details.get("lmp"), mother["edd"]):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def pregnancy(mother, synthetic, as_of):
    details = mother["details"]
    if canonical_status(details.get("stage") or synthetic.get("current_stage")) not in ACTIVE_STAGES:
        return None
    if synthetic.get("outcome_date") or details.get("outcome_date"):
        return None
    lmp = day(details.get("lmp")) or day(synthetic.get("lmp"))
    estimated_from_edd = False
    if lmp is None:
        edd = day(mother["edd"] or synthetic.get("edd"))
        if edd and edd.toordinal() > 280:
            lmp, estimated_from_edd = edd-timedelta(days=280), True
    if not lmp or not 0 <= (as_of-lmp).days <= 294:
        return None
    bmi = numeric(details.get("prepregnancy_bmi"), 12, 75)
    if details.get("plurality") != "singleton":
        bmi = None
    baseline = (bmi, dict(source="hospital mother profile", record_id=mother["id"], date=None,
                          values={"prepregnancy_bmi":bmi,"plurality":"singleton"})) if bmi else None
    return dict(lmp=lmp, baseline=baseline, estimated_from_edd=estimated_from_edd)


def normalized_records(c, mothers, visits):
    ids = [m["id"] for m in mothers]
    if not ids:
        return {}
    scope = {m["id"]:m["registered_facility_id"] for m in mothers}
    records = {mid:dict(visits=[], glucose=[], reports=[], gaps=[]) for mid in ids}
    for r in c.execute(select(s.anc_visit).where(s.anc_visit.c.mother_id.in_(ids))).mappings():
        if r["facility_id"] != scope[r["mother_id"]] or not (when := day(r["visit_date"])):
            continue
        detail = r["details"]
        base = dict(id=r["id"], source="hospital ANC visit", date=when)
        records[r["mother_id"]]["visits"].append(dict(
            **base, sbp=detail.get("bp_systolic"), dbp=detail.get("bp_diastolic"),
            weight_kg=detail.get("weight_kg"), imported_id=r["source_id"]))
        if detail.get("glucose") is not None:
            records[r["mother_id"]]["glucose"].append(dict(
                **base, glucose=detail["glucose"], context=text_value(detail.get("glucose_context"),32),
                unit=text_value(detail.get("glucose_unit"),32)))
    for mid, item in records.items():
        imported = {row.pop("imported_id") for row in item["visits"]}
        item["visits"].extend(row for row in visits.get(mid, []) if row["id"] not in imported)

    orders = {}
    reports_by_order = defaultdict(list)
    for order in c.execute(select(s.investigation_order).where(s.investigation_order.c.mother_id.in_(ids))).mappings():
        mid = order["mother_id"]
        if order["facility_id"] != scope[mid]:
            continue
        orders[order["id"]] = order
        status = canonical_status(order["status"])
        if status in OPEN_STATUSES and (due := day(order["due_date"])):
            records[mid]["gaps"].append(dict(id=order["id"], source="hospital investigation order",
                date=due, item=order["test"], status=status))
    if orders:
        for r in c.execute(select(s.investigation_result).join(
            s.investigation_order, s.investigation_result.c.order_id == s.investigation_order.c.id
        ).where(s.investigation_order.c.mother_id.in_(ids))).mappings():
            values = r["values"]
            if r["order_id"] in orders and isinstance(values,dict) and canonical_status(values.get("status")) in FINAL_STATUSES and (
                when := day(values.get("reported_on"))
            ):
                reports_by_order[r["order_id"]].append((when,r,values))
    for order in orders.values():
        if results := reports_by_order[order["id"]]:
            when, result, values = max(results,key=lambda x:(x[0],x[1]["created_at"],x[1]["id"]))
            record_id, source = result["id"], "hospital finalized investigation result"
        elif canonical_status(order["status"]) in FINAL_STATUSES and (when := day(order["details"].get("completed_date"))):
            record_id, source, values = order["id"], "hospital completed investigation", order["details"]
        else:
            continue
        if order["test"]:
            records[order["mother_id"]]["reports"].append(dict(
                id=record_id, source=source, date=when, test=order["test"][:100],
                flag=canonical_status(values.get("result_flag")),
                value=text_value(values.get("result_value")) or numeric(values.get("result_value"),-1e8,1e8),
                unit=text_value(values.get("unit"),32),order_id=order["id"],
                protocol=text_value(values.get("protocol"),32),
            ))
            context = text_value(values.get("glucose_context"),32)
            if context in {"fasting","postprandial_1h","postprandial_2h"}:
                records[order["mother_id"]]["glucose"].append(dict(id=record_id,source=source,date=when,
                    glucose=values.get("result_value"),unit=text_value(values.get("unit"),32),context=context))
    for gap in c.execute(select(s.care_gap).where(
        s.care_gap.c.mother_id.in_(ids), s.care_gap.c.child_id.is_(None)
    )).mappings():
        status, detail = canonical_status(gap["status"]), gap["details"]
        # Investigation orders were covered above. Exclude postnatal and unrelated gaps.
        if (gap["order_id"] is None and detail.get("source_table") in {"anc_expected", "prenatal_milestone"}
            and status in OPEN_STATUSES and (due := day(gap["due_date"]))):
            records[gap["mother_id"]]["gaps"].append(dict(id=gap["id"],source="hospital prenatal care gap",
                date=due,item=gap["expected_item"],status=status))
    return records


def fingerprint(flag):
    return hashlib.sha256(json.dumps(flag, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def persist(c, mother_id, as_of, flags, trends, coverage, ultrasound_reviews=None):
    now = datetime.now(timezone.utc)
    existing = {r["rule_key"]:r for r in c.execute(select(s.clinical_monitor_flag).where(
        s.clinical_monitor_flag.c.mother_id == mother_id)).mappings()}
    for finding in flags:
        old = existing.pop(finding["rule_key"], None)
        digest = fingerprint(finding)
        values = dict(**finding, fingerprint=digest, active=True, updated_at=now)
        review = (ultrasound_reviews or {}).get(finding["rule_key"])
        if review:
            values.update(reviewed_by=review["reviewed_by"], reviewed_at=review["reviewed_at"],
                          review_note=review["review_note"])
        if old is None:
            identifier = c.execute(s.clinical_monitor_flag.insert().values(
                mother_id=mother_id, **values)).inserted_primary_key[0]
        elif old["fingerprint"] != digest or not old["active"]:
            identifier = old["id"]
            c.execute(update(s.clinical_monitor_flag).where(s.clinical_monitor_flag.c.id==identifier)
                .values(**{"reviewed_by": None, "reviewed_at": None, "review_note": None, **values}))
        else:
            continue
        if finding["rule_key"].startswith("ultrasound:"):
            source = finding["evidence"][0]
            c.execute(s.audit_log.insert().values(
                action="agent_flag_version", entity_type="clinical_monitor_flag", entity_id=identifier,
                details={"ultrasound_id": source["record_id"], "revision": source["values"]["revision"],
                         "fingerprint": digest, "priority": finding["priority"],
                         "review_status": source["values"]["review_status"]},
            ))
    inactive = [r["id"] for r in existing.values() if r["active"]]
    if inactive:
        c.execute(update(s.clinical_monitor_flag).where(s.clinical_monitor_flag.c.id.in_(inactive))
            .values(active=False,updated_at=now))
    snapshot = dict(as_of=as_of.isoformat(), trends=trends, coverage=coverage, updated_at=now)
    run = s.clinical_monitor_run
    updated = c.execute(update(run).where(run.c.mother_id==mother_id).values(**snapshot)).rowcount
    if not updated:
        c.execute(run.insert().values(mother_id=mother_id, **snapshot))


def ultrasound_observations(conn, mothers):
    patients = {mother["id"]: mother for mother in mothers}
    a = s.ultrasound_analysis
    rows = conn.execute(select(
        a.c.id, a.c.mother_id, a.c.facility_id, a.c.episode, a.c.created_at, a.c.updated_at,
        a.c.analysis, a.c.priority, a.c.revision, a.c.reviewed_at, a.c.reviewed_by, a.c.review_note,
        a.c.decision,
    ).where(a.c.mother_id.in_(patients)).order_by(a.c.created_at.desc(), a.c.id)).mappings()
    observations = defaultdict(list)
    for row in rows:
        mother = patients[row["mother_id"]]
        if (row["facility_id"] == mother["registered_facility_id"] and row["episode"] == episode(mother)
                and canonical_status(mother["details"].get("stage")) in ACTIVE_STAGES
                and not mother["details"].get("outcome_date")):
            observations[row["mother_id"]].append(row)
    return observations


def ultrasound_context(conn, mother, records, profile, as_of):
    if not profile:
        return []
    result = []
    for group, fields, checks in (
        ("visits", ("sbp", "dbp"), lambda r: numeric(r.get("sbp"), 55, 280) is not None
         and numeric(r.get("dbp"), 25, 180) is not None and r["sbp"] > r["dbp"]),
        ("glucose", ("glucose", "unit", "context"), lambda r: r.get("unit") in {"mg/dL", "mmol/L"}
         and r.get("context") in {"fasting", "postprandial_1h", "postprandial_2h"}
         and numeric(r.get("glucose"), 1, 720 if r["unit"] == "mg/dL" else 40) is not None),
        ("reports", ("test", "flag", "value", "unit"), lambda r: True),
        ("gaps", ("item", "status"), lambda r: True),
    ):
        candidates = (r for r in records[group] if profile["lmp"] <= r["date"] <= as_of and checks(r))
        latest = max(candidates, key=lambda r: (r["date"], str(r["id"])), default=None)
        if latest:
            result.append(evidence(latest, {field: latest.get(field) for field in fields}))
    task = s.worklist_item
    tasks = conn.execute(select(task).where(
        task.c.mother_id == mother["id"], task.c.facility_id == mother["registered_facility_id"],
        task.c.details["kind"].as_string().in_(("follow_up", "referral_follow_up", "investigation")),
    ).order_by(task.c.created_at.desc(), task.c.id).limit(10)).mappings()
    for row in tasks:
        detail = row["details"]
        created = row["created_at"].date()
        if detail.get("child_id") or not profile["lmp"] <= created <= as_of:
            continue
        result.append(evidence(dict(id=row["id"], source="Hospital follow-up task", date=created), {
            "kind": detail["kind"], "status": row["status"], "due_date": detail.get("due_date"),
        }))
    return result


def ultrasound_flags(rows, clinical_flags, trends, context_rows):
    from .ultrasound import REASONS
    related = {}

    def collect(item):
        key = (item["source"], item["record_id"])
        if key not in related:
            related[key] = {**item, "values": {}}
        related[key]["values"].update(item["values"])

    for item in context_rows:
        collect(item)
    for trend in trends:
        for item in trend["evidence"][:2]:
            collect(item)
    for finding in clinical_flags:
        for item in finding["evidence"]:
            collect(item)
    related = list(related.values())
    flags, reviews = [], {}
    for row in rows:
        result = row["analysis"]
        key = "ultrasound:" + row["id"]
        source = dict(source="Hospital ultrasound review", record_id=row["id"],
                      date=row["created_at"].date().isoformat(), values={
            "uploaded_at": row["created_at"].replace(tzinfo=timezone.utc).isoformat(),
            "analysis_state": result["state"],
            "archive_label": result.get("label"),
            "model_version": result.get("model_version"),
            "confidence": result.get("confidence"),
            "revision": row["revision"],
            "review_status": "reviewed" if row["reviewed_at"] else "pending",
            "review_decision": row["decision"],
        })
        reasons = result["reasons"] or ["research_prediction"]
        verb = "Reviewed ultrasound." if row["reviewed_at"] else "Ultrasound awaiting clinician review."
        context = (" Related maternal observations are available below." if related else
                   " No related observations were selected by the monitoring rules.")
        flags.append(dict(rule_key=key, rule_version="ultrasound-review-v1", priority=row["priority"],
            summary=f"{verb} {' '.join(REASONS[code] for code in reasons)}{context}",
            action="Open the ultrasound review record and assess the image alongside the source records.",
            reference_url="", evidence=[source, *related[:25]]))
        if row["reviewed_at"]:
            reviews[key] = row
    return flags, reviews


def scan_batch(engine, demo, cursor=None, limit=125, today=None, include_ultrasound=False):
    """Scan one batch. A patient row lock serializes review with a concurrent rescan."""
    today = today or datetime.now(INDIA).date()
    with engine.begin() as c:
        query = select(s.mother, s.facility.c.source_id.label("facility_source")).join(
            s.facility, s.facility.c.id == s.mother.c.registered_facility_id
        ).where(consent_scope(demo)).order_by(s.mother.c.id).limit(limit).with_for_update(of=s.mother)
        if cursor:
            query = query.where(s.mother.c.id > cursor)
        mothers = list(c.execute(query).mappings())
        if not mothers:
            return None
        manifest = c.execute(select(s.seed_manifest).limit(1)).mappings().first() if demo else None
        synthetic, visits = synthetic_rows(mothers, manifest) if demo else ({},{})
        records = normalized_records(c, mothers, visits)
        ultrasound = ultrasound_observations(c, mothers) if include_ultrasound else {}
        for m in mothers:
            mid = m["id"]
            simulated = demo and m["consent_flags"].get("synthetic_demo") is True
            as_of = day(manifest["as_of_date"]) if simulated and manifest else None if simulated else today
            if as_of is None:
                continue
            profile = pregnancy(m, synthetic.get(mid, {}), as_of)
            coverage = {"eligible":False,"synthetic":simulated}
            flags, trends = [], []
            if profile:
                flags,trends,counts = evaluate(profile,records[mid],as_of)
                coverage.update(counts,eligible=True,gestation_anchor=profile["lmp"].isoformat(),
                    anchor_source="estimated from recorded EDD" if profile["estimated_from_edd"] else "recorded LMP")
            image_rows = ultrasound.get(mid, [])
            if image_rows:
                related = ultrasound_context(c, m, records[mid], profile, as_of)
                image_flags, reviews = ultrasound_flags(image_rows, flags, trends, related)
                flags.extend(image_flags)
            else:
                reviews = {}
            persist(c, mid, as_of, flags, trends, coverage, reviews)
        return mothers[-1]["id"] if len(mothers)==limit else None


async def monitor_loop(engine, demo, include_ultrasound=False):
    cursor = None
    while True:
        try:
            cursor = await asyncio.to_thread(scan_batch, engine, demo, cursor, include_ultrasound=include_ultrasound)
            await asyncio.sleep(3 if cursor else 90)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.error("Clinical monitoring batch failed (%s)",type(error).__name__)
            await asyncio.sleep(30)


class Review(BaseModel):
    fingerprint: str = Field(pattern="^[a-f0-9]{64}$")
    disposition: Literal["reviewed"]
    note: str = Field(min_length=5, max_length=500)


def register_monitor(app, engine, require, audit, demo):
    @app.get("/api/clinical-monitor")
    def queue(priority: Literal["all","urgent","high","routine"]="all", reviewed: bool=False,
              offset: int=0, u=Depends(require("monitor.read"))):
        if offset<0 or offset>10000:
            raise HTTPException(422,"Invalid offset")
        m,f,r = s.mother,s.clinical_monitor_flag,s.clinical_monitor_run
        rules = [*scoped(u,demo),f.c.active.is_(True),
                 f.c.reviewed_at.is_not(None) if reviewed else f.c.reviewed_at.is_(None)]
        match = {"urgent":3,"high":2,"routine":1}.get(priority)
        if match:
            rules.append(f.c.priority==match)
        with engine.begin() as c:
            rows = list(c.execute(select(f,m.c.details.label("mother_details"),m.c.uhid,r.c.as_of)
                .join(m,m.c.id==f.c.mother_id).join(r,r.c.mother_id==m.c.id).where(*rules)
                .order_by(f.c.priority.desc(),f.c.updated_at.desc(),f.c.id).offset(offset).limit(26)).mappings())
            items = []
            for row in rows[:25]:
                item = dict(row)
                details = item.pop("mother_details")
                item["patient_name"] = details.get("name") or item["uhid"]
                if item["rule_key"].startswith("ultrasound:"):
                    item["ultrasound_id"] = item["rule_key"].split(":", 1)[1]
                items.append(item)
                audit(c,u,"read","clinical_monitor_flag",item["id"],{"mother_id":item["mother_id"]})
            last_scan = c.scalar(select(r.c.updated_at).join(m,m.c.id==r.c.mother_id).where(*scoped(u,demo))
                .order_by(r.c.updated_at.desc()).limit(1))
        return dict(items=items,has_more=len(rows)>25,last_scan=last_scan)

    @app.get("/api/clinical-monitor/patients/{mother_id}")
    def patient(mother_id: UUID,u=Depends(require("monitor.read"))):
        m,r = s.mother,s.clinical_monitor_run
        with engine.begin() as c:
            result = c.execute(select(r).join(m,m.c.id==r.c.mother_id).where(
                m.c.id==str(mother_id),*scoped(u,demo))).mappings().first()
            if not result:
                raise HTTPException(404,"No in-scope monitoring snapshot")
            audit(c,u,"read","clinical_monitor_run",result["id"],{"mother_id":str(mother_id)})
            return {"snapshot":dict(result)}

    @app.post("/api/clinical-monitor/flags/{flag_id}/review")
    def review(flag_id: UUID, body: Review, u=Depends(require("monitor.review"))):
        note = body.note.strip()
        if len(note)<5:
            raise HTTPException(422,"Enter a review note")
        m,f = s.mother,s.clinical_monitor_flag
        with engine.begin() as c:
            owner = c.scalar(select(m.c.id).join(f,f.c.mother_id==m.c.id).where(
                f.c.id==str(flag_id),*scoped(u,demo)).with_for_update(of=m))
            if not owner:
                raise HTTPException(404,"No in-scope monitoring flag")
            if c.scalar(select(f.c.rule_key).where(f.c.id==str(flag_id))).startswith("ultrasound:"):
                raise HTTPException(409,"Review this item in Ultrasound AI Review")
            changed = c.execute(update(f).where(f.c.id==str(flag_id),f.c.active.is_(True),
                f.c.reviewed_at.is_(None),f.c.fingerprint==body.fingerprint)
                .values(reviewed_by=u["id"],reviewed_at=datetime.now(timezone.utc),review_note=note)).rowcount
            if not changed:
                raise HTTPException(409,"This evidence changed or was already reviewed. Refresh the queue.")
            audit(c,u,"review","clinical_monitor_flag",str(flag_id),
                  {"mother_id":owner,"fingerprint":body.fingerprint})
        return {"reviewed":True}
