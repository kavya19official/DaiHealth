# DAI synthetic dataset: verified default run

Source repository was fast-forwarded to `2cf8454` before implementation. The project lives in `synthetic_data/`; it does not alter the application database.

Snapshot: **2026-10-20**. Seed: **20261020**. Python: **3.11.15**.

**347,455 rows, 30 linked tables, 12 hospitals, 5,000 mothers and 2,664 live-born children** (including children with recorded neonatal death).

The oversampled cohort is **480 mothers (9.6%)**. All 61 scenario/stage labels have at least 15 mothers. Normal low-risk singleton coverage is additionally checked within every stage.

All 16 numbered rules and both additional audits PASS. The six automated tests PASS, including deliberate corruption tests. Ruff lint and format checks PASS. A 6-hospital/1,000-mother run using seed 42 also passes all rules.

A second default run is byte-identical for all 30 CSV files, the SQLite database, schema, config snapshot and validation report.

SQLite SHA-256: `57a7ceea43a2b8682da6e23b783d8bfeb743909d972b3e0cbb244e25c6b4943f`.

PostgreSQL-compatible DDL is supplied. A live PostgreSQL import could not be tested because the sandbox blocked shared-memory initialization. MSR quantities are configurable placeholders requiring verification. Full phone contacts have non-dialable SYNTHETIC markers. Birth vaccination and inpatient PNC dates use the explicit clinical chronology exceptions documented in README.

## Table row counts

| Table | Rows |
|---|---:|
| hospitals | 12 |
| departments | 102 |
| wards | 150 |
| patients | 11,111 |
| beds | 4,127 |
| equipment | 1,200 |
| hospital_services | 12 |
| blood_bank | 96 |
| doctors | 134 |
| doctor_schedules | 1,206 |
| nurses_midwives | 150 |
| mothers | 5,000 |
| pregnancies | 5,000 |
| referrals | 9,141 |
| anc_expected | 36,170 |
| anc_visits | 32,275 |
| investigations | 51,571 |
| risk_flags | 3,737 |
| admissions | 6,682 |
| delivery_records | 2,560 |
| newborns | 2,664 |
| stillbirths | 45 |
| vaccinations | 99,030 |
| growth_records | 15,906 |
| postpartum_expected | 10,066 |
| postpartum_visits | 8,800 |
| appointments | 12,252 |
| care_gaps | 16,804 |
| emergency_events | 133 |
| scenario_memberships | 11,319 |

## Scenario counts

| Scenario | All mothers | Seeded edge mothers |
|---|---:|---:|
| MTP | 38 | 15 |
| abruption | 15 | 15 |
| adolescent | 15 | 15 |
| advanced_age | 167 | 27 |
| anaemia_mild | 817 | 30 |
| anaemia_moderate | 710 | 30 |
| anaemia_severe | 87 | 15 |
| aph | 30 | 30 |
| breastfeeding_difficulty | 15 | 15 |
| cord_prolapse | 15 | 15 |
| down_screen_high | 15 | 15 |
| dropout | 15 | 15 |
| eclampsia | 15 | 15 |
| ectopic | 41 | 15 |
| fgr | 152 | 30 |
| gdm | 324 | 15 |
| gestational_hypertension | 180 | 15 |
| hellp | 15 | 15 |
| hepatitis_b | 68 | 15 |
| hiv_art | 26 | 15 |
| hypothyroidism | 211 | 15 |
| migrated | 15 | 15 |
| miscarriage | 184 | 15 |
| molar | 19 | 15 |
| neonatal_death | 39 | 16 |
| normal_low_risk | 2,261 | 30 |
| obstructed_labour | 15 | 15 |
| oligohydramnios | 15 | 15 |
| placenta_praevia | 29 | 15 |
| polyhydramnios | 15 | 15 |
| post_term | 15 | 15 |
| postpartum_depression | 15 | 15 |
| pph | 45 | 45 |
| pprom | 15 | 15 |
| preeclampsia | 90 | 15 |
| preexisting_diabetes | 75 | 15 |
| preterm_labour | 45 | 45 |
| prior_cs_vbac | 15 | 15 |
| prior_two_cs | 105 | 15 |
| quadruplets | 15 | 15 |
| rh_alloimmunisation | 47 | 15 |
| sepsis | 15 | 15 |
| severe_preeclampsia | 15 | 15 |
| shoulder_dystocia | 15 | 15 |
| stage:Child-care | 1,438 | 24 |
| stage:Delivered | 15 | 0 |
| stage:In-labour | 102 | 0 |
| stage:Postpartum 0-6wk | 132 | 24 |
| stage:Postpartum 6wk-1yr | 1,257 | 402 |
| stage:Preconception | 67 | 0 |
| stage:T1 | 498 | 0 |
| stage:T2 | 717 | 0 |
| stage:T3 | 774 | 30 |
| stillbirth | 45 | 15 |
| syphilis | 25 | 15 |
| tb | 23 | 15 |
| triplets | 16 | 15 |
| twins_dcda | 53 | 15 |
| twins_mcda | 37 | 15 |
| twins_mcma | 15 | 15 |
| uterine_rupture | 15 | 15 |

Scenario membership can overlap. Baseline occurrences are included in the All mothers column; do not sum this column to estimate population size.

## Validation results

| Rule | Result | Checks | Failures |
|---|---|---:|---:|
| 1: All foreign keys and SQL integrity | PASS | 1,208,145 | 0 |
| 2: Doctor, department, hospital and referral match | PASS | 233,332 | 0 |
| 3: Assigned clinician works at registered hospital | PASS | 10,000 | 0 |
| 4: Chronology and no future recorded events | PASS | 766,570 | 0 |
| 5: Computed gestational week and stage | PASS | 42,275 | 0 |
| 6: EDD, gestation and preterm/post-term labels | PASS | 10,120 | 0 |
| 7: Plurality, stillbirths and separate sibling records | PASS | 10,269 | 0 |
| 8: Clinical values, risk evidence and validation | PASS | 122,415 | 0 |
| 9: Delivery, NICU, transfusion and referral capabilities | PASS | 5,921 | 0 |
| 10: Bed census, admissions and concurrent NICU capacity | PASS | 25,572 | 0 |
| 11: Daily doctor load and non-overlapping slots | PASS | 24,906 | 0 |
| 12: Functional equipment does not exceed installed assets | PASS | 3,718 | 0 |
| 13: UIP due dates, dose timing, completeness and statuses | PASS | 452,875 | 0 |
| 14: Care gaps re-derived from base records | PASS | 26,805 | 0 |
| 15: SOS nearest eligible hospital and authentication | PASS | 527 | 0 |
| 16: Fictional identifiers and synthetic provenance | PASS | 26,258 | 0 |
| coverage: Scenario evidence, staffing, geography and prevalence | PASS | 11,742 | 0 |
| formats: CSV/SQLite same values, schema and deterministic hashes | PASS | 4,340,034 | 0 |

## Regenerate

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python generate.py --hospitals 12 --patients 5000 --seed 20261020
.venv/bin/python validate.py
.venv/bin/python test_rules.py
```

Read README.md before changing population size or interpreting simulated clinical values. Sources and all assumptions are documented there.
