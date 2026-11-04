# Patient care-step workflow and live timeline

Implemented for the existing HTML/JS patient interface and Express API. No clinical decision or diagnostic model is added.

## Evidence provenance

XState v5 in `backend/careStepMachine.js` guards this server-side workflow:

`planned → patient_reported → evidence_submitted → awaiting_review → clinician_confirmed`

Uploading evidence can start directly from a planned step: a patient need not falsely claim completion first. Evidence submission and queueing are consecutive audited transitions in one transaction. The evidence-submitted state is retained in the audit trail; the current card then says awaiting review. Self-reporting never produces clinician confirmation. Existing records without a verification source remain patient-reported in the timeline; they are not silently upgraded.

The existing patient-owned completion endpoint records only a self-report. Report upload checks milestone ownership, separates mother and child records, and stores the original file through the existing documents API. An uploaded report does not automatically grant a doctor access: the patient must share it using Reports & records. Existing credential, consent, expiry and revocation checks remain in force for clinician review. Linked milestone and document updates plus workflow events are transactional. Reviewing a superseded document cannot confirm the replacement evidence.

`clinician_confirmed` means the clinician's linked report review was recorded. It is **not** a diagnosis, a safety verdict, or proof of an entire care pathway's completion. The UI says “Reviewed by your clinician”.

## SSE

`GET /api/patient/timeline/events` uses the existing authenticated HTTP-only cookie and mother-role guard. It has no patient-ID parameter and never puts a token in a URL. Events contain only a refresh instruction and opaque content hash, not clinical values, report text or another patient's identity.

The server checks that patient's persisted milestone snapshot every two seconds and emits only when it changes. This works for writes in other processes too; it is SSE with server-side polling, not PostgreSQL LISTEN/NOTIFY. Each connection gets an initial refresh, including after reconnect, so missed events converge to the current source of truth. Heartbeats, no-buffer headers, expiry handling and two-minute connection renewal are provided. Connection close clears timers. The browser closes streams on page hide/offline and pauses in low-bandwidth mode. Its existing thirty-second timeline polling remains the fallback; initial/reconnect snapshots prevent missed updates. Production scale should replace per-connection database polling with a scoped shared outbox/pub-sub service.

## Help me with this step

`POST /api/patient/timeline/:id/assist` is a bounded, deterministic guided agent, not a new generative AI model. Its permitted tools read the authenticated patient's own step, match services explicitly named in it, prepare clinician questions and return a request draft. Tool use is logged in `care_step_assistance_log`. It does not collect location, send data to a third party, interpret a report, decide what care is necessary, or write an appointment/reservation. Service freshness and missing data remain explicit. No matching service yields an empty result, not an invented recommendation. The existing appointment form provides final doctor/date selection and its review/send confirmation. A failed help request leaves ordinary visit and report actions available.

## UI

Current chapter / Earlier care / All steps, mother/baby separation, category filters, evidence progress, read-aloud, contrast, reduced motion, export and record history remain reachable. Ancillary coordination and simulation panels are under Clinician notes & edit history. No decorative timeline image is introduced. Existing purple palette and theme tokens are reused. Mother and baby report linking stays separate.

## Local run

From the repository root, `npm start` installs the pinned XState dependency and applies the new idempotent `backend/db/care_step_workflow.sql` migration. For a manually managed PostgreSQL deployment, apply that migration before starting the API. Restart the API for the new routes. The patient service-worker cache is versioned so the next load obtains the updated scripts.

Checks: `node --test backend/patientTimelineLive.test.js backend/patientJourney.test.js`, then `cd backend && npm test`. Integration coverage includes original upload, explicit sharing, clinician review, invalid XState guards, SSE patient isolation, reconnect, expiry and guided-help ownership/no writes. Browser layout QA requires enabled local browser access in Codex Work settings.
