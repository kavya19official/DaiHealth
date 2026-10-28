# DaiHealth (दाई)

**Connected maternal and paediatric care.** One continuous record that follows a mother from pregnancy, through
delivery and recovery, to her child's first years, shared safely between the mother, her doctor and the hospital.

> **Demonstration data only.** Every person, facility, registration and clinical record in this repository is
> synthetic. DaiHealth is a prototype. It is not a medical device and must not be used for real patient care.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [How it fits together](#how-it-fits-together)
- [Project structure](#project-structure)
- [Everyday commands](#everyday-commands)
- [Configuration](#configuration)
- [Hosted PostgreSQL setup](#hosted-postgresql-setup)
- [Privacy and access model](#privacy-and-access-model)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [More documentation](#more-documentation)

---

## What it does

### For the mother (patient dashboard)
- **Care timeline and appointments:** a pregnancy-to-infancy timeline, booking, and a health folder for reports.
- **Health tracking:** blood pressure, weight and blood glucose logs, with a high-risk pregnancy assessment and a risk trend over time.
- **Postpartum follow-through:** postnatal visit schedule, mark-as-done, and a recorded **reason for delay**.
- **Child health:** growth entries, a vaccination history and schedule, milestones, and reminders. Overdue
  vaccines can also be given a recorded reason for delay.
- **Notification centre:** vaccine, appointment, growth and postnatal-visit reminders in one bell menu.
- **Find care:** nearby facilities matched to her stated preferences, each showing **how recent and well-sourced
  the information is** (last-confirmed date, contact reports, reported availability). There is no "best hospital"
  ranking.
- **Consent and sharing:** see which doctors and facilities can open her record, turn access off or on, and view
  who looked at her record.
- **Dr. Daya:** an English and Hindi care guide.

### For the doctor
- A patient roster, work queue, report review, a clinical dashboard and risk trends, limited to patients who have
  not turned that doctor off.

### For the hospital
- A separate **Operations / Administration** portal (Next.js and FastAPI) with referrals and a hospital-readiness view.

---

## Quick start

You need **Node.js 22.13 or newer** and **Python 3.11 or newer** (with `venv`). You do **not** need PostgreSQL or
Docker for the local demo.

```bash
git pull --ff-only     # if you cloned the repository
npm start
```

Then open **http://localhost:3001** and keep that terminal open. Press `Ctrl+C` to stop.

The **first run takes several minutes**. It installs dependencies, creates the local database, applies every
migration, generates the synthetic hospital data, imports a 2,000-mother cohort and trains the demo models.
Later runs reuse all of that and start much faster.

---

## Demo accounts

All three use the password `Dai-Synthetic-2026!`. The sign-in page has a **Patient / Doctor / Hospital** toggle.

| Role | Email |
| --- | --- |
| Patient | `mother@dai-synthetic.invalid` |
| Doctor | `doctor@dai-synthetic.invalid` |
| Hospital / Admin | `hospital_admin@dai-synthetic.invalid` |

The hospital login shows its one-time code on screen in this synthetic demo, so no SMS or API key is needed.
The Hospital / Admin portal opens at `/hospital-admin`.

---

## How it fits together

```
                         http://localhost:3001  (one address in the browser)
                                   |
        +--------------------------+---------------------------+
        |                                                      |
  Express app (backend/)                          proxy to internal services
  - patient and doctor API (/api)                   - 3104  Next.js  (hospital UI)
  - serves frontend/ (HTML, CSS, JS)                - 8100  FastAPI  (hospital API)
  - JWT in an HTTP-only cookie
        |
  PostgreSQL in production  /  PGlite (embedded) in local mode
```

- **Backend:** Express, PostgreSQL and JWT. Locally the database is an embedded PGlite instance stored in `.local/`.
- **Frontend:** plain HTML, CSS and JavaScript under `frontend/`, sharing one client, `frontend/js/dai-api.js`.
- **Hospital portal:** Next.js and FastAPI in `hospital_portal/`, behind the same address.
- **Shared rules:** growth standards, vaccination schedule, postnatal-visit schedule and emergency triage live in
  `shared/` so the browser and server use the same logic.
- **Separate sessions:** patient, doctor and hospital are separate role-based sessions behind one address, not a
  single shared identity provider.

---

## Project structure

```
backend/            Express API, route modules, SQL migrations (backend/db/), tests
frontend/           Patient, doctor and hospital pages and scripts
  js/               Shared client code and per-feature scripts
shared/             Rules shared by browser and server (vaccines, postpartum, growth, triage)
hospital_portal/    Hospital and Administration portal (Next.js, FastAPI)
ml-service/         Demonstration prediction service and trained models
synthetic_data/     Fixed-seed synthetic data generators
scripts/            Local launcher, setup, doctor and check scripts
.local/             Created on first run: local databases and secrets (ignored by git)
```

Top-level pages `index.html`, `auth.html` and `dashboard.html` redirect into `frontend/`.

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm start` | Install, migrate, seed and start everything |
| `npm run stop` | Stop a running launcher without deleting data |
| `npm run stop && npm start` | Safe restart |
| `npm run setup` | Install and import data without starting the apps |
| `npm run doctor` | Show missing prerequisites or generated files |
| `npm run test:local` | Gateway, database adapter and login regression tests |
| `npm run check:local` | Check all three logins and data flows against the running app |
| `DAI_DEV=true npm start` | Hot reload for hospital UI changes |
| `DAI_PORT=3011 npm start` | Use a different public port |

On Windows PowerShell set variables first, for example `$env:DAI_PORT=3011; npm start`.

---

## Configuration

`npm start` creates its own secrets and databases under `.local/`, so no configuration is needed for the demo.

To run only the Express app by hand, copy `backend/.env.example` to `backend/.env` and set:

| Variable | Purpose |
| --- | --- |
| `PORT` | Port for the Express app |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_SSL` | Enable SSL for a hosted database |
| `JWT_SECRET` | Secret for signing session tokens |
| `NODE_ENV` | Keep `development` for local HTTP cookies |
| `GEMINI_API_KEY` | Optional, for the Dr. Daya voice only |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | Optional voice settings |

Other launcher variables: `DAI_PORT`, `DAI_DEV`, `DAI_PYTHON` (custom Python path) and `DAI_CHECK_URL`.
Never commit a real `.env` file or API key.

---

## Hosted PostgreSQL setup

Local mode applies migrations for you. For a hosted PostgreSQL database, run these in order. They are safe to
re-run. Order matters, in particular `follow_through.sql` must come after `patient_support.sql`.

```bash
psql "$DATABASE_URL" -f backend/db/auth_and_wellness.sql
psql "$DATABASE_URL" -f backend/db/care_timeline_and_appointments.sql
psql "$DATABASE_URL" -f backend/db/mother_dashboard.sql
psql "$DATABASE_URL" -f backend/db/antenatal_profile.sql
psql "$DATABASE_URL" -f backend/db/child_dashboard.sql
psql "$DATABASE_URL" -f backend/db/child_dashboard_v2.sql
psql "$DATABASE_URL" -f backend/db/child_health_v3.sql
psql "$DATABASE_URL" -f backend/db/hospital_platform.sql
psql "$DATABASE_URL" -f backend/db/patient_preferences.sql
psql "$DATABASE_URL" -f backend/db/patient_documents.sql
psql "$DATABASE_URL" -f backend/db/care_extensions_v4.sql
psql "$DATABASE_URL" -f backend/db/facility_discovery.sql
psql "$DATABASE_URL" -f backend/db/referral_continuity.sql
psql "$DATABASE_URL" -f backend/db/patient_experience.sql
psql "$DATABASE_URL" -f backend/db/patient_home.sql
psql "$DATABASE_URL" -f backend/db/patient_continuity.sql
psql "$DATABASE_URL" -f backend/db/access_matching.sql
psql "$DATABASE_URL" -f backend/db/patient_support.sql
psql "$DATABASE_URL" -f backend/db/clinical_dashboard.sql
psql "$DATABASE_URL" -f backend/db/document_intake_offline.sql
psql "$DATABASE_URL" -f backend/db/missed_care_outreach.sql
psql "$DATABASE_URL" -f backend/db/green_hospital_dashboard.sql
psql "$DATABASE_URL" -f backend/db/smart_referral_handoff.sql
psql "$DATABASE_URL" -f backend/db/doctor_operations.sql
psql "$DATABASE_URL" -f backend/db/facility_freshness.sql
psql "$DATABASE_URL" -f backend/db/patient_ml.sql
psql "$DATABASE_URL" -f backend/db/patient_access_controls.sql
psql "$DATABASE_URL" -f backend/db/follow_through.sql
psql "$DATABASE_URL" -f backend/db/delhi_directory.sql   # optional: Delhi facility directory (unverified reference data)
```

Then, from `backend/`: `cp .env.example .env`, fill in `DATABASE_URL` and `JWT_SECRET`, `npm install` and `npm start`.

---

## Privacy and access model

- **Roles:** every route is limited by role (mother, doctor, hospital). A mother reads only her own record.
- **Doctor access** comes from an appointment with the mother (or dashboard sharing she agreed to).
- **Revocation is enforced by the server.** When a mother turns a doctor or facility off, the backend stops that
  clinician from reading or changing her record, including shared documents. It is not only hidden in the screen.
- **A facility switch** closes only appointments at that facility.
- **Record-access history** lists views made through DaiHealth clinician screens, including blocked attempts. It
  does not cover access inside a hospital's own systems.
- **Limits:** turning access off does not delete records a hospital must legally keep and does not change
  emergency procedures inside a hospital.
- **Freshness is not a ranking.** Facility confirmation dates, contact reports and reported availability are shown
  for context and never change the order of results.
- **Reasons for delay** never mark a visit or vaccine as done and never replace a clinician's advice.

---

## Testing

Tests that need no database:

```bash
node --test backend/accessControl.sql.test.js backend/followThrough.test.js \
            backend/facilityFreshness.test.js backend/facilityMatching.test.js
```

Tests that use the embedded database (PGlite) run after dependencies have been installed by `npm start` or
`npm run setup`:

```bash
node --test backend/accessControl.test.js backend/facilityDiscovery.test.js
```

Run a single file with `node --test backend/<name>.test.js`.

---

## Troubleshooting

- **Port busy:** another program uses 3001. Close it, or start with `DAI_PORT=3011 npm start`. The launcher never
  kills an unrelated process.
- **Python errors:** install Python 3.11 or newer with `venv`. On Windows set `DAI_PYTHON` to its path.
- **Signed out unexpectedly:** use the same address every time. Do not switch between `localhost` and `127.0.0.1`.
- **A change does not show:** restart with `npm run stop && npm start`, then hard-refresh with `Ctrl+Shift+R`.
- **Start over:** stop the app, back up `.local/` if you want to keep it, then delete it. The next `npm start`
  rebuilds everything from the fixed synthetic seed.
- **Edits are local:** changes made on one machine do not sync to another. Sharing live data needs a hosted
  backend and database.

---

## More documentation

- [`docs/DETAILED_NOTES.md`](docs/DETAILED_NOTES.md): the long-form reference for every feature area
- [`hospital_portal/README.md`](hospital_portal/README.md): the hospital and administration portal
- [`ml-service/README.md`](ml-service/README.md): the demonstration prediction service
- [`synthetic_data/README.md`](synthetic_data/README.md): how the synthetic data is generated
- [`FEATURE_IMPLEMENTATION.md`](FEATURE_IMPLEMENTATION.md) and [`SMART_REFERRAL_IMPLEMENTATION.md`](SMART_REFERRAL_IMPLEMENTATION.md)

## Lower-impact patient assistance

Patient reminder timing and support suggestions always use deterministic rules.
Optional learned access ranking requires both `ML_ENABLED=true` and
`PATIENT_ML_RANKING_ENABLED=true`, in addition to patient consent. The Delhi demo
shortlist, eligibility checks, appointment/referral transitions and follow-up
workflow use rules. See [model-selection policy](docs/AI-MODEL-SELECTION.md) for
scope, evaluation requirements and local verification.

Patient dashboard → Ask Dhruv → **How assistance works · local first** shows local
FAQ routing, reusable public metadata and explicitly approved optional general
drafting. See [routing and cache boundaries](docs/ASSISTANCE-ROUTING-AND-CACHE.md).

Patient **Care timeline → Clinician review requests** and Doctor **Home → Clinician
review requests** now expose a human review queue. General AI drafts use one bounded
request, no automatic retries and duplicate-call guards. Automatic prototype risk
classification has been replaced by review requests; existing deterministic safety
signals remain. See [bounded calls and clinical review](docs/BOUNDED-AI-AND-CLINICIAN-REVIEW.md).

Patient and Doctor **Settings → AI usage & deployment** show account-scoped usage,
provider-reported token data where present, measured latency and optional usefulness
feedback. Missing cost/compute remain unknown; no water/carbon savings are inferred.
The local/self-hosted text-model assessment remains unapproved pending evidence.
See [AI usage and deployment](docs/AI-USAGE-AND-DEPLOYMENT.md).

## Sustainability-aware care coordination

Patient **Visit instructions** and Doctor **Care coordination** (`backend/careCoordination.js`,
`backend/db/care_coordination.sql`):

- **Digital-first, in person when needed.** Clinicians write visit instructions, test preparation
  and follow-up summaries; patients see them only after the clinician verifies them. A pack marked
  "in-person visit clinically necessary" must say why, and the patient is told to attend.
  Patients can say whether a pack saved a trip or paperwork (self-reported, never inferred).
- **Right facility first.** `GET /api/care-coordination/facility-match` excludes facilities without
  the required clinical capability, then orders by distance, then reported availability. Referral
  journeys record prior searches, whether the facility listed the capability, and whether the visit
  happened first time, was redirected or failed (and why).
- **Less duplicate work.** Verified, connected clinicians see reports the patient explicitly shared,
  referral status, pending tests and earlier test decisions. Unshared reports are only counted.
  Test decisions are recorded; repeating a test needs a clinical reason and is always the
  clinician's call. Access is logged and stops immediately on revocation.
- **Preventive follow-up, evaluated.** The queue combines missed-care items with approved follow-ups
  now due. Clinicians record reminders/contacts and outcomes (including reported emergency use).
  The evaluation endpoint reports counts only (`prevention_claim: "not_evaluated"`); no travel,
  carbon or cost savings are calculated.
- **Low bandwidth.** Static text assets are served Brotli/gzip-compressed with ETags
  (`backend/staticCompression.js`). Background polling stops on hidden tabs and in low-bandwidth
  mode, which also turns off map tiles; data still loads when you navigate.

### Missed-care outreach

Mothers see **Follow-up help** (their own overdue visits and tests, a rebook shortcut, and a way to tell the care team what is in the way). Doctors see the **Outreach Queue** (most urgent first, only patients who have not turned off their access, with an attempt log and history). Items are created and re-scored every time either list loads, and close when the care is recorded as done. "Reached" is logged as contact, not as completed care.
