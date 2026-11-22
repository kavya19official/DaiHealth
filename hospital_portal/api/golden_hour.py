"""Golden Hour: incoming emergency pre-alerts (PROTOTYPE, synthetic demonstration only).

A pre-alert is a heads-up that a patient may arrive. It is not a booking, a bed
reservation, a dispatch or a clinical order. The receiving facility is re-checked
here against the synthetic network's listed capabilities, so an alert for something
the facility cannot handle is refused even if the sender's rules were wrong.
The ambulance feed is simulated from the ETA. Nothing here calls a real service.
"""
import hashlib
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Float, JSON, DateTime, UniqueConstraint, select, update
from sqlalchemy.exc import IntegrityError

from . import schema as s
from .demo_requests import COORDS, enabled, fixture, uid

LABEL = "PROTOTYPE — synthetic demonstration. No real hospital, ambulance or clinician is contacted."

alerts = s.table(
    "golden_hour_alert",
    s.ref("facility_id", "facility", False),
    s.text("directory_code", False),
    s.text("patient_key", False),
    s.text("patient_name", False),
    s.text("alert_ref", False),
    s.text("request_key", False),
    s.text("request_hash", False),
    s.text("priority", False),
    s.text("triage_level", False),
    s.text("triggered_by", False),
    s.number("eta_minutes", False),
    Column("distance_km", Float),
    Column("origin_lat", Float),
    Column("origin_lng", Float),
    s.text("origin_label"),
    Column("symptoms", JSON, nullable=False, default=list),
    Column("requirements", JSON, nullable=False, default=dict),
    Column("sbar", JSON, nullable=False, default=dict),
    Column("skipped", JSON, nullable=False, default=list),
    s.text("status", False),
    Column("seen_at", DateTime(timezone=True)),
    Column("decided_at", DateTime(timezone=True)),
    Column("arrived_at", DateTime(timezone=True)),
    s.ref("decided_by", "portal_user"),
    s.text("public_note"),
    s.number("version", False),
    constraints=(UniqueConstraint("patient_key", "request_key"),),
)
events = s.table(
    "golden_hour_event",
    s.ref("alert_id", "golden_hour_alert", False),
    s.text("actor_type", False),
    s.text("actor_key", False),
    s.text("status", False),
    s.text("note", False),
    s.number("version", False),
)

OPEN = {"incoming", "seen", "accepted"}
TERMINAL = {"declined", "cancelled", "arrived"}
TRANSITIONS = {
    "incoming": {"seen", "accepted", "declined", "cancelled"},
    "seen": {"accepted", "declined", "cancelled"},
    "accepted": {"arrived", "cancelled"},
}
DECIDERS = {"consultant", "hospital_admin"}  # accepting an incoming patient is a clinical-operational decision


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class New(Input):
    alert_ref: str = Field(min_length=36, max_length=36)
    directory_code: str = Field(max_length=30)
    priority: Literal["emergency", "urgent"]
    triage_level: Literal["emergency", "urgent"]
    triggered_by: Literal["mother", "family"]
    request_key: str = Field(min_length=16, max_length=80)
    eta_minutes: int = Field(ge=1, le=240)
    distance_km: float = Field(ge=0, le=200)
    origin: dict
    symptoms: list[dict] = Field(min_length=1, max_length=20)
    requirements: dict
    sbar: dict
    patient: dict | None = None
    skipped_nearer: list[dict] = Field(default_factory=list, max_length=10)


class Decision(Input):
    status: Literal["accepted", "declined", "arrived"]
    version: int = Field(ge=1)
    note: str = Field(default="", max_length=500)


class Seen(Input):
    version: int = Field(ge=1)


class PatientCancel(Input):
    note: str = Field(default="", max_length=200)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def sim_speedup():
    try:
        return min(60.0, max(1.0, float(os.getenv("DAI_GH_SIM_SPEEDUP", "8"))))
    except ValueError:
        return 8.0


def satisfies(facility, requirements):
    """Does the synthetic facility list every capability and service the alert says it needs?"""
    caps = set(facility.get("capabilities", []))
    services = {item[1] for item in facility.get("services", [])}
    missing = []
    for cap in requirements.get("caps", []):
        if cap not in caps:
            missing.append(cap)
    for group in requirements.get("capsAny", []):
        if not any(cap in caps for cap in group):
            missing.append(" or ".join(group))
    for service in requirements.get("svcs", []):
        if service not in services:
            missing.append(service)
    return missing


