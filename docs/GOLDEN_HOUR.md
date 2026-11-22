# Golden Hour — emergency pre-alert (prototype)

One tap from a mother, or from a family member she has authorised, runs a danger-sign check. If it trips, DAI
picks the **nearest facility that actually has the capability needed**, builds an SBAR handover (last BP readings,
blood group, allergies, current medicines, gestation, ETA) and sends it to that hospital's portal **before the
patient arrives**. The hospital sees a live incoming-patient card, hears an alert, and a consultant or hospital
administrator taps **Accept** or **Cannot accept**. The mother's screen follows the reply.

> **PROTOTYPE, synthetic data only.** No real hospital, ambulance or clinician is contacted. The ambulance feed
> is simulated from the ETA. A pre-alert is not a bed, a dispatch or a diagnosis. Every screen tells the user to
> call **112 / 108** and not to wait for the app.

## Safety rules (enforced in code and tests)
- **Triage is deterministic.** `shared/emergency-triage.js` (the existing audited table) decides the level. The
  server re-runs it; a browser cannot supply or change a level. No language model is involved anywhere.
- **Capability, not just distance.** `shared/golden-hour.js` holds a fixed table of what each danger sign needs
  (e.g. heavy bleeding -> 24x7 emergency maternity + blood transfusion). A nearer facility that lacks a requirement
  is **skipped and the skip is shown** ("SYNTHETIC South Mother Care Centre, 0.0 km, was nearer but lacks emergency maternity and blood transfusion").
- **Double check at the hospital.** The portal re-validates the receiving facility against its own listed
  capabilities and refuses an alert it cannot handle (HTTP 422), even if the sender was wrong.
- **Honest failure.** If the portal cannot be reached, the patient is told the hospital has **not** been told, with
  a Retry button. If no facility qualifies, nobody is alerted and she is told to call 112 / 108.
- **Decline re-routes.** A decline needs a reason; the alert moves to the next capable facility, never one already
  tried. If none is left she is told to call 112 / 108.
- **Self-harm wording is never shared** in a hospital alert or with family (the patient's own emergency flow keeps
  Tele-MANAS 14416).
- **Minimal location.** Approximate point (~110 m) only; Delhi PIN or permission-based device location.
- **Synthetic accounts only and local demo only** (`DAI_LOCAL=true`, `DAI_DEMO=true`). Real accounts get a message to call 112.
- **Family permission is explicit.** Family can start an alert only if she ticked **"May start an emergency alert
  for me"** in Family Circle (custom categories; not part of any preset). It shows them none of her records.
- One open alert per patient, idempotent on retries and double taps; every staff read and decision is audited.

## Demo (split screen)
1. `npm start`. Phone: sign in as `mother@dai-synthetic.invalid` (password in README). Laptop: Hospital portal ->
   `hospital_admin@dai-synthetic.invalid` -> Facility context selector -> **SYNTHETIC West Referral Hospital** -> open
   **Golden Hour · incoming** (the beep and banner work on any screen once you have clicked once, or press "Enable alert sound").
2. Phone: red **SOS** -> tick *Heavy bleeding* -> **Alert the nearest capable hospital** -> PIN `110017`
   (Malviya Nagar: the South centre is right there, 0 km, but it cannot manage heavy bleeding) -> **Send emergency pre-alert**.
3. Laptop beeps, a red banner and the incoming card appear: ETA, simulated ambulance map, last BP 148/96,
   blood group, allergies, medicines, gestation, SBAR, and "Why this hospital": *the nearer South centre was
   skipped because it lacks emergency maternity and blood transfusion*.
4. Laptop: **Accept incoming patient**. Phone: stepper moves to *Hospital accepted*; the 112 / 108 / 102 buttons stay on screen.
5. Try **Cannot accept** with a reason: the alert re-routes. Or sign in as `family@dai-synthetic.invalid` on
   `/caregiver.html` and start the alert as a family member.
Also: Dai Didi's emergency hand-off opens the same flow with the danger signs pre-filled.

## Pieces
| File | Role |
|---|---|
| `shared/golden-hour.js` | Requirements table, `pickFacility`, ETA estimate, `buildSBAR` (pure, deterministic) |
| `backend/goldenHour.js`, `db/golden_hour.sql` | Patient/family API, triage re-run, facility pick, signed forward to the portal, status polling, re-route |
| `hospital_portal/api/golden_hour.py` | Incoming alerts, capability re-check, accept / decline / arrived, simulated ambulance, audit |
| `hospital_portal/web/app/golden-hour.tsx` | Alarm tone, banner, incoming card, SBAR, accept / decline; "Golden Hour · incoming" board |
| `frontend/js/golden-hour.js/.css` | Patient and family sheet and live status |
| `scripts/seed-golden-hour-demo.cjs` | Demo BP readings, blood group, allergies, medicines, family account (non-destructive) |

## Config
`DAI_PORTAL_API_ORIGIN` / `JWT_SECRET` (existing bridge), `DAI_GH_SIM_SPEEDUP` (default 8: the simulated ambulance runs 8x faster so a demo is watchable, 1 to 60).

## Known limits
- Network is the synthetic Delhi demo (5 facilities); matching is only as good as that listing, which must be confirmed by phone in real life.
- ETA is straight-line x 1.35 at 28 km/h + 6 min dispatch: an estimate, not live traffic. Ambulance position is simulated.
- Short polling every 3 s (no WebSocket). "Accept" is one consultant or administrator tap; no on-call rota or escalation.
- The referral-continuity / smart-referral-handoff modules are not wired in yet; an accepted alert does not create a referral record.
- Tests: `backend/goldenHour.test.js` (15, run in CI). `hospital_portal/tests/test_golden_hour.py` follows the existing portal test style.
