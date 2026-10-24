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
psql "$DATABASE_URL" -f backend/db/facility_discovery.sql
psql "$DATABASE_URL" -f backend/db/facility_freshness.sql
psql "$DATABASE_URL" -f backend/db/delhi_directory.sql   # Delhi facility directory (unverified reference data)
psql "$DATABASE_URL" -f backend/db/referral_continuity.sql
psql "$DATABASE_URL" -f backend/db/patient_experience.sql
psql "$DATABASE_URL" -f backend/db/patient_home.sql
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


## Patient dashboard layout and controls

The patient workspace keeps DAI’s purple palette and now uses a persistent stage
banner, one next-step card, a calendar, a care timeline, a clinician-only health
snapshot and separate navigation for records, children, nearby care and consent.
The stage switches after a recorded delivery. Old ANC gaps remain in history and
are not promoted as the current postpartum action. Missing postnatal records
prompt a catch-up review; they do not imply a new diagnosis.

Appointment rescheduling and cancellation are scoped to the signed-in mother.
Uploaded report access can be disabled globally or revoked per doctor. Family and
ASHA switches are disabled until an account is linked; this prototype does not
pretend those accounts have been granted access. A data export contains the
patient’s records and report metadata, not report binaries or passwords. Account
deletion is a password-confirmed request for review, not an immediate purge.

In local mode the clinician snapshot reads the same seeded cohort as the hospital
portal via its explicit user/source mapping. It only includes ANC measurements
linked to verified synthetic clinicians. Self-entered notes remain in Records.
There is no clinician glucose source in this seed, so glucose stays empty. In a
non-local deployment without that mapping, the snapshot remains empty rather than
inventing readings. Apply `patient_experience.sql` after existing migrations.

The device can cache a minimal timeline and stage in IndexedDB. Reports,
passwords and API responses are not cached by the service worker. Offline
completion is labelled waiting-to-sync, and is sent only after the same account
reconnects (or reload after the server returns). Sign out or disable offline storage to clear saved care data. This
cache is intended for a trusted personal device. Registration and other server
operations still require a connection.

The main navigation includes English, Hindi, Marathi, Tamil and Bengali labels;
secondary forms and clinical content currently retain English/the author’s
original wording. This is partial localization, not a claim of full translation.
Page read-aloud uses available device voices; Dr. Daya remains Gemini-powered in
Hindi and English. Reminder channel and quiet-hour preferences are stored, while
external SMS/WhatsApp delivery and delivery scheduling remain unconnected.
Scheme cards link to official PM-JAY, JSY and PMMVY information and do not
calculate eligibility. Confirm eligibility and document requirements officially.

Verification: `npm test --prefix backend` includes patient stage, care-gap,
clinician-source and isolated database/API tests for ownership, rescheduling,
report-sharing controls, export and deletion requests. `npm run test:local`
checks the unified local authentication/gateway flow.


### Warm patient home

The home page now includes original, generated illustrations for pregnancy,
postpartum with a linked baby, and neutral self-care when no baby is linked.
The default purple palette is unchanged; dark mode is an explicit preference.
The journey card uses recorded dates, shows separate baby tabs, and generates a
shareable card containing a stage/age only, without patient names or identifiers.

Daily checklist ticks and mood notes are self-reported and stored per mother/date
in `patient_daily_checkins`. A streak counts consecutive days with all four items
checked, and is not a health score. Mood is not a screening result, and does not
send a clinician alert. Postnatal screening remains in the existing recovery
module. Journal notes and optional photos are account-scoped; photos use the
existing authorised document store and are not automatically shared. Feeding and
sleep logs are scoped to both the mother and selected child, reject pre-birth
entries, and are not feeding assessments. The export includes these new records.
Personal logs require a connection; offline timeline support is unchanged.

Quick actions and the Ask DAI text/voice entry open the existing functional
workflows. Card read-aloud uses device voices; Dr. Daya keeps its Gemini voice.
Reduced-motion preferences suppress celebration animation. Charts only render
when recorded measurements exist. No token number, clinician call channel, ASHA
link, caregiver access or hospital-ready acknowledgement is invented. The home
shows unconfirmed readiness for clinician-flagged cases until a real confirmation
flow is connected. Family account invitations remain unconnected; report-sharing
controls work in Family & consent.

