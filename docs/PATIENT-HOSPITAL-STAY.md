# My Hospital Stay

Patient-facing, read-only nursing-summary view in the existing patient dashboard. It preserves the lavender theme, stage banner and SOS button.

- Sidebar appears only for an admission or within its configured post-discharge window (default 7 days, 0–30 configurable per stay).
- Home strip appears only during admission; after discharge the page becomes a stay summary.
- Mother and babies have separate tabs keyed by child ID. No missing values become zero.
- Vitals trends, medicines given, feeding, daily weight, phototherapy, kangaroo care and clinician handovers show only released records. Missing content is explicitly labelled.
- Every published entry carries recorder, verifier, releaser and timestamps. Corrections append a replacement referencing the original; history retains the original.
- A hospital-stay link appears in Care Timeline. The fictional discharge fixture creates one follow-up in the existing milestones table, which feeds Pending Care.
- Patient questions are private saved discussion notes, not nurse messages or an emergency channel.

## Data boundary

`GET /api/patient/hospital-stay` is authenticated and mother-only; ownership comes from the session, never a submitted patient ID. Reads are logged. Only verified/released entries whose publication times have passed are returned. Child ownership is checked independently. Measurement JSON is allow-listed, excluding internal alerts and scores. Responses are `no-store` and never put in the offline shell cache.

`PUT /api/patient/hospital-stay/sharing` stores a separate caregiver-sharing preference, default off. **Caregiver authentication and access to this new resource are not connected.** The consent UI says this explicitly; the preference grants no access. Clinical chart values have no patient write endpoint.

## Prototype boundary

The local seed adds one explicitly synthetic recent discharge summary for Nivara, with separate twin updates and an unreleased draft to demonstrate filtering. It does not change an actual hospital bed or census. This is a simulated patient display, not a connected live nursing chart system. Nurse entry, reviewer identities backed by staff accounts, clinician release controls and admission-system integration remain to be connected before real hospital use. There is no automatic delay-based release in this prototype; review and release timestamps must both exist.

When no nurse telephone is configured, Call nurse explains using the bedside call bell. It does not claim to notify staff. After discharge, Contact care team points to the discharge paperwork.

## Run / test

`npm start` applies `backend/db/hospital_stay.sql` and the additive one-time fixture. It preserves existing edits and prior prescriptions.

`node --test backend/patientHospitalStay.test.js backend/patientHospitalStayUI.test.js backend/patientRecordSeed.test.js`

Checks include owner isolation, unverified filtering, foreign-child exclusion, correction history, no raw alert fields, expiry, admission vs discharge, read-only values, question ownership and consent validation.

## Pictorial view

The patient page uses inline SVG charts for released BP (both values), pulse, temperature and baby weight. A single reading appears as a labelled dot, not an invented trend. Missing measurements have illustrated empty states. The daily activity bars and category ring count records; they are not health or recovery scores. Daily buckets use the same local calendar as the displayed times. Corrections replace the original point in charts while preserving it in the history. Medicine / feeding timelines show timestamps, category icons and expandable provenance. Graph values are also available as text, and animation respects reduced motion.
