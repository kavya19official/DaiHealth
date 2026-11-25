# Doctor Workspace data foundation

This phase links existing records and adds a reusable, local-only synthetic cohort for end-to-end demonstrations. Clinicians retain control of reviews and clinical decisions. The existing monitoring rules and live ultrasound inference pipeline are used as shipped.

## Repository audit

| Area | Existing source and entry point | Phase 1 integration |
| --- | --- | --- |
| Identity and roles | Express `users`, `mother_profiles`, `doctor_profiles` and cookie-based `/api/auth/login`. Hospital/Admin has its own portal users, OTP and facility/unit permissions. | Local accounts are created in the existing identity stores. The existing source-link table maps the same maternal and clinician identities across the two stores. |
| Patient dashboard and clinic record | `/api/patient/dashboard`, `/api/patient/overview`, `/api/patient/records` and the patient record vault | Trends and visit details read the linked clinician observations. Legacy source rows remain readable. |
| Doctor workspace and EMR | `/api/doctor/workspace`, `/api/doctor/patients/:id/dashboard`, the patient record dialog and existing visit summary APIs | Each demonstration doctor has three assigned patients. The EMR reads the same observation and appointment IDs as the patient's vault, subject to summary and history sharing. |
| ANC and encounter history | `appointments`, `care_milestones`, `doctor_queue_state`, `visit_summaries`, `/api/timeline/enhanced` | Completed ANC visits connect to their values, note, source lab PDF and follow-up. The missed visit stays open in the timeline. The OGTT order stays pending. |
| Lab investigations | `patient_documents`, `document_intake_drafts`, `verified_report_records`, original downloads and document shares | 36 source PDFs and verified versions have dated CBC observations, booking blood group/Rh and case-specific urine, OGTT, thyroid, renal and liver results. A missing range is omitted. Any printed ranges are fictional source metadata. |
| Ultrasound | Existing private `ultrasound_workspace_scan`, review and release routes, and encrypted image retention | 12 scan records use credited teaching frames. Eleven show a fictional completed review and one is pending. The images carry no patient-specific measurements or inferred findings. The existing live-upload path remains available. |
| Clinical monitoring | Hospital/Admin `anc_visit`, `investigation_order`, `investigation_result`, `care_gap`, monitor worker and review routes | The portal rows reference the original encounter, document and verified report IDs. The existing worker uses the cohort's snapshot date and existing permissions. Ultrasound images stay within the dedicated consent-gated workspace. |
| Nearby Care and booking | Existing facility directory, hospital units, `/api/patient/booking-options`, clinician affiliations and presence | Four distinct units across two existing synthetic facilities anchor the appointments. Presence uses the existing status table. Nearby Care matching and instant dispatch eligibility follow the existing affiliation rules. |
| Demo accounts and seeding | `scripts/local.py`, `scripts/seed-local.cjs`, `hospital_portal.api.seed` | The new cohort is opt-in. Repeated launches reuse persisted IDs, dates and records. The older demo cohort keeps its accounts and data. |

The null-value review covered the affected dashboard, visit history, clinical charts, lab records and ultrasound paths. Unrecorded dates and measurements stay empty or display **Not recorded**. A chart requires dated readings, an outstanding lab uses **Awaiting results**, and an unreleased ultrasound stays **Pending clinician review**. BMI uses recorded height and a recorded clinic weight. Home movement entries use the same self-report tables as the movement counter. Real users keep all existing consent requirements.

## Database changes

`backend/db/clinical_dashboard.sql` adds an optional appointment foreign key and partial index to `clinical_dashboard_entries`. Linked observations must match a completed appointment for the same patient, doctor and date. Deleting an appointment clears the link and preserves the observation.

The same migration adds an optional `doctor_profiles.qualification`. Temperature and oxygen saturation use existing observation JSON. Optional `measured_on` and `reference_range` values use existing verified-report JSON. No new production table or external dependency is required. Separately managed PostgreSQL deployments must apply the updated migration before deploying the backend.

```bash
psql "$DATABASE_URL" -f backend/db/clinical_dashboard.sql
```

## Run the demo

Requires Node 22.13 or later and the project's supported Python environment.

```bash
DAI_SEED_WORKSPACE_FOUNDATION=true npm start
```

