"""ASHA Copilot: offline-first community health worker dashboard.

Priority-ranked daily visits are computed from recorded care signals (missed
appointments in the source ledger, overdue vaccinations and postnatal visits,
open care gaps, overdue investigations, clinician-confirmed risk). Field
mutations are idempotent on a client-generated UUID so queued offline work can
sync safely.
"""

import hashlib
import json
import math
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from . import schema as s
from .security import password_hash
from .staff_scope import facility_staff

LABEL = "Simulated on synthetic data"
SOURCE = Path(__file__).resolve().parents[2] / "backend/data/dai-hospital.db"
IST = ZoneInfo("Asia/Kolkata")
VISIT_STATUSES = ("planned", "completed", "missed", "rescheduled")
CAMP_KINDS = ("attendance", "vitals", "immunization", "referral_flag")
VAX_DONE = ("given", "administered", "completed", "done")
INV_DONE = ("completed", "resulted", "cancelled", "done")


def ist_today():
    return datetime.now(IST).date()


def valid_day(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except (TypeError, ValueError):
        return False


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# --- Rule-based structuring of voice/typed visit notes (no external service) ---
COMPLAINT_TERMS = {
    "headache": "headache",
    "blurring": "blurred vision",
    "blurred vision": "blurred vision",
    "vomit": "vomiting",
    "nausea": "nausea",
    "bleeding": "bleeding",
    "abdominal pain": "abdominal pain",
    "stomach pain": "abdominal pain",
    "back pain": "back pain",
    "swelling": "swelling",
    "breathless": "breathlessness",
    "shortness of breath": "breathlessness",
    "palpitation": "palpitations",
    "fever": "fever",
    "cough": "cough",
    "cold": "cold and cough",
    "loose motion": "diarrhoea",
    "diarrhea": "diarrhoea",
    "burning urine": "burning micturition",
    "itching": "itching",
    "rash": "rash",
    "pain": "pain",
    "weakness": "weakness",
    "dizziness": "dizziness",
    "giddiness": "dizziness",
    "not eating": "loss of appetite",
    "poor appetite": "loss of appetite",
}
DANGER_TERMS = {
    "severe headache": "severe headache",
    "blurred vision": "blurred vision",
    "epigastric pain": "epigastric pain",
    "reduced fetal movement": "reduced fetal movement",
    "baby not moving": "reduced fetal movement",
    "kick count low": "reduced fetal movement",
    "convulsion": "convulsion",
    "fits": "convulsion",
    "heavy bleeding": "heavy bleeding",
    "excessive bleeding": "heavy bleeding",
    "water broke": "ruptured membranes",
    "leaking": "ruptured membranes",
    "fever with chills": "fever with chills",
    "not feeding": "poor feeding",
    "poor feeding": "poor feeding",
    "breathing fast": "fast breathing",
    "fast breathing": "fast breathing",
    "lethargic": "lethargy",
    "very sleepy": "lethargy",
    "pus from cord": "umbilical infection",
    "jaundice": "jaundice",
    "not passing urine": "no urine output",
}


def extract_structured(text):
    """Deterministic extraction of common field measurements and red flags."""
    t = " " + re.sub(r"[^a-z0-9./\- ]", " ", text.lower()) + " "
    fields = {
        "measurements": {},
        "complaints": [],
        "danger_signs": [],
        "follow_up": None,
        "referral_suggested": bool(
            re.search(r"\brefer\b|\breferred\b|\bhospital\b", t)
        ),
        "extraction": "rule_based_review_required",
    }
    m = re.search(r"(?:bp|blood pressure|b p)\D{0,12}(\d{2,3})\s*[\/\- ]\s*(\d{2,3})", t)
    if m:
        sys, dia = int(m.group(1)), int(m.group(2))
        if 50 <= sys <= 250 and 30 <= dia <= 150:
            fields["measurements"]["bp"] = {"systolic": sys, "diastolic": dia}
    m = re.search(r"(?:temp(?:erature)?|fever)\D{0,10}(\d{2,3}(?:\.\d)?)", t)
    if m:
        v = float(m.group(1))
        unit = "C" if v <= 45 else "F" if 94 <= v <= 108 else None
        if unit:
            fields["measurements"]["temperature"] = {"value": v, "unit": unit}
    m = re.search(r"(?:weight|wt)\D{0,10}(\d{2,3}(?:\.\d)?)\s*(?:kg|kgs|kilo)?", t)
    if m:
        v = float(m.group(1))
        if 2 <= v <= 150:
            fields["measurements"]["weight_kg"] = v
    clauses = re.split(r"[.;!?\n]|\b(?:but|however)\b", text.lower())
    def affirmed(term):
        for clause in clauses:
            for match in re.finditer(r"\b" + re.escape(term) + r"s?\b", clause):
                prefix = clause[:match.start()]
                if not re.search(r"\b(?:no|denies|without)\b[^.,;!?]{0,60}$", prefix):
                    return True
        return False

    for term, label in COMPLAINT_TERMS.items():
        if affirmed(term) and label not in fields["complaints"]:
            fields["complaints"].append(label)
    for term, label in DANGER_TERMS.items():
        if affirmed(term) and label not in fields["danger_signs"]:
            fields["danger_signs"].append(label)
    m = re.search(
        r"(?:follow ?up|review|come back|return|next visit|check again)"
        r"\D{0,25}(\d{1,3})\s*(day|week)s?",
        t,
    )
    if m:
        n = int(m.group(1)) * (7 if m.group(2) == "week" else 1)
        fields["follow_up"] = {"in_days": n}
    elif re.search(r"\bnext week\b", t):
        fields["follow_up"] = {"in_days": 7}
    if not fields["measurements"] and not fields["complaints"]:
        fields["extraction"] = "no_structured_fields_found"
    return fields


class VisitBody(BaseModel):
    mother_id: str
    visit_date: str
    status: str
    client_uuid: str = Field(min_length=8, max_length=80)
    outcome: dict | None = None
    recorded_at: str | None = None


class NoteBody(BaseModel):
    mother_id: str
    transcript: str = Field(min_length=3, max_length=4000)
    structured: dict | None = None
    visit_id: str | None = None
    camp_update_id: str | None = None
    recorded_at: str | None = None
    client_uuid: str = Field(min_length=8, max_length=80)


class ExtractBody(BaseModel):
    transcript: str = Field(min_length=3, max_length=4000)


class CampBody(BaseModel):
    village_id: str
    name: str = Field(min_length=3, max_length=180)
    camp_date: str
    details: dict | None = None


class CampStatus(BaseModel):
    status: str


class CampUpdateItem(BaseModel):
    mother_id: str
    kind: str
    payload: dict = Field(default_factory=dict)
    client_uuid: str = Field(min_length=8, max_length=80)
    camp_id: str | None = None


class CampUpdatesBody(BaseModel):
    updates: list[CampUpdateItem] = Field(min_length=1, max_length=200)


class SyncBody(BaseModel):
    visits: list[VisitBody] = Field(default_factory=list, max_length=200)
    notes: list[NoteBody] = Field(default_factory=list, max_length=200)
    camp_updates: list[CampUpdateItem] = Field(default_factory=list, max_length=200)


class VillageBody(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    anganwadi_name: str | None = Field(default=None, max_length=180)


class AssignmentBody(BaseModel):
    asha_id: str
    mother_id: str
    village_id: str | None = None
    household_label: str | None = Field(default=None, max_length=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class AssignmentStatus(BaseModel):
    active: bool


def register_asha(app, engine, require, audit, one):
    def now():
        return datetime.now(timezone.utc)

    def iso(value):
        if value is None:
            return None
        return (
            value.replace(tzinfo=timezone.utc).isoformat()
            if value.tzinfo is None
            else value.isoformat()
        )

    @contextmanager
    def source():
        path = Path(os.getenv("DAI_SOURCE_DB", str(SOURCE)))
        if not path.is_file():
            yield None
            return
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def as_uuid(value):
        try:
            UUID(str(value))
            return True
        except (ValueError, TypeError, AttributeError):
            return False

    def scoped_assignment(c, u, mother_id):
        if not as_uuid(mother_id):
            raise HTTPException(422, "A valid beneficiary UUID is required")
        row = (
            c.execute(
                select(s.asha_assignment)
                .where(
                    s.asha_assignment.c.mother_id == str(mother_id),
                    s.asha_assignment.c.facility_id == u["facility_id"],
                    s.asha_assignment.c.active.is_(True),
                    s.asha_assignment.c.asha_id == u["id"],
                )
                .with_for_update()
            )
            .mappings()
            .first()
        )
        if not row:
            raise HTTPException(404, "Beneficiary is not assigned to you")
        return dict(row)

    BENEFICIARY_COLS = [
        s.asha_assignment.c.id.label("assignment_id"),
        s.asha_assignment.c.asha_id.label("worker_id"),
        s.asha_assignment.c.mother_id,
        s.asha_assignment.c.village_id,
        s.asha_assignment.c.household_label,
        s.asha_assignment.c.lat.label("household_lat"),
        s.asha_assignment.c.lng.label("household_lng"),
        s.mother.c.source_id.label("mother_source_id"),
        s.mother.c.uhid,
        s.mother.c.age,
        s.mother.c.edd,
        s.mother.c.gestation_weeks,
        s.mother.c.clinician_high_risk,
        s.mother.c.high_risk_reason_by_clinician,
        s.mother.c.details.label("mother_details"),
        s.asha_village.c.name.label("village_name"),
        s.asha_village.c.lat.label("village_lat"),
        s.asha_village.c.lng.label("village_lng"),
        s.user.c.name.label("worker_name"),
    ]

    def beneficiary_rows(c, u):
        filters = [
            s.asha_assignment.c.facility_id == u["facility_id"],
            s.asha_assignment.c.active.is_(True),
        ]
        if u["role"] == "asha":
            filters.append(s.asha_assignment.c.asha_id == u["id"])
        return [
            dict(r)
            for r in c.execute(
                select(*BENEFICIARY_COLS)
                .select_from(s.asha_assignment)
                .join(s.mother, s.mother.c.id == s.asha_assignment.c.mother_id)
                .join(
                    s.asha_village,
                    s.asha_village.c.id == s.asha_assignment.c.village_id,
                    isouter=True,
                )
                .join(s.user, s.user.c.id == s.asha_assignment.c.asha_id)
                .where(*filters)
                .order_by(s.mother.c.source_id)
            ).mappings()
        ]

    def signal_map(c, u, rows, visit_date):
        """Batch-compute priority reasons per mother for the requested date."""
        mother_ids = [r["mother_id"] for r in rows]
        sources = {r["mother_id"]: r["mother_source_id"] for r in rows}
        children = {}
        if mother_ids:
            for ch in (
                c.execute(
                    select(s.child).where(s.child.c.mother_id.in_(mother_ids))
                )
                .mappings()
                .all()
            ):
                children.setdefault(ch["mother_id"], []).append(dict(ch))
        signals = {mid: [] for mid in mother_ids}

        def add(mid, code, label, weight, detail=None):
            signals[mid].append(
                {"code": code, "label": label, "weight": weight, "detail": detail}
            )

        fac = (
            c.execute(select(s.facility).where(s.facility.c.id == u["facility_id"]))
            .mappings()
            .first()
        )
        hospital_id = fac["source_id"] if fac else None
        if hospital_id and sources:
            with source() as db:
                if db is not None:
                    marks = ",".join("?" for _ in sources.values())
                    appts = db.execute(
                        "SELECT mother_id,status,appointment_date FROM appointments "
                        f"WHERE hospital_id=? AND mother_id IN ({marks})",
                        (hospital_id, *sources.values()),
                    ).fetchall()
            by_mother = {}
            for a in appts:
                mid = next(
                    (k for k, v in sources.items() if v == a["mother_id"]), None
                )
                if mid:
                    by_mother.setdefault(mid, []).append(dict(a))
            for mid, items in by_mother.items():
                missed = [a for a in items if a["status"] == "missed"]
                stale = [
                    a
                    for a in items
                    if a["status"] == "booked"
                    and a["appointment_date"]
                    and str(a["appointment_date"]) < visit_date
                ]
                if missed:
                    latest = max(str(a["appointment_date"] or "") for a in missed)
                    add(
                        mid,
                        "missed_appointment",
                        "Missed appointment",
                        30,
                        f"{len(missed)} missed, latest {latest}",
                    )
                if stale:
                    add(
                        mid,
                        "appointment_overdue",
                        "Booked appointment not attended",
                        15,
                        f"{len(stale)} past booked appointments",
                    )
        if mother_ids:
            for v in (
                c.execute(
                    select(s.vaccination_record).where(
                        s.vaccination_record.c.mother_id.in_(mother_ids)
                    )
                )
                .mappings()
                .all()
            ):
                status = (v["status"] or "").lower()
                given = v["given_date"] or ""
                done = status in VAX_DONE or (given and given <= visit_date)
                if v["due_date"] and v["due_date"] < visit_date and not done:
                    days = (
                        date.fromisoformat(visit_date)
                        - date.fromisoformat(v["due_date"])
                    ).days
                    add(
                        v["mother_id"],
                        "overdue_vaccine",
                        "Overdue vaccination",
                        25 + (5 if days > 14 else 0),
                        f"{v['vaccine']} due {v['due_date']} ({days}d overdue)",
                    )
            for p in (
                c.execute(
                    select(s.postnatal_followup).where(
                        s.postnatal_followup.c.mother_id.in_(mother_ids)
                    )
                )
                .mappings()
                .all()
            ):
                if p["due_date"] and not (p["completed_at"] or "").strip():
                    if p["due_date"] < visit_date:
                        add(
                            p["mother_id"],
                            "postnatal_overdue",
                            "Overdue postnatal visit",
                            30,
                            f"due {p['due_date']}",
                        )
                    elif p["due_date"] == visit_date:
                        add(
                            p["mother_id"],
                            "postnatal_due",
                            "Postnatal visit due today",
                            10,
                            f"due {p['due_date']}",
                        )
            for g in (
                c.execute(
                    select(s.care_gap).where(s.care_gap.c.mother_id.in_(mother_ids))
                )
                .mappings()
                .all()
            ):
                if (g["status"] or "").upper() == "OPEN" and (
                    not g["due_date"] or g["due_date"] <= visit_date
                ):
                    add(
                        g["mother_id"],
                        "open_care_gap",
                        "Open care gap",
                        15,
                        f"{g['expected_item']} due {g['due_date']}",
                    )
            for o in (
                c.execute(
                    select(s.investigation_order).where(
                        s.investigation_order.c.mother_id.in_(mother_ids)
                    )
                )
                .mappings()
                .all()
            ):
                if (
                    o["due_date"]
                    and o["due_date"] < visit_date
                    and (o["status"] or "").upper() not in INV_DONE
                ):
                    add(
                        o["mother_id"],
                        "overdue_investigation",
                        "Overdue investigation",
                        15,
                        f"{o['test']} due {o['due_date']}",
                    )
        for r in rows:
            mid = r["mother_id"]
            if r["clinician_high_risk"]:
                add(
                    mid,
                    "clinician_high_risk",
                    "Clinician-confirmed high risk",
                    40,
                    r["high_risk_reason_by_clinician"] or "confirmed by clinician",
                )
            gw = r["gestation_weeks"]
            if gw is not None and gw >= 36:
                add(mid, "near_term", "Near term", 15, f"{gw} weeks gestation")
            edd = r["edd"]
            if edd:
                try:
                    delta = (
                        date.fromisoformat(visit_date) - date.fromisoformat(edd)
                    ).days
                except ValueError:
                    delta = None
                if delta is not None and -14 <= delta <= 14:
                    add(mid, "edd_window", "EDD within 14 days", 15, f"EDD {edd}")
            for ch in children.get(mid, []):
                dob = ch["date_of_birth"]
                if dob:
                    try:
                        age_days = (
                            date.fromisoformat(visit_date)
                            - date.fromisoformat(dob)
                        ).days
                    except ValueError:
                        age_days = None
                    if age_days is not None and 0 <= age_days <= 28:
                        add(
                            mid,
                            "newborn",
                            "Newborn under 28 days",
                            20,
                            f"born {dob}",
                        )
                if (
                    ch["birth_weight_g"] is not None
                    and ch["birth_weight_g"] < 2500
                ):
                    add(
                        mid,
                        "low_birth_weight",
                        "Low birth weight",
                        15,
                        f"{ch['birth_weight_g']}g",
                    )
            if (r["age"] or 0) >= 35:
                add(mid, "advanced_age", "Maternal age 35+", 10, f"age {r['age']}")
        return signals

    def visit_items(c, u, visit_date):
        rows = beneficiary_rows(c, u)
        signals = signal_map(c, u, rows, visit_date)
        filters = [
            s.asha_visit.c.facility_id == u["facility_id"],
            s.asha_visit.c.visit_date == visit_date,
        ]
        if u["role"] == "asha":
            filters.append(s.asha_visit.c.asha_id == u["id"])
        existing = {}
        day_visits = list(
            c.execute(
                select(s.asha_visit).where(*filters)
            )
            .mappings()
            .all()
        )
        # Terminal outcomes supersede open plans; latest record wins within a class.
        day_visits.sort(
            key=lambda v: (
                v["status"] != "planned",
                v["recorded_at"] or datetime.min.replace(tzinfo=timezone.utc),
            )
        )
        for v in day_visits:
            existing[v["mother_id"]] = v
        items = []
        child_rows = (
            c.execute(
                select(s.child).where(
                    s.child.c.mother_id.in_([r["mother_id"] for r in rows])
                )
            )
            .mappings()
            .all()
        ) if rows else []
        children_by_mother = {}
        for ch in child_rows:
            children_by_mother.setdefault(ch["mother_id"], []).append(
                {
                    "id": ch["id"],
                    "date_of_birth": ch["date_of_birth"],
                    "birth_weight_g": ch["birth_weight_g"],
                }
            )
        for r in rows:
            mid = r["mother_id"]
            reasons = signals.get(mid, [])
            score = round(sum(x["weight"] for x in reasons), 1)
            visit = existing.get(mid)
            status = "pending"
            if visit:
                status = visit["status"]
            name = (r["mother_details"] or {}).get("name") or r[
                "mother_source_id"
            ]
            lat = r["household_lat"] if r["household_lat"] is not None else r["village_lat"]
            lng = r["household_lng"] if r["household_lng"] is not None else r["village_lng"]
            items.append(
                {
                    "mother_id": mid,
                    "assignment_id": r["assignment_id"],
                    "name": name,
                    "uhid": r["uhid"],
                    "village_id": r["village_id"],
                    "village": r["village_name"],
                    "household_label": r["household_label"],
                    "lat": lat,
                    "lng": lng,
                    "clinician_high_risk": bool(r["clinician_high_risk"]),
                    "priority_score": score,
                    "reasons": sorted(reasons, key=lambda x: -x["weight"]),
                    "status": status,
                    "visit_id": visit["id"] if visit else None,
                    "children": children_by_mother.get(mid, []),
                    "asha_name": r["worker_name"],
                    "asha_id": r["worker_id"],
                }
            )
        items.sort(key=lambda x: (-x["priority_score"], x["name"]))
        return items

    def parse_moment(value):
        if not value:
            return now()
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "recorded_at must be an ISO timestamp")
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    def record_visit(c, u, body):
        if body.status not in VISIT_STATUSES:
            raise HTTPException(422, "Unsupported visit status")
        if not valid_day(body.visit_date):
            raise HTTPException(422, "visit_date must be YYYY-MM-DD")
        a = scoped_assignment(c, u, body.mother_id)
        prior = (
            c.execute(
                select(s.asha_visit).where(
                    s.asha_visit.c.asha_id == u["id"],
                    s.asha_visit.c.client_uuid == body.client_uuid,
                )
            )
            .mappings()
            .first()
        )
        if prior:
            same = (
                prior["mother_id"] == str(body.mother_id)
                and prior["visit_date"] == body.visit_date
                and prior["status"] == body.status
                and prior["outcome"] == (body.outcome or {})
            )
            if not same:
                raise HTTPException(
                    409, "client_uuid was already used for a different visit"
                )
            return dict(prior), True
        open_key = (
            f"{u['id']}|{body.mother_id}|{body.visit_date}"
            if body.status == "planned"
            else None
        )
        if open_key:
            open_plan = (
                c.execute(
                    select(s.asha_visit).where(s.asha_visit.c.open_key == open_key)
                )
                .mappings()
                .first()
            )
            if open_plan:
                return dict(open_plan), True
        mother = one(s.mother, str(body.mother_id), c)
        signals = signal_map(
            c,
            u,
            [
                {
                    "mother_id": mother["id"],
                    "mother_source_id": mother["source_id"],
                    "clinician_high_risk": mother["clinician_high_risk"],
                    "high_risk_reason_by_clinician": mother[
                        "high_risk_reason_by_clinician"
                    ],
                    "gestation_weeks": mother["gestation_weeks"],
                    "edd": mother["edd"],
                    "age": mother["age"],
                }
            ],
            body.visit_date,
        )
        reasons = signals.get(mother["id"], [])
        identifier = str(uuid4())
        try:
            c.execute(
                s.asha_visit.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    asha_id=u["id"],
                    mother_id=str(body.mother_id),
                    village_id=a["village_id"],
                    visit_date=body.visit_date,
                    status=body.status,
                    priority_score=round(sum(x["weight"] for x in reasons), 1),
                    priority_reasons=reasons,
                    outcome=body.outcome or {},
                    client_uuid=body.client_uuid,
                    recorded_at=parse_moment(body.recorded_at),
                    open_key=open_key,
                )
            )
        except IntegrityError:
            raise HTTPException(409, "Visit conflicts with an existing record")
        if body.status != "planned":
            c.execute(
                update(s.asha_visit)
                .where(
                    s.asha_visit.c.open_key
                    == f"{u['id']}|{body.mother_id}|{body.visit_date}",
                    s.asha_visit.c.id != identifier,
                )
                .values(open_key=None)
            )
        row = (
            c.execute(select(s.asha_visit).where(s.asha_visit.c.id == identifier))
            .mappings()
            .one()
        )
        return dict(row), False

    def record_note(c, u, body):
        scoped_assignment(c, u, body.mother_id)
        prior = (
            c.execute(
                select(s.asha_note).where(
                    s.asha_note.c.asha_id == u["id"],
                    s.asha_note.c.client_uuid == body.client_uuid,
                )
            )
            .mappings()
            .first()
        )
        if prior:
            if (
                prior["transcript"] != body.transcript
                or prior["mother_id"] != body.mother_id
                or prior["visit_id"] != body.visit_id
                or prior["camp_update_id"] != body.camp_update_id
                or prior["structured"].get("client", {}) != (body.structured or {})
            ):
                raise HTTPException(
                    409, "client_uuid was already used for a different note"
                )
            return dict(prior), True
        if body.visit_id:
            visit = one(s.asha_visit, str(body.visit_id), c)
            if (visit["asha_id"] != u["id"] or visit["facility_id"] != u["facility_id"]
                or visit["mother_id"] != str(body.mother_id)):
                raise HTTPException(422, "Visit does not match this beneficiary")
        if body.camp_update_id:
            cu = one(s.asha_camp_update, str(body.camp_update_id), c)
            if cu["asha_id"] != u["id"] or cu["mother_id"] != str(body.mother_id):
                raise HTTPException(422, "Camp update does not match")
        structured = {
            "extracted": extract_structured(body.transcript),
            "client": body.structured or {},
        }
        identifier = str(uuid4())
        c.execute(
            s.asha_note.insert().values(
                id=identifier,
                facility_id=u["facility_id"],
                asha_id=u["id"],
                mother_id=str(body.mother_id),
                visit_id=str(body.visit_id) if body.visit_id else None,
                camp_update_id=str(body.camp_update_id)
                if body.camp_update_id
                else None,
                transcript=body.transcript,
                structured=structured,
                recorded_at=parse_moment(body.recorded_at),
                client_uuid=body.client_uuid,
            )
        )
        row = (
            c.execute(select(s.asha_note).where(s.asha_note.c.id == identifier))
            .mappings()
            .one()
        )
        return dict(row), False

    def record_camp_update(c, u, camp, body):
        scoped_assignment(c, u, body.mother_id)
        prior = (
            c.execute(
                select(s.asha_camp_update).where(
                    s.asha_camp_update.c.asha_id == u["id"],
                    s.asha_camp_update.c.client_uuid == body.client_uuid,
                )
            )
            .mappings()
            .first()
        )
        if prior:
            if (prior["camp_id"] != camp["id"] or prior["mother_id"] != body.mother_id
                or prior["kind"] != body.kind or prior["payload"] != body.payload):
                raise HTTPException(
                    409, "client_uuid was already used for a different update"
                )
            return dict(prior), True, None
        if camp["status"] != "open":
            raise HTTPException(409, "Open the camp before recording updates")
        payload = dict(body.payload or {})
        child_id = None
        note_transcript = None
        if body.kind == "attendance":
            if payload.get("status") not in ("present", "absent"):
                raise HTTPException(422, "Choose present or absent for attendance")
        elif body.kind == "immunization":
            if camp["camp_date"] > ist_today().isoformat():
                raise HTTPException(422, "Record vaccines after they have been given")
            child_id = payload.get("child_id")
            raw_vaccine = payload.get("vaccine")
            vaccine = raw_vaccine.strip() if isinstance(raw_vaccine, str) else ""
            if not child_id or not 1 <= len(vaccine) <= 120:
                raise HTTPException(
                    422, "Immunization updates need child_id and vaccine"
                )
            if not as_uuid(child_id):
                raise HTTPException(422, "A valid child UUID is required")
            child = one(s.child, str(child_id), c)
            if child["mother_id"] != str(body.mother_id):
                raise HTTPException(422, "Child does not belong to this mother")
            c.execute(
                s.vaccination_record.insert().values(
                    facility_id=u["facility_id"],
                    child_id=str(child_id),
                    mother_id=str(body.mother_id),
                    vaccine=vaccine[:120],
                    due_date=camp["camp_date"],
                    given_date=camp["camp_date"],
                    status="administered",
                )
            )
            note_transcript = f"Health camp immunization: {vaccine}"
        elif body.kind == "vitals":
            vitals = payload.get("vitals")
            if isinstance(vitals, dict):
                text = vitals.get("text")
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 800:
                    raise HTTPException(422, "Enter the recorded vitals")
                note_transcript = "Health camp vitals: " + text.strip()
            else:
                parts = []
                for key, label in (("bp", "BP"), ("temp_f", "temperature"), ("weight_kg", "weight")):
                    if key in payload and isinstance(payload[key], (str, int, float)) and not isinstance(payload[key], bool):
                        parts.append(f"{label} {payload[key]}")
                if not parts:
                    raise HTTPException(422, "Enter the recorded vitals")
                note_transcript = "Health camp vitals: " + "; ".join(parts)[:800]
        elif body.kind == "referral_flag":
            raw_reason = payload.get("reason")
            reason = raw_reason.strip() if isinstance(raw_reason, str) else ""
            if not 5 <= len(reason) <= 800:
                raise HTTPException(422, "Referral flag needs a reason")
            mother = one(s.mother, str(body.mother_id), c)
            c.execute(
                s.worklist_item.insert().values(
                    facility_id=u["facility_id"],
                    mother_id=str(body.mother_id),
                    assigned_to=mother["assigned_doctor_id"],
                    status="open",
                    details={
                        "source": "asha_health_camp",
                        "camp_id": camp["id"],
                        "reason": reason,
                    },
                )
            )
            note_transcript = "Health camp referral flag: " + reason
        identifier = str(uuid4())
        try:
            c.execute(
                s.asha_camp_update.insert().values(
                    id=identifier,
                    camp_id=camp["id"],
                    asha_id=u["id"],
                    mother_id=str(body.mother_id),
                    child_id=str(child_id) if child_id else None,
                    kind=body.kind,
                    payload=payload,
                    client_uuid=body.client_uuid,
                )
            )
        except IntegrityError:
            raise HTTPException(409, "Camp update conflicts with an existing record")
        note_id = None
        if note_transcript:
            note_id = str(uuid4())
            c.execute(
                s.asha_note.insert().values(
                    id=note_id,
                    facility_id=u["facility_id"],
                    asha_id=u["id"],
                    mother_id=str(body.mother_id),
                    camp_update_id=identifier,
                    transcript=note_transcript,
                    structured={
                        "extracted": extract_structured(note_transcript),
                        "client": payload,
                        "source": "health_camp",
                    },
                    recorded_at=now(),
                    client_uuid=f"camp:{body.client_uuid}",
                )
            )
        row = (
            c.execute(
                select(s.asha_camp_update).where(s.asha_camp_update.c.id == identifier)
            )
            .mappings()
            .one()
        )
        return dict(row), False, note_id

    def visit_out(v):
        value = dict(v)
        for k in ("recorded_at", "created_at", "updated_at"):
            if k in value:
                value[k] = iso(value[k])
        value["synthetic"] = True
        return value

    def note_out(n):
        value = dict(n)
        for k in ("recorded_at", "created_at", "updated_at"):
            if k in value:
                value[k] = iso(value[k])
        value["synthetic"] = True
        return value

    # --- Read endpoints -----------------------------------------------------
    @app.get("/api/asha/dashboard")
    def dashboard(date: str | None = Query(default=None), u=Depends(require("asha.read"))):
        visit_date = date or ist_today().isoformat()
        if not valid_day(visit_date):
            raise HTTPException(422, "date must be YYYY-MM-DD")
        with engine.connect() as c:
            items = visit_items(c, u, visit_date)
            villages = [
                dict(v)
                for v in c.execute(
                    select(s.asha_village).where(
                        s.asha_village.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            camps = [
                dict(v)
                for v in c.execute(
                    select(s.asha_camp).where(
                        s.asha_camp.c.facility_id == u["facility_id"],
                        s.asha_camp.c.asha_id == u["id"],
                    )
                ).mappings()
            ]
            return {
                "date": visit_date,
                "worker": {"id": u["id"], "name": u["name"], "role": u["role"]},
                "villages": villages,
                "stats": {
                    "assigned": len(items),
                    "priority_today": sum(
                        1 for i in items if i["priority_score"] > 0
                    ),
                    "planned": sum(1 for i in items if i["status"] == "planned"),
                    "completed": sum(
                        1 for i in items if i["status"] == "completed"
                    ),
                    "missed": sum(1 for i in items if i["status"] == "missed"),
                },
                "camps": camps,
                "data_label": LABEL,
            }

    @app.get("/api/asha/visits")
    def visits(date: str | None = Query(default=None), u=Depends(require("asha.read"))):
        visit_date = date or ist_today().isoformat()
        if not valid_day(visit_date):
            raise HTTPException(422, "date must be YYYY-MM-DD")
        with engine.begin() as c:
            items = visit_items(c, u, visit_date)
            audit(
                c,
                u,
                "asha_visits_read",
                "facility",
                u["facility_id"],
                {"date": visit_date, "count": len(items)},
            )
            return {"date": visit_date, "items": items, "data_label": LABEL}

    @app.get("/api/asha/route")
    def route(date: str | None = Query(default=None), u=Depends(require("asha.read"))):
        visit_date = date or ist_today().isoformat()
        if not valid_day(visit_date):
            raise HTTPException(422, "date must be YYYY-MM-DD")
        with engine.begin() as c:
            items = [
                i
                for i in visit_items(c, u, visit_date)
                if i["status"] != "completed"
            ]
            audit(
                c,
                u,
                "asha_route_read",
                "facility",
                u["facility_id"],
                {"date": visit_date, "stops": len(items)},
            )
            fac = (
                c.execute(
                    select(s.facility).where(s.facility.c.id == u["facility_id"])
                )
                .mappings()
                .first()
            )
        def has_coordinates(row):
            return row and row["lat"] is not None and row["lng"] is not None

        remaining = [item for item in items if has_coordinates(item)]
        unknown = [item for item in items if not has_coordinates(item)]
        anchor = fac if has_coordinates(fac) else None
        origin = (anchor["lat"], anchor["lng"]) if anchor else (None, None)
        stops = []
        cur = origin
        total = 0.0
        while remaining:
            best = min(remaining, key=lambda item: haversine_km(*cur, item["lat"], item["lng"])) if cur[0] is not None else remaining[0]
            leg = haversine_km(*cur, best["lat"], best["lng"]) if cur[0] is not None else None
            if leg is not None:
                total += leg
            stops.append({
                **best,
                "leg_km": round(leg, 2) if leg is not None else None,
                "leg_minutes": round(leg / 5 * 60) if leg is not None else None,
                "cumulative_km": round(total, 2) if leg is not None else None,
            })
            cur = (best["lat"], best["lng"])
            remaining.remove(best)
        stops.extend({**item, "leg_km": None, "leg_minutes": None, "cumulative_km": None} for item in unknown)
        return {
            "date": visit_date,
            "origin": {"lat": origin[0], "lng": origin[1]},
            "stops": stops,
            "total_km": round(total, 2),
            "total_minutes": round(total / 5 * 60),
            "estimated_stops": sum(stop["leg_km"] is not None for stop in stops),
            "pace_kmh": 5,
            "data_label": LABEL,
        }

    @app.get("/api/asha/notes")
    def notes(
        mother_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        u=Depends(require("asha.read")),
    ):
        filters = [s.asha_note.c.facility_id == u["facility_id"]]
        if u["role"] == "asha":
            filters.extend([
                s.asha_note.c.asha_id == u["id"],
                s.asha_note.c.mother_id.in_(
                    select(s.asha_assignment.c.mother_id).where(
                        s.asha_assignment.c.facility_id == u["facility_id"],
                        s.asha_assignment.c.asha_id == u["id"],
                        s.asha_assignment.c.active.is_(True),
                    )
                ),
            ])
        if mother_id:
            filters.append(s.asha_note.c.mother_id == str(mother_id))
        with engine.begin() as c:
            rows = (
                c.execute(
                    select(s.asha_note)
                    .where(*filters)
                    .order_by(s.asha_note.c.recorded_at.desc())
                    .limit(limit)
                )
                .mappings()
                .all()
            )
            audit(c, u, "asha_notes_read", "facility", u["facility_id"],
                  {"count": len(rows), "mother_id": mother_id})
            return {"items": [note_out(r) for r in rows], "data_label": LABEL}

    @app.post("/api/asha/notes/extract")
    def extract(body: ExtractBody, u=Depends(require("asha.read"))):
        return {"structured": extract_structured(body.transcript)}

    # --- Camps ---------------------------------------------------------------
    @app.get("/api/asha/camps")
    def camps(u=Depends(require("asha.read"))):
        filters = [s.asha_camp.c.facility_id == u["facility_id"]]
        if u["role"] == "asha":
            filters.append(s.asha_camp.c.asha_id == u["id"])
        with engine.connect() as c:
            rows = (
                c.execute(
                    select(s.asha_camp, s.asha_village.c.name.label("village_name"))
                    .select_from(s.asha_camp)
                    .join(
                        s.asha_village,
                        s.asha_village.c.id == s.asha_camp.c.village_id,
                        isouter=True,
                    )
                    .where(*filters)
                    .order_by(s.asha_camp.c.camp_date.desc())
                    .limit(100)
                )
                .mappings()
                .all()
            )
            out = []
            for r in rows:
                value = dict(r)
                for k in ("created_at", "updated_at"):
                    value[k] = iso(value[k])
                value["updates"] = c.scalar(
                    select(func.count())
                    .select_from(s.asha_camp_update)
                    .where(s.asha_camp_update.c.camp_id == value["id"])
                )
                out.append(value)
            return {"items": out, "data_label": LABEL}

    @app.post("/api/asha/camps", status_code=201)
    def create_camp(body: CampBody, u=Depends(require("asha.write"))):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers run health camps")
        if not valid_day(body.camp_date):
            raise HTTPException(422, "camp_date must be YYYY-MM-DD")
        with engine.begin() as c:
            village = one(s.asha_village, body.village_id, c)
            if village["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            identifier = str(uuid4())
            c.execute(
                s.asha_camp.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    asha_id=u["id"],
                    village_id=village["id"],
                    name=body.name,
                    camp_date=body.camp_date,
                    status="planned",
                    details=body.details or {},
                )
            )
            audit(c, u, "asha_camp_created", "asha_camp", identifier)
            return one(s.asha_camp, identifier, c)

    @app.post("/api/asha/camps/{identifier}/status")
    def camp_status(
        identifier: str, body: CampStatus, u=Depends(require("asha.write"))
    ):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers run health camps")
        allowed = {"planned": {"open"}, "open": {"closed"}, "closed": {"open"}}
        with engine.begin() as c:
            camp = one(s.asha_camp, identifier, c)
            if camp["asha_id"] != u["id"] or camp["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Only the camp owner in this facility can change status")
            if body.status not in allowed.get(camp["status"], set()):
                raise HTTPException(
                    409, f"Cannot move camp from {camp['status']} to {body.status}"
                )
            c.execute(
                update(s.asha_camp)
                .where(s.asha_camp.c.id == identifier)
                .values(status=body.status)
            )
            audit(
                c,
                u,
                "asha_camp_" + body.status,
                "asha_camp",
                identifier,
                {"before": camp["status"]},
            )
            return one(s.asha_camp, identifier, c)

    def apply_camp_update(c, u, camp_id, body):
        if not camp_id or not as_uuid(camp_id):
            raise HTTPException(422, "A valid camp UUID is required")
        camp = one(s.asha_camp, str(camp_id), c)
        if camp["asha_id"] != u["id"] or camp["facility_id"] != u["facility_id"]:
            raise HTTPException(403, "Only the camp owner in this facility can record updates")
        if body.kind not in CAMP_KINDS:
            raise HTTPException(422, "Unsupported camp update kind")
        row, dup, note_id = record_camp_update(c, u, camp, body)
        return row, dup, note_id

    @app.post("/api/asha/camps/{identifier}/updates")
    def camp_updates(
        identifier: str, body: CampUpdatesBody, u=Depends(require("asha.write"))
    ):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers record camp updates")
        results = []
        for item in body.updates:
            try:
                with engine.begin() as c:
                    row, dup, note_id = apply_camp_update(c, u, identifier, item)
                    audit(
                        c,
                        u,
                        "asha_camp_update",
                        "asha_camp_update",
                        row["id"],
                        {"kind": row["kind"], "mother_id": row["mother_id"]},
                    )
                results.append(
                    {
                        "client_uuid": item.client_uuid,
                        "status": "duplicate" if dup else "created",
                        "id": row["id"],
                        "note_id": note_id,
                    }
                )
            except HTTPException as e:
                results.append(
                    {
                        "client_uuid": item.client_uuid,
                        "status": "error",
                        "detail": e.detail,
                        "code": e.status_code,
                    }
                )
        return {"results": results, "data_label": LABEL}

    # --- Offline sync ---------------------------------------------------------
    @app.post("/api/asha/sync")
    def sync(body: SyncBody, u=Depends(require("asha.write"))):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers sync field work")
        results = []
        for item in body.visits:
            try:
                with engine.begin() as c:
                    row, dup = record_visit(c, u, item)
                    audit(
                        c,
                        u,
                        "asha_visit_" + row["status"],
                        "asha_visit",
                        row["id"],
                        {"mother_id": row["mother_id"], "date": row["visit_date"]},
                    )
                results.append(
                    {
                        "entity": "visit",
                        "client_uuid": item.client_uuid,
                        "visit_status": row["status"],
                        "status": "duplicate" if dup else "created",
                        "id": row["id"],
                    }
                )
            except HTTPException as e:
                results.append(
                    {
                        "entity": "visit",
                        "client_uuid": item.client_uuid,
                        "status": "error",
                        "detail": e.detail,
                        "code": e.status_code,
                    }
                )
        for item in body.notes:
            try:
                with engine.begin() as c:
                    row, dup = record_note(c, u, item)
                    audit(
                        c,
                        u,
                        "asha_note_recorded",
                        "asha_note",
                        row["id"],
                        {"mother_id": row["mother_id"]},
                    )
                results.append(
                    {
                        "entity": "note",
                        "client_uuid": item.client_uuid,
                        "status": "duplicate" if dup else "created",
                        "id": row["id"],
                    }
                )
            except HTTPException as e:
                results.append(
                    {
                        "entity": "note",
                        "client_uuid": item.client_uuid,
                        "status": "error",
                        "detail": e.detail,
                        "code": e.status_code,
                    }
                )
        for item in body.camp_updates:
            try:
                with engine.begin() as c:
                    row, dup, note_id = apply_camp_update(
                        c, u, item.camp_id, item
                    )
                    audit(
                        c,
                        u,
                        "asha_camp_update",
                        "asha_camp_update",
                        row["id"],
                        {"kind": row["kind"], "mother_id": row["mother_id"]},
                    )
                results.append(
                    {
                        "entity": "camp_update",
                        "client_uuid": item.client_uuid,
                        "status": "duplicate" if dup else "created",
                        "id": row["id"],
                        "note_id": note_id,
                    }
                )
            except HTTPException as e:
                results.append(
                    {
                        "entity": "camp_update",
                        "client_uuid": item.client_uuid,
                        "status": "error",
                        "detail": e.detail,
                        "code": e.status_code,
                    }
                )
        return {"results": results, "data_label": LABEL}

    # --- Direct write endpoints ------------------------------------------------
    @app.post("/api/asha/visits")
    def create_visit(body: VisitBody, u=Depends(require("asha.write"))):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers record visits")
        with engine.begin() as c:
            row, dup = record_visit(c, u, body)
            audit(
                c,
                u,
                "asha_visit_" + row["status"],
                "asha_visit",
                row["id"],
                {"mother_id": row["mother_id"], "date": row["visit_date"]},
            )
            return {"visit": visit_out(row), "duplicate": dup}

    @app.post("/api/asha/notes", status_code=201)
    def create_note(body: NoteBody, u=Depends(require("asha.write"))):
        if u["role"] != "asha":
            raise HTTPException(403, "Only ASHA workers record notes")
        with engine.begin() as c:
            row, dup = record_note(c, u, body)
            audit(
                c,
                u,
                "asha_note_recorded",
                "asha_note",
                row["id"],
                {"mother_id": row["mother_id"]},
            )
            return {"note": note_out(row), "duplicate": dup}

    @app.get("/api/asha/state")
    def state(date: str | None = Query(default=None), u=Depends(require("asha.read"))):
        """Compact snapshot for offline caching on the device."""
        visit_date = date or ist_today().isoformat()
        if not valid_day(visit_date):
            raise HTTPException(422, "date must be YYYY-MM-DD")
        with engine.connect() as c:
            rows = beneficiary_rows(c, u)
            items = visit_items(c, u, visit_date)
            camps = [
                dict(v)
                for v in c.execute(
                    select(s.asha_camp).where(
                        s.asha_camp.c.facility_id == u["facility_id"],
                        s.asha_camp.c.asha_id == u["id"],
                        s.asha_camp.c.status != "closed",
                    )
                ).mappings()
            ]
            villages = [
                dict(v)
                for v in c.execute(
                    select(s.asha_village).where(
                        s.asha_village.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            return {
                "server_time": now().isoformat(),
                "date": visit_date,
                "villages": villages,
                "assignments": [
                    {
                        "id": r["assignment_id"],
                        "mother_id": r["mother_id"],
                        "name": (r["mother_details"] or {}).get("name")
                        or r["mother_source_id"],
                        "village_id": r["village_id"],
                        "village": r["village_name"],
                        "household_label": r["household_label"],
                        "lat": r["household_lat"]
                        if r["household_lat"] is not None
                        else r["village_lat"],
                        "lng": r["household_lng"]
                        if r["household_lng"] is not None
                        else r["village_lng"],
                    }
                    for r in rows
                ],
                "visits": [
                    {
                        "mother_id": i["mother_id"],
                        "name": i["name"],
                        "priority_score": i["priority_score"],
                        "reasons": [x["code"] for x in i["reasons"]],
                        "status": i["status"],
                    }
                    for i in items
                ],
                "camps": camps,
                "data_label": LABEL,
            }

    # --- Oversight & administration ---------------------------------------------
    @app.get("/api/asha/oversight")
    def oversight(u=Depends(require("asha.read"))):
        with engine.connect() as c:
            workers = [
                w
                for w in facility_staff(c, u["facility_id"])
                if w["role"] == "asha"
                and (u["role"] != "asha" or w["id"] == u["id"])
            ]
            out = []
            since = (ist_today() - timedelta(days=7)).isoformat()
            for w in workers:
                wid = w["id"]
                out.append(
                    {
                        "asha_id": wid,
                        "name": w["name"],
                        "assigned": c.scalar(
                            select(func.count())
                            .select_from(s.asha_assignment)
                            .where(
                                s.asha_assignment.c.asha_id == wid,
                                s.asha_assignment.c.active.is_(True),
                            )
                        )
                        or 0,
                        "visits_7d": c.scalar(
                            select(func.count())
                            .select_from(s.asha_visit)
                            .where(
                                s.asha_visit.c.asha_id == wid,
                                s.asha_visit.c.visit_date >= since,
                            )
                        )
                        or 0,
                        "notes": c.scalar(
                            select(func.count())
                            .select_from(s.asha_note)
                            .where(s.asha_note.c.asha_id == wid)
                        )
                        or 0,
                        "camps": c.scalar(
                            select(func.count())
                            .select_from(s.asha_camp)
                            .where(s.asha_camp.c.asha_id == wid)
                        )
                        or 0,
                    }
                )
            return {"workers": out, "data_label": LABEL}

    @app.post("/api/asha/villages", status_code=201)
    def create_village(body: VillageBody, u=Depends(require("asha.assign"))):
        with engine.begin() as c:
            identifier = str(uuid4())
            c.execute(
                s.asha_village.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    name=body.name,
                    lat=body.lat,
                    lng=body.lng,
                    anganwadi_name=body.anganwadi_name,
                )
            )
            audit(c, u, "asha_village_created", "asha_village", identifier)
            return one(s.asha_village, identifier, c)

    @app.post("/api/asha/assignments", status_code=201)
    def create_assignment(
        body: AssignmentBody, u=Depends(require("asha.assign"))
    ):
        with engine.begin() as c:
            worker = [
                p
                for p in facility_staff(c, u["facility_id"])
                if p["id"] == str(body.asha_id)
            ]
            if not worker or worker[0]["role"] != "asha":
                raise HTTPException(
                    422, "Choose an active ASHA worker in this facility"
                )
            mother = one(s.mother, body.mother_id, c)
            if mother["registered_facility_id"] != u["facility_id"]:
                raise HTTPException(
                    422, "Beneficiary belongs to another facility"
                )
            village_id = None
            if body.village_id:
                village = one(s.asha_village, body.village_id, c)
                if village["facility_id"] != u["facility_id"]:
                    raise HTTPException(
                        422, "Village belongs to another facility"
                    )
                village_id = village["id"]
            existing = (
                c.execute(
                    select(s.asha_assignment).where(
                        s.asha_assignment.c.asha_id == body.asha_id,
                        s.asha_assignment.c.mother_id == body.mother_id,
                    )
                )
                .mappings()
                .first()
            )
            if existing:
                c.execute(
                    update(s.asha_assignment)
                    .where(s.asha_assignment.c.id == existing["id"])
                    .values(
                        active=True,
                        village_id=village_id or existing["village_id"],
                        household_label=body.household_label
                        or existing["household_label"],
                        lat=body.lat if body.lat is not None else existing["lat"],
                        lng=body.lng if body.lng is not None else existing["lng"],
                    )
                )
                audit(
                    c,
                    u,
                    "asha_assignment_reactivated",
                    "asha_assignment",
                    existing["id"],
                )
                return one(s.asha_assignment, existing["id"], c)
            identifier = str(uuid4())
            c.execute(
                s.asha_assignment.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    asha_id=body.asha_id,
                    mother_id=body.mother_id,
                    village_id=village_id,
                    household_label=body.household_label,
                    lat=body.lat,
                    lng=body.lng,
                    active=True,
                )
            )
            audit(c, u, "asha_assignment_created", "asha_assignment", identifier)
            return one(s.asha_assignment, identifier, c)

    @app.post("/api/asha/assignments/{identifier}/status")
    def assignment_status(
        identifier: str, body: AssignmentStatus, u=Depends(require("asha.assign"))
    ):
        with engine.begin() as c:
            row = one(s.asha_assignment, identifier, c)
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            c.execute(
                update(s.asha_assignment)
                .where(s.asha_assignment.c.id == identifier)
                .values(active=body.active)
            )
            audit(
                c,
                u,
                "asha_assignment_"
                + ("activated" if body.active else "deactivated"),
                "asha_assignment",
                identifier,
            )
            return one(s.asha_assignment, identifier, c)

    @app.get("/api/asha/roster")
    def roster(u=Depends(require("asha.assign"))):
        with engine.connect() as c:
            workers = [
                w
                for w in facility_staff(c, u["facility_id"])
                if w["role"] == "asha"
            ]
            villages = [
                dict(v)
                for v in c.execute(
                    select(s.asha_village).where(
                        s.asha_village.c.facility_id == u["facility_id"]
                    )
                ).mappings()
            ]
            counts = {
                r["asha_id"]: r["n"]
                for r in c.execute(
                    select(
                        s.asha_assignment.c.asha_id,
                        func.count().label("n"),
                    )
                    .where(
                        s.asha_assignment.c.facility_id == u["facility_id"],
                        s.asha_assignment.c.active.is_(True),
                    )
                    .group_by(s.asha_assignment.c.asha_id)
                ).mappings()
            }
            return {
                "workers": [
                    {
                        "id": w["id"],
                        "name": w["name"],
                        "email": w["email"],
                        "verified": w["verified"],
                        "assigned": counts.get(w["id"], 0),
                    }
                    for w in workers
                ],
                "villages": villages,
                "data_label": LABEL,
            }


def seed_asha(engine):
    """Idempotent synthetic beat: villages, one demo worker, assignments, signals."""
    with engine.begin() as c:
        if c.scalar(select(func.count()).select_from(s.asha_village)):
            return
        worker = (
            c.execute(select(s.user).where(s.user.c.source_id == "demo:asha"))
            .mappings()
            .first()
        )
        if not worker:
            anchor = (
                c.execute(
                    select(s.facility)
                    .where(s.facility.c.source_id.like("HOSP-SYN-%"))
                    .order_by(s.facility.c.source_id)
                )
                .mappings()
                .first()
            )
            if not anchor:
                return
            hashed = password_hash(
                os.getenv("DAI_DEMO_PASSWORD", "Dai-Synthetic-2026!")
            )
            worker_id = str(uuid4())
            c.execute(
                s.user.insert().values(
                    id=worker_id,
                    source_id="demo:asha",
                    facility_id=anchor["id"],
                    name="SYNTHETIC Asha",
                    email="asha@dai-synthetic.invalid",
                    role="asha",
                    verified=True,
                    password_hash=hashed,
                    details={"demo": True},
                )
            )
            worker = {"id": worker_id, "facility_id": anchor["id"]}
        fid = worker["facility_id"]
        mothers = (
            c.execute(
                select(s.mother)
                .where(s.mother.c.registered_facility_id == fid)
                .order_by(
                    s.mother.c.clinician_high_risk.desc(), s.mother.c.source_id
                )
                .limit(48)
            )
            .mappings()
            .all()
        )
        if not mothers:
            return
        fac = (
            c.execute(select(s.facility).where(s.facility.c.id == fid))
            .mappings()
            .one()
        )
        base_lat, base_lng = fac["lat"], fac["lng"]
        villages_spec = [
            ("Rampur", 0.028, 0.022, "Rampur Anganwadi"),
            ("Kishanpur", -0.024, 0.030, "Kishanpur Anganwadi"),
            ("Sukhram Colony", 0.031, -0.026, "Sukhram Anganwadi"),
            ("New Sangam", -0.030, -0.020, "Sangam Anganwadi"),
        ]
        village_ids = []
        for name, dlat, dlng, ang in villages_spec:
            vid = str(uuid5(NAMESPACE_URL, f"dai:asha-village:{fid}:{name}"))
            c.execute(
                s.asha_village.insert().values(
                    id=vid,
                    facility_id=fid,
                    name="SYNTHETIC " + name,
                    lat=base_lat + dlat,
                    lng=base_lng + dlng,
                    anganwadi_name=ang,
                )
            )
            village_ids.append((vid, name, base_lat + dlat, base_lng + dlng))
        today = date.today()
        for idx, m in enumerate(mothers):
            vid, vname, vlat, vlng = village_ids[idx % len(village_ids)]
            digest = hashlib.sha256(str(m["source_id"]).encode()).hexdigest()
            jlat = (int(digest[:4], 16) % 2000 - 1000) / 100000.0
            jlng = (int(digest[4:8], 16) % 2000 - 1000) / 100000.0
            c.execute(
                s.asha_assignment.insert().values(
                    facility_id=fid,
                    asha_id=worker["id"],
                    mother_id=m["id"],
                    village_id=vid,
                    household_label=f"House {10 + idx}, {vname}",
                    lat=vlat + jlat,
                    lng=vlng + jlng,
                    active=True,
                )
            )
        assigned = list(
            c.execute(
                select(s.asha_assignment.c.mother_id).where(
                    s.asha_assignment.c.asha_id == worker["id"]
                )
            ).scalars()
        )
        if not assigned:
            return
        children = (
            c.execute(select(s.child).where(s.child.c.mother_id.in_(assigned)))
            .mappings()
            .all()
        )
        antigens = [
            ("BCG", 0),
            ("Hepatitis B birth", 0),
            ("OPV 0", 0),
            ("Pentavalent-1", 42),
            ("PCV-1", 42),
            ("Pentavalent-2", 70),
            ("PCV-2", 70),
            ("Pentavalent-3", 98),
            ("PCV-3", 98),
            ("MR", 273),
        ]
        for ci, ch in enumerate(children[:60]):
            dob = ch["date_of_birth"]
            if not dob:
                continue
            try:
                birth = date.fromisoformat(dob)
            except ValueError:
                continue
            for vaccine, offset in antigens:
                sid = f"asha-seed:vax:{ch['id']}:{vaccine}"
                if c.scalar(
                    select(s.vaccination_record.c.id).where(
                        s.vaccination_record.c.source_id == sid
                    )
                ):
                    continue
                due = (birth + timedelta(days=offset)).isoformat()
                if due >= today.isoformat():
                    status, given = "scheduled", None
                elif ci % 3 == 0:
                    status, given = "administered", due
                else:
                    status, given = "pending", None
                c.execute(
                    s.vaccination_record.insert().values(
                        source_id=sid,
                        facility_id=fid,
                        child_id=ch["id"],
                        mother_id=ch["mother_id"],
                        vaccine=vaccine,
                        due_date=due,
                        given_date=given,
                        status=status,
                    )
                )
        for mi, mid in enumerate(assigned[:24]):
            sid = f"asha-seed:pn:{mid}"
            if c.scalar(
                select(s.postnatal_followup.c.id).where(
                    s.postnatal_followup.c.source_id == sid
                )
            ):
                continue
            due = (today - timedelta(days=(mi % 5) + 1)).isoformat()
            c.execute(
                s.postnatal_followup.insert().values(
                    source_id=sid,
                    mother_id=mid,
                    due_date=due,
                    completed_at=due if mi % 2 == 0 else None,
                    details={"kind": "postnatal_check", "seed": "asha"},
                )
            )
