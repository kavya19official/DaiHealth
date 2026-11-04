# Compact patient Home — 4 November 2026

Frontend presentation only. No API routes, models, permissions, patient data, consent rules or clinical schedules changed. Existing hospital-stay and doctor work was preserved separately.

## Changes

- Sidebar grouped as Care / Records / Help. My care collapses on Home and expands for an active child route. Existing routes remain reachable. Single selected Home state, with a separate visible keyboard focus ring.
- Small question-mark tour control. Device-local first-visit welcome collapses into a replay chip and stays collapsed on later visits. No identity or clinical data is stored in this preference.
- One greeting in the hero, stage chip and illustration. One next-step card with a concise summary, status in its own grid cell, booking action, directions icon, read-aloud and expandable original guidance. No line clamps on essential next-step text.
- Maximum six journey nodes. Historical outstanding records appear in one Catch up count, expandable into the complete source list. Upcoming items are shown first. Counts still reflect existing record statuses.
- Open glance section for clinician-entered weight/BP/Hb, dated values and meaningful trend lines. Missing values remain missing. Repeated identical readings show a neutral illustrated state rather than a misleading empty chart. Blood sugar remains accessible in an expandable detail when recorded. Clinician-recorded marking remains an expandable chip.
- One shared child selector with linked twin avatars; vaccine content uses the selected child's ID. Different oral/injection/shield SVGs and recorded status rings, grouped by birth/6/10/14 weeks. One catch-up action opens the full child record; later doses remain reachable there. Icons do not imply immunity.
- Nearby map lazy-loads when approaching the viewport. Unknown coordinates and distance stay unknown. Directions and facility-list actions remain available. Source/availability explanation is expandable. Offline/low-bandwidth pauses map tiles.
- Journal, check-ins, feeding/sleep logs and the recorded-detail/3D viewer remain collapsed in More for you. Existing read-aloud, large-text, dark mode and SOS remain. No new library or remote asset provider.

## Moved into expandable details / tooltips

Original next-step rationale; clinic source and interpretation boundary; clinician-marked note; approximate baby-development explanation and source; vaccine status details; facility availability and distance provenance. Native details/summary supports keyboard opening; Escape closes information details. Vaccine tooltips appear on keyboard focus and dismiss with Escape. One concise synthetic/clinical-responsibility footer remains.

## Verification

- Existing Node backend suite: **236 passed, 1 skipped, 0 failed** (237 including 5 new pure presentation tests).
- Hospital API suite: **50 passed**.
- ML suite: **26 passed** using the repository's macOS OpenMP wrapper: `hospital_portal/.venv/bin/python ml-service/run.py -m pytest tests -q`. Direct pytest initially failed on missing libomp; the existing wrapper resolved it without system changes.
- Next TypeScript and production build passed. Patient Home itself is plain HTML/CSS/JS, not TypeScript/Next.
- Final focused Home/layout/hospital-stay UI tests: **9 passed**.
- Existing tests were not renamed or relaxed. New tests verify grouping/limits, unchanged input data, queued status, distinct vaccine icons, invalid/missing birth dates and unknown coordinates.
- Saved CUA browser tests exercised first-visit dismissal/reload, question-mark tour, Escape, all source catch-up records, Baby B identity, one selector, keyboard tooltip and return-focus behaviour, and sidebar active state.
- 24 before and 24 after screenshots: 1440/390 CSS pixels × pregnancy/postpartum/child-care × English/Hindi × light/dark. After-state geometry checks confirmed no horizontal overflow, no next-step title/status overlap, body below title and visible SOS. Six additional tablet stage/language checks at 1024px passed. The clean final preview tab had zero captured console errors before the last contrast-only CSS update.

Measured isolated recorded-source preview at 1440px, English, light:

| Stage | Before height | After height | Shorter | Visible text reduction |
| --- | ---: | ---: | ---: | ---: |
| Pregnancy | 2100 px | 1400 px | 33.33% | 52.74% |
| Postpartum | 2149 px | 1400 px | 34.85% | 52.06% |
| Child care | 2159 px | 1428 px | 33.86% | 51.01% |

These are UI fixture measurements, not clinical or performance outcomes. Fixture data is read from the existing synthetic SQLite dataset. Child-only here means the existing patient Home's recorded Child care state; a separate child-login application was not altered.

## Reproduce UI checks

```sh
python3 scripts/qa/patient-home-fixtures.py
node scripts/qa/patient-home-preview.cjs
```

Open `http://127.0.0.1:13201/preview` in an isolated browser tab. The test-only Stage/Theme/Language controls render existing synthetic source records without API requests or patient writes. The baseline is available at `?revision=before` from commit `df74839` (override `DAI_HOME_BASELINE` if needed). QA files are outside the served production frontend. The preview binds loopback only and refuses production mode.

`scripts/qa/patient-home.cua.mjs` provides reusable CUA interaction assertions and a screenshot matrix runner. Run against the QA preview only, with a freshly selected tab. It verifies actual CSS viewport widths to account for browser zoom. Screenshots and measurement JSON are saved to `/tmp/dai-patient-home-redesign/` in this session.

## Limitations / not verified

The signed-in application was already showing an offline snapshot and permission errors before this work. This frontend redesign does not repair its authentication/session state or change permissions. Full signed-in booking, actual report/3D loading, offline account decryption, audio playback and all regional translations were not revalidated end-to-end in the isolated preview. Its fixture bootstrap intentionally avoids those writes and external integrations.

Browser control was disabled in Work settings at the final pass. The last contrast-only CSS tweaks use existing tokens but were not recaptured; a manual accessibility/contrast audit is still required before claiming full WCAG AA compliance. The saved matrix precedes those tweaks. No 5xx was observed in the isolated local preview; external OpenStreetMap tile reliability is not guaranteed.

Reload the running app after the new service-worker cache version activates. New Home/tour asset query versions also prevent older cached UI from masking the change. Patient records and protected offline copies are not cleared.