def ambulance(row, now):
    """Simulated ambulance feed. Position and remaining minutes come only from the ETA and elapsed time."""
    code = row["directory_code"]
    dest = COORDS.get(code)
    speed = sim_speedup()
    eta = int(row["eta_minutes"])
    start = aware(row["created_at"])
    elapsed = max(0.0, (now - start).total_seconds() / 60.0) * speed
    dispatch = min(6.0, max(1.0, eta - 1.0))
    if row["status"] in ("declined", "cancelled"):
        state, fraction = "stood_down", 0.0
    elif row["status"] == "arrived":
        state, fraction = "arrived", 1.0
    else:
        fraction = 0.0 if elapsed <= dispatch else min(1.0, (elapsed - dispatch) / max(1.0, eta - dispatch))
        state = "dispatching" if elapsed <= dispatch else "arrived" if fraction >= 1.0 else "arriving" if fraction >= 0.85 else "en_route"
    olat, olng = row["origin_lat"], row["origin_lng"]
    position = None
    if dest and olat is not None and olng is not None:
        position = {"lat": round(olat + (dest[0] - olat) * fraction, 5), "lng": round(olng + (dest[1] - olng) * fraction, 5)}
    return {
        "simulated": True,
        "state": state,
        "progress": round(fraction, 3),
        "remaining_minutes": 0 if state in ("arrived", "stood_down") else max(0, round(eta - elapsed)),
        "position": position,
        "origin": {"lat": olat, "lng": olng},
        "destination": {"lat": dest[0], "lng": dest[1]} if dest else None,
        "speedup": speed,
        "note": "Simulated feed generated from the ETA at demo speed. Not a real vehicle.",
    }


