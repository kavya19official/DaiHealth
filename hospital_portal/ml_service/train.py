"""Train, compare and calibrate real sklearn models on explicit synthetic history.
Run from the repository root: python -m hospital_portal.ml_service.train --persist
"""

from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import date, timedelta
from pathlib import Path
import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestRegressor
from .history import (
    ROOT,
    FEATURE_NAMES,
    configuration,
    source_facilities,
    simulate,
    targets,
    features,
    baseline,
    write_csv,
)

ARTIFACTS = ROOT / "artifacts"
LABEL = "Trained on synthetic data — not validated on real hospital activity"


def metrics(actual, predicted):
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    error = np.abs(a - p)
    return {
        "mae": round(float(error.mean()), 4),
        "wape_percent": round(float(error.sum() / a.sum() * 100), 2)
        if a.sum() > 0
        else None,
        "sample_count": int(len(a)),
    }


def fit_forest(X, Y, cfg):
    scale = np.maximum(1, Y.mean(axis=0))
    model = RandomForestRegressor(**cfg["forest"], random_state=cfg["seed"], n_jobs=1)
    model.fit(X, Y / scale)
    return model, scale


def stock_projection(forecasts, cfg, history, delivery_total):
    result = []
    for item in cfg["stock_items"]:
        target = item["code"]
        recent = np.mean([r[target] for r in history[-28:]])
        stock = int(np.ceil(recent * item["scenario_days_on_hand"]))
        series = forecasts[target]

        def crossing(field):
            cumulative = 0.0
            for i, row in enumerate(series):
                cumulative += row[field]
                if cumulative >= stock and cumulative > 0:
                    return i + 1, row["date"]
            return None, None

        day, when = crossing("value")
        _, early_date = crossing("upper")
        _, late_date = crossing("lower")
        mean = float(np.mean([r["value"] for r in series]))
        result.append(
            {
                **item,
                "current_stock": stock,
                "balance_source": "Generated scenario stock balance; not the pharmacy ledger",
                "mean_daily_demand": round(mean, 2),
                "forecast_14d_demand": round(sum(r["value"] for r in series), 1),
                "stockout_day": day,
                "stockout_date": when,
                "earliest_stockout_date": early_date,
                "latest_stockout_date": late_date,
                "days_of_cover_estimate": round(stock / mean, 1) if mean else None,
                "reorder_attention": bool(
                    day is not None and day <= item["reorder_days"]
                ),
                "planning_ratio": round(mean / (delivery_total / len(series)), 3)
                if delivery_total
                else None,
                "reason": f"Scenario stock {stock}; forecast average {mean:.1f} {item['unit']}/day. Review replenishment if cover is below {item['reorder_days']} days. No purchase order is created.",
            }
        )
    return result


