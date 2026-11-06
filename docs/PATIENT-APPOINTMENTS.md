# Patient Appointments: boarding-pass interface

Implemented 6 November 2026. Presentation-only changes: existing API routes, database models, permissions and consent checks are unchanged.

## What changed

- One next-visit ticket with recorded date/time, visit type, clinician, facility/room, separate patient chips, explicit clinic status and a small Demo badge. Free-text demonstration notes are retained inside Visit details, rather than becoming the headline. The hero is excluded from the Upcoming list.
- Upcoming/Past/Cancelled controls and a separate Requests tab with a count when records exist; otherwise a compact Requests chip. The hospital request mirror is mounted inside that tab, never above the page.
- Readable default week strip, month switch and day drawer. Appointment type uses icons plus labels. Missing dates stay missing; no fictional arrival time, waiting time or ETA.
- Three-step booking sheet (Who / What / Where & when), reusing the existing booking validation, options and request-window endpoints. Map tiles load only after Show centre map. Windows remain demo request windows from the current backend configuration, not guaranteed clinician availability.
- Optional browser speech input fills patient/type fields without submitting. Unsupported browsers keep the complete text form. Recognition can use the browser's external speech provider, and starts only on a microphone click.
- Existing calendar export, cancellation, rescheduling, visit-detail export, records navigation and companion preparation remain reachable. The preparation checklist is temporary UI state; companion question drafts are labelled unreviewed and use the existing companion flow.
- Released summaries are below the appointment content, in a designed empty/filled section. The endpoint still returns only clinician-approved summaries. No generated summary is added.

## Recorded state boundaries

The clinic API has pending, confirmed, completed and cancelled. Its tracker displays Requested → Clinic confirmed → Visit recorded → Summary released, with unrecorded steps left unrecorded. It never manufactures a separate Accepted state. Patient-reported completion, when explicitly supplied, is a separate tag and cannot advance staff confirmation.

Hospital coordination has requested, accepted, scheduled/referral_coordinated, closed, declined and cancelled. Its tracker uses recorded request events, independently of clinic bookings. Coordination closed does not assert a clinical visit occurred.

The released-summary endpoint does not return the appointment ID. Summaries therefore remain a separate authorised section: they are not matched by date/name/reason and do not advance an individual ticket's final step.

The booking API accepts one child_id. The sheet explains that babies need separate requests. Twin avatars appear together only if a record actually supplies multiple child_ids; coincident dates never create a combined twin booking.

## Updates, QR and integrations

The page checks existing appointments and hospital request endpoints every 15 seconds while signed in, online, visible and not in low-bandwidth mode. This is **polling**, not SSE/WebSocket realtime. An actual successful clinic response updates the checked timestamp. The backend bridge and existing staff-authorised workflows remain responsible for saving changes.

The QR is generated lazily in the browser from the already installed qrcode package, with its licence and dijkstrajs licence. It encodes only DAI-APPT-<id>, never names, reports, tokens or an access grant. It is labelled Prototype reference only: no check-in scanner or secure verification endpoint exists. It must not be used as authentication.

Native CSS and the optional View Transitions API provide motion, with a reduced-motion fallback. No Framer Motion/GSAP dependency was added. The map reuses existing Leaflet and OpenStreetMap; coordinates come from the selected recorded facility. No location permission, routing service or fabricated distance is required for this map.

Offline saved records remain reachable, but the new booking sheet requires a connection; it does not claim a background request was submitted. Appointment-specific push/SMS reminders and wallet passes are not part of this change. Existing generic opt-in timeline push remains separate.

## Checks and regeneration

```sh
node scripts/sync-appointment-qr.cjs
node --test backend/patientAppointments.test.js backend/patientConnected.test.js
npm test --prefix backend
npm run typecheck --prefix hospital_portal/web
```

New model tests check hero deduplication, true status mapping, missing dates, India-time countdown, explicit twin identity, Hindi/English voice parsing and QR equivalence to the installed library. Connected-screen tests check polling updates and request-tab separation. One existing assertion changed from old “awaiting confirmation” wording to the new explicit Requested label; unrelated records and twin-vault tests are retained.

Signed-in DOM interaction checks exercise the ticket, reference QR, week/month/day drawer, three booking steps, voice fallback, request mounting and summary placement. They do not submit a booking or send any message. DOM checks do not prove visual fit or native browser behaviour.

Browser use is disabled in Work settings, so actual 1440/1024/390 screenshots, light/dark Hindi visual QA, microphone accuracy, native calendar import, map tile rendering and the hospital-acceptance demo video remain unverified. These are not replaced by the DOM checks. No new clinical or ML performance claim is made.

### Measured checks

- Full backend run: **268 tests, 267 passed, 0 failed, 1 skipped**. The subsequently added focused polling/request-tab regression passed with the latest focused set (**11 passed, 0 failed**).
- TypeScript passed. Separate-output Next production build passed; its temporary generated configuration and build output were restored/removed after the check.
- Signed-in DOM checks: unique hero, no top empty request card, seven week days, locally generated accessible QR, three booking steps, unsupported-voice fallback, month/day panels, Requests mounting and summaries below appointments all passed, with no startup/action error captured before harness teardown.
- Script syntax and Git whitespace checks passed. Actual browser screenshots and video remain unavailable as stated above.
