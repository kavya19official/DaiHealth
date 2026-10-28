# Population analytics

Doctor dashboard → Population analytics. Requires the existing verified-doctor gate. This is a network-level aggregate role capability, not the assigned-patient roster and not a patient-level drilldown. This update retains that existing access policy; it does not extend access to hospital, patient or unverified accounts.

## Sources and definitions

- **Unresolved past visits (estimate)** uses `appointments`: pending/confirmed past, non-cancelled doctor appointments divided by all past non-cancelled doctor appointments. This is not proof a visit was missed.
- **Recorded facility no-shows** uses `facility_appointments`: explicit `no_show` divided by past non-cancelled facility appointments. Pending/confirmed visits remain in the denominator, not the numerator. This source is separate; rows are never unioned with doctor appointments because there is no reliable common appointment identity for deduplication.
- **Referral completion** uses `facility_referrals`, grouped by receiving facility/district. Last 14 days excluded; completed status counts in the rate. Duration needs a valid completion timestamp between creation and report time. Invalid/missing timestamps do not produce a duration.
- **Time to follow-up** uses `missed_care_items` and the first `outreach_attempts` timestamp on/after flagging and no later than report generation. Last 7 days excluded. This measures an attempt, not successful contact or completed care. Attribution prefers the linked missed appointment; fallback is the latest appointment on/before flagging, with deterministic ID tie-breaking.

Appointment-date windows use Asia/Kolkata calendar dates: inclusive start, exclusive today. Timestamp cohorts use the captured report time and their documented settlement interval. Current data is reported as currently recorded, not a reconstruction of what staff knew at a historical point in time.

Missing facility attribution stays **No facility recorded**. The cohort originally imported doctor appointments without `facility_uuid`; that historical gap can therefore remain visible. No reassignment or guessed backfill is performed. Explicit facility codes use directory names; a historical UUID with conflicting clinician labels is shown as unmapped instead of choosing an arbitrary label. The SQL queries run in one repeatable-read transaction.

No care completion, no-show, referral, outreach or facility records are fabricated to populate an empty report. No model or AI request is used.

## Privacy and reports

At least 10 distinct people per group. Suppressed rows have only public group identity, suppression flag and reason. People are banded, raw patient/event counts are not returned, and no overall patient/event total is published. Rates use events, not unique people. Rates with fewer than 3 positive or negative events use broad bands. Medians require valid durations from at least 5 distinct people, in addition to the 10-person group gate. Repeated reports can still reveal changes: this is suppression/banding with audit, not differential privacy or a guarantee of anonymity.

`GET /api/analytics/metrics` returns supported definitions and fixed periods.
`GET /api/analytics/report?metric=…&group_by=…&window=…` validates the exact filter allowlist and returns the protected report, `report_id` and `expires_at`. Duplicate and unsupported filters are rejected. A view is audited before results are returned. Failed reads return an error, never a substituted empty result.

`GET /api/analytics/export.csv?report_id=…` downloads the exact displayed report. Query-by-filter exports are no longer supported; callers must first show a report. Snapshot access is bound to the requesting verified clinician; unknown, other-user and expired snapshots return the same error. Status changes after a view do not change that view's CSV. Export quota is five per rolling 24 hours, checked and audited under a per-user database row lock. CSV values retain suppression/bands and formula neutralisation. All responses use private/no-store. No API responses are added to a service-worker cache.

`analytics_report_snapshots` stores only the already redacted aggregate DTO for 15 minutes. Expired rows are rejected immediately and deleted on the next report request; there is no background cleanup guarantee. Snapshot ownership cascades on account deletion. Existing audit retention is unchanged. Raw medical records, identifiers, notes and row-level data are not copied into snapshots.

## Install and validation

Local launcher: `npm start` applies the additive `privacy_analytics_snapshots.sql` migration through the existing migration runner. Existing source records are untouched. For a separately managed PostgreSQL deployment, apply `backend/db/privacy_analytics_snapshots.sql` before deploying this module.

Run `node --test backend/privacyAnalytics.test.js backend/privacyAnalytics.integration.test.js` from the root with backend dependencies installed. Pure privacy/CSV checks plus real PGlite SQL/HTTP checks cover status definitions, period exclusions, missing attribution, historical follow-up location, invalid outreach timestamps, distinct-person medians, query validation, verification, snapshot isolation/expiry, exact export under data changes, audits and concurrent quota enforcement.

The frontend disables downloads when filters change, loads only on opening/explicit submission, and shows loading, error, empty, suppressed and missing-attribution states. Browser verification uses the real doctor HTML/CSS and these SQL-backed APIs, with unrelated workspace endpoints stubbed; checks include desktop/mobile layout, stale filters, exact CSV and error/empty states. No real patient data or paid provider calls were used.
