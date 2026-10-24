"""Facility-reported resource use, tickets, waste streams and green actions.

Never invents environmental scores or labels a hospital "green".
Metrics are only measured | facility_reported | estimated | unavailable.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update

from . import schema as s
from .security import ROLES
from .staff_scope import effective_staff

METRICS = {
    "water_m3": ("Water", "m³"),
    "energy_kwh": ("Electricity", "kWh"),
    "paper_sheets": ("Paper", "sheets"),
    "waste_kg": ("Waste (aggregate)", "kg"),
}
Metric = Literal["water_m3", "energy_kwh", "paper_sheets", "waste_kg"]
Quality = Literal["measured", "facility_reported", "estimated", "unavailable"]
WASTE_STREAMS = ("general", "recyclable", "biomedical", "sharps", "other")
TICKET_KINDS = ("leak", "maintenance", "cooling", "other")
TICKET_DOMAINS = ("water", "energy", "waste")


class Input(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )


class Measurement(Input):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    metric: Metric
    value: float = Field(ge=0, le=1e12)
    quality: Quality
    source: str = Field(min_length=3, max_length=200)
    evidence: str = Field(min_length=3, max_length=1000)
    occupied_bed_days: int | None = Field(default=None, ge=1, le=10_000_000)

    @model_validator(mode="after")
    def valid_period(self):
        try:
            value = date.fromisoformat(self.period + "-01")
        except ValueError as exc:
            raise ValueError("Enter a valid reporting month") from exc
        if value > date.today().replace(day=1):
            raise ValueError("Future months cannot be reported as observed consumption")
        if self.quality == "unavailable":
            # Keep a placeholder row so the period shows as unavailable, not missing
            if self.value not in (0, 0.0):
                raise ValueError("Unavailable metrics must use value 0")
        if self.metric == "paper_sheets" and self.quality != "unavailable":
            if not float(self.value).is_integer():
                raise ValueError("Paper consumption must be a whole number of sheets")
        return self


class GreenAction(Input):
    title: str = Field(min_length=3, max_length=180)
    metric: Metric
    baseline: float = Field(ge=0, le=1e12)
    target: float = Field(ge=0, le=1e12)
    owner_id: UUID
    due_date: date
    baseline_source: str = Field(min_length=3, max_length=1000)

    @model_validator(mode="after")
    def target_direction(self):
        if self.target > self.baseline:
            raise ValueError("Reduction targets must not exceed the baseline")
        return self


class GreenChange(Input):
    version: int = Field(ge=1)
    status: Literal["in_progress", "completed", "cancelled"]
    notes: str = Field(min_length=3, max_length=2000)
    evidence: str | None = Field(default=None, min_length=3, max_length=2000)
    actual: float | None = Field(default=None, ge=0, le=1e12)


class TicketIn(Input):
    kind: Literal["leak", "maintenance", "cooling", "other"]
    domain: Literal["water", "energy", "waste"]
    title: str = Field(min_length=3, max_length=180)
    priority: Literal["routine", "elevated"] = "routine"
    notes: str = Field(default="", max_length=2000)


class TicketChange(Input):
    status: Literal["open", "in_progress", "closed"]
    notes: str = Field(min_length=1, max_length=2000)
    evidence: str | None = Field(default=None, max_length=1000)


class WasteStreamIn(Input):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    stream: Literal["general", "recyclable", "biomedical", "sharps", "other"]
    mass_kg: float = Field(ge=0, le=1e12)
    quality: Quality
    source: str = Field(min_length=3, max_length=200)
    evidence: str = Field(min_length=3, max_length=1000)
    segregation_compliant: bool = False


def preview():
    if os.environ.get("DAI_DEMO") != "true":
        raise HTTPException(
            503,
            "Green hospital writes are limited to the explicit synthetic demo until PostgreSQL acceptance",
        )


def register(app, engine, require, one, audit, facility_staff):
    def intensity(value: float, bed_days: int | None):
        if not bed_days:
            return None
        return round(value / bed_days, 4)

    def series_for(metric: str, rows: list[dict]):
        pts = [
            {
                "period": r["period"],
                "value": r["value"],
                "quality": r["quality"],
                "source": r["source"],
                "intensity_per_bed_day": intensity(r["value"], r.get("occupied_bed_days")),
            }
            for r in rows
            if r["metric"] == metric
        ]
        pts.sort(key=lambda x: x["period"])
        return pts

    def anomaly_flags(rows: list[dict]) -> list[dict]:
        """Flag unusual month-to-month changes using facility's own history only."""
        flags = []
        by_metric: dict[str, list] = {}
        for r in rows:
            if r["quality"] == "unavailable":
                continue
            by_metric.setdefault(r["metric"], []).append(r)
        for metric, items in by_metric.items():
            items = sorted(items, key=lambda x: x["period"])
            for i in range(1, len(items)):
                prev, cur = items[i - 1], items[i]
                if prev["value"] <= 0:
                    continue
                change = (cur["value"] - prev["value"]) / prev["value"]
                if abs(change) >= 0.25:
                    flags.append(
                        {
                            "metric": metric,
                            "period": cur["period"],
                            "previous_period": prev["period"],
                            "change_ratio": round(change, 3),
                            "label": "unusual_increase" if change > 0 else "unusual_decrease",
                            "note": "Relative to this facility's prior reported month only — not a benchmark score.",
                        }
                    )
        return flags

    def service_efficiency(c, facility_id: str) -> dict:
        """Read-only counts from existing coordination tables when present; else unavailable."""
        out = {
            "quality": "unavailable",
            "source": "not_connected",
            "note": "Travel and teleconsult efficiency requires operational referral/appointment feeds. No estimate is invented.",
            "referrals_recorded": None,
            "appointments_recorded": None,
            "teleconsult_enabled": False,
        }
        try:
            # Optional tables in hospital schema — fail soft
            if hasattr(s, "referral"):
                n = c.execute(
                    select(s.referral.c.id).where(
                        (s.referral.c.from_facility_id == facility_id)
                        | (s.referral.c.to_facility_id == facility_id)
                    )
                ).fetchall()
                out["referrals_recorded"] = len(n)
                out["quality"] = "facility_reported"
                out["source"] = "referral table"
            if hasattr(s, "appointment"):
                n = c.execute(
                    select(s.appointment.c.id).where(
                        s.appointment.c.facility_id == facility_id
                    )
                ).fetchall()
                out["appointments_recorded"] = len(n)
                out["quality"] = "facility_reported"
                out["source"] = (out.get("source") or "") + "+appointment table"
        except Exception:
            pass
        # Teleconsult only when explicitly configured
        out["teleconsult_enabled"] = os.environ.get("DAI_TELECONSULT") == "true"
        if not out["teleconsult_enabled"]:
            out["teleconsult_status"] = "unavailable"
            out["teleconsult_note"] = "Teleconsultation is shown only when clinically configured and permitted (DAI_TELECONSULT=true)."
        return out

    def iot_status() -> dict:
        endpoint = os.environ.get("DAI_BMS_IOT_ENDPOINT", "").strip()
        if not endpoint:
            return {
                "quality": "unavailable",
                "source": "none",
                "note": "Building-management/IoT data is connected only when DAI_BMS_IOT_ENDPOINT is configured for this facility.",
            }
        return {
            "quality": "facility_reported",
            "source": endpoint,
            "note": "Integration endpoint configured; live polling is facility-specific and not simulated here.",
        }

    @app.get("/api/sustainability")
    def dashboard(period: str = Query("", max_length=7), u=Depends(require("green.read"))):
        with engine.connect() as c:
            measurements = [
                dict(r)
                for r in c.execute(
                    select(s.sustainability_measurement)
                    .where(s.sustainability_measurement.c.facility_id == u["facility_id"])
                    .order_by(
                        s.sustainability_measurement.c.period.desc(),
                        s.sustainability_measurement.c.metric,
                    )
                ).mappings()
            ]
            selected = period or (
                measurements[0]["period"] if measurements else date.today().strftime("%Y-%m")
            )
            current = [m for m in measurements if m["period"] == selected]
            by_metric = {m["metric"]: m for m in current}
            cards = []
            for key, (label, unit) in METRICS.items():
                row = by_metric.get(key)
                if not row:
                    cards.append(
                        {
                            "metric": key,
                            "label": label,
                            "unit": unit,
                            "value": None,
                            "quality": "unavailable",
                            "source": None,
                            "evidence": None,
                            "period": selected,
                            "occupied_bed_days": None,
                            "intensity_per_bed_day": None,
                            "note": "No observation recorded for this period.",
                        }
                    )
                else:
                    cards.append(
                        {
                            "metric": key,
                            "label": label,
                            "unit": unit,
                            "value": row["value"] if row["quality"] != "unavailable" else None,
                            "quality": row["quality"],
                            "source": row["source"],
                            "evidence": row["evidence"],
                            "period": row["period"],
                            "occupied_bed_days": row.get("occupied_bed_days"),
                            "intensity_per_bed_day": intensity(
                                row["value"], row.get("occupied_bed_days")
                            )
                            if row["quality"] != "unavailable"
                            else None,
                        }
                    )

            actions = [
                dict(r)
                for r in c.execute(
                    select(s.sustainability_action)
                    .where(s.sustainability_action.c.facility_id == u["facility_id"])
                    .order_by(s.sustainability_action.c.due_date)
                ).mappings()
            ]
            owners = [
                {"id": r["id"], "name": r["name"], "role": r["role"]}
                for r in facility_staff(c, u["facility_id"])
                if "green.write" in ROLES.get(r["role"], set())
            ]

            tickets, waste_rows = [], []
            if hasattr(s, "sustainability_ticket"):
                tickets = [
                    dict(r)
                    for r in c.execute(
                        select(s.sustainability_ticket)
                        .where(s.sustainability_ticket.c.facility_id == u["facility_id"])
                        .order_by(s.sustainability_ticket.c.created_at.desc())
                    ).mappings()
                ]
            if hasattr(s, "sustainability_waste_stream"):
                waste_rows = [
                    dict(r)
                    for r in c.execute(
                        select(s.sustainability_waste_stream)
                        .where(
                            s.sustainability_waste_stream.c.facility_id == u["facility_id"],
                            s.sustainability_waste_stream.c.period == selected,
                        )
                    ).mappings()
                ]

            return {
                "period": selected,
                "methodology": {
                    "scores": False,
                    "ranking": False,
                    "note": (
                        "Indicators are facility-supplied observations with explicit quality labels. "
                        "This portal does not compute a green score or rank hospitals unless definitions "
                        "and data quality are comparable by an external methodology."
                    ),
                },
                "cards": cards,
                "trends": {k: series_for(k, measurements) for k in METRICS},
                "anomaly_flags": anomaly_flags(measurements),
                "actions": actions,
                "owners": owners,
                "tickets": tickets,
                "waste_streams": waste_rows,
                "service_efficiency": service_efficiency(c, u["facility_id"]),
                "iot": iot_status(),
                "write": "green.write" in ROLES.get(u["role"], set()),
            }

    @app.post("/api/sustainability/measurements")
    def record(body: Measurement, u=Depends(require("green.write"))):
        preview()
        with engine.begin() as c:
            existing = c.execute(
                select(s.sustainability_measurement).where(
                    s.sustainability_measurement.c.facility_id == u["facility_id"],
                    s.sustainability_measurement.c.period == body.period,
                    s.sustainability_measurement.c.metric == body.metric,
                )
            ).mappings().first()
            payload = dict(
                facility_id=u["facility_id"],
                recorded_by=u["id"],
                period=body.period,
                metric=body.metric,
                value=body.value,
                quality=body.quality,
                source=body.source,
                evidence=body.evidence,
                occupied_bed_days=body.occupied_bed_days,
            )
            if existing:
                c.execute(
                    update(s.sustainability_measurement)
                    .where(s.sustainability_measurement.c.id == existing["id"])
                    .values(**payload, updated_at=datetime.now(timezone.utc))
                )
                identifier = existing["id"]
                action = "green_measurement_updated"
            else:
                identifier = str(uuid4())
                c.execute(
                    s.sustainability_measurement.insert().values(id=identifier, **payload)
                )
                action = "green_measurement_created"
            audit(c, u, action, "sustainability_measurement", identifier, payload)
            return {"id": identifier}

    @app.post("/api/sustainability/actions")
    def create_action(body: GreenAction, u=Depends(require("green.write"))):
        preview()
        with engine.begin() as c:
            owner = effective_staff(
                c, one(s.user, str(body.owner_id), c), u["facility_id"]
            )
            if owner["facility_id"] != u["facility_id"] or "green.write" not in ROLES.get(
                owner["role"], set()
            ):
                raise HTTPException(422, "Choose an authorised owner in this facility")
            identifier = str(uuid4())
            c.execute(
                s.sustainability_action.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    owner_id=str(body.owner_id),
                    title=body.title,
                    metric=body.metric,
                    baseline=body.baseline,
                    target=body.target,
                    unit=METRICS[body.metric][1],
                    due_date=body.due_date.isoformat(),
                    status="planned",
                    details={
                        "version": 1,
                        "baseline_source": body.baseline_source,
                        "history": [],
                    },
                )
            )
            audit(c, u, "green_action_created", "sustainability_action", identifier)
            return {"id": identifier}

    @app.post("/api/sustainability/actions/{identifier}")
    def change_action(
        identifier: str, body: GreenChange, u=Depends(require("green.write"))
    ):
        preview()
        with engine.begin() as c:
            row = one(s.sustainability_action, identifier, c)
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            if row["status"] in {"completed", "cancelled"}:
                raise HTTPException(
                    409, "This action is already closed; its evidence is preserved"
                )
            if body.status == "completed" and (not body.evidence or body.actual is None):
                raise HTTPException(
                    422,
                    "A completion evidence reference and actual observation are required",
                )
            event = {
                "status": body.status,
                "notes": body.notes,
                "evidence": body.evidence,
                "actual": body.actual,
                "actor": u["name"],
                "at": datetime.now(timezone.utc).isoformat(),
            }
            details = {
                **row["details"],
                "version": body.version + 1,
                "history": [*row["details"].get("history", []), event],
            }
            if row["details"].get("version") != body.version:
                raise HTTPException(409, "This action changed. Refresh and retry")
            if body.status == "completed":
                details["completion"] = event
            result = c.execute(
                update(s.sustainability_action)
                .where(
                    s.sustainability_action.c.id == identifier,
                    s.sustainability_action.c.details["version"].as_integer()
                    == body.version,
                )
                .values(status=body.status, details=details)
            )
            if result.rowcount != 1:
                raise HTTPException(409, "This action changed. Refresh and retry")
            audit(
                c,
                u,
                "green_action_updated",
                "sustainability_action",
                identifier,
                {"status": body.status, "version": body.version + 1},
            )
            return {"id": identifier}

    @app.post("/api/sustainability/tickets")
    def open_ticket(body: TicketIn, u=Depends(require("green.write"))):
        preview()
        if not hasattr(s, "sustainability_ticket"):
            raise HTTPException(503, "Ticket tables not migrated yet")
        with engine.begin() as c:
            identifier = str(uuid4())
            c.execute(
                s.sustainability_ticket.insert().values(
                    id=identifier,
                    facility_id=u["facility_id"],
                    opened_by=u["id"],
                    kind=body.kind,
                    domain=body.domain,
                    title=body.title,
                    status="open",
                    priority=body.priority,
                    details={"notes": body.notes, "history": []},
                )
            )
            audit(c, u, "green_ticket_opened", "sustainability_ticket", identifier)
            return {"id": identifier}

    @app.post("/api/sustainability/tickets/{identifier}")
    def change_ticket(
        identifier: str, body: TicketChange, u=Depends(require("green.write"))
    ):
        preview()
        if not hasattr(s, "sustainability_ticket"):
            raise HTTPException(503, "Ticket tables not migrated yet")
        with engine.begin() as c:
            row = one(s.sustainability_ticket, identifier, c)
            if row["facility_id"] != u["facility_id"]:
                raise HTTPException(403, "Outside your facility scope")
            history = list(row["details"].get("history", []))
            history.append(
                {
                    "status": body.status,
                    "notes": body.notes,
                    "evidence": body.evidence,
                    "actor": u["name"],
                    "at": datetime.now(timezone.utc).isoformat(),
                }
            )
            c.execute(
                update(s.sustainability_ticket)
                .where(s.sustainability_ticket.c.id == identifier)
                .values(
                    status=body.status,
                    details={**row["details"], "history": history, "evidence": body.evidence},
                    updated_at=datetime.now(timezone.utc),
                )
            )
            audit(c, u, "green_ticket_updated", "sustainability_ticket", identifier)
            return {"id": identifier}

    @app.post("/api/sustainability/waste-streams")
    def record_waste(body: WasteStreamIn, u=Depends(require("green.write"))):
        preview()
        if not hasattr(s, "sustainability_waste_stream"):
            raise HTTPException(503, "Waste stream tables not migrated yet")
        with engine.begin() as c:
            existing = c.execute(
                select(s.sustainability_waste_stream).where(
                    s.sustainability_waste_stream.c.facility_id == u["facility_id"],
                    s.sustainability_waste_stream.c.period == body.period,
                    s.sustainability_waste_stream.c.stream == body.stream,
                )
            ).mappings().first()
            payload = dict(
                facility_id=u["facility_id"],
                recorded_by=u["id"],
                period=body.period,
                stream=body.stream,
                mass_kg=body.mass_kg,
                quality=body.quality,
                source=body.source,
                evidence=body.evidence,
                segregation_compliant=body.segregation_compliant,
            )
            if existing:
                c.execute(
                    update(s.sustainability_waste_stream)
                    .where(s.sustainability_waste_stream.c.id == existing["id"])
                    .values(**payload, updated_at=datetime.now(timezone.utc))
                )
                identifier = existing["id"]
            else:
                identifier = str(uuid4())
                c.execute(
                    s.sustainability_waste_stream.insert().values(id=identifier, **payload)
                )
            audit(c, u, "green_waste_stream_recorded", "sustainability_waste_stream", identifier)
            return {"id": identifier}
