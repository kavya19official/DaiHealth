# Doctor Connect

Doctor Connect offers private, immediate audio consultations in the existing patient and doctor dashboards. A patient shares their concern and identity with the clinician who accepts. An offer initially shows the assigned facility, request time, category and preferred language. After accepting, the clinician sees the stated concern and patient identification. Established patient-record permissions still control access to pregnancy context and the existing patient profile.

## Run the local demonstration

```bash
npm run setup
npm start
```

1. Open `http://localhost:3001/auth.html?role=doctor` in a separate browser profile. Sign in as `doctor@dai-synthetic.invalid` with the local demo password `Dai-Synthetic-2026!`.
2. Open **Incoming Patient Requests** and select **Available**. Keep that dashboard open. The synthetic setup gives local demo doctors a verified Nearby Care affiliation.
3. In another profile, sign in as `mother@dai-synthetic.invalid` using the same demo password. Open `http://localhost:3001/dashboard.html` if sign-in takes you to the child workspace.
4. Choose **Talk to a Doctor Now** and send a synthetic concern with sharing consent. Select the checkbox about a possible emergency to see the persistent 112 message and Nearby Care link. This choice has no effect on matching.
5. Accept the offer as the doctor. Both participants choose **Join audio call** and grant microphone access. The call view reports a peer connection after WebRTC connects, and the request records that the consultation started after both participants report a connection.
6. In the clinician's consultation card, record guidance and a follow-up or facility if appropriate. Release the note and open **Consultation history** on the patient side.

## Deployment

The launcher applies `backend/db/instant_consultations.sql` automatically. On an existing PostgreSQL deployment with the other DaiHealth migrations applied, run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/instant_consultations.sql
```

Production clinicians need a verified account and an active, verified Nearby Care affiliation accepting new patients. Availability is opt-in. An open dashboard refreshes presence, which expires after 90 seconds. Pending offers and accepted consultations count toward capacity. Existing emergency and hospital workflows are unaffected.

| Setting | Default | Purpose |
| --- | --- | --- |
| `DAI_INSTANT_OFFER_SECONDS` | 30 | Time for one clinician to respond |
| `DAI_INSTANT_SEARCH_SECONDS` | 180 | Total time to find a clinician |
| `DAI_INSTANT_SESSION_SECONDS` | 7200 | Maximum time an accepted session remains open |
| `DAI_INSTANT_DOCTOR_CAPACITY` | 1 | Maximum simultaneous offers and consultations per clinician |
| `DAI_TURN_URL`, `DAI_TURN_USERNAME`, `DAI_TURN_PASSWORD` | unset | Existing WebRTC relay for calls between networks where direct connectivity is unavailable |

Calling uses the existing remote-visit signaling store. Use a single backend instance for calls unless signaling is moved to a shared transport. Browser microphone access needs HTTPS in production, or localhost during development. Keep TURN credentials out of source control and configure a private, deployment-scoped relay. The workspace polls every 2.5 seconds while open; it requires a live connection. When saved location coordinates are available, routing checks within 25 km first. If there are no available candidates in range, or the location is missing, it searches the wider affiliated network. The patient sees when doctors are offline, busy, or considering an offer.

The clinician records the outcome and recommendations. DaiHealth has no automated emergency classification in this workflow. Released clinician notes appear in the patient's consultation history and complete-record export. The consultation does not create an appointment or grant additional access to the clinical chart.

## Tests

```bash
node --test backend/instantConsultations.test.js
# With the local demo running and Playwright Chromium installed
hospital_portal/.venv/bin/python hospital_portal/tests/instant_consultations_browser.py
```

For a headless runner without ICE interfaces, set `DAI_TEST_EXPECT_CONNECTED=false` to check signaling and the unable-to-connect outcome. Real media verification requires a browser with working ICE connectivity.
