# Recorded-data graphs — mother and doctor

Added to the existing dai-recovery-access-update.zip; the recovery/access repairs remain included. No extra graph library, new API, background model call, patient-data cache or database migration is required.

## Where to find them

Mother Home → **View care graphs** or expand **Your care · graphs & recorded trends**. Doctor Dashboard → **View graphs** or expand **Clinical workspace · graphs & recorded trends**. Chart sections are expandable to preserve the uncluttered main dashboard. The doctor chart section remains open across workspace rerenders when the user has opened it. Each figure has a complete recorded-values table with units and available source/context information.

## Mother: 13 chart types

1. Recorded care states (completed, awaiting review, overdue, upcoming or queued).
2. Recorded appointment count by date.
3. Saved appointment status counts.
4. Clinician-entered maternal weight (kg).
5. Clinician-entered systolic blood pressure (mmHg).
6. Clinician-entered diastolic blood pressure (mmHg).
7. Clinician-entered haemoglobin (g/dL).
8. Clinician-entered blood glucose (mg/dL).
9. Selected child's recorded weight (kg).
10. Selected child's recorded length/height (cm).
11. Selected child's recorded head circumference (cm).
12. Recorded vaccination entries, kept separate by child.
13. Recorded postnatal contact states.

Selecting another baby updates the growth charts to that child's own measurements. An unknown vaccination list is omitted rather than counted as zero. Measurement series never mix clinician entries with self-reports. The current API may supply only a small number of clinician readings: the graphs do not fabricate a longer history. One measurement is a point, without a trend line. Date-based line points use actual date spacing. No clinical target, risk threshold, growth percentile or forecast is added.

## Doctor: 10 chart types

1. Supplied maternal journey stages (child age groups remain unavailable when not supplied).
2. Recorded appointments by date.
3. Saved appointment status counts.
4. Recorded milestone completions by date.
5. Recorded care-plan category counts.
6. Existing worklist delay bands (not severity/risk).
7. Authorised shared-report review states.
8. Clinical summary sharing states (not risk classification).
9. Hospital-reported available beds, with installed counts and timestamps in the table.
10. Hospital-reported PRBC stock with available source timestamps.

Maternal/Child mode refreshes mode-specific appointment and plan charts. Clinical summary sharing refers to the supplied patient/mother summaries; it is not a child's clinical assessment. Hospital resource charts remain scoped facility snapshots, independent of care mode. Missing child-specific report scope stays unreported. Explicitly shared report metadata may include patients outside the appointment roster, as allowed by the existing API. No new access is granted by these charts.

## Boundaries

- Empty sources show an explicit unavailable state, not random synthetic plots or fabricated zeros.
- Bars represent recorded entries, not actual attendance, live bookings, clinical outcomes, immunity, confirmed readiness or reserved beds/blood.
- Figures use existing date/value fields and do not persist sensitive chart payloads to localStorage or service-worker caches. Offline mother graphs show a reconnect state.
- Graph labels are currently English; this does not complete the separate request for full-app multilingual coverage.
- SVG focusable points/bars have value titles; tables provide full readable values. No accessibility certification or Safari validation is claimed.
- The ZIP is additive to earlier mother/doctor visual updates, and also supports the current baseline focused dashboard. Their earlier ZIPs need not be downloaded again to install these graph additions. This package does not automatically install all earlier illustration/redesign assets.

## Validation

Three new pure-data/escaping tests cover clinician-only sources, missing versus zero, separate child records, assigned appointment scoping, child mode, review states and safe table output. Existing doctor model/view, child/recovery and patient layout regression tests were also run. Browser tests use the actual app with explicit synthetic view/API fixtures, verifying 13 mother figures and 10 doctor figures alongside the existing dashboard navigation, child/mode switching and viewport checks. These are UI regressions, not a new live backend or production clinical validation.
