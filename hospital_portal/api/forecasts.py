"""Facility-scoped forecasts. Only aggregate scenario data is returned."""

import os
import httpx
from fastapi import Depends, HTTPException
from sqlalchemy import select, func
from . import schema as s


def register_forecasts(app, engine, require, audit):
    @app.get("/api/ml/forecast")
    def get_forecast(u=Depends(require("forecast.read"))):
        with engine.begin() as c:
            facility = (
                c.execute(select(s.facility).where(s.facility.c.id == u["facility_id"]))
                .mappings()
                .one()
            )
            url = os.getenv("DAI_ML_SERVICE_URL")
            if url:
                token = os.getenv("DAI_ML_SERVICE_TOKEN")
                if not token:
                    raise HTTPException(503, "Configure the internal ML service token")
                try:
                    result = httpx.get(
                        url.rstrip("/") + "/v1/forecasts/" + facility["source_id"],
                        headers={"x-dai-ml-token": token},
                        timeout=15,
                    )
                    result.raise_for_status()
                    report = result.json()
                except (httpx.HTTPError, ValueError):
                    raise HTTPException(
                        503, "ML service unavailable; no forecasts have been invented"
                    )
                serving_mode = "separate ML service"
            else:
                try:
                    if __package__.startswith("hospital_portal."):
                        from ..ml_service.store import forecast, ForecastUnavailable
                    else:
                        from ml_service.store import forecast, ForecastUnavailable
                    report = forecast(facility["source_id"])
                except ForecastUnavailable as exc:
                    raise HTTPException(503, str(exc))
                serving_mode = "local trained artifact serving"
            if report.get("hospital_id") != facility["source_id"]:
                raise HTTPException(502, "ML service returned the wrong facility")
            counts = c.execute(
                select(s.mother.c.edd, func.count().label("count"))
                .where(
                    s.mother.c.registered_facility_id == u["facility_id"],
                    s.mother.c.edd >= report["forecast_start"],
                    s.mother.c.edd <= report["forecast_end"],
                    s.mother.c.details["stage"]
                    .as_string()
                    .in_(["T1", "T2", "T3", "In-labour"]),
                )
                .group_by(s.mother.c.edd)
            ).mappings()
            report["registered_cohort_edd_context"] = [
                {"date": r["edd"], "count": r["count"]} for r in counts
            ]
            report["cohort_note"] = (
                "Counts of imported ongoing pregnancies by EDD. These are separate from the larger synthetic operating scenario and are not model training features."
            )
            report["serving_mode"] = serving_mode
            report["data_label"] = "Simulated on synthetic data"
            report["training_label"] = (
                "Trained on synthetic data; real-hospital validation pending"
            )
            audit(
                c,
                u,
                "read_forecast",
                "ml_forecast",
                report["model_version"],
                {"facility_id": u["facility_id"], "serving_mode": serving_mode},
            )
            return report