def train_one(facility, cfg, anchor, folder):
    hist = simulate(facility, cfg, anchor)
    names = targets(cfg)
    n = cfg["history_days"]
    asof = date.fromisoformat(cfg["as_of_date"])
    test_start = asof - timedelta(days=cfg["test_days"] - 1)
    calibration_start = test_start - timedelta(days=cfg["calibration_days"])
    validation_start = calibration_start - timedelta(days=cfg["validation_days"])
    data = []
    labels = []
    base = []
    dates = []
    horizons = []
    origin_dates = []
    for origin in range(28, n - 1):
        for horizon in range(1, cfg["horizon_days"] + 1):
            index = origin + horizon
            if index >= n:
                break
            data.append(features(hist, origin, horizon))
            labels.append([hist[index][name] for name in names])
            base.append([baseline(hist, origin, horizon, name) for name in names])
            dates.append(hist[index]["date"])
            origin_dates.append(hist[origin]["date"])
            horizons.append(horizon)
    X = np.array(data)
    Y = np.array(labels, dtype=float)
    B = np.array(base)
    D = np.array(dates)
    H = np.array(horizons)
    origin_day_values = np.array(origin_dates)
    train_mask = D < validation_start.isoformat()
    train_end = (validation_start - timedelta(days=1)).isoformat()
    eval_fit_end = (calibration_start - timedelta(days=1)).isoformat()
    # A validation/calibration forecast must be issued after the model's fit cutoff.
    # Target-date partitioning alone would leak later training labels into long-horizon origins.
    validation_mask = (
        (D >= validation_start.isoformat())
        & (D < calibration_start.isoformat())
        & (origin_day_values >= train_end)
    )
    calibration_mask = (
        (D >= calibration_start.isoformat())
        & (D < test_start.isoformat())
        & (origin_day_values >= eval_fit_end)
    )
    test_mask = (D >= test_start.isoformat()) & (origin_day_values >= eval_fit_end)
    selection, scale = fit_forest(X[train_mask], Y[train_mask], cfg)
    validation_pred = np.maximum(0, selection.predict(X[validation_mask]) * scale)
    model_val = np.mean(np.abs(Y[validation_mask] - validation_pred), axis=0)
    baseline_val = np.mean(np.abs(Y[validation_mask] - B[validation_mask]), axis=0)
    choose_model = model_val < baseline_val
    evaluation, eval_scale = fit_forest(
        X[D < calibration_start.isoformat()], Y[D < calibration_start.isoformat()], cfg
    )
    cal_model = np.maximum(0, evaluation.predict(X[calibration_mask]) * eval_scale)
    cal_selected = np.where(choose_model, cal_model, B[calibration_mask])
    residuals = np.abs(Y[calibration_mask] - cal_selected)
    test_model = np.maximum(0, evaluation.predict(X[test_mask]) * eval_scale)
    test_selected = np.where(choose_model, test_model, B[test_mask])
    bands = np.zeros((cfg["horizon_days"], len(names)))
    for h in range(1, cfg["horizon_days"] + 1):
        bands[h - 1] = np.quantile(
            residuals[H[calibration_mask] == h],
            cfg["interval_coverage"],
            axis=0,
            method="higher",
        )
    final, final_scale = fit_forest(X, Y, cfg)
    futureX = np.array(
        [features(hist, n - 1, h) for h in range(1, cfg["horizon_days"] + 1)]
    )
    future_model = np.maximum(0, final.predict(futureX) * final_scale)
    future_base = np.array(
        [
            [baseline(hist, n - 1, h, name) for name in names]
            for h in range(1, cfg["horizon_days"] + 1)
        ]
    )
    future = np.where(choose_model, future_model, future_base)
    forecast = {}
    evaluations = {}
    backtest = {}
    for j, name in enumerate(names):
        forecast[name] = [
            {
                "date": hist[n + h - 1]["date"],
                "horizon_days": h,
                "value": round(float(future[h - 1, j]), 2),
                "lower": round(max(0, float(future[h - 1, j] - bands[h - 1, j])), 2),
                "upper": round(float(future[h - 1, j] + bands[h - 1, j]), 2),
                "selected_method": "random_forest"
                if choose_model[j]
                else "seasonal_baseline",
            }
            for h in range(1, cfg["horizon_days"] + 1)
        ]
        actual = Y[test_mask, j]
        q = bands[H[test_mask] - 1, j]
        selected_metrics = metrics(actual, test_selected[:, j])
        base_metrics = metrics(actual, B[test_mask, j])
        per_h = []
        for h in range(1, cfg["horizon_days"] + 1):
            mask = H[test_mask] == h
            per_h.append(
                {"horizon_days": h, **metrics(actual[mask], test_selected[mask, j])}
            )
        evaluations[name] = {
            "selected_method": "random_forest"
            if choose_model[j]
            else "seasonal_baseline",
            "selection_basis": "Lower validation MAE; test data was not used for selection",
            "validation_model_mae": round(float(model_val[j]), 4),
            "validation_baseline_mae": round(float(baseline_val[j]), 4),
            "selected_test": selected_metrics,
            "candidate_test": metrics(actual, test_model[:, j]),
            "baseline_test": base_metrics,
            "test_mae_improvement_percent": round(
                (base_metrics["mae"] - selected_metrics["mae"])
                / base_metrics["mae"]
                * 100,
                2,
            )
            if base_metrics["mae"]
            else None,
            "empirical_range_coverage_percent": round(
                float(
                    np.mean(
                        (actual >= np.maximum(0, test_selected[:, j] - q))
                        & (actual <= test_selected[:, j] + q)
                    )
                )
                * 100,
                2,
            ),
            "horizon_metrics": per_h,
        }
        backtest[name] = [
            {
                "date": str(D[k]),
                "actual": float(Y[k, j]),
                "predicted": round(float(test_selected[index, j]), 2),
                "baseline": round(float(B[k, j]), 2),
            }
            for index, k in enumerate(np.where(test_mask)[0])
            if H[k] == 1
        ]
    drivers = sorted(
        [
            {"feature": feature, "importance_percent": round(float(value) * 100, 2)}
            for feature, value in zip(FEATURE_NAMES, final.feature_importances_)
        ],
        key=lambda r: r["importance_percent"],
        reverse=True,
    )
    model_file = folder / (facility["hospital_id"] + ".joblib")
    joblib.dump(
        {
            "model": final,
            "target_scale": final_scale,
            "target_names": names,
            "feature_names": FEATURE_NAMES,
            "selected_model_targets": choose_model,
            "range_widths": bands,
            "sklearn_version": sklearn.__version__,
        },
        model_file,
        compress=3,
    )
    deliveries = sum(r["value"] for r in forecast["deliveries"])
    payload = {
        "hospital_id": facility["hospital_id"],
        "hospital_name": facility["name"],
        "tier": facility["tier"],
        "data_label": LABEL,
        "as_of_date": cfg["as_of_date"],
        "history_start": hist[0]["date"],
        "history_end": hist[n - 1]["date"],
        "forecast_start": hist[n]["date"],
        "forecast_end": hist[-1]["date"],
        "forecast_horizon_days": cfg["horizon_days"],
        "range_nominal_coverage_percent": cfg["interval_coverage"] * 100,
        "range_method": "Absolute-error quantiles by target and horizon on a separate earlier calibration period; empirical range, not a guarantee.",
        "model_family": "Multi-output RandomForestRegressor with target normalization and per-target seasonal-baseline selection",
        "evaluation": evaluations,
        "forecast": forecast,
        "backtest_horizon_1": backtest,
        "global_feature_importance": drivers,
        "explanation": {
            "kind": "Recorded input values and global model importance, not SHAP or causal effects",
            "inputs": dict(
                zip(FEATURE_NAMES, [round(float(v), 3) for v in futureX[0]])
            ),
            "booking_signal": "Synthetic planned arrivals known 28 days in advance. Registered DAI-cohort EDD counts are separate context only.",
            "human_decision": "Forecasts do not change clinical risk, reserve beds, create rosters or order stock.",
        },
        "splits": {
            "train_target_end": (validation_start - timedelta(days=1)).isoformat(),
            "validation_start": validation_start.isoformat(),
            "validation_end": (calibration_start - timedelta(days=1)).isoformat(),
            "calibration_start": calibration_start.isoformat(),
            "calibration_end": (test_start - timedelta(days=1)).isoformat(),
            "test_start": test_start.isoformat(),
            "test_end": cfg["as_of_date"],
            "evaluation_model_fit_through": (
                calibration_start - timedelta(days=1)
            ).isoformat(),
            "serving_model_refit_through": cfg["as_of_date"],
            "test_unique_target_days": cfg["test_days"],
            "earliest_validation_issue_date": str(
                min(origin_day_values[validation_mask])
            ),
            "earliest_calibration_issue_date": str(
                min(origin_day_values[calibration_mask])
            ),
            "boundary_policy": "Forecast origins before a model's fit cutoff are excluded from validation and calibration, even if their target dates are in the next period.",
            "note": "Rolling-origin evaluation: each feature uses observations through its issue date only. Targets are partitioned by calendar date, with no random split.",
        },
        "stock_projection": stock_projection(forecast, cfg, hist[:n], deliveries),
        "assumptions": cfg["assumptions"],
        "history_summary": {
            "mean_daily_deliveries": round(
                float(np.mean([r["deliveries"] for r in hist[:n]])), 2
            ),
            "annual_deliveries_assumption": cfg["anchor_annual_deliveries"]
            if anchor
            else cfg["annual_deliveries_by_tier"][facility["tier"]],
        },
        "recent_history": [
            {
                k: r[k]
                for k in ("date", "deliveries", "nicu_admissions", "planned_arrivals")
            }
            for r in hist[n - 28 : n]
        ],
        "model_sha256": hashlib.sha256(model_file.read_bytes()).hexdigest(),
    }
    (folder / (facility["hospital_id"] + ".json")).write_text(
        json.dumps(payload, indent=2, allow_nan=False) + "\n"
    )
    return payload, hist


