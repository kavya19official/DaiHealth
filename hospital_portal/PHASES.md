# DAI build phases and acceptance gates

The supplied phase-order section is missing. This sequence follows its module dependencies.

| Phase | Scope | Current status |
|---|---|---|
| 1 | Stack, UUID schema, existing-data import, M1 organisation CRUD, M2 auth/RBAC/audit | Local implementation and tests pass; PostgreSQL/PostGIS deployment acceptance pending |
| 2 | M3 front office + admission/discharge, M4 bed twin, M5 critical/LR/OT capacity; Redis/WebSockets and reservation expiry | Not started in the new stack |
| 3 | M6 delivery/twins/birth doses/PNC; M7 simulated diagnostics with actual gap closure | Not started |
| 4 | Blood/on-call readiness, human-approved referrals, two-step SOS, explainable arrivals | Not started |
| 5 | M8 inventory, simulated operational ML/history, model evaluation; roadmap integrations | Scaffolds only |

Phase 1 checks:
- PASS: existing synthetic records imported with stable UUID/source provenance, 2,000 mothers and separate children.
- PASS: all source foreign keys and hospital/unit/assigned-doctor chains resolve.
- PASS: 240 clinician-confirmed high-risk mothers; no algorithmic relabelling.
- PASS: password plus expiring simulated OTP, wrong-attempt limit and single-use verification.
- PASS: signed access sessions, refresh rotation, logout revocation and denied header spoofing.
- PASS: clinician registration/department/verification checks; unit and assignment isolation.
- PASS: patient reads and accepted edits create audit entries.
- PASS: M1 facility editing and department/unit/clinic CRUD, linked-record deletion blocked.
- PASS: TypeScript and Next.js production build; package vulnerability audit.
- PASS: browser sign-in, accepted facility save and role switching; responsive alignment checked.
- PENDING: execute Compose with a dedicated PostgreSQL/PostGIS database and Redis; verify persisted UUID/FK schema, generated geography/index and service health. Docker unavailable here; existing PostgreSQL credentials not supplied.

Phase 2 remains gated. SQLite preview tests do not substitute for PostgreSQL integration acceptance.

External OTP delivery is MOCK, clearly labelled. The non-demo API fails closed. Production security review, real identity verification and deployment are separate acceptance work; no real records are permitted in this prototype.

Read-only operational browsing was restored at the user’s request: Operations / Administration navigation, bed/cot snapshots, resource and staffing views, recorded care worklists and emergency history. This restores data visibility while leaving Phase 2+ write/live workflow acceptance gated.
