# Pending Care: action-first UI and optional prototypes

Implemented in two tested phases, 6 November 2026. Existing palette, font families, dark-mode tokens, permissions, clinical rules and consent boundaries are retained. No new schema migration is needed.

## Phase A (default, built)

The previous page had a large completion ring, repeated full-text cards, category/status filters, simulated barrier controls and a report-done dialog that did not save a patient update. The replacement has:

- Compact heading, counts derived from recorded items, and one subject selector. Mother and every child retain separate identities; no combined twin completion state.
- One Start here item. Recorded clinician priority precedes the existing deterministic due-date order. Optional existing ML can rank only inside the same priority/due category, has its reason and synthetic badge, and cannot create or suppress a gap.
- Three collapsible groups: To arrange, Waiting for review, Recently completed. Future items stay reachable through Care timeline. Every row retains its subject and a single main action.
- A desktop drawer/mobile bottom sheet, native-dialog keyboard focus/escape behaviour, the recorded workflow stepper, accessible explanatory details, read-aloud, existing guided help, appointment requests, evidence upload and original-report preview.
- Self-report uses the existing patient completion endpoint/offline queue and is explicitly separate from clinical confirmation. Booking never changes a completion state. Records with completion but no confirmation metadata stay in review; they are not labelled clinician-confirmed. Baby dose and recovery records lacking confirmation metadata do not receive a false clinical tick.
- Existing recovery check-ins, official schemes, Nearby Care and scheduling remain reachable. Fake barrier forms, disabled ASHA buttons and non-functional support promises were removed.
- Lists render 40 rows per group with Show more; this is bounded/windowed paging, not a new virtualization framework. Reduced motion, text-size scaling and a no-motion essential interface are retained.

Phase A changes no backend routes or data models. The existing pending model's rule/date status remains unchanged; added presentation helpers project authoritative workflow states into groups. The existing XState machine remains the sole transition authority.

## Phase B flags (all OFF by default)

Authenticated server feature configuration is at `GET /api/patient/pending-care/features`. Client storage or query parameters cannot enable a backend capability.

| UI flag | Server environment variable | Default |
| --- | --- | --- |
| pendingCarePlanner | PENDING_CARE_PLANNER | false |
| pendingCareAssistant | PENDING_CARE_ASSISTANT | false |
| pendingCareReceipts | PENDING_CARE_RECEIPTS | false |
| pendingCareLive | PENDING_CARE_LIVE | false |

Set a variable to the literal `true` before starting the app to test that capability. Example for a local prototype check:

```sh
PENDING_CARE_PLANNER=true PENDING_CARE_ASSISTANT=true PENDING_CARE_RECEIPTS=true PENDING_CARE_LIVE=true npm start
```

The main demo should use `npm start` without these flags. The final local run explicitly sets all four false. Never edit committed defaults to enable unfinished prototype features.

### B1: Plan these together — prototype

`POST /api/patient/pending-care/plans` requires the mother role, explicit planning/logging consent and two to eight owned maternal milestone IDs. Urgent/clinician-prioritised, clinician-authored, already-requested, already-reported and preparation-constrained steps fall back to normal individual actions. No medical prerequisite is inferred from free text.

Candidates require an exact recorded service-name match, an active verified doctor-site link and an exact site-name match to the existing hospital booking catalogue. No fuzzy crosswalk or fabricated slots are introduced. The current directory and hospital catalogue are separate datasets: incomplete links legitimately produce no plan. Existing configurable demo session assumptions remain labelled request windows, not guaranteed appointment availability.

Recorded unit days/request windows, occupied slots, remaining daily doctor capacity and stated preferred days constrain the candidates. A travel limit requires separate explicit one-shot location consent and finite coordinates; straight-line distance is a feasibility filter, not an ETA. Coordinates are not persisted. No new location permission is requested unless the user asks for this limit.

A separate Python process uses the existing OR-Tools CP-SAT dependency. The solver has a fixed seed, one worker, a short per-solve time limit and a 3.5-second wall kill. It proposes at most three alternatives, forbids overlapping visits and different centres on the same day, and respects remaining daily doctor capacity. Its objective prefers fewer distinct days, then earlier windows. This is not a clinical ordering decision, a claim of trip savings, or evaluated real-world optimisation.

Each suggested item opens the ordinary booking sheet with its exact owned milestone ID and recorded clinician/window prefill only if still available. The patient reviews and sends each request through the existing validation route. No batch booking or clinical completion occurs. Stale windows revert to the ordinary selection flow.

Minimal operational inputs, candidate references, solver status/time and plan counts are audit logged. A solver import failure, timeout or no feasible solution returns a deterministic rules fallback. Service/ownership validation errors fail closed. Rate limits and a per-user in-flight guard prevent repeated parallel planning.

**Scope limit:** child vaccine/recovery schedules do not currently provide all the milestone/service/window links required by this planner. Their existing per-child and recovery flows remain available; the prototype explains the fallback instead of manufacturing a family plan. Clinical partner verification of service links, preparation constraints and usability is still required.

