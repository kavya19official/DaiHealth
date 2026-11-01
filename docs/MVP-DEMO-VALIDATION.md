# Validation — 2026-11-01

Environment: Linux, Node 24.22.1, Python 3.12, embedded PGlite, SQLite, Next.js 16.4.2. Local services were exercised through the unified localhost:3001 gateway. User macOS/Safari execution is not claimed.

| Check | Result |
| --- | --- |
| Backend `npm test` (all test files, concurrency 2) | 202 tests: 201 passed, 0 failed, 1 skipped |
| Hospital Python suite | 40 passed; one Starlette/httpx deprecation warning |
| Next production build | Passed; routes prerendered successfully |
| TypeScript `tsc --noEmit` | Passed |
| Unified login/cohort/session check | Passed: patient, doctor, hospital OTP, refresh/logout and wrong-role denial |
| Saved end-to-end HTTP workflow | Passed: registration, twins/timeline, ranking, request acceptance/assignment/scheduling, doctor coordination feed, patient state, follow-up lifecycle, separately simulated risk escalation, messages and audit |
| Chromium browser matrix | Passed: 13 patient panels, 15 doctor panels, 31 hospital/administration views, actual upload and care search, doctor child filter, facility-switch inbox continuity, optional guide and 390px mobile layout; zero page exceptions or API 5xx |

Data counts verified: 144 doctors, 2,000 mothers, 1,078 children, 8,000 milestones and 2,000 imported appointments. Additional labelled demo activity and verification records are additive.

The browser run uses separate authenticated contexts and actual APIs. It tests navigation, a real document upload and PIN-based search. API regression tests cover additional mutations, sharing, concurrency, invalid input and revocation. It is not an exhaustive manual audit of every button or clinical combination, nor an accessibility certification. See MVP-DEMO-AUDIT.md for limitations.

Package validation: guarded installer tested against latest main and its preceding baseline, repeated installation, dry-run and a deliberately conflicting local edit. Conflicts are detected before any source file is changed.
