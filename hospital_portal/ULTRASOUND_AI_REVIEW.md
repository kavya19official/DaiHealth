# Ultrasound scans and clinician review

The patient workspace can share a single ultrasound frame with a verified clinician from the patient's care team. The clinician opens the patient's scan history, views the image and its available assessment, records a clinical decision, then explicitly releases a patient-facing report. The patient has access to their own images and released findings and next steps. The patient response includes the technical image assessment, review flag, processing milestones and released clinical report. Experimental archive scores, draft content and private notes are clinician-only.

## Open the workspaces

- **Patient dashboard → Ultrasound scans.** Choose an eligible doctor, confirm sharing, and upload a PNG, JPEG or WebP up to 12 MiB. History shows **Pending review**, **Under review**, or **Reviewed**. Open scan history for the encrypted image preview. Pending scans refresh automatically while the workspace is visible.
- **Doctor dashboard → Ultrasound Review.** Select an authorized patient. Review their scan and pregnancy context, save clinical findings and next steps as a draft, then use **Release report to patient**. The clinician can confirm, correct or reject available AI output or record an independent review. Private notes stay in the clinician workspace. The doctor can also upload with recorded confirmation that the patient agreed to share the frame.
- The deployed hospital administration dashboard has no scan workflow. Existing hospital records are retained. In the linked synthetic cohort, the verified assigned clinician can view their prior portal records as archived history. Old notes and decisions stay in their original records and are never auto-released.

When the live private ML service is available, the workflow assesses image quality. The supplied Kaggle archive failed the training audit. With no approved model directory, scans remain available for clinician review and the UI shows **Model unavailable**. An approved research checkpoint can produce experimental archive-label outputs for the clinician. Those outputs do not set the review decision or release a report. [Research audit and model release](../ml-service/ultrasound/README.md)

## Analysis and review states

The upload endpoint authenticates, validates, re-encodes and encrypts the image before returning the scan ID. The existing scan row stores the pending job, processing stages and assessment. A background worker uses a database lease so duplicate uploads share the same result and interrupted jobs can resume. The browser polls the existing patient's or doctor's scoped scan detail. The private ML service emits quality checks, model loading on cold start, preprocessing and inference when they begin. The portal records report persistence and the completion time in the scan record. The browser displays the actual elapsed time and lets fast jobs finish immediately. The portal waits up to 85 seconds for its private analysis request. An older private service returning plain JSON still works and does not report intermediate stages.

| Stage or state | Meaning |
| --- | --- |
| Uploaded / Processing | The frame is stored. The worker may be waiting for the ML service, checking the image, running inference or saving the assessment. |
| Awaiting doctor review | The assessment is ready. The doctor can see the stored image, pregnancy context and any experimental results. |
| Under review | The doctor has started work. A saved draft remains in the clinician workspace until release. |
| Reviewed by doctor / Additional scan required | The patient can see the released findings and follow-up instructions. |

The public assessment includes image-check grade, technical limitations, recorded milestones, model availability and the review flag with its rationale. Good and Acceptable mean the raster passed the resolution, contrast and detail checks. Poor means at least one check failed and classification was skipped. An unavailable service or unaudited model can leave confidence and findings unavailable. The existing EfficientNet-B0 model's archive categories and scores are experimental and available to clinicians if an approved checkpoint is installed. They do not set the clinical decision. The supplied ZIP has no approved checkpoint, and the bundled data audit is blocked by conflict, leakage and missing group provenance. Without a checkpoint, the demo runs the real resolution, contrast and detail checks against the uploaded pixels and shows **AI analysis unavailable**. Patients and doctors can retry the same retained frame before any clinical draft has been saved. The scan is available in the doctor's existing queue for manual review.

The workspace records **Review recommended** for failed technical checks, unavailable inference and experimental classifications. It records the specific reason from the technical check or model outcome. The three experimental archive classes describe the model's training target. They provide no validated rule for Routine or Priority Clinical Review, no ultrasound modality verification and no fetal anatomy interpretation. These categories need a clinically validated source before they can be assigned automatically.

Use the real fetal ultrasound frames under `frontend/assets/ultrasound-demo/` with the existing linked synthetic demo accounts. The image credits are in that directory. The browser acceptance test uploads `brain_1013.png` through the live backend, checks the quality and no-model branch, and verifies release to the same patient. Scripted measurements from the separate seed are identified as demo values and are never presented as inference output.

## Start locally

Use the full application launcher from the repository root with Node.js 22.13+ and Python 3.12. Create the environment file once. Keep the same image key to reopen frames encrypted during previous runs.

```sh
mkdir -p .local
umask 077
python3 - <<'PY' > .local/ultrasound.env
import secrets
print("export DAI_ULTRASOUND_ENABLED=true")
print("export DAI_ULTRASOUND_IMAGE_KEY=" + secrets.token_hex(32))
print("export DAI_ULTRASOUND_GATEWAY_TOKEN=" + secrets.token_urlsafe(48))
print("export DAI_ULTRASOUND_SERVICE_TOKEN=" + secrets.token_urlsafe(48))
PY
. ./.local/ultrasound.env
npm start
```

Open `http://localhost:3001` and use linked synthetic mother and doctor accounts with a confirmed or completed appointment and an active pregnancy with recorded dates. The local seed reuses the synthetic hospital cohort. Keep any live identifying or clinical data out of the synthetic demo.

