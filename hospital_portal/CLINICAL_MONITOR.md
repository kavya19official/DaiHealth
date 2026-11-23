# Clinical monitoring agent

The hospital workspace shows **Clinical monitoring** to verified consultants and residents. Consultants see their assigned facility and unit. Residents see their assigned patients in that unit. Consultants can record a review against the exact evidence version. A changed finding returns to the review queue. Opening the patient record also shows observation coverage and trimester weights, including for patients with no current flags.

## Architecture

The FastAPI lifespan runs a bounded scheduler. It reads up to 125 consented patient records per batch, binds structured observations to the current pregnancy, evaluates pure rules, and writes evidence-linked flags to the existing portal database. After a sweep it waits 90 seconds. The dashboard refreshes every 30 seconds while visible. This is periodic review support. It does not page clinicians or provide emergency workflow coverage. No external model or extra credentials are needed.

Each flag includes the rule version, source type, original record ID, date, values, a short review step, and a guideline link where applicable. Repeated scans preserve unchanged clinician acknowledgement. The clinical data stay in their original tables. The agent writes monitoring artefacts and audit events.

## Inputs and exclusions

| Input | Records and handling |
| --- | --- |
| Pregnancy dating | Active antenatal stage and valid recorded LMP or estimated LMP from EDD. Observations outside the episode date window are excluded. |
| Blood pressure | Dated paired ANC readings. Severe-range values recorded within seven days take priority. Values reaching lower review thresholds on different dates are grouped without asserting that a diagnostic timing interval was met. |
| Weight | Descriptive changes within each trimester. Second- and third-trimester comparisons require prepregnancy BMI, documented singleton status, and at least 14 days between readings. The synthetic cohort lacks the baseline required for these comparisons. |
| Glucose | Numeric glucose with units and explicit fasting or post-meal timing. An explicitly recorded 75-g, two-hour OGTT can receive a separate review flag. |
| Reports | Latest dated, finalized structured result per test, or a completed investigation carrying an original reported flag. The agent does not infer protocols from test names or scan PDF/OCR drafts. |
| Care milestones | Open prenatal care gaps and overdue investigation orders. A matching finalized result removes the investigation from the overdue list. |

The portal’s native records feed the live adapter. In explicit demo mode, the adapter also uses the existing read-only synthetic ANC ledger. It checks the ledger against the seed manifest and evaluates as of the seeded snapshot date. Express patient-entered records and uploaded documents remain separate. They feed the hospital rules only once an authorized workflow records structured observations or finalized results in the portal.

Native integration uses mother.details fields stage, lmp, outcome_date, prepregnancy_bmi and plurality. ANC visits use bp_systolic, bp_diastolic, weight_kg, glucose, glucose_unit and glucose_context in details. Investigation results use status, reported_on, result_value, result_flag, unit, glucose_context and protocol in values. Use ogtt_75g_2h only for a documented 75-g OGTT sampled at two hours.

## Run and validate

- Run the existing npm start command. The portal creates the monitoring tables on startup. Set DAI_CLINICAL_MONITOR_ENABLED=false to disable scanning.
- Native patients require care_coordination and clinical_monitoring set to true in the portal consent record. Existing synthetic consent is recognized only in explicit demo mode. Removing consent blocks access to previously computed flags.
- Run python -m pytest hospital_portal/tests/test_clinical_monitor.py in the portal environment. Set DAI_SOURCE_DB if the generated ledger is outside its default path. Review thresholds, scan windows and the existing consent workflow with the deploying clinical team before using the feature with real patients.

References [ACOG pregnancy blood pressure](https://www.acog.org/womens-health/faqs/preeclampsia-and-high-blood-pressure-during-pregnancy), [ADA 2026 pregnancy glucose monitoring](https://doi.org/10.2337/dc26-s015), [ADA 2026 diagnostic protocols](https://doi.org/10.2337/dc26-s002), and [National Academies gestational weight gain guidelines](https://doi.org/10.17226/12584).
