-- DAI SYNTHETIC DATA ONLY. No clinical compliance claim.

CREATE TABLE hospitals (
  hospital_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  district TEXT,
  state TEXT,
  pincode TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  ownership TEXT,
  nabh_accredited BOOLEAN,
  has_nicu_level TEXT,
  has_blood_bank BOOLEAN,
  has_ambulance_count INTEGER,
  is_sos_participating BOOLEAN,
  emergency_24x7 BOOLEAN,
  total_beds INTEGER,
  ot_count INTEGER,
  labour_table_count INTEGER,
  CHECK (latitude BETWEEN 6 AND 38),
  CHECK (longitude BETWEEN 68 AND 98)
);

CREATE TABLE departments (
  department_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),
  name TEXT NOT NULL
);

CREATE TABLE wards (
  ward_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),
  department_id TEXT REFERENCES departments(department_id),
  ward_type TEXT,
  capacity INTEGER,
  oxygen_supported BOOLEAN
);

CREATE TABLE patients (
  patient_id TEXT PRIMARY KEY NOT NULL,
  patient_type TEXT,
  synthetic_label TEXT,
  is_synthetic BOOLEAN
);

CREATE TABLE beds (
  bed_id TEXT PRIMARY KEY NOT NULL,
  ward_id TEXT NOT NULL REFERENCES wards(ward_id),
  bed_type TEXT,
  status TEXT,
  oxygen_supported BOOLEAN,
  monitor_attached BOOLEAN,
  current_patient_id TEXT REFERENCES patients(patient_id),
  CHECK (status IN ('available','occupied','maintenance'))
);

CREATE TABLE equipment (
  equipment_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  ward_id TEXT REFERENCES wards(ward_id),
  type TEXT,
  installed_quantity INTEGER,
  functional_quantity INTEGER,
  status TEXT,
  last_service_date DATE
);

CREATE TABLE hospital_services (
  hospital_id TEXT PRIMARY KEY NOT NULL REFERENCES hospitals(hospital_id),
  c_section BOOLEAN,
  blood_transfusion BOOLEAN,
  mtp BOOLEAN,
  labour_room_24x7 BOOLEAN,
  emergency_obstetric_care TEXT,
  neonatal_resuscitation BOOLEAN,
  vaccination_centre BOOLEAN,
  diagnostic_tests TEXT,
  obstetric_hdu BOOLEAN
);

CREATE TABLE blood_bank (
  blood_bank_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  blood_group TEXT,
  units_available INTEGER
);

CREATE TABLE doctors (
  doctor_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),
  department_id TEXT NOT NULL REFERENCES departments(department_id),
  name TEXT,
  gender TEXT,
  specialty TEXT,
  designation TEXT,
  qualification TEXT,
  experience_years INTEGER,
  registration_number TEXT UNIQUE,
  languages_spoken TEXT,
  high_risk_pregnancy_certified BOOLEAN,
  max_daily_patients INTEGER
);

CREATE TABLE doctor_schedules (
  schedule_id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT REFERENCES doctors(doctor_id),
  day INTEGER,
  start_time TEXT,
  end_time TEXT,
  clinic_type TEXT,
  is_on_call BOOLEAN,
  CHECK (start_time < end_time)
);

CREATE TABLE nurses_midwives (
  staff_id TEXT PRIMARY KEY NOT NULL,
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  ward_id TEXT REFERENCES wards(ward_id),
  name TEXT,
  designation TEXT,
  languages_spoken TEXT
);

CREATE TABLE mothers (
  mother_id TEXT PRIMARY KEY NOT NULL REFERENCES patients(patient_id),
  name TEXT,
  age INTEGER,
  district TEXT,
  state TEXT,
  pincode TEXT,
  preferred_language TEXT,
  literacy_level TEXT,
  digital_literacy TEXT,
  income_band TEXT,
  scheme_enrolment TEXT,
  home_latitude DOUBLE PRECISION,
  home_longitude DOUBLE PRECISION,
  phone TEXT,
  phone_numeric_core TEXT,
  contact_is_dialable BOOLEAN,
  caregiver_contact TEXT,
  registered_hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),
  assigned_obgyn_id TEXT NOT NULL REFERENCES doctors(doctor_id),
  is_edge_case_seed BOOLEAN,
  dropout_probability DOUBLE PRECISION,
  distance_km DOUBLE PRECISION,
  messiness_tag TEXT
);