## Troubleshoot a missing workspace

Apply the ultrasound workflow update to the same checkout you launch. Stop the running app with `npm run stop`, source the existing `.local/ultrasound.env` in that checkout, then run `npm start`. Open the address printed by the launcher, normally `http://localhost:3001`. Restarting Safari alone does not reload the backend routes.

An unauthenticated `curl -i http://localhost:3001/api/patient/ultrasound/options` should return **401 JSON**. An HTML **404** means that process lacks the ultrasound route. A signed-in **503** with the disabled message means ultrasound is not enabled in the running process. Postpartum accounts can view scan history and released reports. The upload form requires an active pregnancy.

## Access, storage and lifecycle

The Node gateway resolves identity from the existing signed session and checks live appointment, clinician credential, doctor-revocation, and facility-revocation records. A submission is scoped to the confirmed doctor and the most recent qualifying facility relationship. Patient ownership is resolved server-side. Gateway requests to the private hospital service carry a separate, short-lived signed grant bound to the requested method, path, body digest, identity and scope.

The intake service verifies the raster, strips metadata via PNG re-encoding, and saves AES-256-GCM ciphertext and the image digest. Burned-in identifiers are part of the raster and require removal before sharing. Image access is authorized for each request and served with caching disabled. Duplicate frames for the same episode, doctor and facility return the existing scan. An identical expired frame yields a request for a new capture. Retention defaults to 30 days. The report remains available after image expiry. Audit events track submission with sharing confirmation, reads, draft review and release. Review revisions prevent stale writes and release is a separate action.

The original `ultrasound_analysis` table used hospital-portal UUID ownership. The separate `ultrasound_workspace_scan` table uses the app's native patient/doctor account IDs, including accounts outside the synthetic portal mapping. Both use the same private raster analysis, encryption and retention implementation. The portal creates the table and indexes at startup through its existing schema initializer. PostgreSQL operators can apply [the workspace migration](migrations/20261123_ultrasound_workspace.sql) to the portal database. No migration is needed in the Node account database.

## Deployment

- **Docker Compose.** The full-app Compose file runs the gateway, clinical portal and private ML service together with persistent local state. Source the three persistent secrets as above and run `docker compose -f compose.ultrasound.yaml up --build`. The app port is published to loopback; the private API and ML ports stay inside the container. The separate hospital-only Compose stack is for the hospital preview and its forecasting service.
- **Render.** Use the root Dockerfile with the repository's `render.yaml`. Set `DAI_ULTRASOUND_IMAGE_KEY` to a stable 64-digit hex key. The blueprint generates separate gateway and ML tokens and uses the existing persistent disk. Use the Docker launcher so the same service hosts the patient/doctor pages and starts the private applications. If the service exists with different settings, check its dashboard configuration and current commit before deploying. Auto-deploy is disabled in the blueprint. Keep the deployment in synthetic demo mode until your site's clinical, consent, and production controls are configured.
- **Private model.** The launcher starts the default loopback ML listener when ultrasound is enabled, independently of patient ranking. A separate private HTTPS ML origin can be configured by setting `DAI_ULTRASOUND_ML_ORIGIN` and the same private service credential on both ends. Install the evaluated model's Torch runtime in the private service and set `DAI_ULTRASOUND_MODEL_DIR` there. The default Docker image supports quality checks and manual review.

See [the environment template](.env.example) for exact variable names.

## Tests

```sh
node --test backend/ultrasoundWorkspace.test.js
hospital_portal/.venv/bin/python -m pytest -q hospital_portal/tests/test_ultrasound_flow.py ml-service/tests/test_ultrasound_research.py
```

The browser test exercises a live synthetic deployment through the regular patient/doctor login. Install Playwright with Chromium. Select linked synthetic accounts with a confirmed appointment and an active pregnancy. Set `DAI_TEST_PATIENT`, `DAI_TEST_DOCTOR`, and optional `DAI_TEST_PASSWORD` and `DAI_TEST_URL`, then run `python hospital_portal/tests/ultrasound_browser.py`. Run against fresh synthetic state for a unique upload. The test uploads a public research frame, checks exact pixel equality through the protected image route, exercises invalid and repeated uploads, retries unavailable inference, checks a poor-quality frame, and verifies the patient sees the released clinical report. The ML tests separately exercise image-dependent input wiring and a test-only Torch checkpoint through the private HTTP endpoint.

## Refinement files

| Area | Files |
| --- | --- |
| Patient and doctor views | `frontend/dashboard.html`, `frontend/doctor.html`, `frontend/js/ultrasound-workspace.js`, `frontend/ultrasound-workspace.css` |
| Scoped API and persisted processing | `backend/ultrasoundWorkspace.js`, `hospital_portal/api/main.py`, `hospital_portal/api/ultrasound_workspace.py`, `hospital_portal/api/ultrasound_processing.py`, `hospital_portal/api/ultrasound.py` |
| Inference events | `ml-service/ultrasound/inference.py` |
| Verification | `hospital_portal/tests/test_ultrasound_flow.py`, `hospital_portal/tests/ultrasound_browser.py`, `ml-service/tests/test_ultrasound_research.py` |
