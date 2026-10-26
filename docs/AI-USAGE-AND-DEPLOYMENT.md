# AI usage and privacy-preserving deployment

Base: 0e7cfa8. This is an operational metadata ledger and a deployment assessment, not a billing statement, clinical quality score or environmental impact calculator.

## Where to see it

Patient or Doctor dashboard → Settings → **AI usage & deployment** → Refresh AI usage. Dhruv → How assistance works → **View AI usage & deployment** opens the same section. Generate a new optional draft after installation, then refresh: old requests are not backfilled. Refresh and usefulness feedback query the application database only; they do not make model calls. There is no background polling.

The view is scoped to the authenticated account's last 30 days. It shows outbound attempts, fresh returned responses, failed/timed-out attempts, unfinished records, server voice cache hits, joined in-flight voice requests, local-service rule fallbacks, available provider-reported token totals, server-measured round-trip latency, requested model versus provider-reported version, and optional draft-usefulness feedback. An attempt is not confirmation of a billed inference. A nonempty response is not proof of correctness, usefulness, clinical benefit, playback or attendance.

## Sources and definitions

The Gemini response schema documents [usageMetadata, modelVersion and responseId](https://ai.google.dev/api/generate-content). The ledger allowlists these usage fields:

| Response field | Stored value |
| --- | --- |
| promptTokenCount | input_tokens |
| candidatesTokenCount | output_tokens |
| totalTokenCount | total_tokens |
| cachedContentTokenCount | cached_input_tokens |
| thoughtsTokenCount | thought_tokens |

Only nonnegative safe integers are accepted. Explicit zero stays zero; missing, malformed or unavailable values remain null. No character-to-token conversion or extra countTokens request is used. Totals are retained as reported, not reconstructed by adding partial components. In particular, cached input is already part of the reported prompt count; it is not added again. Coverage shows how many attempts actually reported a total, so a known partial sum cannot masquerade as a complete account total.

Latency uses this server's monotonic clock around the HTTP call/read. It includes network and response parsing and is not provider GPU/inference time. The mean excludes missing observations and reports its sample count. Failed calls and timeouts with an observed duration remain visible. The configured output-token cap is a budget, not a measured token count.

Cost is **not reported** by the integrated generation responses, and no provider billing export is connected. No currency amount is inferred from token counts or a published price list; missing cost is never displayed as free. Provider compute time, power, energy and water use are also unavailable. No water/carbon saving or smaller-model environmental benefit is calculated. Provider billing remains the authority for billed charges, which may include other applications, projects or services not represented here.

General text, prepared voice and the optional patient access-ranker service are instrumented. The ranker does not report token usage or artifact version, so these remain unknown. A ranker service's explicit rule fallback is recorded separately from a learned result. Its existing personalization/location consent and rules-first gates remain unchanged. Instrumentation records its service request, not a claim that a model actually ran. The ledger is not a profiler for unrelated offline training, Python hospital experiments, browser-local deterministic FAQs or browser speech-recognition services.

For voice, one actual generation records one outbound attempt. Another account's hit on the approved-public-answer cache records its own cache event with no provider tokens copied onto it. Joining a live generation records a non-provider coalesced event. Browser-memory audio replay makes no server request and therefore adds no server event. Anonymous public voice is recorded without an owner and is excluded from all account dashboards; operators can inspect the metadata table through their existing secured database access. No new public or cross-patient aggregate endpoint is introduced.

## Honest success and missing telemetry

Returned means the backend received a nonempty draft, supported PCM audio or a validated ranking; drafts may still be incomplete or wrong. Optional Useful / Not useful feedback is a patient's or doctor's self-report about their own returned general draft. It is not an objective accuracy label and cannot approve a clinical decision. Only the owner can rate that event. No free-text feedback is accepted.

A started record is written before an outbound attempt and completed afterward. A crash can leave it unfinished, including a crash before the network call; do not equate these rows with billed model execution. Metadata writes have a one-second deadline per operation and no retry. A database query may complete late after that deadline; its row can remain unfinished. Logging errors do not cause a provider retry or hide a successful draft. A failed write is flagged in that server process and a draft response reports usage.recorded=false. If the first write fails, no event may exist; process-local warnings can reset on restart, so missing telemetry cannot establish zero historical usage. Reconcile with provider billing rather than treating this ledger as exact billing reconciliation.

## Privacy and retention

`ai_usage_events` stores account ID where authenticated, fixed task identifier, model/service identifiers, response identifier for operational reconciliation, status, timing, reported counts and an optional boolean usefulness rating. It excludes prompts, generated drafts, speech text/audio, clinical summaries, medical histories, uploaded documents, API keys, cookies and IP addresses. The existing voice rate limiter's temporary IP-based state is unchanged and is not copied into this ledger.

All account metrics and feedback endpoints require authentication, enforce owner scope and use private/no-store. They are absent from the service-worker cache. Shared voice caches continue to contain only allowlisted public prepared answers. Ledger rows older than 30 days are removed on the first tracked request and at most once per day thereafter; this is request-driven cleanup, not an always-running deletion daemon. Account deletion cascades owned ledger rows. Usage metadata itself still needs access-controlled storage and backups; it is not anonymous merely because prompts are excluded.

## Deployment assessment: no unearned local-model claim

`config/privacy-deployment-assessment.json` is a versioned, read-only assessment surfaced in the dashboard. Deterministic local FAQs/validation remain available. Hosted fixed-task drafting remains explicitly configured and user-approved. New on-device and self-hosted lightweight **text** models are marked **not evaluated / not enabled**. No candidate was downloaded, benchmarked or clinically approved for deployment by this update. This does not disable the existing separately opted-in experimental tabular ranker service; its configured endpoint is not automatically certified as private or on-device.

Before enabling a candidate, an accountable reviewer must collect evidence for:

- Accuracy/usefulness versus rules and the current hosted baseline on held-out target tasks, English/Hindi, refusal and unsafe-output cases; keep human clinical review independent of model selection.
- Security/privacy: model and licence provenance, network egress/telemetry, multi-user isolation, encryption, logging, retention, update supply chain and prompt-injection boundaries. Local plaintext caches and compromised devices can be unsafe too.
- Maintenance: named owner, supported hardware/runtime, patch cadence, incident handling, monitoring, signed versions and rollback.
- Accessibility/reliability: actual target-device latency, memory, battery/thermal behaviour, screen-reader support, supported languages, voice compatibility and understandable offline/failure behaviour. Do not remove accessible hosted options based solely on model size.
- Operational/environmental comparison: measured workload, hardware, task completion and wall/battery energy against a defined baseline, with uncertainty and boundaries. Any carbon calculation needs defensible location/time-specific intensity and scope; any water claim needs its own defensible data and methodology. Tokens or latency alone do not supply these quantities.

Results, reviewer and review date remain unset because that evaluation has not happened. The UI cannot enable a model by changing a status or giving a usefulness rating. Smaller/local is not automatically greener, cheaper, safer or more private.

## Installation and validation

Root `npm start` applies `backend/db/ai_usage.sql` through the local migration list. Existing clinical records, clinician gates, `.env` and model keys are preserved. A separately managed PostgreSQL deployment must apply the additive migration after the existing schema before starting the updated backend.

Tests:

```
node --test backend/aiUsage.test.js backend/assistanceRouting.test.js backend/dayaSpeech.test.js backend/patientML.test.js backend/patientTimelineIntegration.test.js
```

Tests use synthetic accounts and mocked provider responses. They verify exact supplied usage fields, missing data, zero values, owner isolation, feedback scope, cache/coalescing accounting, persistence, optional service fallbacks, logging failure behaviour and full backend startup. Desktop/mobile browser checks exercise the SQL-backed dashboard and feedback flow with mocked provider usage. No paid API request, real patient record, target-device energy measurement or clinical model validation is claimed by these tests.
