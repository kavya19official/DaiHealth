# Doctor dashboard — reference-inspired overview

Prepared on 2026-11-05 against latest main `d631ceff63a39181f25269ffca90918b0df11d53`.

## Layout and behavior

The clinician Home screen now follows the supplied reference: a lavender hero, doctor illustration and recorded day counts; a horizontal patient journey; then three equal-priority cards for Today, Care completion and Incoming handoffs. Existing Maternal / Newborn & Child controls, search, profile/team menu, theme and navigation remain in place.

The original roster, attention list, hospital resources, staff roster and other quick actions are retained under **More from your clinical workspace**, as well as their existing navigation screens. Stage filters open that disclosure so their matching roster is visible. The disclosure stays open during roster search and refresh; typed queries are preserved by the existing renderer. My patients / All opens the existing roster workflow. Clinic, Schedule, care completion details and handoff record actions use the original routes.

The inline Ask Dhruv button opens the existing companion panel. It does not submit a prompt or call a model. The duplicate floating companion launcher is hidden only on Home while the inline entry exists; other screens keep it.

## Data and permission boundaries

This update consumes the existing authorised `/api/doctor/workspace` payload. No API, schema, role or consent rules changed. Patient stage counts, appointments and report totals are not copied from the screenshot. Missing admission data stays unavailable, child ages remain unshared when absent, and missing handoff data is distinct from a reported empty list.

The care completion card uses the existing dashboard calculation, completed recorded milestones divided by all recorded milestones in the applicable view. Its numerator and denominator match that calculation. It is not a clinical outcome, readiness guarantee or risk prediction. Original source tooltips remain available.

## Illustration

`frontend/assets/doctor/clinician-reference-v1.png` is a decorative transparent illustration generated with the built-in image-generation tool; it is not the signed-in clinician's photograph.

Prompt: warm softly shaded editorial illustration of an Indian female doctor with dark hair in a low bun, white coat, pale lilac blouse and stethoscope, holding a dark tablet; head-to-waist composition, lavender leaves and a small blank medical-record motif; transparent background, no room, logos, text or photorealism.

## Validation

- `node --test backend/doctorDashboardModel.test.js backend/doctorDashboardFocus.test.js`: 8 tests passed.
- The optional `scripts/check-doctor-reference.cjs` runs the actual dashboard with an explicit synthetic workspace API fixture. It checks three primary cards, data-derived completion counts, missing admission state, clinic/analytics actions, stage filtering, separate child mode, roster search disclosure, companion opening/closing, dark mode, empty/populated handoffs, and widths 390 / 768 / 1536. The final browser run had zero page exceptions or API writes.
- Changed JavaScript passed syntax checks; `git diff --check` passed.
- The installer was checked for dry-run, repeat installation, checksum integrity, custom-edit preservation and conflict refusal.

These are UI regression checks, not a fresh live backend, multi-service or production security validation. Existing APIs were not changed. Chromium was tested here; Safari and assistive-technology combinations need separate manual verification. Existing interface language coverage is not expanded by this visual update.

Optional browser-check setup outside the app:

```bash
npm install --prefix /tmp/dai-doctor-check --no-save playwright
/tmp/dai-doctor-check/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dai-doctor-check/node_modules/playwright node scripts/check-doctor-reference.cjs
```

## Install

Stop the current server, apply the update from the project root, then run `npm start`. Sign in as Doctor and open Dashboard. This update can be applied alongside the separate mother-dashboard update: their source targets do not overlap. No .env or database files are included or reset.
