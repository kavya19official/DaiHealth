# Doctor dashboard redesign - 3 November 2026

## Scope and implementation

Presentation only: no backend routes, database models, consent checks, API contracts or clinical decision rules were changed for this redesign. The pre-existing patient PDF and hospital-stay work remains separate and uncommitted.

The dashboard now leads with a greeting, three sourced maternal statistics (or only supported child statistics), the existing care-team SVG, a journey strip, today's clinic and a larger completion ring. It previews five attention items and six patient rows. Hospital resources use proportional bed/cot illustrations and blood-group droplets, with their actual source date/time. Handoffs and roster use compact avatar rows. Empty facility alerts are omitted. Profile and unit selectors moved into the profile popover without changing their disabled/verified state.

A shared rendering/model pair provides Maternal and Newborn & Child modes; the initial mode comes from the existing specialty field. The other doctor pages, search, outreach, appointments, reports, review decisions, ward snapshots and Dhruv remain reachable. The mobile table becomes stacked rows, and handoffs/roster collapse under More.

Changes live in `frontend/doctor.html`, `frontend/doctor-dashboard-focus.css`, `frontend/js/doctor-dashboard-model.js`, `frontend/js/doctor-dashboard-focus.js`, and small integrations in doctor-workspace.js, doctor-studio.js and clinical-review.js. The shared shell cache version changes so it cannot keep serving the older clinician-review script.

## Text and safety

The default maternal dashboard dropped from **1,290 to 388 visible words** (69.92% reduction), measured from the same synthetic doctor account using `#panel-dashboard.innerText`, with filters and details collapsed.

Long explanations moved into focusable info-button tooltips: appointment-status semantics, EDD versus forecasts, stage provenance, completion denominators, worklist order, roster presence, incoming handoffs, resource snapshots and review requirements. Original review forms and their decision instructions remain inside a collapsed review workspace. The footer retains the synthetic-data indicator and: “Based on recorded information. Clinical decisions stay with you.”

No risk score, diagnosis, new risk label, medication instruction or inferred hospital readiness was added. Unknown values remain unavailable, not zero. Corrections to presentation helpers prevent old ANC items appearing as the next step for postpartum patients. Global search and sidebar saved views clear temporary journey restrictions.

## Current API limits

- Child appointments expose child IDs and linked mothers, but not birth dates, complete vaccination schedules or individual child names. The dashboard therefore uses separate **Child record #ID** rows. Child age bands, vaccine totals and newborn follow-up totals stay unavailable unless the existing payload supplies relevant facts. It never borrows a mother's clinical risk flag or completion percentage for a child.
- Multiple child IDs under one mother are labelled linked siblings; they are not asserted to be twins without an explicit birth/plurality record. Child records remain separate.
- The current doctor roster does not expose live admission status. In-hospital counts remain unavailable unless an explicit recorded labour/admission stage is present.
- The new quick-action buttons open existing authorised records/workflows. They do not themselves create an appointment, write a note or set a clinical flag. Nurse/doctor write flows were not expanded in this frontend-only task.
- Hospital capacity is a snapshot, not a reservation. The displayed source is historical in this cohort, so its date is shown rather than claiming it is live.

## Verification

| Check | Result |
| --- | --- |
| Full Node backend suite | 219 tests: 218 passed, 1 existing skip, 0 failures |
| Hospital API pytest suite | 40 passed |
| Patient ML pytest suite | 26 passed |
| Hospital web TypeScript | Passed |
| Hospital web production build | Passed |
| New dashboard model/render regression tests | 8 passed after final helper changes |
| Reusable CUA browser checks | 32/32 passed |
| API smoke checks | 6/6 endpoints returned HTTP 200 |
| Browser console errors | None observed |
| Text contrast samples | 22 samples across light/dark passed 4.5:1; minimum 5.308:1 |
| Responsive page width | No horizontal page overflow at 1440, 1024 or 390px |

The existing skipped child-health integration test needs TEST_DATABASE_URL; it was not silently enabled against local patient data. Existing tests were not renamed or weakened. Two new test files exercise the presentation helpers/rendering; the CUA browser runner covers switching, journey filtering (including the full roster), clearing restrictions, empty states, keyboard search, tooltips/Escape, profile access, review controls, quick-action pickers and phone overflow. CSS respects reduced motion. Contrast sampling and keyboard checks are not a formal full WCAG audit.

Commands:

```sh
npm --prefix backend test
hospital_portal/.venv/bin/python -m pytest hospital_portal/tests -q
hospital_portal/.venv/bin/python ml-service/run.py -m pytest tests -q
npm --prefix hospital_portal/web run typecheck
npm --prefix hospital_portal/web run build
node --test backend/doctorDashboardModel.test.js backend/doctorDashboardFocus.test.js
```

Browser runner: `scripts/browser/check-doctor-dashboard.mjs`, using an authenticated synthetic doctor tab in Codex's CUA runtime. It adds no browser-library dependency.

## Screenshots and run evidence

Current-run evidence is in `/tmp/dai-doctor-redesign/`:

- Before: `before-1440-light.png`, `before-1440-dark.png`, `before-390-light.png`, `before-390-dark.png`.
- After: `after-maternal-1440-light.png`, `after-maternal-1440-dark.png`, `after-maternal-390-light.png`, `after-maternal-390-dark.png`, and equivalent `after-child-*` files (8 final screenshots).
- `browser-checks.json`, `api-checks.json`, `contrast-checks.json`, `summary.json`, and test/build logs.

There are four baseline screenshots, not eight: the old interface had no separate child mode to capture. All eight requested final mode/theme/width combinations were captured. Real-world paediatric completeness, live admission fidelity and clinical usability cannot be validated from this synthetic dataset; no such validation is claimed.
