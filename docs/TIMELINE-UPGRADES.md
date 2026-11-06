# Timeline upgrade phases

This work extends the existing DAI patient and doctor interfaces. Clinical facts, consent and clinician-only confirmation remain authoritative. Synthetic evaluation is not clinical validation.

1. **Experience**: SVG animation (native Web Animations, reduced-motion and low-bandwidth opt-outs), current-stop marker, source badges, per-item Hindi/English read-aloud and approved FAQ explanations, optional D3 date explorer, lazy Lottie review celebration, bounded rendering and skeletons. Existing 3D remains optional.
2. **Data and trust**: append-only event capture and replay, FHIR R4-aligned export with Provenance, hash-chained authenticated event seals, recipient-bound expiring and revocable QR summary grants. No anonymous medical-record sharing.
3. **Assistance and access**: optional existing ranking only within rule/clinician priority groups, explanations and rules fallback; spatial search uses PostgreSQL/PostGIS when configured and a documented distance fallback otherwise. No diagnosis or result interpretation.
4. **Reliability**: existing encrypted IndexedDB is retained; reconnect sync and conflicts remain explicit; browser push is opt-in, generic and requires configured VAPID credentials. No SMS provider or automatic external messaging is assumed.

Phase outcomes, commands and measured checks will be recorded here as implemented. Do not call this FHIR-certified, ABDM-integrated or clinically validated. Event seals protect against database-only modification when the application signing key is protected; they do not protect against a compromised application/key or prove clinical correctness.

## Implemented design and boundaries

### Experience

The roadway uses measured SVG geometry, native Web Animations and an animated current-stop marker. Animations are skipped for reduced motion and low-bandwidth choices. D3 is loaded only when the date explorer is opened; patient and doctor history offer whole-journey/year/month/week controls, pan and Ctrl/Command-wheel or pinch zoom. Essential information remains available in the ordinary list. Patient rows are windowed at 40 and doctor history at 60. This is bounded/windowed rendering, not an infinite-scroll virtualization framework.

A small original Lottie check animation is loaded only for a new clinician-review event, never a self-report. The existing optional Three.js model remains in the clinical/Personal tools view; no model download is added to the roadway. The new tools reuse the existing reviewed FAQ catalogue for Hindi/English explanations and browser TTS. There is no new generative medical-answer endpoint, no report interpretation and no newly trained model.

### Event model, export and integrity

`backend/db/timeline_history.sql` captures milestone INSERT/UPDATE/DELETE through database triggers, so existing write routes participate. Existing rows receive an explicitly labelled initial snapshot: prior edits cannot be reconstructed if they were never recorded. The patient timeline read is replayed from these events. Legacy tables remain write projections; this is event sourcing for the milestone stream, not a conversion of the whole HIS, child-growth or report-file stores.

`timelineEventStore.js` verifies an HMAC-SHA256 chain of canonicalized events and seals new entries under a per-patient lock. SQL triggers reject ordinary event/seal updates and deletes. The application signing key must stay outside the database and Git. This detects modification of sealed history by a database-only attacker; it does not prove clinical truth, stop a compromised application/key, or prevent a full database rollback if both data and heads are restored. Retain an external exported checkpoint for rollback comparison. Managed anchoring/key rotation is deployment work.

The export is an R4-aligned Bundle of Patient, Device, Basic milestone records and Provenance. Basic is deliberate: a scheduled milestone is not automatically a clinical ServiceRequest, performed test, prescription or completed appointment. This is a custom exchange shape, not ABDM integration or FHIR profile certification. It excludes report bodies, identifiers, names, telephone numbers and private guidance. Baby records keep their existing separate IDs and stores; the current export/share tool covers mother milestones only.

QR grants cover 1–30 explicit steps, one connected verified clinician, a 5-minute to 24-hour expiry and a fixed metadata-only snapshot. Sensitive-category consent is separate. The token is random, stored only as a hash, and placed in a browser fragment rather than an HTTP query. The snapshot is HMAC-authenticated, including recipient and expiry. Reading requires the authenticated matching clinician and rechecks live credential, sharing and access revocations. Reads are audit logged. No public/bearer-only medical-record view is added.

### Rules, ranking and centre access

The previous 17-entry milestone template was moved unchanged into `backend/data/care-timeline-rules.json`, validated at startup. Its norms are prototype assumptions requiring clinical partner verification; this extraction does not validate or expand them. Clinician-authored plans retain precedence.

