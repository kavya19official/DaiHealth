# DaiHealth (दाई)

Connected maternal and paediatric care — mother, doctor and hospital workflows on one continuous record.

## Start the complete DAI locally (all three interfaces)

Install **Node.js 22.13+**, **Python 3.11+** (with venv). No PostgreSQL server or Docker installation is needed for this local demo. Then, from the DAI repository root:

```bash
git pull --ff-only
npm start
```

Open **http://localhost:3001**. DAI opens directly to the familiar sign-in form with a **Patient / Doctor / Hospital** toggle. The marketing overview remains at `/about.html`. Keep this terminal running; Ctrl+C stops the three application services. From another terminal in the same checkout, `npm run stop` also stops the launcher without deleting data and waits for shutdown to finish, so `npm run stop && npm start` safely restarts this checkout. First startup installs dependencies, applies every patient/doctor SQL migration to the embedded local database, generates the fixed-seed synthetic hospital database, imports the 2,000-mother cohort into both applications, and trains the synthetic ML models if missing. It can take several minutes and needs internet for package downloads. Subsequent runs reuse local data, installed dependencies and the compiled hospital UI. Restart `npm start` after editing hospital UI code to rebuild it; use `DAI_DEV=true npm start` for hot reload instead.

| Interface | Local synthetic email | Password |
| --- | --- | --- |
| Patient | `mother@dai-synthetic.invalid` | `Dai-Synthetic-2026!` |
| Doctor | `doctor@dai-synthetic.invalid` | `Dai-Synthetic-2026!` |
| Hospital/Admin | `hospital_admin@dai-synthetic.invalid` | `Dai-Synthetic-2026!` |

Hospital/Admin opens at `/hospital-admin` with the full **Operations / Administration** layout. Its second-factor OTP appears on screen in this explicit synthetic demo; no SMS/API key is required. Patient and doctor use the existing authenticated dashboards and SQL routes, backed locally by persistent embedded PostgreSQL (PGlite). Hosted operation still uses PostgreSQL through node-postgres. These are separate role-appropriate sessions behind one address, not a new shared identity provider. The old hospital console remains at `/hospital-legacy.html` in local mode.

### Why pulling alone did not work

Git contains application code and generation scripts, **not running API servers, `.env` secrets, databases, uploaded files or trained model artifacts**. The old instructions assumed a pre-existing PostgreSQL schema and account data, and the hospital preview used a separate FastAPI/Next process plus an ignored generated database. The root launcher now creates these dependencies reproducibly instead of depending on one teammate's laptop.

- Each laptop gets the same initial fixed-seed synthetic records, with source-ID links between the hospital, patient and doctor imports. The seeded doctor is assigned to the seeded mother's cohort. The patient-side initial timeline/appointment entries are explicitly synthetic schedule examples, not imported completion evidence.
- **Local edits do not sync across laptops.** To collaborate on the same live mutable data, deploy a shared authenticated backend and database later. Pulling Git never synchronises database edits.
- Per-device JWT/database secrets and databases live in ignored `.local/`; no teammate's production `.env` or personal database is used by this launcher. Existing PostgreSQL databases are untouched. The local patient/doctor preview uses PGlite inside the Express process, while Hospital/Admin retains its SQLite preview. This local mode does not verify a production PostgreSQL/PostGIS deployment.
- Express serves the homepage/patient/doctor at 3001 and proxies Hospital/Admin to internal loopback services 3104 (Next.js) and 8100 (FastAPI). Browser requests stay on one origin; hospital and patient cookies are separated by path/name.
- `npm run setup`: install/import without starting the apps. `npm run doctor`: show missing prerequisites/generated files. `npm run test:local`: gateway/database regression tests. `npm run check:local`: verify all three login/data flows against the running app (default `http://localhost:3001`, override with `DAI_CHECK_URL`).
- A busy port produces an actionable error; the launcher never kills an unrelated process. Stop older DAI terminals with Ctrl+C. Change the public port with `DAI_PORT=3011 npm start` (PowerShell: `$env:DAI_PORT=3011; npm start`). Use the printed **localhost** URL consistently, rather than switching between localhost and 127.0.0.1 during a session.
- Later `npm start` runs apply newly added migrations and keep seed records/edits intact. An incompatible changed synthetic source is reported rather than overwriting existing data. Back up `.local/` before replacing a scenario.
- On Windows, install Python with venv and Node.js. If Python has a custom location, set `DAI_PYTHON`. Both local databases persist under `.local/` after Ctrl+C. PGlite is a single-connection local development database; the adapter serialises entire transactions to keep concurrent requests separate. Never use these demonstration accounts/data for real patient care.