Education cards link to NHS/NHS Inform or WHO primary sources. Approximate fruit
comparisons are currently curated for weeks 26 and 28 only; other weeks show a
stage-based learning card, not an invented size measurement. These are general
education and not an assessment of any fetus. Main navigation remains partially
localized as described above; much of the new editorial home copy is English.

Original illustration assets are in `frontend/assets/patient/` (generated with
the built-in image generator; fictional people, no stock patient photographs).
`backend/db/patient_home.sql` is applied automatically by `npm start`. Hosted
PostgreSQL deployments must apply it after `patient_experience.sql`.


### Visual care journey and voice latency

Care Timeline now displays the existing API milestones on a winding path, grouped
into trimester chapters and followed by the recorded postnatal schedule. Filter
chips, a week jump slider, compact view, read-aloud, a recorded-completion ring,
chapter summaries, high contrast, reduced-decoration low-bandwidth mode and a text recap download are available. The baby lane derives
vaccination dates from the shared child schedule and switches children without
mixing their records. Dark/large-text and offline timeline support are preserved.

The Plan / Booked / Result / Done strip only fills booking/result steps when an
explicit record link is present. Self-reported completion does not imply verified
results or clinical clearance. While the timeline is open, recorded milestones refresh every 30 seconds; changed completion records trigger the gentle celebration. No unrecorded clinician checkpoints, provider
verification badges, family access or hospital-ready acknowledgements are
invented. Full milestone-linked attachments, per-stop voice notes, caregiver
accounts, automatic hospital result linkage and a shared doctor path remain
future integration work. Current doctor records keep using the existing API.
Journey educational week content and shareable cards remain available from Home;
the timeline does not fabricate weekly medical facts or award unearned badges.
The new journey copy is currently English; card read-aloud uses device voices.

Dr. Daya keeps Gemini/Charon in English and Hindi. Approved FAQ audio is cached
in memory and under `.local/tts-cache/` (ignored by Git), keyed by model, voice,
language and the exact approved text. It survives restarts. Identical requests
share one upstream generation. The widget caches twelve recent audio clips and
prepares a question’s approved answer on focus/hover only when voice is on.
It also prepares an already-recognized FAQ answer after a typing pause (voice on, at most one draft warm-up per eight seconds). Only the approved answer goes to Gemini, not the typed question.
It never sends patient records, silently switches voices, or generates the full
FAQ catalogue in the background. A first uncached response still waits for the
configured Gemini 2.5 TTS generation; streaming/model migration is not claimed.
Stopping or changing language cancels playback, while an in-flight approved clip
can finish caching. Gemini errors remain visible. `DAI_TTS_CACHE_DIR` can change
the cache directory; voice/model changes use separate entries.

### Connected patient appointments, reports and health folder

The patient Appointments page now requests time windows against the hospital's configured unit OPD weekdays and room. It defaults to the assigned doctor, supports an explicitly selected baby, Upcoming/Past/Cancelled views, calendar downloads, and reasoned reschedule/cancellation requests. Duplicate windows and doctor daily limits are checked inside the appointment transaction. A request remains pending until the doctor confirms it; no live token or queue position is invented.

`backend/continuity-config.json` holds the demo request-window length, booking horizon and fallback hours. Unit weekdays/rooms come from the hospital configuration; matching synthetic doctor schedules supply session times where available. Fallback hours and the request-window length need verification with a partner clinic. Local requests are mirrored through a durable outbox into the hospital workspace, using its existing unit/cohort access controls and read audit. This bridge is for the local SQLite/PGlite prototype; it is not a verified PostgreSQL/PostGIS production integration.

Reports support original PDF/image previews, download, date/category/subject filtering and search. Self-uploaded files can explicitly link a mother milestone and record completion **awaiting clinician verification**. Baby uploads cannot link to a mother milestone. Private screenings are redacted until the owner explicitly reveals them. Sharing is limited to connected doctors, requires explicit consent for sensitive reports, expires within 30 days and can be revoked immediately. The global doctor-sharing preference still blocks per-report shares. Metadata reads, previews, downloads, consent changes and review actions are logged. Unreviewed uploads never receive a hospital-verification badge.

