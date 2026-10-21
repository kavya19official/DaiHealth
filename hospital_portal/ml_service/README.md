# DAI operational ML forecasts

**Trained on synthetic data. Not validated on real hospital activity.** These forecasts predict aggregate demand, not disease. They never change a clinician's high-risk flag, reserve resources, dispatch transport, prescribe, or place a purchase order.

## Run locally

From the repository root, after creating the portal dataset:

```sh
source hospital_portal/.venv/bin/activate
pip install -r hospital_portal/requirements.txt
python -m hospital_portal.ml_service.train --persist
```

Then use the existing backend/frontend commands and open **Administration → ML forecasts & stock planning**. With FastAPI reload enabled, refresh the browser to load the new role permission. Local serving reads trained JSON artifacts directly; a third service is optional.

Training all 12 facilities takes a few minutes on a laptop. It creates `artifacts/<version>/` containing trusted local sklearn model files, daily history CSV, advance-booking calendar CSV, per-hospital forecast/evaluation JSON and a SHA-256 manifest. `current.json` is atomically switched only after all hospitals and optional database persistence succeed. Generated artifacts are ignored by Git; no trained model is downloaded or uploaded.

`--persist` writes versions and predictions to the existing `ml_model_registry` and `ml_prediction` tables. It preserves original patient/source files and does not accept a forecast on a human's behalf. Repeat persistence of the same version does not duplicate predictions. Use a dedicated `DATABASE_URL` when training for another deployment.

```sh
# Configurable output location and a quick one-hospital training run:
python -m hospital_portal.ml_service.train --hospitals 1 --output /tmp/dai-model-test
# Full regeneration using a chosen source/config:
python -m hospital_portal.ml_service.train --source backend/data/dai-hospital.db --config hospital_portal/ml_service/config.json --persist
```

Use the full default run for the live portal; a one-hospital run cannot serve facilities it did not train. `DAI_ML_ARTIFACT_DIR` overrides the artifact directory consistently for training and serving. Retrain manually after changing the scenario or source. No background retraining is claimed.

## What is actually trained

- One multi-output **RandomForestRegressor** per hospital, jointly predicting deliveries, aggregate NICU admissions and daily consumption for eight inventory items.
- A four-matching-weekday mean is the **seasonal baseline**. Each target uses the candidate only if its validation MAE is lower; otherwise the baseline is selected. Negative/zero test improvements are shown honestly.
- A 14-day direct forecast uses horizon, target calendar, lagged/rolling delivery history, NICU history and an explicitly synthetic advance-booking signal. Both 7- and 14-day planning views are available.
- Targets are normalized by training means so high-volume glove consumption does not dominate the shared model objective. Each fit uses its own training data for scaling.
- No-show classification, patient-level NICU risk, length-of-stay and equipment-failure models are not included in this increment.

## Data provenance

The existing 5,000-mother source cohort is too sparse to represent the hospital's whole daily workload. Therefore `history.py` generates a **separate aggregate operating scenario** with 730 completed daily rows for each existing facility ID (8,760 rows total), without inventing patient identities or changing any clinical record. It also generates 14 future calendar/booking rows with no future actual outcomes.

Every volume, weekday factor, seasonality parameter, inventory coefficient and opening-stock scenario is stored in `config.json`. The 25,000-delivery annual anchor is the user's scenario assumption; it is not substituted into the recorded clinical census. Other tier volumes and inventory assumptions require partner validation. NICU demand and surfactant consumption are zero for facilities without NICU capability. Inventory units are planning units, **not medication doses**.

Synthetic booked-arrival signals are available 28 days before the target day. They depend on calendar/earlier latent load and separate random noise, not on future realised deliveries. Current imported-cohort EDD counts appear only as separate aggregate context, not as retrospectively invented training features.

The version hashes source data, scenario config, history/training code and sklearn version. The JSON report's checksum and hospital identity are verified before serving. HTTP handlers never unpickle a model; joblib files are locally generated trusted artifacts only.

## Evaluation without future leakage

The last 180 days are split into **60 validation, 60 calibration and 60 test days**, in that order. Earlier targets form training data. There is no shuffled split.

Validation and calibration origins before a model's fit cutoff are excluded even if the target date falls into the next period. This matters for multi-day horizons. All features use observations available on the issue date; future calendar/booking values are permitted only when their recorded availability date is no later than that origin.

The selected evaluation model is fitted through the validation cutoff. The calibration period supplies horizon/target-specific absolute-error quantiles for nominal 80% daily empirical ranges. The later test period measures MAE, WAPE and actual range coverage. The evaluated model does not fit on calibration or test labels. Serving models are subsequently refitted through the configured as-of date; the dashboard states these distinct fit cutoffs.

Metrics cover 60 unique test dates and 14 forecast horizons (840 predictions per target); the horizon-one backtest contains one prediction per date. Overlapping forecasts and time dependence mean nominal daily coverage is not a guarantee or a joint 14-day probability. WAPE is undefined when all actual demand is zero. Never present these synthetic metrics as real-world accuracy.

The UI reports input values and **global forest feature importance**, not SHAP or causal explanations. Baseline-selected targets instead depend on prior matching weekdays. A stock slider performs inventory arithmetic against stored forecasts; it does not invoke a new model or alter pharmacy balances.

## Optional separate FastAPI ML service

```sh
# Set the same locally generated service token in both terminals; do not commit it.
DAI_ML_SERVICE_TOKEN='your-generated-private-token' uvicorn hospital_portal.ml_service.main:app --host 127.0.0.1 --port 8001
```

Set `DAI_ML_SERVICE_URL=http://127.0.0.1:8001` and the same `DAI_ML_SERVICE_TOKEN` on the main API. This makes it proxy only its authenticated user's facility. The internal `/v1/forecasts/{hospital_id}` endpoint fails closed without a configured matching token. There is no public unauthenticated prediction endpoint and no training/upload endpoint.

Compose mounts the generated models read-only into API and ML containers. Its default API mode is local artifact serving; opt into the separate service with `DAI_ML_SERVICE_URL=http://ml-service:8001` and a shared service token in `.env`. Docker/PostgreSQL deployment remains independently unverified.

## Tests and references

```sh
python -m pytest hospital_portal/tests/test_forecasts.py -q
```

Checks cover deterministic generation/retraining, absence of future observed outcomes in features, issue-date and target-date boundaries, measured metrics, baseline selection, ranges, source integrity, registry idempotency, denied role access and internal-service authentication.

Methods follow the primary scikit-learn documentation for [time-ordered evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split), [Random Forest regression](https://scikit-learn.org/stable/modules/ensemble.html#forest) and [regression metrics](https://scikit-learn.org/stable/modules/model_evaluation.html#regression-metrics).