Catch-up suggestions reuse the existing optional PatientML service only within rule-defined overdue items, with recorded clinician priority protected and visible explanation strings. They do not reorder dated history, create gaps, diagnose, interpret results or expose probabilities. Rule ordering works without ML, flags or consent. Actual ML output retains the synthetic-data badge. To enable the pre-existing release, both `ML_ENABLED=true` and `PATIENT_ML_RANKING_ENABLED=true` plus patient personalization consent are required; no claim of model accuracy is added here.

A one-shot centre search requires explicit location consent and only matches listed service names from the recorded step. Coordinates are not persisted. Distances are straight-line distances, not routes, ETAs or readiness guarantees. PostgreSQL/PostGIS queries use a geography index and metre-based `ST_DWithin` when configured; local mode uses haversine. Docker/PostGIS runtime acceptance was not available in this environment. Service eligibility and missing-data handling are retained in either path.

### Offline and push

Existing AES-GCM/PBKDF2 IndexedDB protection, account binding, expiry, explicit unlock and version-conflict handling are retained. The workflow-state label is part of the protected copy; report files and lab values remain excluded. Background Sync only asks an open, unlocked DAI window to sync. The worker receives neither the vault key nor clinical payload. Browsers without Background Sync keep online/unlock sync.

Browser push is opt-in and separate from scheduled reminders. A daily worker reads recorded pending care, respects India quiet hours, claims a deduplication key before sending, and disables expired subscriptions. It sends generic lock-screen text only. Subscriptions are encrypted at rest; endpoints must be HTTPS on supported push-provider domains, preventing arbitrary server-side URL requests. Tests use an injected sender: no real push message was sent during development. Physical-browser permission, provider delivery and iOS/PWA behaviour require a real device check. There is no SMS integration.

## Run and configuration

```sh
npm start
npm run test:timeline
npm run timeline:vendors
```

`npm start` applies the required migrations and installs pinned dependencies. Optional D3/Lottie assets are vendored with their licences; `timeline:vendors` refreshes them from installed packages. The default local mode generates private audit and VAPID keys under ignored `.local/` files with mode 0600. Keep these keys with your local database backup; deleting/replacing the audit key invalidates existing seals.

For a deployed API set secrets through the deployment secret store:

- `TIMELINE_AUDIT_KEY`: a strong random value of at least 32 characters, retained securely.
- `DAI_PUBLIC_ORIGIN`: the actual HTTPS origin used by recipients. Local QR links point at localhost and cannot reach another laptop without a shared accessible deployment.
- `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`: a VAPID key pair and a real deployment contact URI. The browser permission and patient scheduling choices still start off.

Optional patient-database spatial setup:

```sh
DATABASE_URL='your-patient-postgresql-connection' npm run setup:patient-postgis
# Set PATIENT_POSTGIS_ENABLED=true only on that configured patient API.
```

Do not apply the optional PostGIS SQL to PGlite or the hospital's SQLite database. It lives outside automatic migrations intentionally. Read `/api/patient/push/config` and the centre response's `distance_method` rather than inferring availability from dependencies.

## Checks and known verification limits

Targeted checks cover road geometry/windowing, Hindi/English prepared speech, reduced motion, provenance separation, event replay, immutable triggers, deliberate event/snapshot tampering, FHIR shape, clinician binding, expiry/revocation, spatial consent/no coordinate persistence, rule extraction, encrypted push credentials, provider allowlists, quiet hours, deduplication and expired subscriptions. Existing complete-server tests exercise the event-backed timeline API. The final full-suite result is reported from its actual run.

Browser control was disabled in Work settings during implementation. DOM startup checks are not screenshots or proof of visual layout, native SVG/Lottie playback, pinch gestures, browser speech, push delivery or real PostGIS performance. Those checks remain explicitly unverified.

### Final measured checks (6 November 2026)

- Full existing backend suite: **261 tests; 260 passed, 0 failed, 1 skipped** (`npm test --prefix backend`).
- Hospital portal TypeScript: `npm run typecheck` passed.
- Patient/doctor inline scripts and new timeline scripts passed JavaScript syntax checks; `git diff --check` passed.
- Signed-in DOM startup: patient Care Timeline rendered six roadway stops; doctor dashboard loaded, with no captured startup errors. This is a DOM integration check, not visual browser verification.
- Live authenticated API smoke: timeline, event history, FHIR export and push configuration each returned HTTP 200, valid JSON and `no-store`.
- Two test-fixture issues were corrected: optional PostGIS SQL was moved out of automatic local migrations; outreach date fixtures now use the database's calendar, matching the overdue calculation across timezone boundaries. Roadway tests use a fixed scenario date.
- A failed/empty centre-search response now leaves an explicit retry/alternative message rather than an indefinite checking state.

The local app is served at `http://localhost:3001`. Changes are local; no push was performed for this implementation request.
