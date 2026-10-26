# Bounded calls and clinician decisions

This update is based on a0b6aa3. It adds bounded, duplicate-resistant general drafting and a human review queue. It does not establish clinical validity, verify an actual professional licence with a regulator, or provide an emergency dispatch service. Tests and walkthroughs use synthetic accounts and records.

## One bounded request

`POST /api/assistance/complex` continues to accept only task, language and explicit approval. Its body is limited to 1024 UTF-8 bytes. It constructs one fixed structured JSON provider request and accepts no conversation, document, clinical summary or full medical history. There are no agent/tool loops and zero automatic retries. The provider timeout is 15 seconds; the browser has a 20-second deadline. Output remains capped at 700 tokens and 6000 displayed characters.

One in-flight draft per authenticated user prevents parallel fan-out, including requests for different tasks. Repeating the same task/language waits 30 seconds before a new approved attempt. The existing five-request/ten-minute per-user process-local budget remains. Failure also consumes one attempt and has the same pause; it never silently retries. Only task/language/timestamp and in-flight state are retained, not a generated draft. These guards are per Node process and reset on restart; they are not a distributed quota or a durable exactly-once guarantee. No saved output is silently reused for another patient.

FAQs and form validation stay local. Prepared voice is no longer generated while typing, hovering or focusing FAQ buttons. A voice request occurs for an actual reply playback and uses the existing prepared-content-only cache. This removes speculative voice calls; it does not disable voice or emergency help.

On successful drafting, the routing settings collapse and the reply is scrolled into view automatically. A model response has no ability to change clinical state, access records, create an appointment or approve care.

## Human review in both dashboards

Patient: Care timeline → **Clinician review requests**. Choose pregnancy risk, clinical recommendation, or medical document interpretation; provide a 5–1000 character relevant summary, not a copied history. A document request requires an owned document ID and separate sharing through Records. Requesting review does not grant access. The form does not send anything to an external AI service.

Doctor: Home → **Clinician review requests**. A doctor needs verified credentials through the existing clinical-account verification gate, an active care-team relationship, and no patient/facility revocation. For documents, an active share/privacy permission is additionally required. The clinician reads the original relevant record, explicitly confirms review, and records a patient-visible decision/reason plus evidence reference. Escalation assigns the signing clinician as owner. Only that owner can close it. State/version and source-permission checks run again at sign-off; short transaction locks prevent access/credential changes racing the commit. These prototype locks can delay unrelated updates while a review transaction completes; no model or external call occurs inside the transaction.

Patient and authorised doctor can refresh to see the updated state and audit. Events are appended, not overwritten. Decisions carry reviewer identity and evidence reference. New health logs invalidate an older sign-off version; a changed patient summary is also versioned and retained in history. Finished decisions cannot be silently edited. An audit read is not proof that a clinician has acted. Requests without an available authorised clinician remain pending and must not be described as reviewed or low risk.

The existing document extraction/verification workflow now requires verified clinical credentials, not merely a nonempty licence string. Original-file hash, source confirmation, value/unit confirmation, consent, privacy and append-only version checks remain in place. The new clinical queue records interpretation/review notes; it does not automatically certify extracted observations as a verified structured report. Use the existing Records intake-verification workflow for that separate action.

## Legacy automatic risk classification

Registration and POST /api/risk/assess no longer run the prototype kNN classifier or write a medical risk label. Submitted registration measurements are preserved as self-reported health logs with units/source; an initial human review is queued. A blood-pressure/glucose health log still saves normally and queues/refreshes a human review. Repeated logs update its version and audit rather than creating duplicate open requests. The manual risk action accepts an empty body; measurements must first be saved in Health logs so the clinician can inspect an original record.

Historical classifications remain in the database for provenance. GET /api/risk and served trend responses do not present historical automated classifications as clinician approval. The historical pure model code remains for offline tests only. Raw vital trends, deterministic safety signals, SOS and postpartum/emergency rules are retained. No safety threshold, access requirement or human-review step was loosened to save compute. Other synthetic source records and clinician-marked source flags are not rewritten by this migration.

The Hospital/Admin synthetic risk-review demo remains separate, with its existing case-version gate, reviewer evidence, named escalation owner and audit. Its simulated review is still not externally verified clinical approval. A production clinical workflow needs qualified oversight and validation; the software gates alone do not provide that validation.

## Install and check

The root local launcher applies `backend/db/clinical_review_requests.sql` through the existing seed/migration list before startup. Existing patient edits and histories are retained. For a separately operated PostgreSQL deployment, apply that migration after the existing schema before starting the updated backend. Do not upgrade a shared production clinical service using an unreviewed demo ZIP.

Relevant tests:

```
node --test backend/assistanceRouting.test.js backend/clinicalReview.test.js backend/documentIntake.test.js backend/patientContinuity.test.js backend/patientTimelineIntegration.test.js backend/careRules.test.js backend/dayaSpeech.test.js backend/clinicalDashboard.test.js
```

Checks cover duplicate/concurrent-call blocking, context and output budgets, review-only medical task routing, credential and consent rejection, clinician/owner scope, version conflicts, updated context, source sharing, append-only history, actual backend registration/log/review paths, and retained deterministic emergency/postpartum behaviour. Browser checks use the real SQL-backed review routes and the unchanged widget assets in a synthetic harness; the external provider is mocked. No new paid external API request or real patient data is required to verify this update.
