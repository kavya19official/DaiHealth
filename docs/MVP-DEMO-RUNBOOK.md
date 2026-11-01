# DaiHealth MVP video runbook

Synthetic prototype only. Use fictional entries and describe all availability, risk cases and forecasts as demonstrations. Do not enter real patient data.

## Start and rehearse

```bash
npm run demo
```

Keep the terminal open. First startup installs dependencies, generates/imports the cohort and builds the hospital interface; allow several minutes. Later starts preserve saved edits. Open http://localhost:3001/auth.html?demo=video for an optional collapsible recording guide. Hide it before recording. Normal `npm start` still works without the optional video fixtures.

Use three separate browser profiles (or different browsers), one per role. Tabs in the same profile share authentication cookies and can silently change the current role. All default synthetic accounts use `Dai-Synthetic-2026!` unless you configured a different demo password.

| Profile | Account | Destination |
| --- | --- | --- |
| Patient | mother@dai-synthetic.invalid | /dashboard.html |
| Doctor | doctor@dai-synthetic.invalid | /doctor.html |
| Hospital / administration | hospital_admin@dai-synthetic.invalid | /hospital-admin |
| Separate risk-review scene | consultant@dai-synthetic.invalid | /hospital-admin |

Hospital sign-in displays a synthetic OTP; no SMS provider is required. After five rapid OTP requests, wait five minutes. Do not disable the login protection. Restart after installing this update; refresh the browser once so its service worker replaces the old shell.

## Suggested 6–8 minute recording

1. **Registration (30 seconds).** Register a new fictional mother using a unique `@dai-synthetic.invalid` address. Show the account and initial timeline. Explain that this is a new account; then sign in as the seeded mother for the populated longitudinal story. A newly registered patient does not inherit someone else's imported history.
2. **Maternal and child continuity (60 seconds).** Show Home, Care timeline, Pending care and Follow-up help. Show the seeded children's separate records and visit/vaccination information. Completion is recorded, not inferred. A genuine empty state is valid; never imply it is a failed medical result.
3. **Explainable care discovery (45 seconds).** Nearby care → “Find care — synthetic Delhi journey”. Set PIN `110017`, choose Pregnancy check-up, then Find matching fictional care. Show service eligibility, approximate distance, preference explanations and the explicitly sourced synthetic slot. Select **SYNTHETIC South Mother Care** and request an appointment with consent and a future date. The request is coordination, not a reserved real-world slot.
4. **Hospital handoff (60 seconds).** In the hospital profile, Operations → Patient requests. Use **Facility context** to select SYNTHETIC South Mother Care. Accept the patient's request, select an authorised clinician and record a future appointment time. Video mode adds a labelled synthetic affiliation for the seeded mother's existing clinician where source records are available; choose that clinician to connect the doctor scene. If another authorised clinician is selected, show the request in their context instead. Refresh the patient Appointments view: the hospital-managed request and saved status are mirrored there. Manage/cancel requests in Nearby care, separate from ordinary doctor appointments.
5. **Doctor review (60 seconds).** In the doctor profile, show the assigned roster and Appointments → Hospital-coordinated requests. This feed is read-only and separate from the clinic queue. The “Open authorised patient record” action appears only when there is an existing record relationship. Show shared documents, open an original, and use the existing report-review workflow. Only explicitly shared reports are available. Demonstrate a saved in-app message and, separately, an existing clinic queue transition; a hospital coordination request does not become a second queue booking automatically.
6. **Follow-up (45 seconds).** Hospital Patient requests / follow-up area: create a logistics follow-up for the request with a named owner and due date. Patient Care timeline: refresh, acknowledge and report completion. Staff reviews the report and closes it with fictional evidence. Refresh the patient timeline to show the shared closed state and event history. Patient-reported completion alone is not staff verification.
7. **Separate risk-review simulation (45 seconds).** Sign in as the consultant, switch to the receiving facility, review a synthetic case with an explicit simulation acknowledgement, record the reason and evidence reference, and select an escalation owner. Show patient-visible status, owner acknowledgement, disposition and audit. Say: “This demonstrates the human review and escalation workflow; it is not a validated prediction or proof of independent clinical approval.” Do not describe fictional test evidence as a real clinician sign-off.
8. **Hospital and administration (60 seconds).** Show recorded bed readiness, roster, referrals and the distinction between historical snapshots and live availability. Switch to Administration for staffing, resource records, Green hospital and audit. Video resource fixtures are estimated and visibly synthetic; there is no claim of measured environmental savings. End on the patient's updated timeline.

## Verification before recording

With the services running, in a second terminal:

```bash
npm run check:local
npm run check:demo
```

`check:demo` deliberately writes labelled synthetic registration, request, follow-up, message and risk-simulation records, and closes its workflow. It is restricted to the local demo. Do not run it during recording. Repeated tests leave audit history; records persist across restarts. There is no automatic destructive reset.

For source regression checks:

```bash
npm --prefix backend test
python -m pytest hospital_portal/tests -q
npm --prefix hospital_portal/web run build
```

Use the launcher's Python environment or install `hospital_portal/requirements.txt` in a suitable virtual environment first. See the audit for the tested environment and scope.

## If a screen looks empty

Confirm that the header shows the signed-in person, not Guest. Select the correct hospital Facility context and refresh the active panel. Wait for startup to finish. If the service is unavailable, restart `npm start` and use Retry; do not paste tokens into DevTools. Patient permissions, revoked sharing, facility scope and an empty search can correctly produce no records. Rebooking a missed care item prepares the booking form; it does not alter an existing appointment. Missing backend data is never replaced with a fabricated clinical result.
