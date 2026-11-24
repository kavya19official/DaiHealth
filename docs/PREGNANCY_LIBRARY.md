# Digital Pregnancy Library

Open **My Pregnancy Library** from the Mother Dashboard home card or sidebar. The dedicated dashboard route is `/dashboard.html#pregnancy-library`. It includes a week-by-week timeline, a chronological memory gallery, private writing, letters and milestones.

The timeline follows the last menstrual period in the mother profile, or derives it from the estimated due date when needed. Week 1 begins on the first day of that date and Week 40 ends just before the standard 40-week estimate. After Week 40 the current-week indicator stays at Week 40 until the profile changes. Birth has its own chapter. The downloaded dates or ultrasound tags never establish a clinical result. Actual appointments and pregnancy care milestones are read from their existing tables. Personal milestone dates are clearly attributed to the mother. A delivery date from the existing postpartum record is labelled as a care-record date. The account can switch to previously saved journeys when a later pregnancy is recorded. Large date corrections can produce a separate episode, so both sets of entries remain accessible. Existing dashboard journal entries still open under the original home journal.

Weekly developmental context is educational and follows the [NHS pregnancy guide](https://www.nhs.uk/best-start-in-life/pregnancy/week-by-week-guide-to-pregnancy/) and [ACOG’s fetal development overview](https://www.acog.org/womens-health/faqs/how-your-fetus-grows-during-pregnancy).

## Local setup and demo

Use Node 22.13+ and the regular DaiHealth launcher from the repository root.

```sh
npm start
```

For an optional populated demo using the existing local synthetic cohort, start with:

```sh
DAI_PREGNANCY_LIBRARY_DEMO=true npm start
```

Open the gateway address printed by the launcher, usually `http://localhost:3001`. Sign in as `mother-syn-0000085@dai-synthetic.invalid` with the synthetic password printed by the launcher. The seed only runs with the explicit flag and local demo settings. It verifies the seeded cohort linkage and only initializes an empty library. The library labels this journey as containing sample entries.

For an existing PostgreSQL deployment, apply the migration before starting the updated gateway.

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/pregnancy_library.sql
```

## Storage and access

The library uses the existing DaiHealth database. `pregnancy_library_journeys` stores episode dates, `pregnancy_library_entries` stores notes by kind, `pregnancy_library_media` stores attachment bytes, and `pregnancy_library_moments` stores personal milestone dates. Composite foreign keys enforce ownership across records and cascade attachment deletion. Entry and attachment changes commit together. Per-account locking enforces concurrent quota and edit revisions.

Serve the dashboard and library API from the same DaiHealth gateway. It authorizes every request, including video byte ranges. The files have no public URL, share link or service-worker cache. They live outside the clinical document system. The owner can download their stored media through the authenticated viewer. Use the existing production PostgreSQL connection with TLS, encrypted disks/backups and backups that include this schema. Backup retention is the deployment's PostgreSQL retention policy. No additional bucket, signing key or upload service is required.

JPEG, PNG and WebP photos are stored as re-encoded WebP up to 2400 px on the longest side. This strips image metadata. Videos use native playback for progressive H.264 MP4 uploads. Video files retain their original bytes and any embedded metadata. The library supports up to eight attachments per memory, 6 MiB per incoming photo, 20 MiB per video, and 32 MiB per save request. Limits are 300 entries and 120 MiB of stored attachments per account. The personal library is online-only.

## Gateway routes

All paths below start with `/api/patient/pregnancy-library` and require a current mother session. Writes use the same-origin library request header.

| Method and suffix | Purpose |
| --- | --- |
| `GET /summary` | Current or latest journey and dashboard counts |
| `GET /` | Journey, entries, attachment metadata, milestone dates and linked care dates |
| `POST /entries` | Create an entry and atomically save any attachments |
| `PATCH /entries/:id` | Edit an entry and replace, remove or add attachments using its current revision |
| `DELETE /entries/:id` | Delete the entry and its attachments using its current revision |
| `PUT /moments/:code` | Add, edit or clear a personal milestone date |
| `GET /media/:id` | View, play or download an owner-authorized attachment |

## Verification commands

```sh
node --test backend/pregnancyLibrary.test.js
npm test --prefix backend
npm run build --prefix hospital_portal/web
DAI_EXPECT_LIBRARY_DEMO=true python hospital_portal/tests/pregnancy_library_browser.py
```

The browser check needs Playwright and Chromium against a running synthetic deployment. Set `DAI_TEST_CHROMIUM` with a custom Chromium executable or install Chromium with `python -m playwright install chromium`. `DAI_TEST_URL`, `DAI_TEST_PATIENT` and `DAI_TEST_PASSWORD` can override the test defaults.