def train(source=None, output=None, cfg=None, limit=None, persist=False, engine=None):
    cfg = cfg or configuration()
    facilities, path, source_cutoff = source_facilities(source)
    if cfg["as_of_date"] != source_cutoff:
        raise ValueError("Forecast as_of_date must match the source synthetic snapshot")
    if limit:
        facilities = facilities[:limit]
    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    signature = json.dumps(
        {
            "config": cfg,
            "source_sha256": source_sha,
            "facilities": [f["hospital_id"] for f in facilities],
            "sklearn": sklearn.__version__,
            "history_code": hashlib.sha256(
                (ROOT / "history.py").read_bytes()
            ).hexdigest(),
            "training_code": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        sort_keys=True,
    )
    version = hashlib.sha256(signature.encode()).hexdigest()[:16]
    output = Path(output or os.getenv("DAI_ML_ARTIFACT_DIR", str(ARTIFACTS)))
    output.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".training-", dir=output))
    reports = []
    completed = []
    calendar = []
    try:
        for i, f in enumerate(facilities):
            report, hist = train_one(f, cfg, i == 0, stage)
            report["model_version"] = version
            reports.append(report)
            (stage / (f["hospital_id"] + ".json")).write_text(
                json.dumps(report, indent=2, allow_nan=False) + "\n"
            )
            completed.extend(r for r in hist if not r["is_forecast_calendar"])
            calendar.extend(
                {
                    k: r[k]
                    for k in (
                        "hospital_id",
                        "date",
                        "booking_known_on",
                        "planned_arrivals",
                    )
                }
                for r in hist
            )
            print(
                f"Trained {f['hospital_id']}: delivery test MAE {report['evaluation']['deliveries']['selected_test']['mae']}; selected {report['evaluation']['deliveries']['selected_method']}",
                flush=True,
            )
        write_csv(stage / "daily_history.csv", completed)
        write_csv(stage / "booking_calendar.csv", calendar)
        manifest = {
            "version": version,
            "data_label": LABEL,
            "source_sha256": source_sha,
            "as_of_date": cfg["as_of_date"],
            "history_rows": len(completed),
            "facility_count": len(facilities),
            "sklearn_version": sklearn.__version__,
            "configuration": cfg,
            "files": {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in stage.iterdir()
                if p.is_file()
            },
            "scope": "Separate synthetic aggregate operating scenario. No patient rows changed.",
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        destination = output / version
        if destination.exists():
            # Same version is immutable; rebuild must yield the same forecast content.
            for f in facilities:
                if (destination / (f["hospital_id"] + ".json")).read_bytes() != (
                    stage / (f["hospital_id"] + ".json")
                ).read_bytes():
                    raise ValueError("Same-version training was not reproducible")
            shutil.rmtree(stage)
        else:
            stage.replace(destination)
        if persist:
            persist_predictions(reports, engine)
        pointer = output / "current.tmp"
        pointer.write_text(json.dumps({"version": version}) + "\n")
        pointer.replace(output / "current.json")
        return manifest, reports
    except BaseException:
        if stage.exists():
            shutil.rmtree(stage)
        raise


def persist_predictions(reports, engine=None):
    from sqlalchemy import select, delete

    if __package__.startswith("hospital_portal."):
        from ..api import schema as s
        from ..api.db import database, initialize
        from ..api.seed import uid
    else:
        from api import schema as s
        from api.db import database, initialize
        from api.seed import uid

    engine = engine or database()
    initialize(engine)
    with engine.begin() as c:
        for report in reports:
            fid = uid("facility", report["hospital_id"])
            if not c.scalar(select(s.facility.c.id).where(s.facility.c.id == fid)):
                raise ValueError("Seed the portal database before persisting forecasts")
            source_id = (
                "ops-ml:" + report["model_version"] + ":" + report["hospital_id"]
            )
            c.execute(
                delete(s.ml_model_registry).where(
                    s.ml_model_registry.c.source_id == source_id
                )
            )
            c.execute(
                s.ml_model_registry.insert().values(
                    source_id=source_id,
                    name="operational_forecast:" + report["hospital_id"],
                    version=report["model_version"],
                    metrics={
                        "evaluation": report["evaluation"],
                        "splits": report["splits"],
                    },
                    trained_on=report["history_start"] + ".." + report["history_end"],
                    data_label=LABEL,
                )
            )
            for target, rows in report["forecast"].items():
                for row in rows:
                    key = source_id + ":" + target + ":" + row["date"]
                    c.execute(
                        delete(s.ml_prediction).where(
                            s.ml_prediction.c.source_id == key
                        )
                    )
                    c.execute(
                        s.ml_prediction.insert().values(
                            source_id=key,
                            facility_id=fid,
                            model_name=target + ":" + row["selected_method"],
                            target_date=row["date"],
                            value=row["value"],
                            lower=row["lower"],
                            upper=row["upper"],
                            explanation_json={
                                "version": report["model_version"],
                                "data_label": LABEL,
                                "range_method": report["range_method"],
                                "accepted": False,
                            },
                        )
                    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--output")
    parser.add_argument("--config")
    parser.add_argument("--hospitals", type=int)
    parser.add_argument("--persist", action="store_true")
    args = parser.parse_args()
    manifest, _ = train(
        args.source,
        args.output,
        configuration(args.config),
        args.hospitals,
        args.persist,
    )
    print(
        json.dumps(
            {
                k: manifest[k]
                for k in ("version", "history_rows", "facility_count", "source_sha256")
            },
            indent=2,
        )
    )
