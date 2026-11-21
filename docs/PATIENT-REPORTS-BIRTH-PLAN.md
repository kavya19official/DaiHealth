# Patient report review and birth plan

## Where to find them

- **Reports & records → Understand a lab report:** upload an original with the existing upload form, refresh the report selector, choose the file and review extracted values. PDF text and printed English images use the existing server-side PDF/OCR extraction; no external language model receives the report. The current parser recognises haemoglobin, glucose, platelets, TSH and creatinine. Other fields can be entered manually. Scanned PDFs need manual transcription; only the first five PDF pages are read.
- Check the date, every included value and unit, and the reference interval printed by that laboratory. Exclude unwanted fields. Nothing extracted is persisted until **Confirm & save to timeline**. The original upload and an access audit entry already exist separately. An unavailable extractor leaves manual entry available.
- Saved entries appear under **Care timeline → Report values over time** and in Reports & records, with their report date, mother/child association and **Confirmed by you** provenance. Private reports require explicit reveal. This never marks a report clinically verified, updates risk status, or completes a care gap.
- **Birth plan:** record a preferred facility, companion, transport and backup arrangements, emergency contacts and discussion preferences. Save privately. Check the explicit sharing box to print/save a PDF or share the saved text using the system share sheet (text download fallback). Unsaved edits disable sharing. Exported copies contain contact details and cannot be recalled; there is no public URL or automatic transmission to clinicians.

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

These checks cover draft discard, failed saves, explicit sharing consent, unsaved edits, child labels and escaping. Visual layout, native mobile sharing and PDF printing still need real-browser/device checks.

Sources: [MedlinePlus on reference intervals](https://medlineplus.gov/lab-tests/how-to-understand-your-lab-results/), [NHS birth preferences](https://www.nhs.uk/best-start-in-life/pregnancy/preparing-for-labour-and-birth/what-to-include-in-your-birth-plan/).

The timeline service-worker test now checks a versioned shell-cache name and inclusion of the new static client, instead of pinning the obsolete `v78-family-compact` cache name.

Latest verification: the focused API/migration/clinician-intake checks and DOM interactions passed. The full backend run reported 292 passes, one skip and one failure: the pre-existing CP-SAT capacity test exceeded its 3.5-second process timeout under suite load. Its isolated four-test planner suite passed. No planner production behavior or timeout was changed.