CREATE TABLE pregnancies (
  pregnancy_id TEXT PRIMARY KEY NOT NULL,
  mother_id TEXT NOT NULL REFERENCES mothers(mother_id),
  lmp DATE NOT NULL,
  edd DATE NOT NULL,
  current_gestational_week INTEGER,
  current_stage TEXT,
  gravida INTEGER,
  para INTEGER,
  living_children INTEGER,
  plurality TEXT,
  plurality_count INTEGER,
  chorionicity TEXT,
  conception_type TEXT,
  prior_cesarean INTEGER,
  outcome TEXT,
  outcome_date DATE,
  labour_started_at TIMESTAMP,
  is_edge_case_seed BOOLEAN,
  confirmed_high_risk BOOLEAN,
  clinical_hb DOUBLE PRECISION,
  clinical_sbp INTEGER,
  clinical_dbp INTEGER,
  ogtt_2h_mg_dl DOUBLE PRECISION,
  conditions TEXT,
  prior_district TEXT,
  migration_date DATE
);

CREATE TABLE referrals (
  referral_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  referred_from_hospital_id TEXT REFERENCES hospitals(hospital_id),
  referred_to_hospital_id TEXT REFERENCES hospitals(hospital_id),
  reason TEXT,
  referred_at TIMESTAMP,
  transport_time_min INTEGER,
  referring_doctor_id TEXT REFERENCES doctors(doctor_id),
  receiving_doctor_id TEXT REFERENCES doctors(doctor_id)
);

CREATE TABLE anc_expected (
  expected_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  gestational_week INTEGER,
  due_date DATE
);

CREATE TABLE anc_visits (
  visit_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  expected_id TEXT UNIQUE REFERENCES anc_expected(expected_id),
  visit_date DATE,
  gestational_week_at_visit INTEGER,
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  doctor_id TEXT REFERENCES doctors(doctor_id),
  bp_systolic INTEGER,
  bp_diastolic INTEGER,
  weight_kg DOUBLE PRECISION,
  hb DOUBLE PRECISION,
  fundal_height_cm DOUBLE PRECISION,
  fetal_heart_rate INTEGER,
  urine_albumin TEXT,
  urine_sugar TEXT,
  ifa_given BOOLEAN,
  calcium_given BOOLEAN,
  td_dose_given INTEGER,
  notes_code TEXT,
  entered_at DATE
);

CREATE TABLE investigations (
  investigation_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  ordered_by_doctor_id TEXT REFERENCES doctors(doctor_id),
  test_type TEXT,
  ordered_date DATE,
  due_date DATE,
  completed_date DATE,
  gestational_week INTEGER,
  status TEXT,
  result_value TEXT,
  result_flag TEXT,
  referral_id TEXT REFERENCES referrals(referral_id)
);

CREATE TABLE risk_flags (
  flag_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  risk_type TEXT,
  severity TEXT,
  raised_by TEXT,
  validated_by_doctor_id TEXT REFERENCES doctors(doctor_id),
  validation_status TEXT,
  date DATE
);

CREATE TABLE admissions (
  admission_id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  ward_id TEXT REFERENCES wards(ward_id),
  bed_id TEXT REFERENCES beds(bed_id),
  admitted_at TIMESTAMP,
  discharged_at TIMESTAMP,
  admission_reason TEXT
);

CREATE TABLE delivery_records (
  delivery_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT UNIQUE REFERENCES pregnancies(pregnancy_id),
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  delivering_doctor_id TEXT REFERENCES doctors(doctor_id),
  mode TEXT,
  gestational_age_at_birth INTEGER,
  birth_timing TEXT,
  blood_loss_ml INTEGER,
  transfusion_units INTEGER,
  complications TEXT,
  ward_id TEXT REFERENCES wards(ward_id),
  bed_id TEXT REFERENCES beds(bed_id),
  admission_id TEXT REFERENCES admissions(admission_id),
  admitted_at TIMESTAMP,
  delivered_at TIMESTAMP,
  discharged_at TIMESTAMP,
  maternal_outcome TEXT,
  referral_id TEXT REFERENCES referrals(referral_id)
);

