# DaiHealth ultrasound implementation report

> Historical implementation report. The original hospital review UI has been superseded by patient and doctor dashboard workspaces. See [the current integration and deployment guide](../hospital_portal/ULTRASOUND_AI_REVIEW.md).

## Delivered behavior

The implementation uses the supplied `DaiHealth-main(2).zip` as its source baseline. The hospital portal supports provider upload, scoped review and encrypted image previews. The same private ML service performs raster checks and can run a released EfficientNet-B0 artifact. The clinical monitoring agent attaches the image review to the mother's recorded antenatal evidence. No commit, push or deployment took place.

A verified consultant or assigned resident opens a patient in **Patient registry**, submits one PNG, JPEG or WebP frame, and opens **Ultrasound AI Review**. The queue displays the uploaded image, recorded pregnancy context, UTC-backed timestamps rendered in local time, analysis state, review reason and priority, and model metadata and scores when available. A consultant records a disposition and comments. Unavailable analysis can be retried on the stored raster. The fallback queues a verified raster for human review, with no fabricated scores. Only the provider upload path is enabled.

## Files created

| Files in the source archive | Purpose |
| --- | --- |
| `hospital_portal/api/ultrasound.py` and `hospital_portal/migrations/20261123_ultrasound_analysis.sql` | Authenticated intake, secure storage, deduplication, inference deadline, retry, review, retention and PostgreSQL schema. |
| `hospital_portal/web/app/ultrasound.tsx` and `ultrasound.module.css` in the same directory | Patient-linked upload form and consultant dashboard with private preview. |
| `ml-service/ultrasound/{__init__.py,audit.py,imaging.py,training.py,inference.py,requirements.txt}` | Restored and integrated research code. The previous separate listener and queue were superseded by the existing ML service and portal review. |
| `ml-service/ultrasound/{README.md,kaggle-v2-audit-summary.json}` and `hospital_portal/ULTRASOUND_AI_REVIEW.md` | Audit results, training, release, setup, security, API and clinician workflow. |
| `hospital_portal/tests/{test_ultrasound_flow.py,ultrasound_browser.py}` and `ml-service/tests/test_ultrasound_research.py` | Portal workflow, browser, model, data audit and preprocessing tests. |
| `docs/ULTRASOUND_IMPLEMENTATION_REPORT.md` | Implementation and verification record. |

## Files modified

| Files in the source archive | Purpose |
| --- | --- |
| `hospital_portal/api/{main.py,schema.py,security.py,clinical_monitor.py}` | Route registration, portable schema, existing permissions, monitoring evidence aggregation and flag synchronization. |
| `hospital_portal/web/app/{page.tsx,clinical-monitor.tsx}` | Navigation, selected-patient intake, and linked clinical monitoring flags. |
| `scripts/local.py` and `ml-service/api/main.py` | Existing launcher starts the ML process when required. The existing FastAPI ML app registers a private authenticated analysis endpoint. |
| `hospital_portal/{.env.example,requirements.txt,CLINICAL_MONITOR.md}`, `ml-service/{README.md,requirements.txt}`, `README.md` | Optional configuration, runtime dependencies and reference documentation. |
| `.gitignore` and `.dockerignore` | Exclude private ultrasound datasets and training output from source control and Docker build context. |

## Run

The [integration guide](../hospital_portal/ULTRASOUND_AI_REVIEW.md) has exact commands to generate and persist local secrets, apply the optional PostgreSQL migration, start the system with `npm start`, and open the synthetic clinician workflow. In the local demo, use `/hospital-admin` at the gateway. The [dataset and ML guide](../ml-service/ultrasound/README.md) gives the download, audit, training, held-out evaluation, and private artifact release commands.

## Dataset and training status

The Kaggle download was 632,918,233 bytes and matched the previous audit's SHA-256. Re-running the auditor confirmed 335 byte-identical conflicting Normal/Benign groups, 143 of which cross supplied splits. Decoded pixels revealed 336 duplicate groups, with 144 crossing splits. Perceptual checks flagged 15 additional pairs, four crossing splits. The auditor excluded 999 filename-marked derivatives, quarantined contaminated duplicate components, and removed six within-split repeats. All named-split files decoded. Remaining split counts were 719 train, 122 validation, and 143 test. All 984 carry the Malignant archive label. The available metadata do not establish patient-level grouping, independent study splits, or a clinical reference standard.

The publisher's newer public Mendeley listing provides no independent adjudication or patient linkage. The expert-labeled FETAL_PLANES_DB supports a different anatomical-plane target. Neither provides verification of the supplied archive classes.

**Kaggle training was blocked.** Running the training CLI against the original archive exited with the expected audit error before initializing the model. No ultrasound model, clinical performance metrics or clinically validated confidence cutoff was produced from the Kaggle archive. The separate generated-raster fixture exercised ImageNet initialization, head training, fine-tuning, checkpoint selection, calibration, held-out evaluation and artifact export. The fixture was temporary and provides software verification only.

The pipeline uses verified patient grouping and review metadata, class-weighted EfficientNet-B0 cross-entropy, validation macro F1 for checkpoint choice, validation-only temperature fitting and held-out evaluation. The report includes precision, recall, class F1, macro and weighted F1, a confusion matrix, ROC-AUC where applicable, Brier score, log loss, ECE and threshold coverage.

## Verification

| Check | Result |
| --- | --- |
| Existing Express backend tests | 380 passed, 1 skipped. The configured PostgreSQL URL is required for the existing child health route suite. |
| Hospital portal suite | 73 passed, including the ultrasound workflow. Focused ultrasound and clinical-monitor rerun after final changes passed all 3 tests. |
| Existing ML and ultrasound suite | 31 passed, 1 skipped in the default environment. |
| Ultrasound suite with PyTorch installed | 6 passed, including real Torch state-dict serialization, loading, release gating and hash rejection. |
| Synthetic data rules | 6 passed. The generator also completed its validation checks during setup. |
| Next.js | Type check and production build passed. |
| Live browser workflow | Passed through the real Express gateway, FastAPI portal, SQLite and private ML listener. The test exercised clinician authentication, upload, invalid and poor-quality routing, a private image preview, clinical review persistence and a no-model retry. |
| SQL migration | Applied twice on PostgreSQL-compatible PGlite with expected keys and indexes. Production PostgreSQL and PostGIS deployment acceptance remains outstanding. |
| Raw archive training command | Failed closed as intended for the reproduced audit blockers. |

## Remaining for clinical validation

Obtain independently adjudicated labels for a clinically specified target, stable de-identified patient linkage, representative study and device coverage, and an external held-out cohort. Evaluate per-class and subgroup performance, calibration, uncertainty, false negatives, device and site shifts, and prospective clinician workflow impact. Raster quality checks assess measurable file properties and leave clinical adequacy and ultrasound anatomy to the reviewer. Complete site-specific review of consent, data protection, human factors and clinical governance before operational clinical use.