On the doctor Records page, **Consented patient reports** displays only active shares and offers a manual, registered-clinician review form. Saving the review records the clinician note and verifies the explicitly linked milestone. There is no automated clinical interpretation, dose advice or OCR extraction. This is a clinician-review workflow, not a live LIS/PACS connection.

The patient Health folder groups pregnancy, delivery, recovery, history and separate baby records. Birth details map through durable child IDs, never through twin array order. Emergency summary and per-child vaccination cards can be printed or saved using the browser's PDF printer. Profile-entered history is distinguished from hospital-source data; missing allergies or conditions are shown as **not recorded**, not as “none”. No report files are cached offline.

ABHA linking, teleconsultation, a unified cross-hospital access ledger, live tokens, caregiver/facility sharing links, transport booking and external reminders are not connected. Their panels explain the limitation. Full ABDM sync, OCR and claims remain roadmap items. Original files remain in ignored local storage; no patient report or its numeric results are sent to the assistant/TTS provider by these screens.

## Access-aware, explainable Find Care

In the patient dashboard open **Find Care**, select the required service and any
required capability, then set access preferences: travel radius, language,
appointment date/time (IST), service-fee budget and transport difficulty.
**Find suitable care** ranks eligible facilities and explains each component of
its preference score. Required service, capability and accessibility are hard
filters; a cheaper or closer unsuitable facility cannot enter the shortlist.
Widening the search never silently drops these requirements.

- Preferences influence ranking by default. **Only show confirmed preference
  matches** excludes unknown, unmet or partially matching preferences.
- The score is earned points / possible points × 100. Normal weights are travel
  30, language 20, reported availability 25 and stated budget 25; only requested
  language/budget/distance signals are included. Transport difficulty increases
  the travel weight to 45. Unknown information earns zero. The card discloses all
  component weights and points. This is not a clinical safety or quality score.
- Distance uses coordinates supplied with permission and is straight-line, not
  road travel time. City/PIN entry is not geocoded or used to infer affordability,
  transport difficulty or personal characteristics. Without coordinates, distance
  remains unknown and the limit is explicitly unconfirmed. With coordinates,
  facilities with unknown distance or outside the radius are excluded.
- Costs use a sourced, dated fee range for the selected service. Missing costs
  are unknown, never assumed free. Partial overlap with the patient's budget is
  labelled. Other charges/insurance coverage are not inferred.
- Timing uses future reported service slots with available places; opening hours
  are not treated as confirmed appointments. Matching does not reserve capacity.
- **Remember my preferences** explicitly saves only these stated preferences in
  the existing patient-preferences record. Coordinates stay in the existing
  separate location workflow. **Clear access preferences** preserves the selected
  required service and capability. Both the dashboard and `/facilities.html` use
  one shared implementation, including the existing appointment-request dialogs.

Root `npm start` applies `backend/db/access_matching.sql` after the existing
facility migrations. Hosted PostgreSQL deployments must apply that migration too.
It adds optional service fee evidence and reported service slots; existing facility
and patient records are retained. Real listings without the new evidence show
unknown costs/availability until that information is provided. The hospital portal
and patient directory remain separate stores; this change does not claim live
synchronisation between their service/slot editors.

In explicit local mode the launcher inserts six clearly labelled synthetic access
examples once; it never overwrites later directory edits. Five offer obstetrics,
but only four meet the high-risk capability gate. The sixth is a vaccination
example. One eligible example intentionally has no price/schedule evidence.
Search **New Delhi → Obstetrics → High-risk pregnancy**, with Hindi, an afternoon
three days after first setup, and a budget up to ₹1,000. Coordinates around
28.6139, 77.209 can be used in browser automation for this synthetic scenario;
users choose whether to share their own device coordinates. These are fictional
providers and fees, not a real Delhi directory. Saved demo slots expire normally.

Checks: `npm test --prefix backend` includes matching gates, preferences,
unknown/partial evidence, IST timing, transport weights and actual PostgreSQL
queries through PGlite. Browser checks cover both patient entry points, preference
persistence, strict matches, changes in ranking and mobile overflow.

