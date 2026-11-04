# Operations intelligence

Open **Hospital → Administration → Operations intelligence** as Hospital Admin or Quality Officer. This additive workspace connects five capabilities without changing patient care, clinical rosters or existing permissions for other modules.

| Capability | Working implementation |
| --- | --- |
| Bounded agentic workflow | Five actual tools inspect resource observations, open tickets and declared availability, call the optimiser, then explain the draft. The local policy agent is the default; optional Gemini function calling is explicitly opt-in. |
| Green Hospital | Reuses existing `sustainability_measurement` and `sustainability_ticket` records. Compares adjacent months only when source and reporting quality match. Uses occupied-bed-day intensity when both denominators exist. Links back to the existing Green Hospital record editor. |
| Sustainable AI | Local-first execution, 15-minute unchanged-draft cache, bounded solver/tools/provider calls, and a persisted usage ledger for measured latency, cache hits, external attempts and provider-reported tokens. Unknown energy/carbon stays unavailable. |
| CP-SAT | Google OR-Tools schedules non-clinical inspection tickets within explicitly declared staff-domain/time windows, avoiding overlap with approved work. Compares with a same-input priority-first greedy baseline. Missing OR-Tools or unsuccessful solves use that verified fallback. |
| XAI | Shows each tool, inputs in aggregate, reason, constraint checks, configured assumptions, snapshot hash, unscheduled reasons, solver status and baseline difference. A staff-exclusion what-if produces a separate draft. These are rule/constraint explanations, not SHAP or clinical risk predictions. |

## Try it

Use the normal local launcher after restarting it so the API receives the new routes and dependencies:

```sh
cd /Users/Dell/Documents/DAI
npm run stop
npm start
```

The launcher installs `hospital_portal/requirements.txt`, including `ortools==9.15.6755`. Existing port conflicts still need the owning process stopped; this feature does not kill unrelated processes.

1. Sign in to Hospital as `hospital_admin@dai-synthetic.invalid` with the existing local demo password `Dai-Synthetic-2026!` and displayed demo OTP.
2. Choose Administration → Operations intelligence.
3. **Load synthetic workshop** explicitly adds labelled observations, three inspection tickets and declared demonstration availability. It is idempotent for existing records and preserves existing observations. It does not load automatically on page open.
4. **Build a plan**. Inspect assignments and “Why this assignment?”, then Decision trail · XAI.
5. Repeat the same request to see the draft cache. Select unavailable staff to create a what-if draft.
6. Enter a review note, then approve or reject. Approval writes non-clinical assignments and marks associated tickets In progress. It does not mark repairs complete or certify resource savings.
7. Sustainable AI shows your own recorded operations requests in this facility over the last 30 days, not usage across the whole application.

All writes currently require `DAI_DEMO=true`; this is a synthetic prototype, not a production maintenance system. The standard local launcher sets that flag.

## Optional Gemini tool selection

The local workflow and solver work without an API key. To enable the optional external planner, expose `GEMINI_API_KEY` and `DAI_OPERATIONS_AI_MODEL` to the **hospital Python API process**, then restart it. Choose an available Gemini model supporting `generateContent` function calling in your account. The local launcher inherits exported environment variables. Do not put keys into frontend code or commit them.

```sh
# In the same terminal that starts DAI; enter your key without echoing it.
read -s GEMINI_API_KEY
export GEMINI_API_KEY
export DAI_OPERATIONS_AI_MODEL='your-supported-function-calling-model'
npm start
```

Then opt in through **AI planner options**. Requests go to Google's Gemini API and contain a synthetic non-clinical task plus aggregate tool counts only. Patient records, staff names/IDs, meter notes and API keys are not included in prompt data or the usage ledger. An API key is sent only in the required authentication header. The model cannot approve or mutate records. Function names, argument shape and prerequisites are validated server-side; provider failure or invalid proposals continue locally. Provider signatures/call IDs are preserved between validated tool turns. Maximum two external requests per run, each with a four-second timeout. External attempts and unknown token counts are reported honestly.

