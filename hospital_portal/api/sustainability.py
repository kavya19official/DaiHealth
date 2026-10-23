"""Reported resource use and accountable improvement actions; no environmental scores."""

import os
import re
from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID, uuid4
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from . import schema as s
from .staff_scope import effective_staff, facility_staff
from .security import ROLES

METRICS = {
    "water_m3": ("Water", "m³"),
    "energy_kwh": ("Electricity", "kWh"),
    "paper_sheets": ("Paper", "sheets"),
    "waste_kg": ("Waste", "kg"),
}
Metric = Literal["water_m3", "energy_kwh", "paper_sheets", "waste_kg"]


class Input(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )


class Measurement(Input):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    metric: Metric
    value: float = Field(ge=0, le=1e12)
    quality: Literal["measured", "facility_reported", "estimated"]
    source: str = Field(min_length=3, max_length=200)
    evidence: str = Field(min_length=3, max_length=1000)
    occupied_bed_days: int | None = Field(default=None, ge=1, le=10000000)

    @model_validator(mode="after")
    def valid_period(self):
        try:
            value = date.fromisoformat(self.period + "-01")
        except ValueError:
            raise ValueError("Enter a valid reporting month")
        if value > date.today().replace(day=1):
            raise ValueError("Future months cannot be reported as observed consumption")
        if self.metric == "paper_sheets" and not self.value.is_integer():
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
    evidence: str = Field(default="", max_length=1000)
    actual: float | None = Field(default=None, ge=0, le=1e12)


def register_sustainability(app, engine, require, audit, one):
    def preview():
        if os.getenv("DAI_DEMO", "false").lower() != "true":
            raise HTTPException(
                409,
                "Writes require explicit synthetic preview mode; production acceptance remains pending.",
            )

    @app.get("/api/sustainability")
    def dashboard(
        period: str = Query("", max_length=7), u=Depends(require("green.read"))
    ):
        if period and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
            raise HTTPException(422, "Use YYYY-MM for the reporting period")
        if period:
            try:
                date.fromisoformat(period + "-01")
            except ValueError:
                raise HTTPException(422, "Enter a valid reporting month")
        with engine.begin() as c:
            measurements = [
                dict(r)
                for r in c.execute(
                    select(s.sustainability_measurement)
                    .where(
                        s.sustainability_measurement.c.facility_id == u["facility_id"]
                    )
                    .order_by(
                        s.sustainability_measurement.c.period.desc(),
                        s.sustainability_measurement.c.metric,
                    )
                ).mappings()
            ]
            selected = period or (
                measurements[0]["period"]
                if measurements
                else date.today().strftime("%Y-%m")
            )
            year, month = map(int, selected.split("-"))
            previous = f"{year-1}-12" if month == 1 else f"{year}-{month-1:02}"
            indicators = []
            for metric, (name, unit) in METRICS.items():
                current = next(
                    (
                        m
                        for m in measurements
                        if m["metric"] == metric and m["period"] == selected
                    ),
                    None,
                )
                prior = next(
                    (
                        m
                        for m in measurements
                        if m["metric"] == metric and m["period"] == previous
                    ),
                    None,
                )
                # Only compare adjacent observations with the same reporting method.
                comparable = bool(
                    current
                    and prior
                    and current["quality"] == prior["quality"]
                    and current["source"] == prior["source"]
                    and prior["value"] > 0
                )
                indicators.append(
                    {
                        "metric": metric,
                        "name": name,
                        "unit": unit,
                        "observation": current,
                        "previous_period": previous,
                        "change_percent": (
                            round(
                                (current["value"] - prior["value"])
                                / prior["value"]
                                * 100,
                                1,
                            )
                            if comparable
                            else None
                        ),
                        "per_occupied_bed_day": (
                            round(current["value"] / current["occupied_bed_days"], 4)
                            if current and current["occupied_bed_days"]
                            else None
                        ),
                    }
                )
            actions = [
                dict(r)
                for r in c.execute(
                    select(s.sustainability_action)
                    .where(s.sustainability_action.c.facility_id == u["facility_id"])
                    .order_by(s.sustainability_action.c.updated_at.desc())
                ).mappings()
            ]
            staff = [
                {"id": r["id"], "name": r["name"], "role": r["role"]}
                for r in facility_staff(c, u["facility_id"])
                if "green.write" in ROLES.get(r["role"], set())
            ]
            audit(
                c, u, "read", "sustainability", u["facility_id"], {"period": selected}
            )
            return {
                "period": selected,
                "periods": sorted({m["period"] for m in measurements}, reverse=True),
                "indicators": indicators,
                "history": measurements,
                "actions": actions,
                "staff": staff,
                "data_label": "Simulated on synthetic data",
                "limitations": "Observations are entered by staff. Targets are goals, not verified savings. No green score, carbon/water conversion from AI usage, or peer ranking is calculated.",
            }

    @app.post("/api/sustainability/measurements", status_code=201)
    def record(body: Measurement, u=Depends(require("green.write"))):
        preview()
        with engine.begin() as c:
            identifier = str(uuid4())
            try:
                c.execute(
                    s.sustainability_measurement.insert().values(
                        id=identifier,
                        facility_id=u["facility_id"],
                        recorded_by=u["id"],
                        **body.model_dump(),
                    )
                )
            except IntegrityError:
                raise HTTPException(
                    409,
                    "This metric already has a record for that month. Existing evidence is preserved; use a different reporting month.",
                )
            audit(
                c,
                u,
                "measurement_recorded",
                "sustainability_measurement",
                identifier,
                {"period": body.period, "metric": body.metric},
            )
            return {"id": identifier}

    @app.post("/api/sustainability/actions", status_code=201)
    def create_action(body: GreenAction, u=Depends(require("green.write"))):
        preview()
        with engine.begin() as c:
            owner = effective_staff(
                c, one(s.user, str(body.owner_id), c), u["facility_id"]
            )
            if owner["facility_id"] != u[
                "facility_id"
            ] or "green.write" not in ROLES.get(owner["role"], set()):
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
            if body.status == "completed" and (
                not body.evidence or body.actual is None
            ):
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