### Manual / hosted operation

The sections below describe individual services and deployment. For the complete local demo use the root command above; starting only `backend` does **not** start the new Hospital/Admin portal. Optional Gemini speech needs its own key; sign-in, data and hospital features do not.

Embedded local database reference: [PGlite documentation](https://pglite.dev/docs/).

## Architecture

- **Backend**: Express + PostgreSQL + JWT (HTTP-only cookie). Serves the frontend statically from `frontend/`.
- **Frontend**: Plain HTML/CSS/JS under `frontend/`. Shared client: `frontend/js/dai-api.js`.
- **Auth**: Register/login as mother or doctor → cookie JWT → role-based dashboards.
- **API base**: On localhost uses same-origin `/api`. In production uses `https://daihealth.onrender.com/api` (override with `window.DAI_API_BASE`).

## Database setup

Apply in order (idempotent — safe to re-run):

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
```

For Render, create/connect a Render PostgreSQL database and add its **Internal
Database URL** to the web service as:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=replace-with-a-long-random-secret
GEMINI_API_KEY=your-gemini-api-key
```

The backend also supports local `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
values, but production should use `DATABASE_URL`.

`child_dashboard.sql` and `child_dashboard_v2.sql` (vaccination certificates +
the Notification Center's `notifications` table) were previously missing from
this list — every deployment that only ran the earlier five files was missing
the `children`, `child_vaccinations`, `child_growth_logs`, `child_milestones`
and `notifications` tables, which is why `GET /api/notifications` and the
Child dashboard's per-child routes returned 500s until this was applied.

`backend/db/children.sql` and `backend/children.js` (an older, simpler child
schema/route pair — no vaccination codes, no certificates, no photo) have been
removed: `child_dashboard.sql` + `backend/childDashboard.js` is the schema the
app actually runs on.

## Run locally

```bash
cd backend
cp .env.example .env   # set DB_* and JWT_SECRET
npm install
npm start              # http://localhost:3001
```

Open http://localhost:3001 — homepage, auth, mother dashboard (`dashboard.html`), doctor dashboard (`doctor.html`).

## Flow

1. Homepage → Sign in / register (`auth.html`).
2. Auth issues JWT cookie; redirects by role.
3. Mother dashboard loads timeline, appointments, wellness, profile from authenticated APIs only (guest mode is localStorage-only, no network writes required for viewing).
4. Doctor dashboard loads patients and appointments from `/api/doctor/*` and `/api/appointments`.
5. Child dashboard (`child-dashboard.html`) uses `/api/children` — see **Child health** below. Mothers can only access their own children.
6. Unauthenticated access to protected API routes returns 401; client redirects to `auth.html`.

## Notes

- Hospital console (`hospital.html` + `backend/hospitalPlatform.js`) currently uses an in-memory / file-backed demo state for continuity workflows. Core mother and doctor paths use PostgreSQL only.
- No mock patient/doctor/appointment data is rendered in mother or doctor dashboards after login; initial HTML placeholders are replaced by API data.
- Illustrations on mother and doctor welcome cards use project assets (`frontend/assets/mother-illustration.jpeg`, `doctor-illustration.jpeg`).


## Notification Center

`backend/notifications.js` (`GET/PATCH/POST/DELETE /api/notifications*`) computes
each mother's or doctor's notifications fresh on every request — due/missed
vaccines, low-weight growth flags, care-timeline items, and appointments — and
upserts them by a stable key so nothing duplicates. Requires
`child_dashboard_v2.sql` to be applied (see Database setup above).

## High-risk pregnancy assessment

Uses the UCI **Maternal Health Risk Data Set** (`backend/data/maternal_health_risk.csv`):
Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate → RiskLevel.

- At mother signup (when age + BP provided), risk is scored and stored on `mother_profiles`.
- Dashboard card: `GET /api/risk`, `POST /api/risk/assess` (k-NN k=7 + clinical thresholds).
- Defaults only when missing: BodyTemp 98.6°F, HeartRate 76 bpm, BS 7.0 mmol/L (documented in `riskAssessment.js`).

## Expanded mother registration

Collects DOB, address, blood group, pregnancy status, LMP/EDD, gravida/parity,
history, conditions, medications/allergies, height/weight, optional vitals.
If status is **delivered**, child name + DOB are required and a `children` row is created.

## Hospital workspace update

Open `/hospital.html` after starting the backend. The console now uses section-based
navigation, with Operations and Administration entry points, responsive styling,
and an actionable overview. Existing registry, clinic, documents, pathways and
audit tools remain available.

New server-saved coordination flows:
- Referrals: requested → accepted → transport arranged → arrived → completed.
- Discharge coordination: preparing → documents reviewed → follow-ups booked →
  handover confirmed → completed.
- Shift handovers: assigned → acknowledged → completed.
- Resource capacity: administrator-confirmed available units, owner and timestamp.

Each transition requires confirmation notes/evidence and the expected current
status, preventing stale clients from advancing the same record twice. Changes
are recorded in the existing audit history and atomic file-backed state. New
records start empty; they are not fabricated when loading fails.

These remain **demo workflows**: discharge newborn references are entered as notes,
not relational child links; referrals record staff confirmations rather than
contacting another hospital; capacity is manually confirmed. The existing
production authentication model, hospital membership, PostgreSQL migration,
staff invitation/deactivation, pathway approval/versioning and real external
communication integrations are not completed by this update. Keep the role
switcher limited to demo use. Do not use sample workflows for real patient data.

Validation: `npm test --prefix backend` covers existing hospital workflows plus
coordination validation, permissions, sequential transitions, stale updates,
resource validation and saved evidence/history. Browser visual QA is still
required before deployment.


## DAI hospital portal

The new Next.js/FastAPI hospital readiness portal imports the existing synthetic DAI dataset. See [hospital_portal/README.md](hospital_portal/README.md) for backend/frontend commands and [phase gates](hospital_portal/PHASES.md). Phase 1 local checks pass; PostgreSQL/PostGIS deployment acceptance remains pending. The existing `frontend/hospital.html` administration preview remains available through the Express backend.

## Child health

`child-dashboard.html` + `backend/childDashboard.js` + `shared/child-reference.js`
(shared with the browser via `/shared/…`):

- **Medical profile & health timeline** — birth details, blood group, allergies, notes;
  one newest-first timeline of births, vaccines, growth, milestones, medical history and
  appointments (`Ref.buildTimeline`).
- **Vaccination history & schedule** — India's Universal Immunisation Programme schedule
  (`VACCINES` in `child-reference.js`), certificates per dose. Reminders start 14 days before
  a dose (`REMINDER_LEAD_DAYS`), become "due" at 7 days, and "overdue" afterwards; state-dependent
  vaccines (PCV, JE) are never flagged. The schedule is a convenience, **not** medical advice —
  have a paediatrician review it before real-world use (a doctor may follow the IAP schedule).
- **Growth charts** — weight, length/height and head circumference plotted against the WHO Child
  Growth Standards (0–60 months, LMS tables in `shared/who-growth-standards.js`), with z-scores,
  percentiles, corrected age for babies born before 37 weeks, and screening flags in the
  Notification Center. WHO publishes boys and girls only, so profiles with sex "other" get no curves.
- **Developmental milestones** — CDC checklists from 2 to 60 months, per-checkpoint status, and a
  gentle "mention it at your next check-up" prompt (never a diagnosis).
- **Paediatric appointments & medical history** — appointments booked for a specific child
  (`appointments.child_id`) and a medical-history log (`child_health_events`); doctors with an
  appointment relationship see the history in `GET /api/doctor/patients/:motherId/children`.

Tests: `npm test` in `backend/` runs the unit tests. The route tests in `childHealth.test.js`
also run when `TEST_DATABASE_URL` points at a database with all migrations applied.


### Dr. Daya: animated English / Hindi care guide

Open **Ask Dr. Daya** from the shared sign-in, patient, doctor or hospital workspace. The panel renders the supplied full-body doctor with local Three.js assets, Idle and Talking FBX animations and repaired texture references. Enable **Voice** to hear a reply; the character gestures while speech plays. **Speak** accepts browser speech recognition where supported (microphone permission required); typed questions always work. Language selection applies to both recognition and read-aloud. Gemini provides the Charon male voice in English and Hindi when configured; no browser voice is substituted if Gemini fails. Set the backend API key as shown below. This is a 3D web assistant; headset VR and facial lip-sync are not implemented.

There are **40 curated FAQs in English and Hindi**, across app navigation, pregnancy milestones, medical terms, postpartum, child care, appointments, emergency/SOS, schemes, privacy and medical boundaries. Responses are deterministic, with official/clinical source links. Answer selection does not call an LLM or retrieve private patient records or invent appointments, pending tests, hospital availability or eligibility. Document/family permissions and unsupported flows are described honestly. Questions stay in page memory and can be cleared. When Voice is on, only the prepared answer and chosen language are sent through the backend to Google Gemini for speech; the speech endpoint rejects arbitrary text. The browser's speech provider may process microphone audio. Gemini audio is cached in bounded server memory; text remains available when voice generation fails, and a visible Gemini error is shown; there is no browser-voice fallback.

Danger signs bypass FAQ retrieval and return only **“Turant SOS dabaiye ya nazdiki hospital jaiye.”** in Hindi, or its fixed English translation. Medication changes, personal pregnancy safety and diagnosis requests have fixed refusals. Recognition is keyword-based; this is educational navigation, not a clinical triage service. Demo SOS does not dispatch real services.

`frontend/js/daya-knowledge.js` is the shared content source. `hospital_portal/web/scripts/sync-daya.cjs` copies only the assistant, model and renderer assets to ignored `public/daya/` before Next dev/build. The root launcher fingerprints these assets so future pulls rebuild the hospital copy. Docker Compose uses the repository root as the web build context to include them. Retain avatar attribution: **BrushDip**, *Doctor - Sketchfab Weekly - 13 Mar'23*, CC Attribution; details and modifications are recorded in `frontend/assets/dr-daya/CREDITS.md`. Three.js and fflate license notices are included.

Verify responses with `node --test backend/dayaAssistant.test.js` (also part of `npm test` in backend). Asset integration check: `node scripts/check-daya-assets.mjs`.


### Gemini male voice: API key setup

Edit `backend/.env` (create it if necessary); add these settings without replacing existing database or login settings:

```dotenv
GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Charon
```

Get a key from https://aistudio.google.com/apikey. The same Charon voice reads both English and Hindi; choose the language in Dr. Daya. The Express backend loads this file independently of the terminal working directory. `backend/.env` is Git-ignored. Never put this key in frontend files or a `NEXT_PUBLIC_*` variable. API access and quotas depend on your Google project.

Restart from the DAI root with `npm run stop`, then `npm start`. At http://localhost:3001 open **Ask Dr. Daya**, choose English or Hindi, enable **Voice**, then select a question. The status shows **Gemini · Charon · English/हिंदी** for actual Gemini audio. **Gemini voice unavailable** identifies a failure; the error is displayed and no default browser voice is used. The avatar talks during actual audio playback and returns to Idle at the end. Cancelling, changing language or closing the panel aborts pending speech and stops playback.

The default preview TTS model is configurable via the setting above if Google changes its availability. Only curated answers are accepted by `POST /api/tts`; it has a timeout, a request limit, bounded caching and WAV conversion. Test the integration without spending API quota using `node --test backend/dayaSpeech.test.js`; tests mock Google. A real audio check requires adding your key locally.
