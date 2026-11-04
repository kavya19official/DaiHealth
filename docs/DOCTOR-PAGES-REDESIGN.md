# Doctor pages: patient panel, appointments and schedule

Delivered 4 November 2026. Frontend presentation only; no backend route, database model, authorisation check, consent policy or API contract changed. Existing patient PDF/hospital-stay work is separate and remains uncommitted.

## Inspection before implementation

- **My Patients:** repeated saved-view chips and a six-field filter form, table/cards/board, export controls, a clinical-summary quick view, and a five-item sidebar subnavigation. The former “Child appointments” view returned mothers who had child appointments, rather than separate child rows.
- **Appointments:** a hospital coordination panel was prepended above an independent clinic queue. The clinic displayed duplicated totals, a date strip, queue/calendar/history views, and versioned queue actions. Hospital requests were read-only through the doctor API.
- **Schedule:** recorded recurring ANC/gynae/OT days, special clinics and appointments were shown in a seven-column list. Untimed allocations, repeated empty-day copy and disclaimers made the page wordy. Hospital roster data is a reported source, not presence confirmation.
- **Shared foundation:** plain HTML/CSS/JavaScript, the existing doctor dashboard model/renderers, inline SVG icons, token-based light/dark themes, Express REST endpoints, existing audit/consent checks, and Node test conventions. No dependency was added.

## Implementation and commit order

1. Sidebar: Care, Follow-up and Hospital sections; patient subnavigation is visible and selected only on My Patients. Existing routes and badge hooks remain.
2. My Patients: one counted chip row synchronised with the sidebar and `#patients?view=...`; cards by default, table and a stage board including Unstaged; collapsed advanced filters and removable chips; bounded six-record pagination and offscreen rendering containment; selection-only export controls; right-side clinical preview.
3. Appointments: Queue, Requests, Timeline, Calendar and History tabs; clickable status filters, dated week strip, short cards and illustrated empty states. Requested, scheduled, queue stages, staff-confirmed completion and patient-reported completion have separate labels. Existing versioned queue actions remain available. Notes and confirmation use the existing appointment endpoint. HTTP 409 queue failures produce a friendly Refresh banner.
4. Schedule: Day/Week/Month/List views, fixed unit-day strip, a collapsible month picker with booking dots, activity filters, a timed grid, a separate Time TBC lane, current-time marker and day details. Crowded blocks use initials, with full identity available through their accessible name/day panel. The time grid scrolls independently of untimed allocations. Phone layouts use a week strip and selected-day list. Roster and on-call rows are explicitly scheduled, not confirmed presence.
5. Shared polish and verification: specialty switch updates all three pages in the same event; tooltips support keyboard focus/Escape; dark-theme contrast corrected using existing text tokens; temporary dashboard journey filters clear when returning to All assigned/global search; skeletons and source-time footers remain.

New code lives in `frontend/js/doctor-pages-model.js`, `frontend/js/doctor-pages.js` and `frontend/doctor-pages.css`. Small integrations are in `frontend/doctor.html`, `frontend/js/doctor-studio.js` and `frontend/js/doctor-coordination-requests.js`. The previous renderers remain fallback paths when the new module is absent.

## Text moved into tooltips

Unit allocation versus actual booking, untimed activity, token unavailability, unknown readiness, sharing scope, clinician-mark provenance, missing plurality records, bulk workflow limits, queue/request semantics and rescheduling/request-write limits now use focusable info controls. Each page keeps one short footer, a **Synthetic demo** indicator and a reported timestamp. Day-detail roster rows retain the explicit “Scheduled, presence not confirmed” label.

Default maternal-view text, measured from the active page's `innerText` at 1440px, with details collapsed:

| Page | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| My Patients | 647 words | 152 words | 76.51% |
| Appointments | 125 words | 51 words | 59.20% |
| Schedule | 158 words | 79 words | 50.00% |

This measures default visible content: the old roster mounted all 22 rows; the new default displays six cards with navigation to the remainder. The month picker and advanced filters are collapsed. Records remain reachable.

## Safety and API limits

