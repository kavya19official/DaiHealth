"""Reproducible aggregate operating scenario linked to the existing DAI hospitals."""

from __future__ import annotations
import csv
import hashlib
import json
import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT.parents[1] / "backend/data/dai-hospital.db"


def configuration(path=None):
    cfg = json.loads(Path(path or ROOT / "config.json").read_text())
    if cfg["history_days"] < cfg["minimum_history_days"]:
        raise ValueError("Insufficient history configured")
    if not 1 <= cfg["horizon_days"] <= cfg["booking_lead_days"]:
        raise ValueError("Forecast horizon exceeds booking lead time")
    if (
        cfg["validation_days"] + cfg["calibration_days"] + cfg["test_days"] + 90
        >= cfg["history_days"]
    ):
        raise ValueError("Time splits leave insufficient training history")
    if (
        min(cfg["validation_days"], cfg["calibration_days"], cfg["test_days"])
        < cfg["horizon_days"]
    ):
        raise ValueError("Evaluation periods must be at least the forecast horizon")
    if not 0 < cfg["interval_coverage"] < 1:
        raise ValueError("Coverage must lie between 0 and 1")
    return cfg


def source_facilities(source=None):
    path = Path(source or os.getenv("DAI_SOURCE_DB", str(DEFAULT_SOURCE)))
    if not path.is_file():
        raise FileNotFoundError("Generate the DAI hospital dataset before training")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    facilities = [
        dict(r)
        for r in con.execute(
            "SELECT hospital_id,name,tier,has_nicu_level,total_beds FROM hospitals ORDER BY hospital_id"
        )
    ]
    cutoff = con.execute(
        "SELECT value FROM hospital_metadata WHERE key='as_of_date'"
    ).fetchone()[0]
    con.close()
    return facilities, path, cutoff


def targets(cfg):
    return ["deliveries", "nicu_admissions"] + [i["code"] for i in cfg["stock_items"]]


def simulate(facility, cfg, anchor=False):
    key = facility["hospital_id"]
    stable = int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(cfg["seed"] + stable)
    end = date.fromisoformat(cfg["as_of_date"])
    n = cfg["history_days"]
    h = cfg["horizon_days"]
    days = [end - timedelta(days=n - 1 - i) for i in range(n + h)]
    annual = (
        cfg["anchor_annual_deliveries"]
        if anchor
        else cfg["annual_deliveries_by_tier"][facility["tier"]]
    )
    weekly = np.array(cfg["weekday_weights"], dtype=float)
    weekly /= weekly.mean()
    latent = np.zeros(n + h)
    for i in range(1, len(latent)):
        latent[i] = 0.82 * latent[i - 1] + rng.normal(0, 0.035)
    means = np.array(
        [
            annual
            / 365.25
            * weekly[d.weekday()]
            * (
                1
                + cfg["seasonality_amplitude"]
                * np.sin(2 * np.pi * d.timetuple().tm_yday / 365.25)
            )
            * (1 + cfg["growth_per_year"] * (i - n) / 365.25)
            * np.exp(latent[max(0, i - cfg["booking_lead_days"])])
            for i, d in enumerate(days)
        ]
    )
    planned = rng.poisson(np.maximum(0.01, means * cfg["booking_fraction"]))
    observed = rng.poisson(np.maximum(0.01, means[:n] * np.exp(latent[:n] * 0.6)))
    rate = (
        cfg["nicu_rate_by_tier"][facility["tier"]]
        if facility["has_nicu_level"] != "none"
        else 0
    )
    nicu = rng.binomial(observed, rate)
    result = []
    for i, d in enumerate(days):
        row = {
            "hospital_id": key,
            "date": d.isoformat(),
            "booking_known_on": (
                d - timedelta(days=cfg["booking_lead_days"])
            ).isoformat(),
            "planned_arrivals": int(planned[i]),
            "is_forecast_calendar": i >= n,
        }
        if i < n:
            row["deliveries"] = int(observed[i])
            row["nicu_admissions"] = int(nicu[i])
            for item in cfg["stock_items"]:
                # Independent stock noise prevents an exact target/consumption identity.
                expectation = observed[i] * item["units_per_delivery"]
                if (
                    item["code"] == "surfactant"
                    and facility["has_nicu_level"] == "none"
                ):
                    expectation = 0
                row[item["code"]] = int(rng.poisson(max(0, expectation)))
        else:
            for target in targets(cfg):
                row[target] = None
        result.append(row)
    return result


FEATURE_NAMES = [
    "horizon_days",
    "target_weekday_sin",
    "target_weekday_cos",
    "target_year_sin",
    "target_year_cos",
    "origin_index",
    "planned_arrivals_known_in_advance",
    "delivery_latest",
    "delivery_lag_7",
    "delivery_mean_7",
    "delivery_mean_28",
    "delivery_std_7",
    "delivery_trend_7_vs_28",
    "nicu_mean_7",
]


def features(history, origin, horizon):
    if origin < 28 or horizon < 1:
        raise ValueError("Features need 28 completed days and a positive horizon")
    target = history[origin + horizon]
    origin_date = history[origin]["date"]
    if target["booking_known_on"] > origin_date:
        raise ValueError("Booking signal was not yet available at forecast origin")
    d = date.fromisoformat(target["date"])
    values = np.array([r["deliveries"] for r in history[: origin + 1]], dtype=float)
    if np.isnan(values[-28:]).any():
        raise ValueError("Observed feature window contains future outcomes")
    last7 = values[-7:]
    last28 = values[-28:]
    return [
        horizon,
        np.sin(2 * np.pi * d.weekday() / 7),
        np.cos(2 * np.pi * d.weekday() / 7),
        np.sin(2 * np.pi * d.timetuple().tm_yday / 365.25),
        np.cos(2 * np.pi * d.timetuple().tm_yday / 365.25),
        origin,
        target["planned_arrivals"],
        values[-1],
        values[origin - 7],
        last7.mean(),
        last28.mean(),
        last7.std(),
        last7.mean() - last28.mean(),
        np.mean([r["nicu_admissions"] for r in history[origin - 6 : origin + 1]]),
    ]


def baseline(history, origin, horizon, target):
    day = date.fromisoformat(history[origin + horizon]["date"]).weekday()
    matches = [
        r[target]
        for r in history[max(0, origin - 27) : origin + 1]
        if date.fromisoformat(r["date"]).weekday() == day
    ]
    return float(np.mean(matches))


def write_csv(path, rows):
    with Path(path).open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
