# Daily tracking

Open `dashboard.html#daily`. Five compact views keep the Today page short: Today, Wellbeing, Measurements, Pregnancy (recorded pregnancy only), Week & sharing.

## Built

- Existing water, prescribed-supplement, meal, movement-session and contraction logs stay reachable. SVG glasses add one record at a time; eight is the existing display/storage cap, never a fluid recommendation. Food chips fill an editable note.
- Sleep hours/quality, a five-point mood/energy check-in and activity minutes are optional self-reports. Mood taps are **not a validated screening instrument**; the separate postpartum screening feature remains separate.
- Structured symptoms include selection, severity, time noticed and optional text. Warning selections and current BP input reuse the fixed emergency rule table. A prompt can appear before saving, does not diagnose, never silently sends SOS and does not mark a care gap complete.
- BP, weight and blood glucose write to the existing `health_logs` table. Glucose context is required. Only actual clinician-entered targets are shown, with author/date. Other additions use the append-only `patient_daily_entries` table.
- Weekly SVG reading sequences show recorded values, with separate glucose-context series. Missing entries remain missing. Printable self-reported summaries include dates, units, movement sessions, symptoms, supplement reports and targets; explicit inclusion consent is required. Long records may take additional pages.
- A compact home card reports logged categories. This is logging activity, not a health score or a requirement to complete every category.
- Separate seven-day, revocable daily-summary consent is required for a connected, verified doctor. The doctor opens **Weekly patient tracking** from the patient's clinical summary. Existing broad summary consent does not automatically reveal mood or symptom notes. Reads and grants are audited. Family permissions remain managed separately; this does not introduce a family/ASHA daily-diary viewer.
- English/Hindi UI, accessible native controls, optional browser speech-to-text for meal/symptom drafts, text fallback, and reduced-motion CSS. A transcript must be checked and explicitly saved. Browser support/recognition accuracy varies; microphone audio may use the browser's speech service.
- An opt-in daily check-in reminder runs only while DAI is open. It is skipped after a mood check-in is recorded that day. This is not guaranteed push, SMS, an injection reminder or a prescribed medication schedule.

## Protected offline queue

Daily data is included only after the mother unlocks her private-device offline copy in Settings and explicitly selects **Include in protected offline copy**. The existing AES-GCM/PBKDF2 vault, account binding, expiry, locking and deletion apply. The seven most recent opened daily pages are retained in the encrypted payload; raw reports, audio and tokens are excluded. Locking the copy removes decrypted data from memory.

Water, supplement, meal, structured symptom, sleep, mood, activity, BP, weight, glucose and movement-session submissions use owner-scoped mutation IDs. Server transactions insert the idempotency event and update the existing canonical tables together. A repeated identical mutation does not add another glass, meal or reading; a changed payload returns 409. Offline entries are labelled waiting to sync, never saved on the server. DAI must be open, unlocked, connected and signed into the same account to sync. Conflicts are retained for review/discard; no silent overwrites. Contraction timing retains its existing online save flow.

## Safety references and remaining validation

The warning table already cites [CDC urgent maternal warning signs](https://www.cdc.gov/hearher/maternal-warning-signs/index.html). [NHS movement guidance](https://www.nhs.uk/pregnancy/keeping-well/your-babys-movements/) emphasises a baby's usual pattern and prompt maternity contact for reduced/changed movement, with no universal daily count. The counter is hidden before a recorded week 28; unknown gestation displays care-team guidance without inventing a week. Counts never reassure the mother that reduced movement is safe. Medical wording and workflow still require clinician review and field usability validation before clinical deployment.

No new ML, automated diagnosis, clinical priority score, exercise goal or medication dose is added. The support-circle viewer, delivered provider reminders and clinical effectiveness validation remain separate work.

## Verification

```sh
node --test backend/patientDaily.test.js backend/clinicalDashboard.test.js backend/connectedCare.test.js backend/patientTimelineClient.test.js backend/localMigrations.test.js
NODE_PATH=/path/to/playwright-core/node_modules node scripts/test-daily-tracking-browser.cjs
```

Integration coverage includes ownership, role checks, input validation, canonical persistence, exact retry idempotency, altered retry conflicts, explicit sharing, consent expiry/revocation, account closure/export and no-store responses. Isolated Chromium uses synthetic entries at 1440px/390px in English/Hindi and light/dark, checks warning-without-auto-submit, target provenance, private print consent, genuine encrypted IndexedDB persistence and reconnect sync. Browser microphone recognition on a real device and clinical effectiveness are not established by these tests.

Final verification: 12 focused API/privacy/export/startup tests passed, followed by the two-test Daily API rerun confirming the existing three-year log-date limit. Chromium checks passed for logging, warning prompts without auto-submission, explicit field choices and print consent, target provenance, protected offline persistence and reconnect sync, desktop/mobile EN/HI light/dark, postpartum navigation, a recorded week-20 counter restriction, and no-speech text fallback. Local health returned 200; the new daily endpoint returned 401 without sign-in. Native speech accuracy and clinician validation remain outstanding.

## Pastel redesign

Daily tracking now uses scoped blue/water, amber/supplements, green/food and rose/symptom surfaces with indigo text, matching icon tiles and action controls. Four SVG ring segments and the seven-day/four-category grid reflect persisted entries only; empty marks mean not recorded. The page does not invent a streak or imply four categories are prescribed tasks. Patient-reported severity is an explicit native radio choice, with no default or computed classification. Purple remains the navigation accent. A compact mobile shortcut bar moves to the relevant form and sits above the existing Dhruv launcher. Dark variants and reduced-motion rules apply without modifying other pages' tokens.

The redesign browser run covers the four SVG segments, 28 weekly grid markers, severity choice, mobile shortcuts, logging, printing and encrypted offline sync at 1440px/390px in English/Hindi and light/dark themes. Eighteen key foreground/background pairs were checked numerically against 4.5:1; this is not a claim that the entire app has completed an accessibility audit.
