"""Forecasts must be trained, reproducible, time-safe and honest about their source."""

import copy
import json
import os
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func

os.environ["DAI_APP_FACTORY_ONLY"] = "true"
os.environ["DAI_DEMO"] = "true"
from hospital_portal.ml_service.history import (
    configuration,
    source_facilities,
    simulate,
    features,
    targets,
)
from hospital_portal.ml_service.train import train, persist_predictions
from hospital_portal.ml_service.store import forecast, ForecastUnavailable
from hospital_portal.api.db import database
from hospital_portal.api.seed import seed
from hospital_portal.api.main import create_app
from hospital_portal.api import schema as s


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("trained")
    cfg = configuration()
    cfg.update(history_days=365, validation_days=21, calibration_days=21, test_days=21)
    cfg["forest"] = {"n_estimators": 8, "max_depth": 5, "min_samples_leaf": 12}
    manifest, reports = train(output=root, cfg=cfg, limit=1)
    return root, cfg, manifest, reports[0]


def test_history_and_features_do_not_read_future_outcomes():
    cfg = configuration()
    facility = source_facilities()[0][0]
    history = simulate(facility, cfg, True)
    assert history == simulate(facility, cfg, True)
    assert len(history) == 730 + 14
    assert all(r["nicu_admissions"] <= r["deliveries"] for r in history[:730])
    before = features(history, 100, 14)
    changed = copy.deepcopy(history)
    for row in changed[101:]:
        for key in targets(cfg):
            row[key] = 999999
    assert np.array_equal(before, features(changed, 100, 14))
    changed[114]["booking_known_on"] = changed[114]["date"]
    with pytest.raises(ValueError, match="not yet available"):
        features(changed, 100, 14)
    phc = {**facility, "tier": "PHC", "has_nicu_level": "none"}
    assert all(
        r["surfactant"] == 0 and r["nicu_admissions"] == 0
        for r in simulate(phc, cfg)[:730]
    )


def test_time_splits_baseline_selection_and_ranges(trained):
    root, cfg, manifest, report = trained
    assert manifest["history_rows"] == 365
    split = report["splits"]
    assert (
        split["train_target_end"]
        < split["validation_start"]
        <= split["validation_end"]
        < split["calibration_start"]
        <= split["calibration_end"]
        < split["test_start"]
        <= split["test_end"]
    )
    assert split["earliest_validation_issue_date"] >= split["train_target_end"]
    assert (
        split["earliest_calibration_issue_date"]
        >= split["evaluation_model_fit_through"]
    )
    for target, rows in report["forecast"].items():
        assert len(rows) == 14 and rows[0]["date"] > report["as_of_date"]
        assert all(0 <= r["lower"] <= r["value"] <= r["upper"] for r in rows)
        evaluation = report["evaluation"][target]
        expected = (
            "random_forest"
            if evaluation["validation_model_mae"]
            < evaluation["validation_baseline_mae"]
            else "seasonal_baseline"
        )
        assert evaluation["selected_method"] == expected
        assert len(report["backtest_horizon_1"][target]) == cfg["test_days"]
        actual = np.array([r["actual"] for r in report["backtest_horizon_1"][target]])
        predicted = np.array(
            [r["predicted"] for r in report["backtest_horizon_1"][target]]
        )
        measured = float(np.abs(actual - predicted).mean())
        assert abs(measured - evaluation["horizon_metrics"][0]["mae"]) < 0.02
    assert len(report["stock_projection"]) == 8
    for item in report["stock_projection"]:
        assert item["current_stock"] >= 0
        assert item["reorder_attention"] == (
            item["stockout_day"] is not None
            and item["stockout_day"] <= item["reorder_days"]
        )


def test_same_seed_retraining_and_checksum_integrity(trained):
    root, cfg, manifest, report = trained
    again, reports = train(output=root, cfg=cfg, limit=1)
    assert again["version"] == manifest["version"]
    assert reports[0] == report
    assert forecast("HOSP-SYN-0001", root)["model_version"] == manifest["version"]
    filename = root / manifest["version"] / "HOSP-SYN-0001.json"
    original = filename.read_bytes()
    try:
        filename.write_text("{}")
        with pytest.raises(ForecastUnavailable, match="integrity"):
            forecast("HOSP-SYN-0001", root)
    finally:
        filename.write_bytes(original)
    with pytest.raises(ForecastUnavailable):
        forecast("../../secrets", root)


def test_api_scope_registry_and_internal_service(trained, tmp_path, monkeypatch):
    root, cfg, manifest, report = trained
    monkeypatch.setenv("DAI_ML_ARTIFACT_DIR", str(root))
    monkeypatch.delenv("DAI_ML_SERVICE_URL", raising=False)
    engine = database("sqlite:///" + str(tmp_path / "portal.db"))
    seed(engine)
    persist_predictions([report], engine)
    persist_predictions([report], engine)  # Idempotent for the same model version.
    with engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(s.ml_model_registry)) == 1
        assert c.scalar(select(func.count()).select_from(s.ml_prediction)) == 140

    def login(client, role):
        challenge = client.post(
            "/api/auth/login",
            json={
                "email": role + "@dai-synthetic.invalid",
                "password": "Dai-Synthetic-2026!",
            },
        ).json()
        response = client.post(
            "/api/auth/otp",
            json={
                "challenge_id": challenge["challenge_id"],
                "code": challenge["demo_otp"],
            },
        )
        assert response.status_code == 200, response.text
        return {"Authorization": "Bearer " + response.json()["access_token"]}

    with TestClient(create_app(engine)) as client:
        assert client.get("/api/ml/forecast").status_code == 401
        nurse = login(client, "nurse")
        assert client.get("/api/ml/forecast", headers=nurse).status_code == 403
        admin = login(client, "hospital_admin")
        result = client.get(
            "/api/ml/forecast?facility_id=another-hospital", headers=admin
        )
        assert result.status_code == 200, result.text
        assert result.json()["hospital_id"] == "HOSP-SYN-0001"
        assert result.json()["data_label"] == "Simulated on synthetic data"
        assert "mother_name" not in json.dumps(result.json())
        with engine.connect() as c:
            assert (
                c.scalar(
                    select(func.count())
                    .select_from(s.audit_log)
                    .where(s.audit_log.c.action == "read_forecast")
                )
                == 1
            )
    from hospital_portal.ml_service.main import app as ml_app

    with TestClient(ml_app) as ml:
        assert ml.get("/health").json()["models_trained"]
        monkeypatch.delenv("DAI_ML_SERVICE_TOKEN", raising=False)
        assert ml.get("/v1/forecasts/HOSP-SYN-0001").status_code == 503
        monkeypatch.setenv("DAI_ML_SERVICE_TOKEN", "test-internal-service-token")
        assert ml.get("/v1/forecasts/HOSP-SYN-0001").status_code == 401
        assert (
            ml.get(
                "/v1/forecasts/HOSP-SYN-0001",
                headers={"x-dai-ml-token": "test-internal-service-token"},
            ).status_code
            == 200
        )
    engine.dispose()