def register_golden_hour(app, engine, require, audit, patient):
    def output(c, row, staff=False):
        now = datetime.now(timezone.utc)
        value = {
            "id": row["id"],
            "status": row["status"],
            "priority": row["priority"],
            "version": row["version"],
            "created_at": aware(row["created_at"]),
            "seen_at": aware(row["seen_at"]),
            "decided_at": aware(row["decided_at"]),
            "arrived_at": aware(row["arrived_at"]),
            "public_note": row["public_note"],
            "eta_minutes": row["eta_minutes"],
            "ambulance": ambulance(row, now),
            "facility_name": c.scalar(select(s.facility.c.name).where(s.facility.c.id == row["facility_id"])),
            "accepted_by_name": c.scalar(select(s.user.c.name).where(s.user.c.id == row["decided_by"])) if row["decided_by"] and row["status"] in ("accepted", "arrived") else None,
            "synthetic": True,
            "label": LABEL,
        }
        if staff:
            value.update(
                {
                    "patient_name": row["patient_name"],
                    "triage_level": row["triage_level"],
                    "triggered_by": row["triggered_by"],
                    "distance_km": row["distance_km"],
                    "origin_label": row["origin_label"],
                    "symptoms": row["symptoms"],
                    "requirements": row["requirements"],
                    "sbar": row["sbar"],
                    "skipped_nearer": row["skipped"],
                    "events": [
                        {**dict(e), "created_at": aware(e["created_at"])}
                        for e in c.execute(
                            select(events.c.status, events.c.note, events.c.version, events.c.created_at, events.c.actor_type)
                            .where(events.c.alert_id == row["id"])
                            .order_by(events.c.version, events.c.created_at)
                        ).mappings().all()
                    ],
                }
            )
        return value

    def history(c, row_id, who, status, note, version):
        c.execute(events.insert().values(alert_id=row_id, actor_type=who["type"], actor_key=who["id"], status=status, note=note, version=version))

    # ---------------- patient side (signed bridge token from the patient app) ----------------
    @app.post("/api/demo-coordination/patient/golden-hour")
    def create(body: New, p=Depends(patient)):
        enabled()
        f = next((f for f in fixture()["facilities"] if f["code"] == body.directory_code), None)
        if not f:
            raise HTTPException(422, "Unknown receiving facility")
        missing = satisfies(f, body.requirements)
        if missing:
            raise HTTPException(422, "The receiving facility does not list: " + ", ".join(missing) + ". No alert was created.")
        if len(json.dumps(body.sbar)) > 30000 or len(json.dumps(body.requirements)) > 4000:
            raise HTTPException(422, "Alert details are too large")
        hashed = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True, default=str).encode()).hexdigest()
        origin = body.origin or {}
        try:
            with engine.begin() as c:
                fid = uid("facility:" + body.directory_code)
                if not c.scalar(select(s.facility.c.id).where(s.facility.c.id == fid)):
                    raise HTTPException(503, "Synthetic receiving facility has not been initialized. Restart npm start.")
                existing = c.execute(select(alerts).where(alerts.c.patient_key == p["sub"], alerts.c.request_key == body.request_key)).mappings().first()
                if existing:
                    if existing["request_hash"] != hashed:
                        raise HTTPException(409, "Request key was already used with different details")
                    return {"alert": output(c, existing), "duplicate": True}
                open_alert = c.execute(
                    select(alerts).where(alerts.c.patient_key == p["sub"], alerts.c.directory_code == body.directory_code, alerts.c.status.in_(sorted(OPEN)))
                ).mappings().first()
                if open_alert:
                    return {"alert": output(c, open_alert), "duplicate": True}
                identifier = str(uuid4())
                c.execute(
                    alerts.insert().values(
                        id=identifier, facility_id=fid, directory_code=body.directory_code, patient_key=p["sub"], patient_name=p["patient_name"],
                        alert_ref=body.alert_ref, request_key=body.request_key, request_hash=hashed, priority=body.priority, triage_level=body.triage_level,
                        triggered_by=body.triggered_by, eta_minutes=body.eta_minutes, distance_km=body.distance_km,
                        origin_lat=origin.get("latitude") if isinstance(origin.get("latitude"), (int, float)) else None,
                        origin_lng=origin.get("longitude") if isinstance(origin.get("longitude"), (int, float)) else None,
                        origin_label=str(origin.get("label", ""))[:120], symptoms=body.symptoms, requirements=body.requirements, sbar=body.sbar,
                        skipped=body.skipped_nearer, status="incoming", public_note="Pre-alert sent. Waiting for the hospital to see it. Call 112 (or 108) now.", version=1,
                    )
                )
                row = c.execute(select(alerts).where(alerts.c.id == identifier)).mappings().one()
                history(c, identifier, {"type": "patient", "id": p["sub"]}, "incoming", "Pre-alert sent by the " + body.triggered_by + ".", 1)
                return {"alert": output(c, row), "duplicate": False}
        except IntegrityError:
            raise HTTPException(409, "A matching alert was created concurrently. Refresh.")

    @app.get("/api/demo-coordination/patient/golden-hour/{identifier}")
    def own(identifier: UUID, p=Depends(patient)):
        enabled()
        with engine.connect() as c:
            row = c.execute(select(alerts).where(alerts.c.id == str(identifier), alerts.c.patient_key == p["sub"])).mappings().first()
            if not row:
                raise HTTPException(404, "Alert not found")
            return {"alert": output(c, row)}

    @app.post("/api/demo-coordination/patient/golden-hour/{identifier}/cancel")
    def cancel(identifier: UUID, body: PatientCancel, p=Depends(patient)):
        enabled()
        identifier = str(identifier)
        with engine.begin() as c:
            row = c.execute(select(alerts).where(alerts.c.id == identifier, alerts.c.patient_key == p["sub"])).mappings().first()
            if not row:
                raise HTTPException(404, "Alert not found")
            if row["status"] in TERMINAL:
                return {"alert": output(c, row)}
            note = body.note or "Cancelled by the patient or family."
            result = c.execute(update(alerts).where(alerts.c.id == identifier, alerts.c.version == row["version"]).values(status="cancelled", public_note=note, version=row["version"] + 1, decided_at=datetime.now(timezone.utc)))
            if result.rowcount != 1:
                raise HTTPException(409, "Alert changed. Refresh and retry.")
            after = c.execute(select(alerts).where(alerts.c.id == identifier)).mappings().one()
            history(c, identifier, {"type": "patient", "id": p["sub"]}, "cancelled", note, after["version"])
            return {"alert": output(c, after)}

    # ---------------- hospital staff side ----------------
    @app.get("/api/golden-hour/staff/incoming")
    def incoming(u=Depends(require("coordination.read"))):
        enabled()
        with engine.begin() as c:
            since = datetime.now(timezone.utc) - timedelta(hours=12)
            rows = c.execute(
                select(alerts).where(alerts.c.facility_id == u["facility_id"], alerts.c.created_at >= since).order_by(alerts.c.created_at.desc()).limit(50)
            ).mappings().all()
            audit(c, u, "golden_hour_incoming_read", "facility", u["facility_id"], {"alert_ids": [r["id"] for r in rows]})
            return {
                "alerts": [output(c, r, staff=True) for r in rows],
                "facility_name": c.scalar(select(s.facility.c.name).where(s.facility.c.id == u["facility_id"])),
                "server_time": datetime.now(timezone.utc),
                "can_decide": u["role"] in DECIDERS,
                "label": LABEL,
                "synthetic": True,
            }

    @app.post("/api/golden-hour/staff/alerts/{identifier}/seen")
    def seen(identifier: UUID, body: Seen, u=Depends(require("coordination.write"))):
        enabled()
        identifier = str(identifier)
        with engine.begin() as c:
            row = c.execute(select(alerts).where(alerts.c.id == identifier, alerts.c.facility_id == u["facility_id"])).mappings().first()
            if not row:
                raise HTTPException(404, "Alert not found in your active facility")
            if row["status"] != "incoming":
                return {"alert": output(c, row, staff=True)}
            result = c.execute(
                update(alerts).where(alerts.c.id == identifier, alerts.c.version == body.version).values(
                    status="seen", seen_at=datetime.now(timezone.utc), version=body.version + 1,
                    public_note="The hospital has seen your alert. It has not accepted yet. Keep going to emergency care and call 112 (or 108).",
                )
            )
            if result.rowcount != 1:
                after = c.execute(select(alerts).where(alerts.c.id == identifier)).mappings().one()
                return {"alert": output(c, after, staff=True)}
            after = c.execute(select(alerts).where(alerts.c.id == identifier)).mappings().one()
            history(c, identifier, {"type": "staff", "id": u["id"]}, "seen", "Seen by hospital staff.", after["version"])
            audit(c, u, "golden_hour_seen", "golden_hour_alert", identifier, {"version": after["version"]})
            return {"alert": output(c, after, staff=True)}

    @app.post("/api/golden-hour/staff/alerts/{identifier}/decision")
    def decision(identifier: UUID, body: Decision, u=Depends(require("coordination.write"))):
        enabled()
        identifier = str(identifier)
        if u["role"] not in DECIDERS:
            raise HTTPException(403, "Only a consultant or hospital administrator can accept or decline an incoming patient")
        with engine.begin() as c:
            row = c.execute(select(alerts).where(alerts.c.id == identifier, alerts.c.facility_id == u["facility_id"])).mappings().first()
            if not row:
                raise HTTPException(404, "Alert not found in your active facility")
            if body.status not in TRANSITIONS.get(row["status"], set()):
                raise HTTPException(409, "This status change is not allowed from " + row["status"])
            if body.status == "declined" and len(body.note) < 5:
                raise HTTPException(422, "Say briefly why the hospital cannot accept, so the family can be redirected")
            notes = {
                "accepted": body.note or "Accepted. The hospital is preparing. This is not a confirmed bed. Keep going to emergency care and call 112 (or 108).",
                "declined": body.note,
                "arrived": body.note or "Patient arrived.",
            }
            values = {"status": body.status, "public_note": notes[body.status], "version": body.version + 1, "decided_by": u["id"], "decided_at": datetime.now(timezone.utc)}
            if body.status == "arrived":
                values["arrived_at"] = datetime.now(timezone.utc)
            result = c.execute(update(alerts).where(alerts.c.id == identifier, alerts.c.version == body.version).values(**values))
            if result.rowcount != 1:
                raise HTTPException(409, "Alert changed. Refresh and retry.")
            after = c.execute(select(alerts).where(alerts.c.id == identifier)).mappings().one()
            history(c, identifier, {"type": "staff", "id": u["id"]}, body.status, notes[body.status], after["version"])
            audit(c, u, "golden_hour_" + body.status, "golden_hour_alert", identifier, {"before_status": row["status"], "after_status": body.status, "version": after["version"]})
            return {"alert": output(c, after, staff=True)}
