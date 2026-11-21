# After Delivery: recovery workspace

The patient page at `dashboard.html#postpartum` now uses the existing DAI palette and fonts with a restrained post-discharge layout. It replaces the playful recovery world, welcome celebration, mood emojis and capped 42-day ring.

## What changed

- Actual days since the recorded birth date, with date provenance and a discrepancy notice when the hospital record differs. No recovery percentage or completion assessment.
- One maternal next-visit panel; child appointments cannot be shown as the mother's next visit.
- Recovery follow-up rows with an options dialog. A patient's “I've had this visit” is visibly self-reported. Requesting an appointment does not confirm a follow-up. Existing arrangement-barrier help remains reachable.
- A dated handover section with the hospital's recorded birth/discharge details and original maternal prescription/discharge files. File source labels distinguish clinician uploads from personal uploads. Sensitive titles remain hidden and opening a file uses the existing authorised document viewer.
- Released visit summaries remain attached to their original appointments. The current summary endpoint does not identify the subject sufficiently to republish those instructions as a maternal discharge plan; the workspace links to Appointments instead.
- BP and temperature charts use actual post-birth entries only, with date/source labels and a recorded-values table. A chart requires at least two readings. Self-entered and hospital-released sources, including their temperature units, remain separate. No prenatal substitution, reference bands, invented readings or assessment labels.
- A separate text-based private wellbeing note, saved explicitly. It is distinct from the existing clinical care check-in; it sends no automatic care-team notification.
- Feeding, recovery and family-planning questions route to the existing companion, normal visit-request flow, centre finder and messages. Generated questions are explicitly unreviewed. SOS remains available.
- Separate child record links retain durable child IDs. No shared twin completion state.
- Existing clinical education, daily-care questions, saved guidance, baby warning signs and birth-date editing remain accessible in disclosures. Today's urgent/emergency recorded guidance opens visibly. Existing backend clinical rules, authorisation, consent and routes were not changed.

## Reliability and accessibility

The workspace preserves the existing clinical form DOM and unfinished private-note selection across its own record refreshes and source/lane switches. Old responses are rejected after an account switch. Failed refreshes retain last-loaded records with an explicit retry notice; offline views make no new calls. Missing records are not replaced with synthetic values. A new service-worker shell version includes the new static assets and still excludes API responses and report files.

The layout uses responsive columns, 44px controls, visible keyboard focus, native details/dialog/fieldset controls, text status labels, large-text scaling, existing dark-mode tokens and reduced-motion rules. Sections have read-aloud controls. English/Hindi principal labels use the existing language state; detailed legacy clinical content and some secondary labels remain English.

## Validation

- Pure model/render tests cover date provenance, uncapped day counts, missing readings, prenatal/future/sibling exclusions, superseded hospital records, self-report semantics, sensitive file titles, account isolation, failed refresh and offline behaviour.
- Signed-in local jsdom interaction checks cover the actual delivered demo account with two children: workspace/source loading, source tabs, distinct child links, restoration of the maternal lane, single clinical-form root, preservation of unfinished birth-date input and private-note selection, and follow-up-dialog opening/closing. Checks do not submit clinical or wellbeing updates to the local demo database.
- Backend suite: 290 tests, 289 passed, one skipped, zero failures.
- Hospital TypeScript and production build checks pass. The production check used an isolated build directory; generated configuration changes were removed afterwards.

## Not yet verified

Native browser access was disabled in Work settings. No real-browser screenshots, pixel/overflow checks at 390/1024/1440px, screen-reader review, or video were captured. DOM checks are not visual QA. Recent-birth form submission and all locale/stage combinations need a browser walkthrough before presenting the UI as fully validated. The existing clinical rules and educational content still require clinical governance; the redesign does not establish clinical effectiveness.

## Recorded-data visual overview

Added a follow-up status donut with labelled counts (patient-recorded, to arrange, upcoming, and unknown where applicable). It measures schedule status, never recovery or clinical completion. A four-week bar chart counts distinct days with loaded, dated check-ins, ending at the latest recorded entry; it labels its date window and partial-data scope. Missing entries produce an explicitly labelled illustration. Existing measured-value charts now include a subtle filled area. No new charting dependency or backend change was introduced.

The visual update passed 13 targeted recovery/cache/startup tests and the signed-in DOM interaction check, including chart rendering and preservation of unfinished forms. Real-browser pixel/layout verification remains unavailable.
