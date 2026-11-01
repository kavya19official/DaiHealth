# Patient guided workflow tour

Built on latest main `eaf50f14122d1f922aebdef52dd14c13cf62352d` (MVP demo experience), using the supplied screen recording as an interaction reference.

## Try it

Start the existing app with `npm start` (or `npm run demo`). Open the patient dashboard. Click **Show me around** on Home, or **Guide** in the header from any patient screen. The dashboard does not automatically interrupt a patient with a modal tour.

The tour highlights real navigation on desktop, and the active screen heading on smaller devices. Next and Back navigate the existing screens and retain their existing data loading and permission behavior. Skip, Close or Escape exits and returns to the screen where the tour started. Finish leaves the patient in Settings. Guide always starts a fresh tour.

| Step | Screen | Workflow explanation |
| --- | --- | --- |
| 1 | Home | Understand the recorded care overview |
| 2 | Care timeline | Follow scheduled care and hospital follow-up state |
| 3 | Pending care | Find recorded items that need attention |
| 4 | Nearby care | Set location, select need and understand matching |
| 5 | Appointments | Track appointments and hospital request responses |
| 6 | Reports & records | Upload an original and understand sharing/review |
| 7 | Follow-up help | Explain barriers and prepare rebooking |
| 8 | After delivery | Continue postnatal follow-through |
| 9 | My children | Keep each child's record separate |
| 10 | Family & consent | Understand permission and sharing controls |
| 11 | Updates | Understand saved care-team communication |
| 12 | Settings | Find preferences and learn how to restart |

The patient performs actual actions after leaving the tour. This is an orientation layer: it does not book an appointment, upload a report, acknowledge a task, grant consent, mark care complete or make an AI call. No patient data or tour history is stored. Staff-side assignment/status transitions remain in the existing hospital workflow. The synthetic PIN example is clearly labelled. Tour copy is English; it does not add translations for other page languages.

## Accessibility and verification

Includes dialog labelling, a progress indicator, keyboard focus containment, Escape dismissal, focus restoration, visible focus styles, readable notes and a responsive card. Existing sidebar disclosure states are restored on exit. No new animation or dependency is needed by the product.

The optional regression script `scripts/check-patient-tour.cjs` serves the actual dashboard in guest mode. It exercises all 12 routes at 1440×1000 and 390×844, Back, Finish, restart, Skip, Escape, focus containment/restoration, card bounds and zero API writes. Browser API responses deliberately deny access; this test does not claim signed-in backend integration was retested. Chromium was tested; Safari and screen-reader behavior require separate manual validation.

To run this optional UI check without changing app dependencies:

```bash
npm install --prefix /tmp/dai-tour-check --no-save playwright
/tmp/dai-tour-check/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dai-tour-check/node_modules/playwright node scripts/check-patient-tour.cjs
```

JavaScript syntax and `git diff --check` were also checked. Existing backend APIs and schemas are unchanged.