Function-calling protocol reference: [Google Gemini documentation](https://ai.google.dev/gemini-api/docs/function-calling).

## Planning policy and boundaries

Editable configuration: `hospital_portal/api/operations/policy.json`.

- Fixed seed 42, one solver worker, two-second solver budget, up to 24 jobs and 40 availability windows.
- Each job fits fully in one declared time window and domain, with no overlapping assignments for a staff member. Approved jobs also block capacity.
- Objective: maximise configured priority points, then prefer earlier starts. Elevated=100 and routine=1 are product placeholders, not clinical or engineering standards.
- Inspection durations: leak=60, cooling=90, maintenance=60, other=45 minutes. Verify locally before operational use.
- A separate validator checks every returned assignment independently. A baseline guard prevents serving fewer priority points than the same-input greedy plan.
- Declared domains describe inspection availability; they are not professional certifications. Qualified engineering repairs require hospital procedures.
- Resource-review threshold is a configurable 25% increase. It prompts review, not a claim of waste, savings or superior hospital quality. Weather, case mix and measurement changes still require human interpretation.
- CP-SAT is constraint optimisation, not a trained ML model. Optimality is claimed only when the solver returns OPTIMAL for this bounded objective.

## Data and safeguards

New tables: `operations_availability`, `operations_run`, `operations_assignment`, `operations_ai_usage`. Every table uses existing UUID/timestamp conventions and foreign keys. Existing schema creation handles SQLite; additive PostgreSQL DDL is in `hospital_portal/migrations/20261104_operations_intelligence.sql` and requires the existing facility/user/sustainability tables.

Read/write permissions are assigned to Hospital Admin and Quality Officer. Eligible declaration targets are verified non-clinical staff with an active affiliation in the selected facility. Runs and usage are scoped to the current actor and facility. Every read, proposal, declaration and decision uses the existing audit system.

Approval requires a note and current version. Inside a transaction it locks the facility, rechecks the complete source snapshot and policy hash, current eligibility, future time feasibility and independent constraints. Concurrent approval or stale sources return a conflict without partial assignments. No clinical beds, patient routing or duty roster is changed.

Cache keys include actor/facility, policy, explicit parameters, staff eligibility, source versions, observations and assignments. A draft is reused only while still future-feasible. No external-call saving, carbon saving or water saving is inferred from cache counts. The 30-day usage display is a query window, not an implemented deletion/retention policy.

## Verification

```sh
hospital_portal/.venv/bin/python -m pytest hospital_portal/tests -q
node --test backend/*.test.js
npm --prefix hospital_portal/web run typecheck
npm --prefix hospital_portal/web run build
```

Tests cover real CP-SAT versus identical-constraint greedy, deterministic assignments, missing-solver fallback, independent hard constraints, hostile/out-of-scope provider tools, aggregate-only provider requests, function-signature round trips, source comparability, role/facility scoping, explicit/idempotent demo data, cache, stale-source rejection, atomic concurrent approval, unchanged clinical rosters and timezone preservation on SQLite.

A synthetic capacity test gives three equally weighted jobs of 90/60/60 minutes in a 120-minute window. The actual solver test covers two jobs (200 policy points); priority-first greedy covers one (100 points). This is a constraint fixture, not real-world accuracy or demonstrated hospital savings.

Browser verification uses a copied SQLite database, never the user's original records. Covered: initial empty state, explicit workshop, plan, cache, staff-exclusion what-if, rejection, approval, Green Hospital/XAI/usage tabs and responsive layout.

## Measured verification on 4 November 2026

- Hospital API suite: 50 passed. Focused operations suite: 10 passed (included in the 50).
- Existing Node backend suite: 231 passed, 1 skipped, 0 failed.
- TypeScript check and Next production build passed.
- Browser checks confirmed real draft/cache/what-if/reject/approve flows and saved-plan selection on an isolated SQLite copy. At 390 CSS pixels the final document and viewport widths both measured 390, with no horizontal overflow.
- One existing FastAPI TestClient/httpx deprecation warning remains; no application test failure.

## Remaining validation

Live Gemini calls have not been exercised with a paid key; mocked provider tests verify the protocol and fallback. PostgreSQL locking/migration and Docker runtime have not been verified against live services (Docker-style API imports are checked). Production deployment requires real role/skill verification, engineering-approved durations, operational lifecycle for cancelling/reassigning approved work, retention policy and hospital pilot validation. No forecast model is trained by this module; existing ML features remain separate.
