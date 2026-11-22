# DaiCare and postpartum mental health

The patient dashboard’s **After delivery** panel includes a private mood check-in and the Edinburgh Postnatal Depression Scale (EPDS). **Appointments** includes the DaiCare directory and booking history. Verified clinicians use the Doctor dashboard’s **Appointments** panel to publish slots, confirm or decline requests, join calls, document follow-up and work through assigned mental health referrals.

## Screen, share and follow up

- The English EPDS uses all ten items, their original response order, and the seven-day recall period. A score of 13 or more flags clinical follow-up. Any nonzero response on item ten takes priority and presents immediate safety guidance, including India’s emergency number, 112. The service supports human assessment and follow-up. The screening does not establish a diagnosis.
- The dashboard and notification center prompt a private mood check-in every seven days. Multiple updates on the same day replace that day’s mood. Patients can request help at any score.
- The patient separately consents to sharing their name, screening total and priority with the assigned clinician. Individual answers remain in the patient’s record. The queue shows whether a request is waiting, assigned, acknowledged, resolved or withdrawn. A worker checks every 30 seconds for verified on-call coverage and reassigns unacknowledged requests when coverage expires. An assigned clinician sees an in-app notification and must monitor the dashboard and acknowledge referrals. The app does not send emergency dispatch, SMS or pager alerts.
- The mother can withdraw the referral share or turn off a clinician from the existing access controls. Screenings, visits and mood check-ins are included in the patient’s data export. Sharing changes and clinician record views feed the existing consent audit trail.
- AI assistance is optional and disabled by default. With explicit patient approval it sends EPDS totals and aggregate mood counts to the configured Gemini API. It sends neither identifiers, notes nor item-level answers. Its output can flag a case for additional human review and cannot change the EPDS score or override the item-ten path. Review provider terms and local clinical governance before enabling it with patient data.

EPDS source and reproduction attribution: Cox JL, Holden JM, Sagovsky R (1987). Detection of postnatal depression: development of the 10-item Edinburgh Postnatal Depression Scale. *British Journal of Psychiatry*, 150, 782–786. See the [instrument and scoring guidance](https://www.cope.org.au/health-professionals/screening-and-assessment-tools/using-the-epds-as-a-screening-tool) and the [source noting permitted reproduction with attribution](https://health.mo.gov/sites/health/files/media/pdf/2026/04/EPDS.pdf).

## Enrol real verified clinicians and schedule on-call coverage

Use an existing clinician account. An operator verifies that person’s registration, identity, public clinic contact, scope of practice, coverage area, and qualifications with the appropriate medical council and records the verification reference. See the [India telemedicine practice guidelines](https://www.mohfw.gov.in/pdf/Telemedicine.pdf). The tool binds the published listing to the existing account and exact registration number. It never publishes existing synthetic profiles automatically.

Create an operator-owned JSON file with the following fields. Use documented, verified facts in place of the examples.

```json
{
  "council": "Verified medical council name",
  "registration_number": "Matches the clinician’s DaiHealth record",
  "qualification": "Verified qualification",
  "city": "Mumbai",
  "state": "Maharashtra",
  "public_contact": "Public clinic contact",
  "languages": ["Hindi", "English"],
  "pincodes": ["400001"],
  "modes": ["video", "audio", "home"],
  "mental_health": true,
  "verification_ref": "Private evidence reference including reviewer and date"
}
```

Only set `mental_health` for a clinician approved for this service, such as a psychiatrist or another credentialed mental health clinician working within their authorised scope. The current network uses existing DaiHealth doctor accounts. Home visits only appear for the exact verified six-digit PIN. Remote consultations can be offered across India according to clinician coverage and availability.

```bash
node scripts/daicare-directory.cjs approve DOCTOR_ID /secure/path/profile.json
node scripts/daicare-directory.cjs shift DOCTOR_ID START_ISO END_ISO
node scripts/daicare-directory.cjs suspend DOCTOR_ID
```

The operator supplies `DATABASE_URL` for PostgreSQL. For embedded PGlite, stop DaiHealth and set `DAICARE_MAINTENANCE_DB_DIR` to the existing database directory, usually `.local/patient-db`, or `/var/data/patient-db` in the Docker demo. Run the commands with exclusive database access, then restart. Start and end times take timezone-qualified ISO values such as `2026-11-23T09:00:00+05:30`. An operator can roster up to 24 hours per shift. Keep a coverage handoff and a verified contact procedure outside the application for clinical operations.

No real clinician has been enlisted by this change. Verified national coverage depends on actual enrolment and a staffed on-call rota.

## Consultation flow

A patient searches by consultation type, specialty, city/state or PIN. Each 30-minute booking starts as requested and needs clinician confirmation. For home visits, the confirmed clinician can see the service address, and it disappears from the clinician’s view after cancellation or withdrawal. Booking grants access to its own details. The patient can separately share a time-limited, read-only care summary from the existing clinical dashboard. After the visit, they can acknowledge a clinician’s follow-up note and date. DaiCare membership alone does not grant broader record access.

Audio/video calls reuse DaiHealth’s authenticated WebRTC media flow, open ten minutes before the appointment and stay available for 75 minutes after the start. Use HTTPS or localhost and browser microphone/camera permissions. On different networks, provision a dedicated TURN relay and test it. Signaling is stored in memory, so use a single application instance or add shared signaling state before scaling. Records and consent are persisted in the database. Backend signaling access is revoked on the next request, and the supported client ends media at its next access poll. A peer-to-peer call has no central media server to forcibly disconnect a noncompliant client.

## Local and Render setup

Run `npm start` from the repository root. The existing local and Render Docker launchers apply `backend/db/daicare.sql`. For standalone PostgreSQL, apply after existing migrations:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/daicare.sql
```

Keep all existing deployment secrets and database settings. In the backend service’s private environment, configure these only when using the associated service:

| Variable | Purpose |
| --- | --- |
| `DAI_TURN_URL`, `DAI_TURN_USERNAME`, `DAI_TURN_PASSWORD` | Existing WebRTC relay configuration. Use a dedicated scoped relay credential provided to room participants. |
| `DAICARE_AI_ENABLED` | Set to `true` only after approving the optional AI service and data flow. |
| `GEMINI_API_KEY`, `DAICARE_AI_MODEL` | Existing backend key and a Gemini model supporting structured JSON output. |

Run `npm ci --prefix backend` and `node --test backend/daicare.test.js` for the targeted regression tests. The provider stub verifies the bounded AI response contract without sending patient data. For a real remote call check, use separate patient and doctor sessions on different devices/networks.