- Every item comes from the existing authorised workspace, appointments, clinical dashboard or shared-document API. No diagnosis, clinical verdict, model score or new risk flag is generated.
- Child IDs stay separate and retain their parent link. Maternal risk and clinical-summary consent are not copied onto child records. The API does not supply full individual child names, ages, complete vaccine schedules or a child clinical-summary contract here; the UI uses **Child record #ID**, unavailable values and existing linked-parent navigation.
- Multiple child IDs under one mother are labelled **Linked siblings**, not assumed twins. An explicit plurality is required for a twin badge. The current live payload lacks that field; positive twin rendering is tested using a synthetic test fixture only.
- Postpartum day counts appear only when present in the recorded stage label. A delivered status alone does not establish a delivery date. Unknown stages remain in Unstaged.
- Previews fetch measurements only where clinical-summary consent is active; the existing endpoint rechecks access and audit rules. Child previews never fetch maternal measurements as child measurements. A refresh that revokes consent or removes the assignment closes the clinical preview. Ordinary refreshes do not discard an open note form.
- Language filters remain unavailable when the API does not expose language. Untimed allocations stay untimed. OT blocks do not borrow the unit's OPD room. Bed/blood readiness is never inferred here.
- **Rescheduling and hospital request decisions are not exposed as doctor write contracts.** Their controls are visibly unavailable with explanations, and hospital requests link to the existing hospital workflow. Accept/assign/decline were not made functional by bypassing authentication or adding routes. The original doctor request view was read-only, and this constraint remains.
- Tokens are shown only when recorded. Finishing a consultation still uses the existing required-summary, versioned queue flow; adding an appointment note does not mark a visit completed.
- Long rosters use bounded pagination plus CSS offscreen containment, rather than adding a third-party scrolling virtualiser. The stage board mounts at most six cards per column initially. No heavy dependency was added.

## Verification

| Check | Result |
| --- | --- |
| Full Node suite | 232 tests: 231 passed, 1 existing database-dependent skip, 0 failures |
| Hospital API pytest | 40 passed |
| Patient ML pytest | 26 passed |
| Hospital web TypeScript | Passed |
| Hospital web production build | Passed |
| New presentation model/render tests | 13 passed (4 model, 9 render) |
| Three-page CUA browser acceptance | 80/80 passed |
| Existing dashboard CUA regression | 32/32 passed |
| Authenticated API smoke | 6/6 routes HTTP 200 |
| Browser console errors | None observed |
| Responsive fit | No page overflow at 1440, 1024 and 390px in both specialties |
| Text contrast samples | 56 across light/dark; all at least 4.5:1, minimum 5.308:1 |
| Screenshot matrix | 24 before + 24 after (3 pages × 2 specialties × 2 widths × 2 themes) |

Existing unit tests were not renamed or weakened. `scripts/browser/check-doctor-dashboard.mjs` changed its old table selectors to the new roster keys and strengthened its journey-reset check. New tests cover missing data, child identity/consent isolation, due windows, stage completeness, queue states, untimed schedules, bounded initial rendering, explicit-only twin badges, conflict banners and revocation during preview. The new `scripts/browser/check-doctor-pages.mjs` exercises chip/URL/sidebar sync, filtering, layouts, previews, tabs, forms, calendar/day panels, mode consistency, keyboard controls and responsive screenshots.

Issues caught and fixed during verification: a specialty-switch event-order lag, an OT borrowing the OPD room, a temporary dashboard filter surviving All assigned, weak inactive-tab contrast, and overlap between close-together timed bookings.

Commands used:

```sh
npm --prefix backend test
hospital_portal/.venv/bin/python -m pytest hospital_portal/tests -q
hospital_portal/.venv/bin/python ml-service/run.py -m pytest tests -q
npm --prefix hospital_portal/web run typecheck
npm --prefix hospital_portal/web run build
node --test backend/doctorPagesModel.test.js backend/doctorPagesRender.test.js
```

The browser runners use Codex CUA with an already authenticated synthetic doctor tab and add no runtime dependency. Evidence is under `/tmp/dai-doctor-pages/`: `browser-checks.json`, `dashboard-regression/browser-checks.json`, `api-checks.json`, `contrast-checks.json`, `summary.json`, test/build logs and `before-*` / `after-*` screenshots.

## Not verified

This is not a formal WCAG certification or real-clinician usability study. The hospital request inbox is empty in the current doctor account, so populated request cards and explicit twin badges were verified with test fixtures rather than newly fabricated live records. Browser checks opened note forms but did not submit notes or change real demo queue/request records. Missing child fields, unsupported rescheduling/request writes, real-world hospital status and live clinical data completeness remain outside this frontend task. One pre-existing integration test still requires `TEST_DATABASE_URL`.
