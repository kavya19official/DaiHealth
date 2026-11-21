# Connected clinician, hospital and family workflows

## What is available

| Feature | Where | Behaviour and boundaries |
| --- | --- | --- |
| Remote follow-up | Patient / Doctor → Appointments → Remote follow-ups | Uses existing confirmed appointments, explicit patient audio/video consent, authenticated WebRTC signalling and optional TURN relay. Calls open on the scheduled date. Revoking consent or changing mode stops local media. No recording, automated diagnosis, waiting-time estimate or automatic visit completion. Local browser-to-browser connectivity is tested with synthetic media; real devices and cross-network TURN still need pilot testing. |
| Visit note and electronic prescription delivery | Doctor remote follow-up dialog | Clinician-written notes have private drafts and released snapshots. Editing a draft does not overwrite the released version. The clinician can upload an issued prescription PDF through the existing authorised upload endpoint and attach it to the released visit note. Uploading a PDF makes it visible in the patient's records immediately. DAI neither generates prescriptions nor verifies digital signatures. |
| SBAR | Doctor → Emergency & Referrals; Hospital → Facility handoffs | Source-labelled record-derived SBAR drafts and print/PDF layouts. Doctor smart/facility referrals remain permission-scoped. Hospital packets include only the already-authorised handoff summary, not the full maternal record. Missing facts stay unrecorded. Clinician review is required; no new clinical assessment is generated. Long narratives may span more than one printed page. |
| Capacity & readiness | Hospital sidebar | Bed states, neonatal bed counts, blood snapshots and scheduled staff. Bed timestamps use the oldest included confirmation; any missing included timestamp leaves the aggregate unconfirmed. A neonatal bed count does not certify a staffed NICU slot. Roster rows do not prove presence. No facility ranking or reservation is implied. |
| Quality measures | Doctor → Population analytics / Analytics; Hospital → Ward quality dashboard | Explicit recorded no-show rate, completed-referral turnaround and recorded eligible vaccine-dose coverage. Groups under 10 mothers and sparse outcomes are withheld. Doctor catchments use patient-stated ward/village. Hospital wards use recorded assignments; vaccination rows follow the newborn-to-mother link. Source ledger dates are visible. These are panel/recorded-dose measures, not population coverage. |
| SMS / WhatsApp | Patient Settings | Provider adapter, explicit consent, encrypted contact, OTP verification, India quiet hours, daily deduplication and opt-out. Disabled until configured. Delivery state means provider acceptance, not confirmed handset delivery. Existing Web Push and in-app inbox remain independent. |
| Family members | Family & consent → Invite someone you trust | A mother chooses read-only scopes, selected children and 1–30 day expiry. Invitation links are secret, email-bound, accepted once by a signed-in account, and immediately revocable at the API. Caregiver signup requires a valid invitation. Reports, wellbeing answers and clinician notes are not exposed through family scopes. Mother-only appointments plus explicitly selected children's appointments are shared. |
| Data rights | Patient Settings | Record JSON export, original-file download through Records, access-log JSON export, and permanent login closure with sharing/reminders revoked. Closure anonymises the login identity and blocks existing sessions on subsequent authenticated requests. It does **not** erase clinical records: records and audits remain pending retention review. The existing record-erasure review request stays separate. This is not a claim of certified legal compliance. |
| Benefits / entitlements | Schemes & support | PMMVY, JSY, PM-JAY and JSSK have programme-specific conversation questions and document guidance reviewed against official sources on 21 November 2026. Other scheme entries keep their earlier review dates. Eligibility is only a prompt to seek official confirmation; there is no government submission, approval or transport booking. |

## Activation

Restart with `npm start` from the repository root to apply `connected_care.sql`. No new production package dependency was introduced. Caregiver access uses `/caregiver.html`; the mother copies an invitation URL herself. No invitation email is sent automatically.

WebRTC works only with browser media permission and a secure context (HTTPS or localhost). For reliable calling across NAT/firewalls, configure a TURN service approved for the deployment:

```text
DAI_TURN_URL
DAI_TURN_USERNAME
DAI_TURN_PASSWORD
```

TURN credentials are returned only to authorised participants of a consented, scheduled visit. Signalling is transient process memory with an hour expiry; it is not a recording or durable call service. A server restart loses signalling state. Media, device compatibility, call reliability, network metadata handling and clinical telemedicine procedures need pilot validation before deployment. No third-party relay is chosen automatically.

