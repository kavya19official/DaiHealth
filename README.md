# DaiHealth (दाई)

Connected maternal and paediatric care — mother, doctor and hospital workflows on one continuous record.

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