### B2: Help me finish this step — bounded prototype

`POST /api/patient/pending-care/:id/assistant` permits only Explain → Find care → Prepare request → Review request. It checks ownership on every action, requires explicit consent, maintains a short-lived ordered session, rejects replay/out-of-order/arbitrary tools, rate-limits starts and detects record changes. It makes no external LLM call.

Draft questions use recorded text and prepared prompts, are labelled unreviewed, and do not interpret results. A separate explicit confirmation is needed to open the ordinary appointment form, which still requires the patient's own review/send. No assistant endpoint can book, prescribe, label risk or confirm care. No automatic retries are added. Existing local guided help remains available with the prototype flag off.

### B3: Completion receipts and FHIR — prototype

`GET /api/patient/pending-care/:id/receipt` returns metadata only for an owned, authoritatively confirmed milestone. Evidence must match the same mother and milestone; appointment links must match the same mother. Reviewer and time come from the recorded clinician transition. Missing metadata remains missing, including legacy confirmations. Reads are audited.

When the receipt flag is true, the existing FHIR export adds Task resources and Task-targeted Provenance alongside the original Basic milestone resources. Patient-reported and awaiting-review states map to in-progress, never completed. Sources point to existing event/evidence identifiers; report bodies and invented practitioner details are not added. This is labelled FHIR-aligned (prototype), not certified or ABDM-integrated. No second state machine is created.

### B4: Who's helping? — prototype

`GET /api/patient/pending-care/:id/ownership` displays the patient's next action and what a permitted care team can do. It does not claim an assigned clinician, a delivered escalation or new access permission. A bootstrap snapshot is labelled Last available snapshot; it is not passed off as a clinical update.

The page reuses the existing cookie-authenticated timeline SSE invalidations and refreshes from recorded data. If the stream is unavailable, the flagged page polls every 15 seconds while visible, signed in, online and not in low-bandwidth mode. A visible status distinguishes Live, polling fallback and offline. No duplicate SSE connection or fabricated realtime ETA is added.

## Safety and demo sequence

A valid demo is: see Start here → open details → prepare/review a suggested ordinary request → retain the gap as open → patient reports completion or submits evidence → a permitted clinician reviews the original evidence → recorded confirmation and a receipt appear.

**Requesting an appointment must not advance the item to awaiting review or clinician-confirmed.** Those later demo stages require separate evidence and clinician actions through existing authorised routes. Do not present a staged/fabricated clinical confirmation as a live outcome.

## Checks and remaining validation

- Phase A full suite: 271 tests, 270 passed, 0 failed, 1 skipped.
- Full suites with all Phase B flags off and all on: 282 tests, 281 passed, 0 failed, 1 skipped in each run.
- TypeScript and separate-output Next production builds passed with all four flags off and again with all four flags on. Temporary generated configuration/build files are restored/removed after checks.
- New checks cover exact eligibility, feasible/no-plan and real solver timeout, combined doctor capacity, ownership, audit records, default-off flags, consent, ordered/replayed assistant actions, confirmation gating, unchanged appointment counts, receipts without invented metadata, additive gated Task export, and SSE/polling fallback. Existing tests cover XState transition guards, document access and twin separation.
- Signed-in DOM checks cover the Phase A groups/drawer/baby switch. A separate synthetic DOM fixture with all flags on exercised consent, the unreviewed draft confirmation gate, ordinary-form handoff, ownership and the current catalogue's no-plan fallback. It submitted no appointment and confirmed no clinical care.
- Two older frontend tests were updated for the new presentation and browser-event harness. They do not remove backend safety assertions. No model accuracy, clinical outcome, savings or performance-effect estimate is claimed.

Browser control remains disabled in Work settings. Actual 1440/1024/390 screenshots, English/Hindi and stage-specific visual QA, native screen-reader/keyboard testing, microphone/TTS checks and the requested screen recording are **not verified**. DOM checks are not screenshots. Planner feasibility tests are not a field evaluation or evidence of fewer journeys. Before enabling it for a demo, verify exact service/site links, stated preferences and the ordinary booking handoff using a clinical partner-reviewed synthetic scenario.

## Commands

```sh
npm start
node --test backend/patientPending.test.js backend/pendingCare*.test.js
PENDING_CARE_PLANNER=false PENDING_CARE_ASSISTANT=false PENDING_CARE_RECEIPTS=false PENDING_CARE_LIVE=false npm test --prefix backend
PENDING_CARE_PLANNER=true PENDING_CARE_ASSISTANT=true PENDING_CARE_RECEIPTS=true PENDING_CARE_LIVE=true npm test --prefix backend
npm run typecheck --prefix hospital_portal/web
```

`PENDING_CARE_PYTHON` can select an interpreter containing OR-Tools. Otherwise the backend uses `hospital_portal/.venv/bin/python` when present, then `python3`. OR-Tools is already pinned in `hospital_portal/requirements.txt`. If unavailable, ordinary Pending Care still works and the planner returns its rules fallback.