SMS / WhatsApp uses the injectable provider interface in `backend/providerNotifications.js`. The included adapter calls Twilio's Messages API with a fixed generic reminder or verification template:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
DAI_MESSAGE_ENCRYPTION_KEY       # 64 hex characters; retain securely across restarts
TWILIO_SMS_FROM
TWILIO_WHATSAPP_FROM
TWILIO_WHATSAPP_REMINDER_CONTENT_SID
TWILIO_WHATSAPP_OTP_CONTENT_SID
```

Use approved senders/templates and confirm country-specific provider requirements. WhatsApp templates must be configured for the generic reminder and OTP (OTP variable `1`). Generate the contact-encryption key securely, for example `openssl rand -hex 32`, and place it in deployment environment variables; never commit it. Rotating it requires re-verifying stored contacts. Provider setup may incur costs. OTP requests are limited and reminders use 9 PM–8 AM India quiet hours. Failed sends are recorded without automatic retries. No real SMS or WhatsApp was sent during automated testing.

## Data meaning and safety

- Source datasets are synthetic where labelled in the existing portals; no real-world quality performance is claimed.
- No new risk score, care-gap rule, autonomous clinical decision, medicine advice or ranking was added.
- Staff attendance and staffed NICU-slot confirmation are not connected. Unknown values remain unknown.
- Historic hospital handoffs lacked referral timestamps. New explicit handoffs now record creation/completion times. Old missing turnaround times are excluded; transport time is never substituted for referral turnaround.
- Account closure does not remove retained hospital records or replace a hospital's own authorisation and retention policies. Previously exported/shared copies cannot be recalled, and a message already accepted by a provider may still arrive.
- Quality reporting uses small-group and small-outcome suppression, fixed query windows, and an audited 15-minute snapshot for doctor reports. Current consent scope is checked before reusing a snapshot. This is not formal differential privacy.
- Record export covers DAI patient records, including new check-ins, growth, released remote notes and released stay updates. Original file bytes are downloaded separately; unrelated external hospital-system records are not automatically exported.

## Validation commands

```sh
node --test backend/connectedCare.test.js backend/localMigrations.test.js backend/patientSupport.test.js
npm test --prefix backend
hospital_portal/.venv/bin/python -m pytest hospital_portal/tests/test_connected_care.py hospital_portal/tests/test_workspace.py hospital_portal/tests/test_administration.py -q
npm run typecheck --prefix hospital_portal/web
npm run build --prefix hospital_portal/web
```

DOM checks use a development-only jsdom installation:

```sh
npm install --prefix /tmp/dai-ui-test jsdom@29.1.1
NODE_PATH=/tmp/dai-ui-test/node_modules node scripts/test-connected-care.cjs
```

Tests cover consent withdrawal, private versus released note versions, owner isolation, family scopes/twin selection and revocation, exports excluding private drafts and password hashes, contact verification, encrypted contacts, deduplication, no fabricated delivery, clinical-access revocation on closure, freshness handling and suppression. Browser DOM checks verify consent before media, media-track cleanup, the SOS action, missing-provider state and invitation scope selection. An additional two-browser headless Chrome test exchanges synthetic video/audio and verifies that both participants stop their media after consent withdrawal, without page errors or API 5xx responses. Real devices, cross-network TURN connectivity, signed-prescription validity, provider delivery, mobile layout, print pagination and clinical/governance validation remain unverified.

The pre-existing Next.js 16.4.2 dependency triggered its build security guard. It has been patched to 16.4.6 within the same minor version. The production build completes, and a fresh npm audit reports zero dependency vulnerabilities. No security guard was bypassed.

## Primary sources

- [Telemedicine Practice Guidelines, Ministry of Health](https://www.mohfw.gov.in/pdf/Telemedicine.pdf)
- [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource)
- [WebRTC peer connections and TURN](https://webrtc.org/getting-started/peer-connections)
- [PMMVY — Ministry of Women and Child Development](https://www.wcd.gov.in/offerings/pradhan-mantri-matru-vandana-yojana)
- [PMMVY documents — Delhi WCD FAQ](https://wcd.delhi.gov.in/sites/default/files/WCD/generic_multiple_files/faqs.pdf)
- [JSY — National Health Mission](https://www.nhm.gov.in/nhm/index1.php?lang=1&level=3&lid=309&sublinkid=841)
- [PM-JAY — National Health Authority](https://nha.gov.in/PM-JAY)
- [JSSK — National Health Mission](https://nhm.gov.in/nhm_live/index1.php?lang=1&level=3&lid=308&sublinkid=842)

## Additional browser and review regression checks

```sh
npm install --prefix /tmp/dai-browser playwright-core
NODE_PATH=/tmp/dai-browser/node_modules node scripts/test-remote-call-browser.cjs
node --test backend/postpartumInfant.test.js
```

The browser check uses an isolated temporary profile and generated media only. Set `DAI_TEST_BROWSER` to a compatible Chromium executable on other machines; the default is the local Chrome application path on macOS. No real camera, microphone, personal browser profile or provider message is used.

Postpartum wellbeing sharing now has a dedicated clinical-review category so that it cannot replace an unrelated pending clinical-recommendation request. Infant sleep charts show only entered durations, never a fabricated zero when duration is missing.

Closed-account denial is also part of the central clinician-access SQL guard, so a new appointment or restored grant cannot reopen a closed patient record through DAI clinician APIs. The clinical-retention review remains separate.

Remote-consultation consent choices are recorded atomically in the existing patient access-event history. Withdrawal preserves the prior grant timestamp and adds a withdrawal event rather than erasing evidence of the original choice.

Final local verification: 303 backend tests passed, one external-Postgres test skipped; 13 hospital tests passed; focused consent/closure checks and DOM checks passed; the two-browser synthetic-media call test also verified private drafts and clinician release. TypeScript, the production build and npm audit passed. Restart DAI to apply migrations and reload the patient page to receive the updated static cache.
