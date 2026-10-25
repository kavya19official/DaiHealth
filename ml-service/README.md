> Current runtime policy: reminders and support suggestions always use rules, including when ML is enabled. Only optional access rankers may load, and only with both `ML_ENABLED=true` and `PATIENT_ML_RANKING_ENABLED=true`. Historical reminder/barrier training and release-gate sections below describe offline experiments, not live serving. See [the model-selection policy](../docs/AI-MODEL-SELECTION.md).

# Patient access assistance

ML decides **how to help**, not a condition. The rules engine owns gap membership, due status, clinician priority and service eligibility. No diagnosis, medication advice, inferred high-risk flag or patient-facing probability is produced. All four models and all evaluation data are synthetic. Every learned patient output has a reason and the badge **Simulated on synthetic data**.

## Run from the repository root

Python 3.11+, using the existing local hospital virtual environment (created by `npm run setup`):

```sh
make ml-install
make ml-data
make ml-train
make ml-eval
make ml-test
make ml-serve
```

`ml-serve` binds only to `127.0.0.1:8200`; OpenAPI is at `http://127.0.0.1:8200/docs`. The service is internal, and must not be exposed directly as a public patient API. The Express gateway authenticates mothers, scopes all records to their identity and validates source facts. `PATIENT_ML_URL` overrides the internal origin. Model files are trusted, local joblib artifacts, verified against registry SHA-256 before loading; never load untrusted joblib files.

To start all three interfaces plus patient ML together:

```sh
ML_ENABLED=true npm start
```

Do not also run `make ml-serve` on the same port. With `ML_ENABLED` unset or false the launcher omits the service and the gateway uses rules only. Training is an explicit offline command, never repeated on startup. Models missing, corrupt artifacts, timeout, disabled flag and revoked consent all leave the rules usable. The deployment version is fixed to training seed 142; the other four runs estimate variation and are not candidates chosen by test performance.

For a standalone environment, create a Python 3.11 virtual environment, install `requirements.txt` and run `make ML_PYTHON=/absolute/path/to/venv/bin/python ml-train`. On macOS the wrapper reuses the existing scikit-learn bundled OpenMP runtime through the child-process library path; it does not modify system libraries. Alternatively install the official OpenMP dependency for LightGBM. Linux uses the normal loader.

## Reuse of the existing DAI dataset

`data/synthetic_generator.py` reads the existing `synthetic_data/output/dai.db` **read-only**. It does not create a substitute roster. Its manifest records source SHA-256, original mother IDs, linked original appointment IDs, linked original gap IDs, original hospital IDs and original table counts. The 5,000 source mothers, age, language, digital literacy, journey distance and caregiver contact anchor the scenario. Prior source attendance status is taken only from appointments strictly before the simulated interaction. No clinical measurements, diagnosis or disease labels are training features.

The source cohort is a care snapshot, not a randomized 24-month reminder/choice experiment. We therefore add a **separate operational interaction scenario**, with twelve bi-monthly contexts across a 24-month observation window. A context outside the recorded pregnancy is a care/child follow-up context, not a claim of a two-year pregnancy. Source rows and source clinical care remain unchanged. Gestational week is zero outside the recorded pregnancy episode, including after a recorded pregnancy loss; stage continues into general post-pregnancy care. Caregiver support and preferred channel are simulated interaction attributes. Fixture distances for facility-choice sessions are simulated access scenarios anchored to the source journey distance and source facility identities, not live route estimates.

The scenario includes source-conditioned stochastic access barriers, random latent variation, overlapping predictors and independent 18% label flips. Original appointment status is retained for provenance but is excluded from predictors; the training target is the **new simulated interaction outcome**, not the unchanged source appointment label. All seven-day labels have a seven-day observation window ending on/before the as-of date. No generating probability or counterfactual potential outcome is saved as a target or feature.

Appointments: missed attendance depends weakly on prior *simulated* misses available before the event, distance, literacy, caregiver availability and the past source attendance context. Future misses never enter the feature row. Opening-hours evidence in the app comes from reported service/facility hours; a 24×7 emergency flag is used only for an emergency search, never to claim that a lab is open. Gaps: source gap identities/types anchor candidate items; seven-day closure is a simulated access outcome, not a claim that the source gap was completed. Facilities: every choice is among candidates listed as offering the needed service; pick and completion are stochastic, and confirmation age/availability are explicit scenario assumptions. Reminder actions are uniformly randomized across four hours and four channels, with propensity 1/16. Only the chosen action's factual opened/completed outcomes are recorded; the other actions have no observed outcome.

CSV files are generated in `data/generated/`. These files are reproducible outputs and are ignored by Git; the source database remains authoritative. New opt-in operational events are persisted in PostgreSQL by `backend/db/patient_ml.sql`, with foreign keys to the authenticated patient identity. They are a future retraining source, not silently mixed into this synthetic evaluation.

## Training, leakage controls and evaluation