### Little worlds: baby, recovery and Nearby Care

The patient workspace keeps the existing DAI purple palette. The child page now
has illustrated/photo avatars, distinct sibling accents within the same theme,
a calendar-age hero and a time-based ring toward the next vaccine due date.
Each child has its own vaccine passport, recorded-dose stamp animation, PNG
export and optional device share, dated keepsake notes and feed/sleep logs.
The side-by-side view shows independent records, not a development competition.
Original photo uploads and add-child forms remain available. Memories use the
existing child-owned health-events API; feed/sleep notes use the owned personal
log API. Photo and voice attachments to memories are not connected. A keepsake
export intentionally includes the child's name/DOB only after the user opens
its export flow. It is not a clinical vaccination certificate.

Postpartum has Mother/Baby lanes, a six-week time ring, the existing postnatal
follow-ups and private mood notes. Passing day 42 never claims recovery is
complete. A welcome moment can be replayed; automatic display requires a linked
hospital-source delivery in the first 42 days and is remembered once per account
and delivery on that device. No diagnosis, mood-triggered notification, lactation
staff contact channel or caregiver access is invented. The existing clinical
check-in and emergency flow remain available below the recovery scene.
Growth uses the existing WHO reference data and recorded measurements, with
neutral wording. New editorial copy is primarily English; card read-aloud uses
available device voices. Full regional localization and clinician-reviewed
education authoring remain future work.

Nearby Care places the existing directory search results on a Leaflet map with
custom markers, clustering, category chips, a radius control and an accessible
button/keyboard/pointer-operated bottom sheet. Required clinical service and
capability filters stay in the existing matching API. The pending-care shortcut
suggests a service category; patients must confirm that the exact test is offered.
The new map never claims live readiness or free government services without
source evidence. Emergency chips only filter an explicit `emergency_24x7`
directory field; they do not replace SOS or rank hospitals by a fabricated ETA.

Map dependencies are vendored (Leaflet 1.9.4, MarkerCluster 1.5.3) with their
licences under `frontend/vendor/leaflet/`. OpenStreetMap attribution remains
visible. Tiles load on demand and are not bulk-prefetched/offline-packaged.
`window.DAI_MAP_TILE_URL` can select another compatible tile provider. The list
still works when tiles fail. Route preview sends coordinates to public OSRM only
on an explicit request, labels its modelled estimate without live traffic and
falls back to a dashed straight line with no ETA on failure. Directions opens
the user's maps app. Geolocation is explicitly requested for the current search;
Save location now saves area fields without coordinates. Previously stored
location records are retained until the user changes/saves their area. PostGIS,
live hospital readiness sync, moderated reviews, offline map packs and automatic
emergency routing are not claimed by this interface update.

Check `node --test backend/littleWorld.test.js` for date/age boundaries, vaccine
ring sources, missing coordinates, emergency filtering, separate sibling renders
and recovery wording. `npm test --prefix backend` includes it alongside the
existing ownership and patient/hospital continuity checks.

### Companion presentation: Dhruv

The visible AI companion is now named **Dhruv**, without a clinician title.
The header and launcher identify him as an AI care companion; the introduction
states that medical decisions belong to the real clinician. The frontend adds
softer reply cards, optional slow playback (0.85×) and a replay button on each
answer. This reuses the existing approved English/Hindi responses and Gemini
Charon audio. The avatar, camera, FBX model, textures and animation files are
unchanged; internal `daya` asset paths remain for compatibility. No new diagnosis,
report interpretation, conversational memory, lip-sync or live handoff capability
is claimed. Hospital public assets are copied by the existing sync script.

### Support, consent and the patient inbox

Schemes & support now offers seven official information pathways with category
chips, a horizontal card shelf, a guided conversation checklist and private
preparation steps. `patient_support.sql` and `patientSupport.js` persist each
mother's step/document ticks and optional app-reminder date. Steps are explicitly
self-reported; they do not submit an application, prove eligibility or unlock a
payment. The short questionnaire does not reproduce all scheme criteria and
returns only “Might be eligible” or a help-desk next step. Answers are not saved.
Source URLs and a 24 October 2026 review date appear with the catalogue. No scheme
ID or official deadline is invented. The personal wallet is a checklist summary.

