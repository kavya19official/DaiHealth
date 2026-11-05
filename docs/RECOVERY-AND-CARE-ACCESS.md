# After delivery redesign and visible care access

Base: main `d631ceff63a39181f25269ffca90918b0df11d53`, 2026-11-05. Additive to the mother and doctor dashboard updates.

## After delivery

A compact lavender recovery hero replaces the large capped ring with actual recorded days since birth. Summary cards show open recorded postnatal follow-ups and whether today's existing check-in is recorded or its window is closed. Missing day/schedule information is labelled missing; it is not zero or a recovery score.

Mother/baby tabs, individual child links, visit schedule, private mood notes, reading controls, support entry, the original postpartum forms and their emergency actions remain. The check-in schedule and clinical warning rules have not been changed. An inactive postpartum pathway still shows the original delivery-date entry/empty state. The illustration reuses an existing decorative project asset.

## Feature visibility

- A permanent **Find care** button opens the existing Nearby care screen from any mother-dashboard panel. On a narrow screen it is an accessible search icon.
- Entering Nearby care expands its existing care-need/area/preferences drawer so search controls are immediately available. No search or device-location permission is triggered automatically.
- Home now has a visible shortcut row for Nearby care, Appointments, Reports & records and Family & consent, using the original navigation handler.
- The sidebar reserves space for its brand/footer and scrolls its navigation independently at smaller window heights. No menu item or patient feature is removed.
- The mother redesign's detailed readings, vaccination tracker and map still remain under More of your care. Nearby care itself is a full page reached directly by the new button/shortcut; it is not dependent on opening that disclosure.
- Hospital-stay navigation retains its original authorised-data visibility rule. This update does not expose staff-only data or force unavailable hospital records to appear.

## Verification

`node --test backend/littleWorld.test.js`: 5 tests passed. The optional `scripts/check-recovery-access.cjs` serves the actual dashboard with explicitly synthetic display state. It checks all primary patient navigation routes, the four shortcuts, permanent Find care entry, scrollable sidebar, mother/baby lanes, a recorded day beyond 42, same-record refresh of the day marker, missing-day state and 1440/1024/390px layout. There were zero page exceptions or API writes. It is run on the base layout and alongside the separately installed mother redesign.

Syntax checks and `git diff --check` passed. These are UI and existing rule regressions, not new live clinical/backend validation. Safari and assistive-technology combinations were not independently tested. The existing language framework remains; new labels support English/Hindi, while original records keep source wording.

No database, credentials, dependencies or .env changes. The installer preflights first, backs up originals, preserves unrelated HTML/cache edits and refuses custom/newer versions of new files. It can be rerun safely.

Optional browser test:

```bash
npm install --prefix /tmp/dai-recovery-check --no-save playwright
/tmp/dai-recovery-check/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dai-recovery-check/node_modules/playwright node scripts/check-recovery-access.cjs
```
