# Ultrasound scans and clinician review

The patient workspace can share a single ultrasound frame with a verified clinician from the patient's care team. The clinician opens the patient's scan history, views the image and its available assessment, records a clinical decision, then explicitly releases a patient-facing report. The patient has access to their own images and released findings and next steps. The patient response includes the technical image assessment, research scan-view predictions, review flag, processing milestones and released clinical report. Experimental archive scores, draft content and private notes are clinician-only.

## Open the workspaces

- **Patient dashboard → Ultrasound scans.** Choose an eligible doctor, confirm sharing, and upload a PNG, JPEG or WebP up to 12 MiB. History shows **Pending review**, **Under review**, or **Reviewed**. Open scan history for the encrypted image preview. Pending scans refresh automatically while the workspace is visible.
- **Doctor dashboard → Ultrasound Review.** Select an authorized patient. Review their scan and pregnancy context, save clinical findings and next steps as a draft, then use **Release report to patient**. The clinician can confirm, correct or reject available AI output or record an independent review. Private notes stay in the clinician workspace. The doctor can also upload with recorded confirmation that the patient agreed to share the frame.
- The deployed hospital administration dashboard has no scan workflow. Existing hospital records are retained. In the linked synthetic cohort, the verified assigned clinician can view their prior portal records as archived history. Old notes and decisions stay in their original records and are never auto-released.

The private ML service verifies and loads the bundled **SonoNet16** checkpoint and runs the published model locally using the existing SciPy and NumPy environment. The checkpoint ships with the checkout, so the running app does not download model weights. It classifies fetal ultrasound views using the uploaded pixels. A clearly separated two-view vertical image can return one estimate per panel. Otherwise the classifier evaluates one image. Weak scores and unsupported views are labeled explicitly. Use a single original scan view for ambiguous layouts, side-by-side views or collages.

