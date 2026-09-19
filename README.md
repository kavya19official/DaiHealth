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
