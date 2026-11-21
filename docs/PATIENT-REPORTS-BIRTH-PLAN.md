# Patient report review and birth plan

## Where to find them

- **Reports & records → Understand a lab report:** upload an original with the existing upload form, refresh the report selector, choose the file and review extracted values. PDF text and printed English images use the existing server-side PDF/OCR extraction; no external language model receives the report. The current parser recognises haemoglobin, glucose, platelets, TSH and creatinine. Other fields can be entered manually. Scanned PDFs need manual transcription; only the first five PDF pages are read.
- Check the date, every included value and unit, and the reference interval printed by that laboratory. Exclude unwanted fields. Nothing extracted is persisted until **Confirm & save to timeline**. The original upload and an access audit entry already exist separately. An unavailable extractor leaves manual entry available.
- Saved entries appear under **Care timeline → Report values over time** and in Reports & records, with their report date, mother/child association and **Confirmed by you** provenance. Private reports require explicit reveal. This never marks a report clinically verified, updates risk status, or completes a care gap.
- **Birth plan:** record basics and medical details to flag, companion roles, transport and emergency contacts, labour, pain relief, delivery, changed-plan and C-section preferences, newborn care and recovery. Mark the most important preferences and where you are flexible. Sections are optional and use one shared field definition in `shared/birth-plan.js` for the form and API validation. Save privately. Check the explicit sharing box to print/save a PDF or share the saved text using the system share sheet (text download fallback). Unsaved edits disable sharing. Exported copies contain the selected saved health preferences and contact details and cannot be recalled; there is no public URL or automatic transmission to clinicians.

Reference intervals are transcribed, never invented or used to produce a diagnosis or normal/abnormal label. Missing ranges stay missing. Birth preferences are discussion points; saving them does not reserve resources.

## Storage and operation

`patient_report_birth.sql` is included in both existing local migration lists. Restart with `npm start` from the repository root to apply it. Existing authentication, document ownership, sensitive-report reveal and audit helpers are reused. New endpoints are restricted to the authenticated mother and return `Cache-Control: private, no-store`. Report confirmations compare the current original's SHA-256 hash before committing. Duplicate confirmations for the same original and date are rejected. Birth plans use optimistic versions to reject stale overwrites.

The service worker caches only the new static UI assets, never these API responses or uploaded files. These forms need a connection to load/save; failed saves keep the current form input. Patient-confirmed values are an additional patient-facing timeline section, not clinician observations or a FHIR certification claim. Existing original-report sharing remains separate.

## Verification

```sh
node --test backend/patientReportBirth.test.js backend/documentIntake.test.js backend/localMigrations.test.js
npm test --prefix backend
```

The integration tests use PGlite and temporary localhost servers. They cover extraction, a real synthetic PDF fixture, preview without persistence, owner isolation, role checks, explicit confirmation, source-change conflicts, private reveal, clinical verification separation, and birth-plan versions.

Run the DOM interaction checks without adding a production dependency:

```sh
npm install --prefix /tmp/dai-ui-test jsdom@29.1.1
NODE_PATH=/tmp/dai-ui-test/node_modules node scripts/test-patient-report-birth.cjs
```

These checks cover draft discard, failed saves, explicit sharing consent, unsaved edits, child labels and escaping. The isolated browser check now covers desktop/mobile layouts, light/dark rendering, explicit print consent and an actual A4 PDF. A representative synthetic plan with short entries fits one page; longer entries continue without truncation. Native mobile share-sheet delivery still needs device validation.