Sign in at [http://localhost:3001/auth.html](http://localhost:3001/auth.html). All accounts below append `@dai-synthetic.invalid`. Use the local launcher password, `Dai-Synthetic-2026!` by default. The same four doctor accounts can sign in to Hospital/Admin as consultants using the on-screen demo OTP.

| Account prefix | Scenario | Assigned doctor suffix |
| --- | --- | --- |
| `foundation-mother-01` | Routine with stable observations | 01 |
| `foundation-mother-02` | Increasing blood pressure | 02 |
| `foundation-mother-03` | Low haemoglobin across visits | 01 |
| `foundation-mother-04` | Increasing weight under follow-up | 02 |
| `foundation-mother-05` | OGTT ordered and awaiting results | 03 |
| `foundation-mother-06` | Previous caesarean and postpartum haemorrhage documented | 03 |
| `foundation-mother-07` | Ultrasound review pending | 03 |
| `foundation-mother-08` | Missed ANC follow-up and subsequent booking | 04 |
| `foundation-mother-09` | Improving haemoglobin | 01 |
| `foundation-mother-10` | Multiple documented risk factors | 02 |
| `foundation-mother-11` | Thyroid follow-up and a documented allergy | 04 |
| `foundation-mother-12` | Completed glucose screening with dated results | 04 |

| Doctor login prefix | Name | Qualification | Seed presence |
| --- | --- | --- | --- |
| `foundation-doctor-01` | Dr Aditi Saran | MD, Obstetrics and Gynaecology | Available |
| `foundation-doctor-02` | Dr Neel Kapoor | DNB, Obstetrics and Gynaecology | Busy |
| `foundation-doctor-03` | Dr Ira Bhasin | MS, Obstetrics and Gynaecology | Available |
| `foundation-doctor-04` | Dr Farah Dutt | MD, Obstetrics and Gynaecology | Offline |

To rehearse, open a doctor panel, find the patient by name, and open **Overview**, **History** or **Reports & results**, or use the clinician’s **Ultrasound review** workspace. Go to **Reports & records** and **Ultrasound scans** in the mother account to see the matching records. Use the second or eighth mother for longitudinal measurements or a missed follow-up. Use the seventh to show the private scan review queue.

## Validation commands

Run the smoke test in a second terminal after the launcher becomes healthy. It logs in across all roles, verifies source IDs and measurements, checks isolation and waits for the existing monitor worker.

```bash
node scripts/test-workspace-foundation.cjs
npm --prefix backend test
hospital_portal/.venv/bin/python -m pytest -q hospital_portal/tests
```

Set `DAI_TEST_URL` if the launcher port differs. The report originals use the existing local document store. Teaching images use the launcher-managed ultrasound image key and the existing expiry policy. The hospital view is a projection of the seeded snapshot. Live changes to additional clinical observations and lab reports after seeding are outside the scope of this projection. The fixture dates are deliberately stable after first setup. Initial sharing grants expire after 30 days, and presence follows the existing heartbeat rules.

## File inventory

New files

- `scripts/fixtures/workspace-foundation.cjs` defines the maternal histories and doctor profiles.
- `scripts/seed-workspace-foundation.cjs` writes Node accounts, visits, observations, report originals and follow-ups.
- `scripts/seed_workspace_foundation.py` writes the linked Hospital/Admin and encrypted ultrasound rows.
- `scripts/test-workspace-foundation.cjs` exercises the live service and its access controls.
- `docs/DOCTOR-WORKSPACE-FOUNDATION.md` records the audit, migrations, accounts and run commands.

Modified files

- `backend/db/clinical_dashboard.sql` adds appointment provenance and optional qualification.
- `backend/clinicalDashboard.js`, `backend/doctorWorkspace.js`, `backend/documentIntake.js`, `backend/patientContinuity.js` and `backend/patientExperience.js` extend existing record endpoints.
- `frontend/js/clinical-dashboard.js`, `frontend/js/doctor-dashboard-focus.js`, `frontend/js/doctor-patient-profile.js`, `frontend/js/patient-connected.js`, `frontend/js/report-intake.js` and `frontend/js/ultrasound-workspace.js` render the source fields and empty states.
- `hospital_portal/api/clinical_monitor.py` and `hospital_portal/api/ultrasound_workspace.py` expose the synthetic snapshot and teaching-frame context.
- `scripts/local.py`, `scripts/seed-local.cjs`, `scripts/check-local.cjs` and `README.md` wire and document the local setup.