The camera/file action saves an original privately through the existing document
API, with `is_sensitive=true`, no report milestone and no automatic sharing.
There is no OCR or identity verification. Help requests are private journal notes;
ASHA/care-team messaging, official office locations, group directories and benefit
application APIs remain unconnected and are described as such in the UI.

Family & consent has a sharing circle based on *effective uploaded-report shares*,
not emergency contacts or family assumptions. The working global pause, per-report
revocation and existing explicit/sensitive/expiring doctor-consent flow remain in
force. Family, ASHA and invitation previews never grant permissions. Legacy
hospital records follow hospital access rules, separately from uploaded reports.
Report file access/consent events are exposed only to their owner; sensitive names
stay redacted. This is not a complete cross-hospital access or break-glass ledger.
Export includes the support checklists. Password-confirmed deletion still creates
a review request rather than erasing retained clinical records.

Updates reads the actual notifications API, groups by day in India time and has
category filters, read/read-all, archive and persisted 24-hour snooze. Danger-level
items cannot be snoozed and bypass a prior snooze if severity changes. Report-review
updates require an actual `reviewed_by` value. Scheme reminders use only dates the
mother chose and are labelled as personal reminders. No invented hospital sender,
verified facility message or weekly performance percentage is rendered. The ring
summarises actual timeline completion. Per-message read-aloud uses device voices.
SMS, WhatsApp, voice-call delivery and caregiver copies remain unconnected.

Published call links are checked against official WCD, NHA and MoHFW/PIB listings:
112, 181, 1098, 14555 and general mental-health support via Tele-MANAS 14416. Sources
are available beside every number. External availability can change; reverify the
catalogue before a real deployment. English/Hindi category labels are included;
longer editorial copy remains primarily English. Existing dark/large-text settings
and reduced-motion preferences are respected. No report files, consent histories
or support answers are cached by the service worker.

Checks: `backend/patientSupport.test.js` covers conservative guidance, actual
care-team schema rendering, effective recipient counts, account/role isolation,
checklist validation, notification snooze persistence and danger-level bypass.
Hosted PostgreSQL deployments must apply `backend/db/patient_support.sql` after
the existing patient migrations; the local launcher applies it automatically.

### Shared pregnancy illustration and clinical dashboard

The patient Home and a selected doctor's patient Timeline now share a dashboard
with an on-demand Three.js viewer, record hotspots, source-separated Hb/BP/weight/
glucose cards, dated trends, clinician-entered targets, care-plan adherence, a
week/month appointment strip and Pending Care links. Missing targets, tokens,
pulse, scan notes and lab ranges remain missing. Readings never receive an
algorithmic good/bad verdict or risk score. Only existing clinician-validated
status is shown. Source/dates accompany clinic entries; self entries stay separate.

The supplied `output.fbx` (copied as `assets/pregnancy/uterus.fbx`) contains one
static 61,635-vertex mesh and no animations. It is not a separable fetal-growth
model. The Uterus tab shows the supplied anatomy and texture without deforming
it; the week slider switches to a separate procedural, stylised baby illustration.
Its qualitative scale is **not a fetal size lookup, scan or development simulation**.
Postpartum defaults to a separate recovery illustration. Conceptual hotspots
organise records; their positions do not locate a scan finding. Rotate, pinch/zoom,
reset and browser-supported fullscreen are available. Save-data/low-memory devices
use an SVG fallback with manual 3D loading. The FBX is about 2.4 MB plus a 1.4 MB
texture, not a claimed sub-3-MB combined download. No external model service is
used. Licence/creator information was not supplied; see the asset README before
redistributing the supplied files. Existing Dhruv assets are unchanged.