Sources: [MedlinePlus on reference intervals](https://medlineplus.gov/lab-tests/how-to-understand-your-lab-results/), [NHS birth preferences](https://www.nhs.uk/best-start-in-life/pregnancy/preparing-for-labour-and-birth/what-to-include-in-your-birth-plan/).

The timeline service-worker test now checks a versioned shell-cache name and inclusion of the new static client, instead of pinning the obsolete `v78-family-compact` cache name.

Latest verification: the focused API/migration/clinician-intake checks and DOM interactions passed. The full backend run reported 292 passes, one skip and one failure: the pre-existing CP-SAT capacity test exceeded its 3.5-second process timeout under suite load. Its isolated four-test planner suite passed. No planner production behavior or timeout was changed.

Birth-plan expansion verification: 8 focused backend/schema/migration/startup checks passed, plus DOM tests including typing during a pending save. The browser run verified all seven sections and a one-page synthetic A4 PDF at `/tmp/dai-expanded-birth/synthetic-birth-plan.pdf`. Omitted fields in an older client’s partial update preserve saved preferences; explicit blank values clear them. Invalid dates, unknown fields and over-length values are rejected. No database migration or clinical-rule changes were needed.

```sh
NODE_PATH=/path/to/playwright-core/node_modules node scripts/test-birth-plan-browser.cjs
```

The birth-plan workspace now follows seven optional sections: essential information; people and practical arrangements; labour; pain management; birth preferences; immediately after birth; priorities and changing circumstances. It includes current medicines, multiples, language/accessibility/privacy/cultural preferences and procedure/communication consent preferences. Existing saved keys and notes remain compatible. Section buttons, an illustration, compact field help and expandable saved summaries reduce visual clutter.

Discussion status is explicitly **patient-reported**, never clinician approval. A discussion date is required for “discussed”; invalid/future dates are rejected. Editing non-discussion preferences after a reported discussion changes the status to “Changes need discussion”, including updates from older partial clients. A subsequent discussion can be recorded separately. Saved preview, print and share include the update timestamp and discussion provenance. No new clinical orders, permissions or automatic sharing were added.

Seven-section verification: eight focused backend/migration/startup checks passed; the final three-test API/schema rerun also passed after tightening partial-update discussion-date validation. DOM checks cover discussion-date prompts and changing a discussed plan back to review-needed. Isolated Chromium checks passed at 1440px and 390px in light/dark themes, with section navigation, explicit print consent, no horizontal overflow or page errors, and a representative one-page A4 PDF. These checks do not constitute clinician review of a mother's plan; native mobile share delivery still needs device validation.

## Guided birth-plan experience

The default is a one-question card view with optional notes, skip/back/next and section jumping. Thirteen discussion preferences have Yes / Maybe / Not for me buttons and horizontal swipe support. Medical facts, identifying details and consent communication remain explicit text/date/select inputs; a swipe never consents to or refuses a procedure. Choices are stored inside the existing optional text field using a reversible `[Preference: …]` prefix, with all prior notes preserved and the existing server length/version checks retained. The full form remains available. Keyboard editing, native controls and reduced-motion preferences are supported.

The Home → Arrival → Labour → Birth → First hour map places current draft preferences by planning stage. It is not an indication that labour has started or that clinical milestones are complete. Three pins per stage are shown initially; further preferences expand and every pin opens its question.

The saved birth pass shows the first three explicitly entered priority lines, expected due date, preferred facility, recorded contact details and patient-reported health details for the team to verify. Additional priorities and all original notes stay in the complete plan. Patient-reported details are never relabelled as clinician-verified flags. Short passes print to one A4 page; long entries continue without silently dropping clinical details.

QR generation uses the already bundled local QR library. It is opt-in through the explicit copy-sharing checkbox. The QR contains the visible saved summary as plaintext, not a public record link, clinical authorisation token or a server lookup. Anyone with a copy can read it; physical/shared copies cannot be recalled. No data is sent to an external QR service. The QR is removed immediately when sharing is unchecked or edits are unsaved, including if library loading finishes late. Overlong payloads or library failure leave the complete text pass printable without a QR. Real phone/printer scan performance still needs device validation.

Verification: eight focused model/API/startup tests and the DOM interaction suite passed. Isolated Chromium verifies a real horizontal swipe, saved choice reload, existing-note preservation, five map stages, QR opt-in and removal, desktop/mobile light/dark layouts, one-page full-plan and birth-pass PDF examples. No backend routes, database schema, permissions or clinical care rules changed for this presentation update.
