# Mother dashboard — reference-inspired home

Base: latest main `d631ceff63a39181f25269ffca90918b0df11d53` as fetched on 2026-11-05.

## What changed

The mother Home screen now follows the supplied reference's hierarchy: a soft lavender shell and rounded sidebar, a personal greeting with a stage-appropriate mother illustration, the existing next-care/book-appointment action, a four-part care journey, mother/child shortcuts, a chronological activity list and a supportive companion entry.

This is a presentation change. The existing Home state supplies patient name, stage, child identity/age, care milestones, appointments and vaccination records. No new endpoint, schema or clinical model is introduced. The patient tour, guarded care-step workflow, timeline live updates and hospital-stay navigation remain in the repository baseline. My Hospital Stay continues to appear only when the existing authorised workflow exposes it.

The earlier home layout's readings, appointment calendar, vaccine passport and nearby map remain under **More of your care**. The original milestone-card download/share action is also retained in that disclosure. Existing personal tools remain in Settings. No source record is deleted or written by rendering the new layout.

## Accuracy and empty states

- Pregnancy completion means all available pregnancy care items are recorded complete; it is not an assertion that every clinically necessary investigation was done. Pending verification remains a review state.
- Delivery is shown as recorded only when a valid delivery date exists. A delivered profile or child record alone never creates delivery evidence.
- Postnatal status uses the existing schedule and completion rules. The catch-up message uses the actual pending item title.
- Child wellness opens the existing separate child records. Each baby selector keeps its own identity and age.
- Activities use actual appointment dates, completed/verified care events and each child's recorded vaccination dates. Missing or invalid dates are not invented. A completed-at timestamp without completed status/verification does not create a completion event.
- The next card labels the registered centre as a registered centre, not a confirmed booking or guaranteed available facility.
- Empty, loading and offline views do not fill the design with fictional completed care. The screenshot reference's dates, names and milestones were not hardcoded into production code.

## Illustration asset

`frontend/assets/patient/mother-twins-v1.png` is a decorative transparent illustration generated with the built-in image-generation tool. It is used when the current delivered profile has at least two child records. Existing single-baby, pregnancy and self-care illustrations remain available through the original stage renderer. It is an illustration, not a portrait of the patient or a medical image.

Prompt: polished warm editorial cutout of an Indian mother in lavender gently holding two sleeping babies in ivory and peach blankets, with dark flowing hair, purple botanical accents and small outlined hearts; upper-body centred composition, transparent background, no text, logos, UI, furniture or medical diagram.

## Verification and limits

- `node --test backend/motherHomeLayout.test.js backend/patientHomeLayout.test.js`: 8 tests passed.
- Actual dashboard browser checks with explicit synthetic view fixtures: postpartum/twins, evidence-based phases, separate child selection, next-step/timeline/children/companion/activity navigation, original tools disclosure, dark mode, larger text, loading/offline/empty views and 390/768/1536px viewport bounds passed. The browser test reports page errors and API writes; the final run had neither.
- `node --check` for changed JavaScript and `git diff --check` passed.
- Browser fixture checks are frontend regression checks, not a new live multi-service or production clinical validation. Backend APIs are unchanged. Safari has not been tested here. Full translation of every existing screen is a separate scope; new static copy has English/Hindi variants and uses the existing locale choice.
- Decorative images respect the app's existing low-bandwidth behavior. Original report contents, clinician notes and patient-entered text retain their source wording.

For the optional browser check, install Playwright outside the repo:

```bash
npm install --prefix /tmp/dai-home-check --no-save playwright
/tmp/dai-home-check/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dai-home-check/node_modules/playwright node scripts/check-mother-home.cjs
```

Normal use: `npm start`, sign in as a mother, open Home and refresh once after applying the update. Existing local records and edits are preserved; there is no database reset.
