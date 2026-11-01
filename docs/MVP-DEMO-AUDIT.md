# MVP demo audit and limitations

Reviewed against latest main `1a61927f94ac3578d9e3c0d4d1cd31d4b33a6ef1` (including the prior follow-up fix) on 2026-11-01. This is a prototype readiness pass, not production certification or an exhaustive proof that every edge case is correct.

## Surfaces and integration

| Surface | Demo data / behavior | Checks |
| --- | --- | --- |
| Shared sign-in and registration | Real local authentication, fictional new registration, role checks, hospital OTP and rotating refresh cookie | HTTP role/session checks and browser navigation |
| Patient maternal journey | Imported synthetic cohort, milestones, appointments, follow-up help, shared task status, records, consent and messages | Panel navigation; saved-state HTTP workflow; real browser document upload |
| Children | Source-linked separate child records including twins; existing child visit and vaccination workflow | Cohort/child API checks and doctor child filter |
| Discovery | Hard service gate, preference/distance/availability explanations, approximate PIN and permission-based location | Ranking regression tests and real PIN browser search |
| Appointments / referrals | Signed patient bridge into hospital facility inbox; staff assignment and versioned status transitions | Live patient → hospital → doctor → patient check; API tests cover referral variant |
| Doctor | Assigned roster, appointment queue, worklist, shared reports and read-only hospital coordination requests | Role, sharing and revocation regression tests; browser panels |
| Hospital operations | Recorded readiness, wards, referrals, patient requests, follow-ups and separate simulated escalation | Browser view matrix and live saved workflow |
| Administration | Facility context, staffing, resources, sustainability and audit | Scoped API suites and browser view matrix |
| AI assistance | Existing deterministic routing, optional user-approved external draft path and usage reporting | Existing backend regression suite; external provider not required for demo |

## Repairs and polish in this update

- Follow-up help now initializes on navigation and direct links. Guest mode is explicit. Cached content no longer overwrites an unsaved barrier form, and failed submissions can be retried.
- Removed the vertical auto margin that placed patient and doctor content far below the heading. Retained the existing visual system and mobile layout.
- Central patient navigation emits a panel event so timeline follow-ups, risk-review status and appointment requests refresh even when navigation uses `history.replaceState` or low-bandwidth mode disables polling.
- Separated conflicting cancellation/rebooking data attributes so unrelated appointment handlers cannot fire from demo request buttons.
- Hospital-managed requests appear in patient Appointments and the assigned doctor's read-only workspace. Canonical UUIDs match the hospital API. Coordination metadata does not grant full medical-record access, and patient doctor/facility revocations are enforced and audited.
- Fixed an appointment-reference permission check in care coordination: an active relationship elsewhere cannot expose an appointment at a revoked facility.
- Prevented duplicate initial refresh-cookie rotation under Next development StrictMode. Added finite request timeouts, actionable unreadable-response errors and an honest connection indicator.
- Long facility names now wrap within mobile viewports, and the context selector has an explicit accessible label.
- Hospital facility changes retain the selected screen while clearing stale context data, rather than sending the presenter back to Overview.
- Added opt-in `npm run demo`, a removable recording guide, additive daily synthetic service slots and explicitly estimated resource records. Fixtures preserve existing edits and never turn real availability or clinical findings into hardcoded success.
- Expanded the backend test command to include all test files with bounded concurrency; added regression coverage for permission checks, coordination scope and opt-in fixture behavior.
- Added a reusable local end-to-end HTTP check and recording runbook.

## Data boundaries

The imported source cohort links 2,000 mothers, 1,078 children and 144 doctors across the Node and hospital systems. Source records and synthetic Delhi demo facilities are distinct. UUIDs are normalized when crossing the SQLite/JSON boundary. Status changes are saved, version checked and queried again through the patient bridge; browser demos do not intercept API responses with fake success.

Video mode is explicitly additive and local-only. Slot reports carry `SYNTHETIC VIDEO FIXTURE: not live availability`; resource observations carry an estimated quality flag and a synthetic source. Existing edits are preserved. A synthetic receiving-facility affiliation is audited and requires an existing verified fictional clinician. No real credentials are invented.

## Verification

The final results are recorded in `MVP-DEMO-VALIDATION.md`. Browser checks use actual local Express, FastAPI and Next services, independent role contexts, low-bandwidth mode, desktop/mobile viewports and disabled external network assets. An API failure, empty asynchronous screen or page exception fails the check. This verifies the rehearsed pathways, not every combination of roles, facility state or clinical input.

## Remaining limitations

- **Synthetic-only / no clinical validation:** cases, registrations, results and evidence are fictional. The risk workflow reports its reason, escalation owner and audit; independent clinical approval has not been verified. No new clinical predictive model was introduced.
- **Not a booking network:** a recorded appointment/request is a local coordination state, not a confirmed real hospital slot. PIN distances are approximate. GPS requires browser permission and a compatible secure context; automated rehearsal uses PIN search.
- **Two appointment workflows:** existing clinic appointments/queue and hospital coordination requests remain separate. The new read-only mirrors make that distinction visible; no duplicate clinical encounter is manufactured.
- **Registration versus imported history:** new Node patient registration does not automatically create a full imported hospital-registry identity or historical clinical record. Use the source-linked seeded mother for the longitudinal cross-interface story. The signed synthetic request can still carry the new patient's coordination identity.
- **Permissions still apply:** record sharing, facility context, verified staff and patient revocations can deliberately hide data. Hospital system access and emergency procedures are separate from the Node sharing model. New request assignment alone does not open the full patient record.
- **External services:** no live SMS, ambulance dispatch, real referrals, ABHA/ABDM integration or guaranteed external mapping service. In-app messages persist locally; they are not SMS. AI drafts require a configured key/model and explicit approval; provider calls were not needed for this rehearsal.
- **Forecasts / environment:** existing hospital forecasts use synthetic data and their existing quality gates. Estimated resource charts do not establish measured savings. AI tokens/cost, where available, must not be converted to carbon/water claims without a defensible methodology.
- **Persistence:** local fixtures and test records survive restarts. Optional seeds are idempotent for their period and do not reset edits. Repeated end-to-end checks create labelled audit/test records and can encounter the real OTP rate limit.
- **Deployment:** local prototype testing does not establish production security, backup recovery, accessibility conformance, multi-user load, offline clinical operation or browser compatibility beyond the tested engine. One existing optional integration test is skipped when its external prerequisite is absent.