Revision 2 evaluation seeds: 142, 143, 144, 145, 146. These are fresh simulated interaction runs, not new real patients; the original source cohort is unchanged. Previously inspected seeds 42–46 are retained as development results, not treated as untouched tests. Each run regenerates the stochastic extension from the same original cohort and makes its own fixed-seed patient partition: 70% train, 15% validation, 15% test. Train uses the first 16 months, validation the next four, test the final four. Events in the wrong patient/time cell are discarded. Thus all test patients are unseen and no patient's earlier events enter training. This deliberately difficult cold-patient, future-time evaluation is not a random row split. Reports contain exact dates, row counts, patient counts and overlap checks.

Each model compares four LightGBM candidates (4/7/15 leaves, 65–180 trees, regularization 5–30) **using validation only**, on two CPU threads. Binary models also compare regularized logistic regression (C=0.01/0.1/1); the validation winner is served even when simpler. Features explicitly encode categorical channels, preferred-channel match, evening hours and digital/channel interaction using inputs already available at request time. No new private inputs or labels are introduced. Classifiers select validation log loss; rankers select validation NDCG after the exact serving priority/eligibility guards, excluding single eligible candidates. Classification threshold remains 0.5, fixed in advance. Reports include accuracy, precision, recall, F1, ROC-AUC, average precision (PR-AUC), Brier score and confusion matrix. Importance is normalized gain for trees or absolute standardized coefficient for logistic models; importance is association, not an individual causal explanation. Candidate validation scores and the selected family are saved for audit.

Ranking baselines are exactly descending overdue days and ascending distance. Reports additionally include a guarded rule comparator, to distinguish model behavior from hard constraints. The served policy keeps overdue buckets and clinician priority ahead of learned access ordering. Facility service eligibility is a hard gate. Facility metrics use only service-eligible candidates; a single eligible candidate is not treated as a ranking experiment. No public hospital-quality rating is produced: **Best match for this search** describes the current access request and is not a “best hospital” ranking. Unknown confirmation dates never count as verified services. Explanations state reported facts, not a clinical verdict or a causal SHAP claim. Rankers report NDCG@3 / NDCG@5, MRR to the first positive-relevance item, and top-one selection of maximum relevance (ties accepted). Queries with only one eligible candidate, and gap queries with no positive outcome, are excluded and counted explicitly; no relevant item exists for their NDCG/MRR.

Reminder lift is **self-normalized inverse propensity scoring** from held-out logged randomized actions. Only rows whose factual action matches a candidate policy contribute; match counts and effective sample sizes are reported. Comparators are fixed 9 AM app and seeded random action. Lift is a difference in estimated completion rate, not prediction accuracy, not a real-world A/B test and not evidence of clinical benefit. A small effective sample size can make it noisy, including negative lift. No test-set tuning or choosing the best seed is permitted.

The script audits every classifier ROC-AUC/accuracy and ranker top-one accuracy against 0.95 and refuses to publish a metrics report if the threshold is exceeded. Inspect the generator and allowlisted features if this happens; do not tune noise to a desirable score. Labels, IDs, raw timestamps, source status, event-opened state and future outcomes are excluded from model inputs.

`training/evaluate.py` recomputes `reports/metrics.json` and `reports/metrics.md` exclusively from saved test predictions. Mean and **sample** standard deviation (ddof=1) are computed over all five runs. Improvement uses paired run differences. Brier improvement is baseline minus model; all other metrics use model minus baseline. Raw confusion matrices and per-seed estimates remain in the JSON. Model registry metrics come from the same report.

## Patient integration and consent

Patient Settings → **Help that works around you** has separate, default-off permissions for personalization, location, app reminder scheduling and interaction logging. Revoking choices clears cached ranking and cancels pending reminder plans. Requests are same-origin cookie-authenticated. Client-supplied patient IDs never choose the identity; only the session does. Source condition/lab fields are never sent to the service. Location permission controls whether journey distance can be used. Only the app channel is currently allowed by the gateway, because SMS, WhatsApp and voice transports are not connected. Offline evaluation of all-channel policies is a simulated experiment, not a claim that those transports work.

Pending Care displays the learned reason, top “Start here” item and small synthetic badge; it never adds or closes gaps. Child/postpartum items without a supported canonical ranking contract keep their existing rule order. Nearby Care reranks only the already filtered candidate set, preserving required-service and other search eligibility decisions. Safety/SOS behavior is unchanged. Support cards link to nearer care, the patient's care-team sharing page and official scheme information; no unlinked ASHA number is invented.

The existing notification inbox calls `reminderScheduler.plan` to pick a send time. Each opted-in user's plan is persisted once per date, respects quiet hours and appears in the app inbox. Inbox refresh advances due plans to ready exactly once and logs the app reminder if event consent is present. This is an **in-app, on-refresh scheduler**, not a background SMS daemon. Danger notices are never delayed by it. No external reminder is sent. Client interaction events cover facility views/choices, starting care actions and opening reminders. Successful canonical timeline and appointment completion mutations are logged server-side (including doctor queue completion); a click alone never proves attendance. Event bodies exclude report text, diagnosis, free text and exact location.

## API