`clinical_dashboard.sql` adds clinician entries/plans, patient adherence and an
explicit expiring consent for this new clinical-summary view. It is separate from
uploaded-report sharing and does not share files or child records. Patients can
choose a verified connected doctor for 1, 7 or 30 days, or revoke access from
Family & consent. A doctor needs the doctor role, recorded clinical credentials,
verified status, an appointment relationship and an unexpired summary consent to
read or write. In local mode verified status comes from the existing hospital
source mapping; hosted deployments must establish `credential_verified` through
their credential-verification process, never from a self-entered licence alone.
No summaries are auto-shared by the seed. Every new clinician read/write and
consent change is audit-logged. Revocation is enforced on every request.

Verified clinicians can manually record measurements, clinic-scan notes/heartbeat,
targets and care-plan instructions. Heartbeat and scan notes require an explicit
clinic-scan source; an ANC fetal-heart-rate value is not silently called a scan.
The patient can record today's adherence only for their own clinician plan.
The two pages refresh the same records using 30-second polling, not WebSockets.
No automatic diagnosis, prescribing, high-risk assignment, investigation ordering,
new referral or hospital-capacity reservation is introduced by this dashboard.
Readiness remains explicitly unconfirmed until a resource integration provides it.

Routes: `GET /api/patient/dashboard`, `PUT /api/patient/dashboard/consent`,
`PUT /api/patient/dashboard/plan/:id/today`, and the connected clinician's
`GET /api/doctor/patients/:id/dashboard`, `POST .../entries`, `POST .../plan`.
The local launcher applies the migration; hosted PostgreSQL needs it applied after
existing patient migrations. Tests in `backend/clinicalDashboard.test.js` check
provenance, dates, role/relationship/verification/consent gates, revocation,
cross-patient isolation and doctor→patient data/adherence continuity.

## Verified document intake and protected offline care

Doctor → Records → Consented patient reports → **Extract & verify fields** opens the original beside an editable extraction draft. Printed English image reports use local OCR; PDFs use embedded text from the first five pages. Scanned PDFs, HEIC, handwriting and unreadable content require manual transcription. Missing units and ambiguous dates must be checked against the original. Extraction alone writes no clinical record. An actively consented registered doctor must confirm the source and every included value/unit. Saving appends a version and an audit event; it does not generate diagnoses, risk scores or automatically complete milestones. Patients see verified versions under Records → View report. Prototype clinician registration uses the existing account license field; it is not an independent credential registry.

Patient → Settings → Reading & offline → **Set up protected copy** requires online sign-in, a private-device acknowledgement and a separate passphrase of at least 12 characters. Essential appointments, recorded doctor instructions and the care timeline are encrypted in IndexedDB using AES-GCM and PBKDF2 (400,000 iterations). Reports, extracted values, tokens and passwords are excluded. The copy expires after seven days and locks after five minutes idle or one minute in a hidden tab. Signing out or deleting the copy removes unsynchronised changes. A forgotten passphrase is unrecoverable.

Offline only timeline self-reported completion can be queued. Synchronisation requires the same signed-in account, is idempotent and refuses changed or clinician-verified milestones. Conflicting updates can be discarded from Settings after checking the online timeline. Bookings, clinical data, consent changes and report uploads require a connection. Low-bandwidth mode hides illustrations and skips Dhruv's 3D import while retaining text chat. Browser encryption does not protect an unlocked page from compromised scripts or device access.

`npm start` applies the new migration locally. For an existing PostgreSQL deployment, apply `backend/db/document_intake_offline.sql` after the existing migrations before restarting the backend. Run `npm test --prefix backend` and `npm run test:local` for checks.

### Doctor workspace redesign

`doctor.html` now uses the shared DAI wordmark and the existing purple palette
with an icon sidebar, responsive main grid, reported-capacity rail, calendar,
record-based charts and a searchable assigned-patient table. Open the Doctor tab
on the shared sign-in page. Search supports available synthetic name, UHID, ABHA
and phone fields, with Ctrl/Cmd+K focus. Views cover clinician-marked shared
summaries, due in 14 days, postpartum, child appointments and overdue Hb follow-up.
The role/unit controls describe the authenticated assignment; they do not permit
self-elevation or arbitrary unit switching. Theme and self-reported presence are
device preferences. No new messages, prescriptions or reservations are sent.

