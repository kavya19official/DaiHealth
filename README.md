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
psql "$DATABASE_URL" -f backend/db/hospital_platform.sql
```

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
5. Child dashboard (`child-dashboard.html`) uses `/api/children` (per-child vaccination schedule with certificates, growth with a WHO weight-for-age reference, CDC developmental milestones, and a profile photo — `backend/childDashboard.js` + `shared/child-reference.js`, the schedule shared with the browser via `/shared/child-reference.js`). Mothers can only access their own children.
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
