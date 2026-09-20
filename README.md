# health-a-thon

## Database setup

`backend/server.js` implements the Care Timeline and Appointments features
(milestone seeding, timeline read/complete, appointment request/list/status
routes) against two tables — `care_milestones` and `appointments` — that
depend on the existing `users` table from the authentication system. Apply
them with:

```bash
psql "$DATABASE_URL" -f backend/db/care_timeline_and_appointments.sql
```

The script is idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
NOT EXISTS`), so it's safe to re-run.

## Mother dashboard

`dashboard.html` renders one of two dashboards depending on the signed-in role
(or the guest flag). The mother dashboard is a single-page shell — sidebar plus
nine sections, routed with `#/overview`, `#/timeline`, `#/tracking/kicks`, … —
and keeps guest mode (localStorage only, no network), the care assistant and
the 5-1-1 alert.

Apply, in this order (all scripts are idempotent):

```bash
psql "$DATABASE_URL" -f backend/db/auth_and_wellness.sql
psql "$DATABASE_URL" -f backend/db/care_timeline_and_appointments.sql
psql "$DATABASE_URL" -f backend/db/mother_dashboard.sql
```

`backend/motherDashboard.js` (hooked in from `server.js`) adds only what the
existing API lacked. Meals, water, supplements, contractions and baby growth
are still written through `/api/wellness/*`, and the doctor's continuity view
reads the same tables.

| Route (mother-only, own rows only) | Purpose |
| --- | --- |
| `GET/PATCH /api/profile/pregnancy` | read / set LMP or due date (re-times open milestones) |
| `PATCH /api/profile/contact` | phone + emergency contact |
| `GET /api/wellness/history?from=&to=` | multi-day view of the wellness tables |
| `DELETE /api/wellness/:kind/:id` | remove a nutrition / growth / contraction entry |
| `GET/POST /api/medications`, `DELETE /api/medications/:id` | medication *names*; "taken" is still `PUT /api/wellness/supplements` |
| `GET/POST /api/health-logs`, `DELETE /api/health-logs/:id` | blood pressure, weight, glucose, kick sessions |
| `GET/POST /api/reports`, `DELETE /api/reports/:id` | test / scan results |

`care_start_date` is the gestational day-0 anchor for the whole timeline
(milestones are LMP + N days), but registration defaults it to *today*. The
dashboard therefore asks a new mother to confirm her due date and records that
in `mother_profiles.pregnancy_confirmed_at`.

Known limitation: `contraction_logs.started_at` is a `TIMESTAMP` without a time
zone that holds the UTC clock time the client sends. `GET /api/wellness` and the
server-side 5-1-1 window (`NOW() - INTERVAL '2 hours'`) in `server.js` misread it
when the server/database time zone is not UTC. `GET /api/wellness/history`
reads it correctly; the existing routes have not been changed
