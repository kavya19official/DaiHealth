# Reports & records: manual uploads and connected-record demo

DAI now presents two entry routes into the patient report folder. Manual PDF/image uploads use the existing patient-document ownership, audit, verification and expiring doctor-sharing system. The second route demonstrates separate ABHA/ABDM and DigiLocker authorizations, with explicit source/document selection. The user confirmed that neither provider's approved access is available; there is **no live government integration**.

## What is implemented

- Optional ABHA-number/address capture after sign-in, with Later, input checks, masked display and encrypted storage. A format check is not identity verification. Nivara can choose an obviously labelled demo identity without entering a real number.
- A source-selection and authorization screen for each provider. The local mock provider is restricted to the curated Nivara account and `DAI_LOCAL=true` plus `DAI_DEMO=true`.
- Five downloadable, labelled, fictional source PDFs across multiple fictional labs/issuers. They reuse Nivara's agreed dates and distinguish the old CBC from the still-pending repeat. Refresh is idempotent by provider and external record ID.
- One patient report list merges manual documents and connected demo records, with source, date, test and issuer filters. Each original opens through an owner/consent-checked endpoint. The import does not mark clinical verification or close care gaps.
- The doctor's patient profile puts the combined report folder first. Manual files retain their existing document shares. Connected records have a separate request/approval flow with clinician, source, document type, report-date interval, purpose and 1/7/30-day expiry.
- Patients can narrow requests, approve, decline, revoke or disconnect. An ABHA entry, a physician's request, a connection or a refresh never creates a doctor grant by itself. General doctor/facility revocations and the patient's doctor-sharing setting remain authoritative.
- Original PDFs and ABHA input are AES-256-GCM encrypted with record/owner-specific authenticated data. Responses never return the raw entered ABHA number/address. Audit entries exclude raw identifiers and file contents. Originals and metadata use private, no-store responses.
- Imported records remain in the patient's folder after disconnect; clinician access is removed. Already downloaded copies cannot be recalled. Doctor previews are cleared when refreshed access is lost.
- Hindi and Marathi labels for the added route, identity, source and consent screens.

## Rehearse the video

1. Sign in as Nivara (`nivara@dai-synthetic.invalid`; the existing local mother shortcut also works). Open Reports & records.
2. Show the Manual upload and Linked records choices. For the mock demonstration, use Nivara's demo identity, select documents under ABHA/ABDM and DigiLocker, and explicitly authorize each demo source.
3. In Hemangini's account, open Nivara > Reports & results > Request connected records. Select providers, record types, dates, purpose and duration. No linked report is available before approval.
4. Return to Nivara. Review the request, narrow it if needed, tick the approval and confirm.
5. Return to Hemangini, refresh, search for CBC or the lab, filter the source and open the original PDF. Manual shares and connected consent are separate.
6. Revoke permission as Nivara. New physician list/download requests fail immediately; the UI refresh removes previews. The original stays in Nivara's own folder.

Browser verification leaves the mock sources/documents available but revokes its rehearsal consent; approve a fresh request for the recording. No government record or identity was fetched during testing.

## What is required for actual integration

ABDM: obtain approved sandbox credentials and onboarding as the appropriate HIP/HIU/PHR participant; implement the current, approved ABHA authentication, care-context discovery/linking, HIE-CM consent callbacks and encrypted FHIR exchange against the onboarded bridge. Test replay, authentication, expiry, revocation, encryption and patient matching. Do not attach real records to an account based only on a self-entered number. Only participating providers with linked records can supply them. Production exit and facility onboarding must precede a live deployment.

DigiLocker: become an approved requester; obtain the current requester/OAuth specification and registered callback/scope configuration. Implement authorization code flow, state/PKCE and server-side token storage as required by the approved specification. Patient-selected issued documents are a separate source; this is not a universal ABHA mirror. Review the permitted storage/retention terms before persisting real issuer documents. This prototype does not accept provider callback payloads, exchange real OAuth tokens or advertise configured keys as a working integration.

Official references checked 25 November 2026:

- [NHA HIP/HIU guidance](https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf): HIE-CM consent and HIP-held records.
- [DigiLocker security architecture](https://www.digilocker.gov.in/web/security-architecture): requester authorization and consent.
- [DigiLocker implementation model](https://www.digilocker.gov.in/web/implementation-model): partner onboarding and vetting.
- [DigiLocker requester terms, June 2025](https://img1.digitallocker.gov.in/circulars/termsofuse/DigiLocker-Terms-of-Use-Requester-june-2025.pdf): consent, permitted use and document storage restrictions.

## Configuration and storage

`backend/db/record_connections.sql` is applied by the local launcher migrations. `backend/recordConnections.js` is mounted by the existing Express server.

For local demos the key is generated once at `.local/record-connections.key` (mode 0600). Preserve it with the local database; losing it makes existing encrypted payloads unreadable. Keep it out of Git. A nonlocal build needs a separately managed 32-byte hex `DAI_RECORD_CONNECTIONS_KEY` to store optional identities; a key does **not** enable ABDM or DigiLocker retrieval. Do not repurpose JWT or provider credentials as an encryption key.

The mock PDFs live in `scripts/fixtures/connected-records` with the manifest `scripts/fixtures/record-connection-demo.cjs`. No fixture claims to be a real government-issued record.

## Verification

Run `node --test backend/recordConnections.test.js backend/patientContinuity.test.js backend/patientRecordSeed.test.js`. The tests cover owned encrypted identity storage, no access from identity alone, provider selection, idempotent retrieval, request/approval, narrowed dates/types, expiry, revocation, general access controls, disconnected sources, blocked direct PDFs, private cache headers and unchanged manual-document permissions/care gaps.
