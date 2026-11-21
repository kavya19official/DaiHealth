# Child growth and developmental check-ins

## Patient workflow

**My children** now shows the selected child's weight-for-age, length/height-for-age and head-circumference-for-age curves, plus a keyboard-accessible table of dated measurements. The existing full child dashboard keeps its growth metric switch and now includes the same developmental questionnaire and measurement table. Add measurements using the existing child dashboard growth form.

The charts reuse `shared/who-growth-standards.js` and `shared/child-reference.js`: sex-specific WHO LMS tables with monthly interpolation, numerical z-scores and approximate percentiles. Reference curves are labelled as references, not diagnoses. Missing measurements are not filled with zeros. Dates are sorted, future observations are excluded, and each sibling is separate. Unsupported reference age/sex leaves the values in the table. Recorded prematurity uses corrected age until two years; observations before term-equivalent age stay in the table rather than being plotted at age zero. No preterm growth standard is bundled.

The length/height measurement method must be confirmed with the clinician. There is no automatic posture conversion. The table labels remain length/height because historical records do not store posture. The existing full-dashboard latest weight, length/height and head measurements now use their own latest dates, so a weight-only entry does not hide the last head measurement.

## Development

The questionnaire reuses DAI's existing paraphrased CDC milestone observations, selected using completed calendar months and corrected age where appropriate. It has explicit **Seen this / Not yet / Not sure** responses, a lost-skill question and an optional concern note. No answers are preselected. Saving creates a private, dated observation snapshot for that child; it never marks a milestone achieved, creates a diagnosis or computes a risk score.

The screen highlights **9, 18 and 30 months** as ages to discuss formal developmental screening. These reminders do not imply that screening has or has not occurred. The built-in questionnaire is **developmental monitoring, not a validated screening instrument**. Clinician-administered standardized screening remains a separate workflow. The official SWYC forms are linked for discussion, not reproduced, modified or automatically scored.

**Arrange a developmental review** opens the selected child's existing appointment form and prepares a reason. The parent still chooses the doctor and date and submits the ordinary request; no appointment is automatically created. Questionnaire answers are not automatically shared with the doctor. Parents can show their saved observations at a visit.

## Data and access

`backend/db/child_development.sql` is registered in both existing migration lists. Restart the app from the repository root with `npm start` to apply it.

- `GET /api/children/:id/development-checkins`
- `POST /api/children/:id/development-checkins`

Both routes require an authenticated mother who owns the child and return `Cache-Control: private, no-store`. The API validates the current age checkpoint and complete allowlisted answers. Twenty recent snapshots are returned. No sensitive payload is cached by the service worker. Existing growth storage and permissions are reused.

## Validation

```sh
node --test backend/childDevelopment.test.js backend/childReference.test.js backend/localMigrations.test.js
npm test --prefix backend
```

DOM interaction checks use a temporary development-only jsdom installation:

```sh
npm install --prefix /tmp/dai-ui-test jsdom@29.1.1
NODE_PATH=/tmp/dai-ui-test/node_modules node scripts/test-child-growth-development.cjs
```

These cover three charts, empty readings, escaping, parent-only labels, failed-save preservation, stale-response protection when switching twins, and child-specific booking context. Real-browser visual review, assistive-technology testing and paediatric review remain necessary before clinical use. No new clinical validation is claimed.

Sources: [WHO Child Growth Standards](https://www.who.int/tools/child-growth-standards), [CDC monitoring and screening](https://www.cdc.gov/act-early/about/developmental-monitoring-and-screening.html), [CDC checklist limitations](https://www.cdc.gov/act-early/milestones/key-points.html), [official SWYC forms](https://www.teamupcenter.org/age-specific-forms/).