- `POST /rank-gaps`: `{patient_id, consent, features?, gaps:[{id, days_overdue, bucket, clinician_priority, gap_type, stage}]}`
- `POST /best-send-time`: `{patient_id, consent, features?}`
- `POST /rank-facilities`: `{patient_id, consent, location?, needed_service, candidates:[{id, distance_km, offers_service, open_now, days_since_confirmed, appointment_availability}]}`
- `POST /support-suggestions`: `{patient_id, consent, features?}` → help actions, never a probability.
- `GET /health`, `GET /model-info`

Python Pydantic schemas reject unknown fields, invalid bounds and duplicate IDs. Missing/failed models return schema-valid rule results with reasons and `source:"rules"`. The gateway lives at `/api/patient/ml/*`, uses canonical owned open milestones, derives facility service/freshness evidence on the server and rejects malformed model membership. `ML_ENABLED=false` works without Python or any model files. Service outage leaves the original UI rule order visible.

## Revision 2 measurement discipline
Original generating probabilities and 18% outcome noise are unchanged. Data are not made easier to increase metrics. New experiment seeds are fixed before evaluating; they reuse the existing synthetic cohort, not independent real-world patients. Five-seed results do not establish clinical usefulness. The selected binary family can be logistic regression instead of LightGBM. Model selection never reads test outcomes. Low support-model recall remains a limitation even if accuracy improves.

## Predictability diagnostic
Run `make ml-diagnose` to write `reports/predictability.json` over five fixed diagnostic seeds (242–246). This measures expected optimal classification accuracy if the hidden generating probability and latent random effects were known. It is an optimistic diagnostic expectation, not a hard finite-sample bound, a model, or a real-world metric. Deployable models have less information. Diagnostic probabilities are optional, explicitly excluded from all predictor allowlists and never supplied to the API. Tests verify that turning diagnostics on leaves all original rows and outcome labels identical. This is used to identify whether more tuning is plausible or richer observed event data are needed; generating noise is not reduced to inflate results.

## Original appointment outcome experiment
`make ml-source-experiment` runs an additional five-seed study (242–246) using only original source `attended`/`missed` maternal appointment labels. It excludes booked/cancelled/rescheduled records and future appointments, instead of simulating replacement attendance labels. Features include source literacy/income, scheduled weekday/hour and LMP-derived appointment week; latent `dropout_probability`, clinical outcome fields, current stage and IDs are excluded. This is a separate data/feature contract and its numbers must not be presented as a direct accuracy increase over the interaction simulator.

Model family is selected by validation average precision; the support threshold uses validation balanced accuracy. Metrics also include fixed-0.5 performance and a majority baseline. No test threshold tuning occurs. Rare positives and only one observed appointment per mother make this an exploratory study; high majority accuracy is investigated as class imbalance, not advertised as success. Per-run counts, normalized feature importance, confusion matrices and validation candidates are in `reports/source-outcomes.json` and `.md`. The fixed seed-242 artifact is saved under `models/experiments/`, with `deployment_status=experimental-not-served`; this command does not alter the four live models or registry. Income/literacy and appointment context are not silently added to the patient serving/consent contract.

## Dependable support behaviour and prediction release gate
The current missed-visit predictor **does not pass** the prototype release policy and cannot drive support suggestions. This improves the application's handling of weak predictions; it does not improve the model's accuracy or establish real-world reliability. Pending Care, Nearby Care and reminder models retain their existing simulation labels and limitations.

`make ml-release-check` writes `reports/reliability.json`. The API also evaluates the gate at request time; a missing report, mismatched model checksum/metrics, failed overlap/leakage audit, mismatched inference threshold or insufficient evaluation evidence defaults to rules. Training and evaluation regenerate the release report. `support_release_policy.json` contains explicit prototype engineering requirements: five distinct runs, at least 100 positive test examples per run, precision ≥0.60, recall ≥0.50 and ROC-AUC ≥0.70 in every run, lower Brier score than the majority baseline in every run, and a positive approximate paired 95% lower confidence bound for accuracy improvement (Student-t multiplier 2.776 with five runs). These are conservative operational screening choices, not clinically validated cutoffs, and repeated synthetic seeds do not constitute independent clinical trials. Do not loosen them merely to enable a model. An independent prospective evaluation is needed for real-world claims.

Personal support uses explicitly known, permitted facts: recorded journey distance of at least 5 km offers a nearer-centre search; a recorded missed visit offers optional care-team help; explicitly reported lack of caregiver support can offer the same help. The 5 km threshold is an assistance heuristic, not a clinical threshold. Unknown values are never treated as reported barriers. A caregiver contact alone does not establish available caregiver support. The Express gateway sends `known_features`; inference also requires the complete expected profile and values inside the supported training range. No patient probabilities or risk labels are exposed.

The rule helper remains available with `ML_ENABLED=false` or the Python service offline, after the patient opts into assistance. Old services returning a learned support response without the new policy marker are rejected by the gateway. The UI labels rule-based support accurately and discards stale responses after consent changes. The original-outcome candidate stays experimental and is not registered for serving.