CREATE TABLE newborns (
  child_id TEXT PRIMARY KEY NOT NULL REFERENCES patients(patient_id),
  mother_id TEXT REFERENCES mothers(mother_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  delivery_id TEXT REFERENCES delivery_records(delivery_id),
  birth_order INTEGER,
  birth_label TEXT,
  date_of_birth DATE,
  sex TEXT,
  birth_weight_g INTEGER,
  apgar_1min INTEGER,
  apgar_5min INTEGER,
  gestational_age INTEGER,
  nicu_admission BOOLEAN,
  nicu_bed_id TEXT REFERENCES beds(bed_id),
  nicu_admission_id TEXT REFERENCES admissions(admission_id),
  outcome TEXT,
  death_date DATE,
  paediatrician_id TEXT REFERENCES doctors(doctor_id),
  UNIQUE (pregnancy_id,birth_order)
);

CREATE TABLE stillbirths (
  stillbirth_id TEXT PRIMARY KEY NOT NULL,
  mother_id TEXT REFERENCES mothers(mother_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  delivery_id TEXT REFERENCES delivery_records(delivery_id),
  birth_order INTEGER,
  date_of_birth DATE,
  sex TEXT,
  birth_weight_g INTEGER,
  UNIQUE (pregnancy_id,birth_order)
);

CREATE TABLE vaccinations (
  vaccination_id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT REFERENCES patients(patient_id),
  child_id TEXT REFERENCES newborns(child_id),
  mother_id TEXT REFERENCES mothers(mother_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  vaccine_code TEXT,
  due_date DATE,
  given_date DATE,
  status TEXT,
  centre_hospital_id TEXT REFERENCES hospitals(hospital_id),
  not_applicable_after_death BOOLEAN,
  CHECK ((child_id IS NOT NULL) <> (mother_id IS NOT NULL))
);

CREATE TABLE growth_records (
  growth_id TEXT PRIMARY KEY NOT NULL,
  child_id TEXT REFERENCES newborns(child_id),
  measured_on DATE,
  age_months INTEGER,
  weight_kg DOUBLE PRECISION,
  height_cm DOUBLE PRECISION,
  head_cm DOUBLE PRECISION,
  weight_for_age_z DOUBLE PRECISION,
  height_for_age_z DOUBLE PRECISION,
  weight_for_height_z DOUBLE PRECISION,
  underweight BOOLEAN,
  stunting BOOLEAN,
  wasting BOOLEAN,
  motor_check TEXT,
  language_check TEXT,
  social_check TEXT
);

CREATE TABLE postpartum_expected (
  expected_id TEXT PRIMARY KEY NOT NULL,
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  postpartum_day INTEGER,
  due_date DATE
);

CREATE TABLE postpartum_visits (
  pnc_id TEXT PRIMARY KEY NOT NULL,
  expected_id TEXT UNIQUE REFERENCES postpartum_expected(expected_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  visit_date DATE,
  postpartum_day INTEGER,
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  doctor_id TEXT REFERENCES doctors(doctor_id),
  care_setting TEXT,
  epds_score INTEGER,
  breastfeeding_status TEXT,
  contraception_counselling BOOLEAN,
  hb_recheck DOUBLE PRECISION
);

CREATE TABLE appointments (
  appointment_id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT REFERENCES patients(patient_id),
  mother_id TEXT REFERENCES mothers(mother_id),
  child_id TEXT REFERENCES newborns(child_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  doctor_id TEXT REFERENCES doctors(doctor_id),
  hospital_id TEXT REFERENCES hospitals(hospital_id),
  appointment_date DATE,
  start_time TEXT,
  end_time TEXT,
  status TEXT,
  reason TEXT
);

CREATE TABLE care_gaps (
  gap_id TEXT PRIMARY KEY NOT NULL,
  subject_type TEXT,
  subject_id TEXT REFERENCES patients(patient_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  source_table TEXT,
  source_id TEXT,
  expected_item TEXT,
  due_date DATE,
  detected_on DATE,
  gap_type TEXT,
  severity TEXT,
  status TEXT,
  action_recommended TEXT,
  closed_on DATE
);

CREATE TABLE emergency_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  mother_id TEXT REFERENCES mothers(mother_id),
  child_id TEXT REFERENCES newborns(child_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  triggered_at TIMESTAMP,
  trigger_latitude DOUBLE PRECISION,
  trigger_longitude DOUBLE PRECISION,
  required_capability TEXT,
  first_auth_passed BOOLEAN,
  second_auth_family_contact TEXT,
  second_auth_doctor_id TEXT REFERENCES doctors(doctor_id),
  second_auth_passed BOOLEAN,
  nearest_hospital_id TEXT REFERENCES hospitals(hospital_id),
  distance_km DOUBLE PRECISION,
  response_time_min INTEGER,
  outcome TEXT,
  bed_allocated TEXT REFERENCES beds(bed_id),
  admission_id TEXT REFERENCES admissions(admission_id),
  CHECK ((child_id IS NOT NULL) <> (mother_id IS NOT NULL))
);

CREATE TABLE scenario_memberships (
  membership_id TEXT PRIMARY KEY NOT NULL,
  mother_id TEXT REFERENCES mothers(mother_id),
  pregnancy_id TEXT REFERENCES pregnancies(pregnancy_id),
  scenario TEXT,
  is_edge_case_seed BOOLEAN
);

CREATE INDEX idx_fk_0 ON departments (hospital_id);

CREATE INDEX idx_fk_1 ON wards (hospital_id);

CREATE INDEX idx_fk_2 ON wards (department_id);

CREATE INDEX idx_fk_3 ON beds (ward_id);

CREATE INDEX idx_fk_4 ON beds (current_patient_id);

CREATE INDEX idx_fk_5 ON equipment (hospital_id);

CREATE INDEX idx_fk_6 ON equipment (ward_id);

CREATE INDEX idx_fk_7 ON hospital_services (hospital_id);

CREATE INDEX idx_fk_8 ON blood_bank (hospital_id);

CREATE INDEX idx_fk_9 ON doctors (hospital_id);

CREATE INDEX idx_fk_10 ON doctors (department_id);

CREATE INDEX idx_fk_11 ON doctor_schedules (doctor_id);

CREATE INDEX idx_fk_12 ON nurses_midwives (hospital_id);

CREATE INDEX idx_fk_13 ON nurses_midwives (ward_id);

CREATE INDEX idx_fk_14 ON mothers (mother_id);

CREATE INDEX idx_fk_15 ON mothers (registered_hospital_id);

CREATE INDEX idx_fk_16 ON mothers (assigned_obgyn_id);

CREATE INDEX idx_fk_17 ON pregnancies (mother_id);

CREATE INDEX idx_fk_18 ON referrals (pregnancy_id);

CREATE INDEX idx_fk_19 ON referrals (referred_from_hospital_id);

CREATE INDEX idx_fk_20 ON referrals (referred_to_hospital_id);

CREATE INDEX idx_fk_21 ON referrals (referring_doctor_id);

CREATE INDEX idx_fk_22 ON referrals (receiving_doctor_id);

CREATE INDEX idx_fk_23 ON anc_expected (pregnancy_id);

CREATE INDEX idx_fk_24 ON anc_visits (pregnancy_id);

CREATE INDEX idx_fk_25 ON anc_visits (expected_id);

CREATE INDEX idx_fk_26 ON anc_visits (hospital_id);

CREATE INDEX idx_fk_27 ON anc_visits (doctor_id);

CREATE INDEX idx_fk_28 ON investigations (pregnancy_id);

CREATE INDEX idx_fk_29 ON investigations (hospital_id);

CREATE INDEX idx_fk_30 ON investigations (ordered_by_doctor_id);

CREATE INDEX idx_fk_31 ON investigations (referral_id);

CREATE INDEX idx_fk_32 ON risk_flags (pregnancy_id);

CREATE INDEX idx_fk_33 ON risk_flags (validated_by_doctor_id);

CREATE INDEX idx_fk_34 ON admissions (patient_id);

CREATE INDEX idx_fk_35 ON admissions (hospital_id);

CREATE INDEX idx_fk_36 ON admissions (ward_id);

CREATE INDEX idx_fk_37 ON admissions (bed_id);

CREATE INDEX idx_fk_38 ON delivery_records (pregnancy_id);

CREATE INDEX idx_fk_39 ON delivery_records (hospital_id);

CREATE INDEX idx_fk_40 ON delivery_records (delivering_doctor_id);

CREATE INDEX idx_fk_41 ON delivery_records (ward_id);

CREATE INDEX idx_fk_42 ON delivery_records (bed_id);

CREATE INDEX idx_fk_43 ON delivery_records (admission_id);

CREATE INDEX idx_fk_44 ON delivery_records (referral_id);

CREATE INDEX idx_fk_45 ON newborns (child_id);

CREATE INDEX idx_fk_46 ON newborns (mother_id);

CREATE INDEX idx_fk_47 ON newborns (pregnancy_id);

CREATE INDEX idx_fk_48 ON newborns (delivery_id);

CREATE INDEX idx_fk_49 ON newborns (nicu_bed_id);

CREATE INDEX idx_fk_50 ON newborns (nicu_admission_id);

CREATE INDEX idx_fk_51 ON newborns (paediatrician_id);

CREATE INDEX idx_fk_52 ON stillbirths (mother_id);

CREATE INDEX idx_fk_53 ON stillbirths (pregnancy_id);

CREATE INDEX idx_fk_54 ON stillbirths (delivery_id);

CREATE INDEX idx_fk_55 ON vaccinations (subject_id);

CREATE INDEX idx_fk_56 ON vaccinations (child_id);

CREATE INDEX idx_fk_57 ON vaccinations (mother_id);

CREATE INDEX idx_fk_58 ON vaccinations (pregnancy_id);

CREATE INDEX idx_fk_59 ON vaccinations (centre_hospital_id);

CREATE INDEX idx_fk_60 ON growth_records (child_id);

CREATE INDEX idx_fk_61 ON postpartum_expected (pregnancy_id);

CREATE INDEX idx_fk_62 ON postpartum_visits (expected_id);

CREATE INDEX idx_fk_63 ON postpartum_visits (pregnancy_id);

CREATE INDEX idx_fk_64 ON postpartum_visits (hospital_id);

CREATE INDEX idx_fk_65 ON postpartum_visits (doctor_id);

CREATE INDEX idx_fk_66 ON appointments (subject_id);

CREATE INDEX idx_fk_67 ON appointments (mother_id);

CREATE INDEX idx_fk_68 ON appointments (child_id);

CREATE INDEX idx_fk_69 ON appointments (pregnancy_id);

CREATE INDEX idx_fk_70 ON appointments (doctor_id);

CREATE INDEX idx_fk_71 ON appointments (hospital_id);

CREATE INDEX idx_fk_72 ON care_gaps (subject_id);

CREATE INDEX idx_fk_73 ON care_gaps (pregnancy_id);

CREATE INDEX idx_fk_74 ON emergency_events (mother_id);

CREATE INDEX idx_fk_75 ON emergency_events (child_id);

CREATE INDEX idx_fk_76 ON emergency_events (pregnancy_id);

CREATE INDEX idx_fk_77 ON emergency_events (second_auth_doctor_id);

CREATE INDEX idx_fk_78 ON emergency_events (nearest_hospital_id);

CREATE INDEX idx_fk_79 ON emergency_events (bed_allocated);

CREATE INDEX idx_fk_80 ON emergency_events (admission_id);

CREATE INDEX idx_fk_81 ON scenario_memberships (mother_id);

CREATE INDEX idx_fk_82 ON scenario_memberships (pregnancy_id);

CREATE UNIQUE INDEX one_current_bed_per_patient ON beds(current_patient_id) WHERE current_patient_id IS NOT NULL;
