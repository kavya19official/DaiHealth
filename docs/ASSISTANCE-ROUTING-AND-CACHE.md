# Local assistance, explicit external drafting, safe reuse

## What the patient sees

Open Ask Dhruv on the patient dashboard. Answers from the existing prepared FAQ catalogue now carry “Local prepared answer · no language-model request”. Expand “How assistance works · local first” for public facility metadata and the optional drafting controls.

Normal typed questions, including unknown questions, stay in the local FAQ matcher. Existing danger/refusal handling still runs before retrieval. Existing form validators and server eligibility/status checks use lightweight code; validation errors never trigger an external model. The new approval check is validated locally and again on the server.

The optional longer drafting tasks are **questions to ask before a visit** and **record-sharing discussion checklist**. The patient must check an explicit external-processing approval box for each request. Changing task or language clears approval. Authentication and server configuration are also required. The request contains only a fixed task ID, language and approval boolean: no free-text prompt, conversation, profile, location or record is accepted. Unknown fields are rejected locally by the API. The server sends a fixed generic instruction to Google Gemini. Output is plain text, labelled as an unreviewed general AI draft; it cannot make appointments, modify records or run tools. It is never converted to approved FAQ content automatically.

This is intentionally a bounded example of longer drafting, not a general clinical chat or report interpreter. Deployment still needs a useful-quality/latency/cost comparison before selecting a model; no larger model is chosen automatically. Existing speech generation remains a separately opted-in accessibility service that receives prepared public answers only.

## Configuration

Normal FAQs work with no AI key. Optional external drafting is off by default. To enable it, set in backend/.env:

```
DAI_COMPLEX_AI_ENABLED=true
DAI_COMPLEX_AI_MODEL=<explicitly selected text model>
GEMINI_API_KEY=<your key>
```

Restart npm start. A missing configuration returns an honest unavailable message, while local FAQs continue working. The model name/key never goes into browser code. Upstream errors are sanitized; the server has a 15-second timeout, a 700-token output budget and a five-request-per-ten-minutes per-user process-local limit. The limit resets on process restart and is not a distributed quota. Tests use a fake provider, not paid external calls; live-provider output quality has not been evaluated.

## Cache boundaries

| Content | Reuse policy | Freshness / scope |
| --- | --- | --- |
| Prepared FAQ JS and widget assets | Service-worker shell allowlist | Versioned shell update; contains no patient state |
| Public FAQ API catalogue | HTTP public cache with content-hash ETag | 300 seconds; hash changes when content changes |
| Basic facility metadata | Shared server memory, allowlisted projection only | 60 seconds total; refetch on expiry; no stale-on-error |
| Prepared FAQ speech | Existing approved-answer-only cache | Exact text, language, model and voice in key |
| Patient searches, location, preferences, timeline, records and requests | No new shared cache | Node API responses default to private, no-store |
| AI-generated drafts | Never cached server-side or in service worker | Private, no-store; displayed only in the current page |

The public facility projection contains only id, name, facility_type, city, state and pincode, with at most 500 active entries. It excludes slots, clinician identities, contacts, patient fields, notes, personal distances and preferences. The response says it is basic metadata, not live service eligibility or availability. Concurrent misses share one database read. Browser caching is disabled for this route so it cannot extend the server's 60-second freshness budget. No patient identity is a key or value in the shared cache. Public routes reject all query parameters rather than accepting personalized variants. The facility cache is process-local, not distributed.

Existing patient offline features may still store that patient's own records according to their existing settings; this change does not redesign them. It does not claim that the whole application has no local patient storage. The service worker still refuses every API request. It reuses only explicit static paths; generated drafts and authenticated responses are absent from the allowlist.

Content prepared for the FAQ catalogue is not new evidence of independent clinical review. Changed catalogue text produces a different HTTP validator; deployment must bump the service-worker shell version when changing static educational assets. Do not move personal AI responses into the public catalogue or public voice cache.

## Verification

```
node --test backend/assistanceRouting.test.js backend/dayaAssistant.test.js backend/dayaSpeech.test.js
```

The tests cover zero model calls for FAQ/invalid/unapproved tasks, two identities receiving independently generated drafts, cache projection/expiry/failure, public ETags, consent, role/session checks, provider payload allowlists, budgets and existing bilingual FAQ/voice behaviour. Use an incognito window or reload once after installation for the updated widget shell. If external drafting is unconfigured, the unavailable message is expected.