`GET /api/doctor/workspace` requires verified credentials and returns only the
appointment-linked roster, recorded care milestones, the clinician's appointments,
and permitted report metadata. Revoked/expired/global-paused report shares are
excluded. No private report contents or result values enter this dashboard.
Clinician flags require the new summary consent and a verified recorded validator;
withheld summaries are shown as Not shared, never low-risk. Every returned patient
roster/report-metadata read and patient-timeline open is audit-logged.

Local mode reads the doctor-linked facility's ward/bed and latest blood snapshots
from the hospital database. Capacity is a *reported snapshot*, not proof of live
readiness, stock reservation or acceptance. Incoming records are limited to the
assigned panel; ETA and case readiness remain unconfirmed. Empty on-call rosters
and unavailable resources are not filled with fake clinicians or values. The UI
polls every 30 seconds while visible; it does not claim WebSocket delivery.

Appointments use recorded statuses, without guessing arrival, waiting time,
no-shows or tokens. The completion ring counts completed/all recorded milestones;
charts use actual completion dates. EDD counts are not ML forecasts. No unit
target, week-over-week improvement, risk score or forecast is fabricated.
The older unauthenticated demonstration panels are kept separate from the
authenticated dashboard; an empty authenticated roster stays empty. Tests cover
record-derived totals, filters, date boundaries, access denial, scope and auditing.
Browser preview is needed for final layout review on target devices.

### Doctor studio: operational views and queue

The doctor workspace now adds Table/Cards/Stage roster views, field filters,
explicit-consent quick views, selected-roster export, Day/Week/Month/List unit
planner, queue lanes, reviewable worklist, protected results inbox, due-date
columns, reported ward bed tiles, incoming-case list, message-template previews,
transparent metrics and device display preferences. Purple/lavender tokens are
preserved; status text/icons use sage, amber, coral and lavender-grey. Animations
are 300–350 ms and reduced-motion is respected. No counts or activity are invented
to populate empty views. Children’s clinical records and unshared lab values are
not pulled into the roster. A shared maternal summary does not grant child access.

`doctor_operations.sql` (applied by the local launcher after existing migrations)
adds separate queue state, worklist actions and immutable operational events.
`POST /api/doctor/queue/:id` requires a verified doctor, their own appointment,
today’s date, an allowed state transition and the current version. A doctor can
have one active consultation. Completed consultation notes update the existing
appointment; the hospital bridge is queued. Check-in/no-show state is explicitly
staff-recorded and does not guess arrival. No new appointment is seeded today just
to fill the queue. Use the date picker or the next-booked-date shortcut to explore.

`POST /api/doctor/worklist/:id` requires an assigned milestone and a written
reason. Review/dismiss/reopen affects the doctor’s worklist only, never clinical
completion. `GET /api/doctor/activity` exposes only the authenticated doctor’s
recorded reads and actions. The results inbox rechecks active shares and uses the
existing clinician-review endpoint; no bulk sign-off is added.

The following remain explicitly unconnected rather than pretending to work:
message delivery/read receipts/voice notes, family and ASHA threads, AI-companion
handoffs, bulk reminders/bookings, new orders, walk-in intake, draggable surgery
changes, shift swaps, individual readiness confirmation and reservations, bed
mutations, predicted bed release, ambulance GPS/routing/ETA and operational ML.
Templates are previews only. EDD bands are recorded dates, not forecasts. Roster
sorting is deterministic and explained, not called ML. Ward tiles are not a
measured architectural floor plan. Status refresh is 30-second polling, not a
live socket. Hospital administration remains authoritative for resource changes.

### Doctor clinic activity

The local launcher additively seeds a linked clinic scenario for existing synthetic doctor–mother assignments: recent and upcoming ANC appointments, today’s queue states, completed follow-ups, clinic measurements and downloadable PNG reports. This runs once (`doctor-activity-v1`) and preserves existing edits, deleted files and revoked consent. Summary/report shares are scoped to the already assigned fictional clinician; patients without summary sharing remain visible only within the existing coordination permissions. It does not create risk labels, change hospital beds, or claim live readiness. Generated report files stay in the ignored local document store and regenerate on a fresh setup. The doctor dashboard uses local illustrations and the existing pregnancy artwork, with no external image service.