SonoNet16 is from [Baumgartner et al., 2017](https://doi.org/10.1109/TMI.2017.2712367). See the [authors’ weights and Apache 2.0 license](https://github.com/baumgach/SonoNet-weights/tree/6c4df39927e42f5b873c09a733bc658ff1ff419c). The scores rank scan views and are uncalibrated for DaiHealth uploads. This research classifier does not assess fetal health, make measurements, detect abnormalities, or set clinical urgency. The doctor still reviews and releases the clinical report. The previous EfficientNet-B0 research pathway and its separate release requirements remain available with an explicit local model directory. [Research audit and release](../ml-service/ultrasound/README.md)

## Analysis and review states

The upload endpoint authenticates, validates, re-encodes and encrypts the image before returning the scan ID. The existing scan row stores the pending job, processing stages and assessment. A background worker uses a database lease so duplicate uploads share the same result and interrupted jobs can resume. The browser polls the existing patient's or doctor's scoped scan detail. The private ML service emits quality checks, model loading on cold start, preprocessing and inference when they begin. The portal records report persistence and the completion time in the scan record. The browser displays the actual elapsed time and lets fast jobs finish immediately. The portal waits up to 85 seconds for its private analysis request. An older private service returning plain JSON still works and does not report intermediate stages.

| Stage or state | Meaning |
| --- | --- |
| Uploaded / Processing | The frame is stored. The worker may be waiting for the ML service, checking the image, running inference or saving the assessment. |
| Awaiting doctor review | The assessment is ready. The doctor can see the stored image, pregnancy context and any experimental results. |
| Under review | The doctor has started work. A saved draft remains in the clinician workspace until release. |
| Reviewed by doctor / Additional scan required | The patient can see the released findings and follow-up instructions. |

Good and Acceptable reflect technical checks for resolution, contrast and detail. Poor means at least one necessary check failed. The UI displays the model result and its actual elapsed time after inference. It keeps scans with no result available in the doctor queue. Patients and doctors can retry the existing encrypted image, subject to its retention limit, before a clinician saves a draft.

A research scan-view result leaves the existing **Review recommended** handoff in place. Use the public example images under `frontend/assets/ultrasound-demo/` to test the workflow with the synthetic accounts. Scripted sample history stays labeled as demo content.

## Start locally

Use the full application launcher from the repository root with Node.js 22.13+ and Python 3.12:

```sh
npm run stop
npm start
```

The local launcher enables the ultrasound workspace, starts its private services and creates persistent encryption and service keys in `.local/config.json` (owner-only permissions). It reuses existing keys, including keys from a previous `.local/ultrasound.env`, so saved frames remain readable. Keep this local configuration with the encrypted image store; never commit it. Explicit `DAI_ULTRASOUND_ENABLED=false` still disables the workspace. Open **Ultrasound scans** and look for **Live AI ready · SonoNet16**. The badge checks that the authenticated private service has actually loaded the model. New uploads run automatically. Hosted deployments require their own explicit service and secret configuration.

After updating and restarting with the same encryption key, pending saved scans without a model result automatically get one retry per model runtime version when SonoNet16 is ready. This applies only while the original image is retained and clinician review has yet to start. **Retry AI analysis** is still available for eligible scans if the automatic attempt fails. Open `http://localhost:3001` and use linked synthetic mother and doctor accounts with a confirmed or completed appointment and an active pregnancy with recorded dates. The local seed reuses the synthetic hospital cohort. Keep any live identifying or clinical data out of the synthetic demo.

## Troubleshoot a missing workspace

Apply the ultrasound workflow update to the same checkout you launch. Stop the running app with `npm run stop`, then run `npm start`. Open the address printed by the launcher, normally `http://localhost:3001`. Restarting Safari alone does not reload the backend routes.

An unauthenticated `curl -i http://localhost:3001/api/patient/ultrasound/options` should return **401 JSON**. An HTML **404** means that process lacks the ultrasound route. A signed-in **503** with the disabled message means ultrasound is not enabled in the running process. Postpartum accounts can view scan history and released reports. The upload form requires an active pregnancy.

## Access, storage and lifecycle

The Node gateway resolves identity from the existing signed session and checks live appointment, clinician credential, doctor-revocation, and facility-revocation records. A submission is scoped to the confirmed doctor and the most recent qualifying facility relationship. Patient ownership is resolved server-side. Gateway requests to the private hospital service carry a separate, short-lived signed grant bound to the requested method, path, body digest, identity and scope.

The intake service verifies the raster, strips metadata via PNG re-encoding, and saves AES-256-GCM ciphertext and the image digest. Burned-in identifiers are part of the raster and require removal before sharing. Image access is authorized for each request and served with caching disabled. Duplicate frames for the same episode, doctor and facility return the existing scan. An identical expired frame yields a request for a new capture. Retention defaults to 30 days. The report remains available after image expiry. Audit events track submission with sharing confirmation, reads, draft review and release. Review revisions prevent stale writes and release is a separate action.

The original `ultrasound_analysis` table used hospital-portal UUID ownership. The separate `ultrasound_workspace_scan` table uses the app's native patient/doctor account IDs, including accounts outside the synthetic portal mapping. Both use the same private raster analysis, encryption and retention implementation. The portal creates the table and indexes at startup through its existing schema initializer. PostgreSQL operators can apply [the workspace migration](migrations/20261123_ultrasound_workspace.sql) to the portal database. No migration is needed in the Node account database.

## Deployment

- **Docker Compose.** The full-app Compose file runs the gateway, clinical portal and private ML service together with persistent local state. Configure the three persistent secrets described in the deployment section and run `docker compose -f compose.ultrasound.yaml up --build`. The app port is published to loopback; the private API and ML ports stay inside the container. The separate hospital-only Compose stack is for the hospital preview and its forecasting service.
- **Render.** Use the root Dockerfile with the repository's `render.yaml`. Set `DAI_ULTRASOUND_IMAGE_KEY` to a stable 64-digit hex key. The blueprint generates separate gateway and ML tokens and uses the existing persistent disk. Use the Docker launcher so the same service hosts the patient/doctor pages and starts the private applications. If the service exists with different settings, check its dashboard configuration and current commit before deploying. Auto-deploy is disabled in the blueprint. Keep the deployment in synthetic demo mode until your site's clinical, consent, and production controls are configured.
- **Private model.** The launcher starts the default loopback ML listener when ultrasound is enabled, independently of patient ranking. A separate private HTTPS ML origin can be configured by setting `DAI_ULTRASOUND_ML_ORIGIN` and the same private service credential on both ends. For an independently hosted ML service, install the standard ML requirements and start from a checkout containing the bundled weights. If needed, copy the bundled verified weights to a different private path:

  ```sh
  cd ml-service
  python -m ultrasound.sononet /private/models/SonoNet16.npz
  ```

  Set `DAI_ULTRASOUND_PLANE_WEIGHTS=/private/models/SonoNet16.npz` on that service. The default configuration reads the bundled checkpoint directly. An empty `DAI_ULTRASOUND_PLANE_WEIGHTS` explicitly disables the default model for fallback testing. An explicitly configured `DAI_ULTRASOUND_MODEL_DIR` continues to select a separately approved archive model.

See [the environment template](.env.example) for exact variable names.

## Tests

```sh
node --test backend/ultrasoundWorkspace.test.js
hospital_portal/.venv/bin/python -m pytest -q hospital_portal/tests/test_ultrasound_flow.py ml-service/tests/test_ultrasound_research.py ml-service/tests/test_sononet.py
```

The SonoNet test loads the bundled published checkpoint and verifies predictions with ONNX imports disabled. The Chromium browser test runs through the signed-in patient and doctor workspaces. Run on fresh synthetic state with `DAI_TEST_PATIENT=mother-syn-0000085@dai-synthetic.invalid`, `DAI_TEST_DOCTOR=doctor@dai-synthetic.invalid`, and `DAI_TEST_EXPECT_SONONET=true`. It verifies distinct predictions for two panels, pixel equality through the protected image route, invalid and repeated uploads, poor-quality handling and the clinician release. For the manual fallback test, start with `DAI_ULTRASOUND_PLANE_WEIGHTS=""` and omit `DAI_TEST_EXPECT_SONONET`.

## Refinement files

| Area | Files |
| --- | --- |
| Patient and doctor views | `frontend/dashboard.html`, `frontend/doctor.html`, `frontend/js/ultrasound-workspace.js`, `frontend/ultrasound-workspace.css` |
| Scoped API and persisted processing | `backend/ultrasoundWorkspace.js`, `hospital_portal/api/main.py`, `hospital_portal/api/ultrasound_workspace.py`, `hospital_portal/api/ultrasound_processing.py`, `hospital_portal/api/ultrasound.py` |
| Inference events | `ml-service/ultrasound/inference.py` |
| Verification | `hospital_portal/tests/test_ultrasound_flow.py`, `hospital_portal/tests/ultrasound_browser.py`, `ml-service/tests/test_ultrasound_research.py` |
