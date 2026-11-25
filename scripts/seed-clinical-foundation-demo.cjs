'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('../backend/node_modules/bcrypt');

const VERSION = 'clinical-foundation-demo-v1';
const LABEL = 'Synthetic';
const ROOT = path.join(__dirname, '..');
const FACILITIES = {
  delhi: {
    id: '05bfef8fd39659f9b367ec5762e633d4',
    name: 'DAI SYNTHETIC New Delhi Facility 0001',
    unit: 'ANC-DEMO-01',
    room: 'Synthetic ANC Room 01',
  },
  community: {
    id: '94da68fa5b3658669fa24f86f6234be6',
    name: 'DAI SYNTHETIC New Delhi Facility 0007',
    unit: 'ANC-DEMO-07',
    room: 'Synthetic ANC Room 07',
  },
};
const DOCTORS = [
  {
    key: 'aditi-sharma', name: 'Dr Aditi Sharma', email: 'synthetic.aditi.sharma@dai-synthetic.invalid',
    specialization: 'Obstetrics and maternal medicine', qualifications: 'MBBS, MD (Obstetrics & Gynaecology), FMAS',
    facility: 'delhi', registration: 'DEMO-OBG-ADITI-001', availability: 'available', next_hour: 9,
  },
  {
    key: 'rohan-mehta', name: 'Dr Rohan Mehta', email: 'synthetic.rohan.mehta@dai-synthetic.invalid',
    specialization: 'High-risk obstetrics and hypertension', qualifications: 'MBBS, DNB (Obstetrics & Gynaecology), DM (Maternal Medicine)',
    facility: 'delhi', registration: 'DEMO-OBG-ROHAN-002', availability: 'in_consultation', next_hour: 11,
  },
  {
    key: 'nandini-iyer', name: 'Dr Nandini Iyer', email: 'synthetic.nandini.iyer@dai-synthetic.invalid',
    specialization: 'Diabetes in pregnancy and antenatal care', qualifications: 'MBBS, MD (Obstetrics & Gynaecology), Diploma in Diabetology',
    facility: 'community', registration: 'DEMO-OBG-NANDINI-003', availability: 'off_duty', next_day: 1, next_hour: 9,
  },
  {
    key: 'imran-qureshi', name: 'Dr Imran Qureshi', email: 'synthetic.imran.qureshi@dai-synthetic.invalid',
    specialization: 'Fetal medicine and obstetric ultrasound', qualifications: 'MBBS, MS (Obstetrics & Gynaecology), Fetal Medicine Fellowship',
    facility: 'community', registration: 'DEMO-OBG-IMRAN-004', availability: 'available', next_hour: 10,
  },
];
const PATIENTS = [
  {
    key: 'ananya-rao', name: 'Ananya Rao', email: 'synthetic.ananya.rao@dai-synthetic.invalid', doctor: 0,
    dob: '1998-03-14', weeks: 30, gravida: 2, parity: 1, blood_group: 'O+', height: 162, pre_weight: 58,
    medical: 'No chronic medical condition recorded', allergies: 'No known drug allergy recorded',
    previous: 'One prior term birth; no postpartum complication recorded', obstetric: 'G2 P1; previous uncomplicated term vaginal birth',
    risk_level: 'routine', risk_factors: [], hb: [11.8, 11.6], bp: [[108, 68], [112, 72], [116, 74], [118, 76]],
    weights: [58.4, 60.1, 63.2, 64.6], pulse: [76, 78, 80, 82], focus: 'Routine antenatal progression with stable observations',
    plan: 'Continue routine ANC, iron and folic acid; anomaly-scan follow-up and growth review as scheduled.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily'], ['Calcium carbonate', '500 mg', 'Twice daily']],
    extra_labs: [], ultrasound: [{ key: 'growth_32w', scan_week: 28, state: 'released', scan_type: 'growth', image: 'growth_32w',
      findings: 'Single live fetus in cephalic presentation. Synthetic biometry is appropriate for 28 weeks; placenta is fundal and clear of the internal os; amniotic fluid is adequate.',
      instructions: 'Continue routine ANC and review fetal growth at the scheduled follow-up. Seek urgent care for bleeding, leaking or reduced fetal movements.',
      review_note: 'Synthetic scripted review: growth trajectory and fluid volume documented for demonstration; no diagnosis is made.' }],
  },
  {
    key: 'meera-kapoor', name: 'Meera Kapoor', email: 'synthetic.meera.kapoor@dai-synthetic.invalid', doctor: 1,
    dob: '1995-08-02', weeks: 31, gravida: 1, parity: 0, blood_group: 'B+', height: 158, pre_weight: 61,
    medical: 'No chronic medical condition recorded before pregnancy', allergies: 'Penicillin: rash recorded',
    previous: 'No previous pregnancy', obstetric: 'G1 P0; primigravida', risk_level: 'high',
    risk_factors: ['Rising blood pressure in pregnancy', 'Close BP and proteinuria surveillance'], hb: [12.1, 11.4],
    bp: [[112, 70], [124, 78], [142, 90], [150, 94]], weights: [61.5, 63.0, 65.4, 66.8], pulse: [78, 82, 86, 88],
    focus: 'Rising blood pressure requiring clinician review and repeat assessment',
    plan: 'Repeat BP and urine protein assessment; discuss antihypertensive treatment and fetal surveillance with the maternal-medicine team.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily'], ['Labetalol', '100 mg', 'Twice daily']],
    extra_labs: [{ visit: 3, panel: 'urinalysis', code: 'urine_protein', name: 'Urine protein', value_text: 'Trace', unit: 'dipstick', reference_text: 'Negative', specimen: 'Midstream urine', status: 'pending_review' }],
  },
  {
    key: 'sana-qureshi', name: 'Sana Qureshi', email: 'synthetic.sana.qureshi@dai-synthetic.invalid', doctor: 0,
    dob: '1999-11-21', weeks: 29, gravida: 2, parity: 1, blood_group: 'A+', height: 165, pre_weight: 54,
    medical: 'Iron-deficiency anaemia documented in the first trimester', allergies: 'No known drug allergy recorded',
    previous: 'Previous uncomplicated term birth', obstetric: 'G2 P1; one prior live birth', risk_level: 'moderate',
    risk_factors: ['Low haemoglobin', 'Iron replacement and response review'], hb: [9.2, 10.4],
    bp: [[110, 70], [108, 68], [112, 72], [114, 74]], weights: [54.4, 56.0, 58.1, 59.0], pulse: [82, 84, 80, 78],
    focus: 'Improving iron-deficiency anaemia after treatment',
    plan: 'Continue prescribed iron, review tolerance and repeat haemoglobin after four weeks.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Ferrous sulfate', '200 mg elemental iron on alternate days', 'Alternate days'], ['Calcium carbonate', '500 mg', 'Twice daily']],
    extra_labs: [{ visit: 3, panel: 'cbc', code: 'platelets', name: 'Platelet count', value_numeric: 246, unit: 'x10^9/L', low: 150, high: 410, specimen: 'Venous blood' }],
  },
  {
    key: 'priya-nair', name: 'Priya Nair', email: 'synthetic.priya.nair@dai-synthetic.invalid', doctor: 2,
    dob: '1993-05-17', weeks: 32, gravida: 1, parity: 0, blood_group: 'AB+', height: 154, pre_weight: 68,
    medical: 'Pre-pregnancy BMI in the overweight range; no diabetes diagnosed', allergies: 'No known drug allergy recorded',
    previous: 'No previous pregnancy', obstetric: 'G1 P0; primigravida', risk_level: 'moderate',
    risk_factors: ['Higher-than-expected weight progression', 'Glucose tolerance monitoring'], hb: [11.3, 11.1],
    bp: [[116, 74], [120, 78], [122, 80], [124, 82]], weights: [68.6, 71.2, 75.0, 77.3], pulse: [80, 82, 84, 86],
    focus: 'Weight progression above the expected trajectory with normal screening glucose',
    plan: 'Review nutrition and activity goals; continue routine ANC and repeat glucose screening if clinically indicated.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    ogtt: [84, 142, 126],
  },
  {
    key: 'ritu-sen', name: 'Ritu Sen', email: 'synthetic.ritu.sen@dai-synthetic.invalid', doctor: 2,
    dob: '1997-01-09', weeks: 27, gravida: 1, parity: 0, blood_group: 'O-', height: 160, pre_weight: 56,
    medical: 'No chronic medical condition recorded', allergies: 'No known drug allergy recorded',
    previous: 'No previous pregnancy', obstetric: 'G1 P0; primigravida', risk_level: 'routine',
    risk_factors: [], hb: [11.5, 11.7], bp: [[106, 66], [110, 70], [112, 72], [114, 74]],
    weights: [56.3, 58.2, 60.4, 61.2], pulse: [74, 76, 78, 80], focus: 'Gestational diabetes screening collected; results not yet available',
    plan: 'Await the laboratory glucose tolerance result; review it at the next ANC appointment before changing treatment.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    ogtt: 'awaiting_result',
  },
  {
    key: 'devika-iyer', name: 'Devika Iyer', email: 'synthetic.devika.iyer@dai-synthetic.invalid', doctor: 1,
    dob: '1991-12-04', weeks: 33, gravida: 3, parity: 1, blood_group: 'B-', height: 157, pre_weight: 59,
    medical: 'History of spontaneous preterm birth; cervical cerclage documented in the prior pregnancy',
    allergies: 'No known drug allergy recorded', previous: 'Spontaneous preterm birth at 34 weeks in the prior pregnancy',
    obstetric: 'G3 P1; one prior preterm birth at 34 weeks and one early pregnancy loss', risk_level: 'high',
    risk_factors: ['Prior spontaneous preterm birth', 'Cervical length surveillance'], hb: [10.8, 11.0],
    bp: [[114, 72], [116, 74], [118, 76], [120, 78]], weights: [59.4, 61.0, 63.3, 64.4], pulse: [78, 80, 82, 80],
    focus: 'Preterm-birth prevention follow-up with stable current observations',
    plan: 'Continue preterm-birth prevention follow-up and review cervical-length surveillance with the high-risk obstetric team.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily'], ['Progesterone vaginal tablets', '200 mg', 'At bedtime']],
  },
  {
    key: 'aishwarya-menon', name: 'Aishwarya Menon', email: 'synthetic.aishwarya.menon@dai-synthetic.invalid', doctor: 3,
    dob: '2000-06-28', weeks: 28, gravida: 1, parity: 0, blood_group: 'A-', height: 163, pre_weight: 55,
    medical: 'No chronic medical condition recorded', allergies: 'No known drug allergy recorded',
    previous: 'No previous pregnancy', obstetric: 'G1 P0; primigravida', risk_level: 'routine', risk_factors: [],
    hb: [11.6, 11.5], bp: [[108, 68], [110, 70], [112, 72], [114, 74]], weights: [55.3, 57.0, 59.1, 60.0],
    pulse: [76, 78, 80, 78], focus: 'Third-trimester ultrasound awaiting clinician interpretation',
    plan: 'Clinician to review the connected ultrasound frames and release a report after image quality and biometry assessment.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    ultrasound: [{ key: 'brain_alt', scan_week: 27, state: 'under_review', scan_type: 'growth', image: 'brain_alt' }],
  },
  {
    key: 'neha-bansal', name: 'Neha Bansal', email: 'synthetic.neha.bansal@dai-synthetic.invalid', doctor: 0,
    dob: '1996-09-12', weeks: 24, gravida: 2, parity: 1, blood_group: 'O+', height: 161, pre_weight: 60,
    medical: 'No chronic medical condition recorded', allergies: 'No known drug allergy recorded',
    previous: 'Previous uncomplicated term birth', obstetric: 'G2 P1; one prior live birth', risk_level: 'routine',
    risk_factors: ['Missed antenatal follow-up; contact and rebooking required'], hb: [11.2, 11.3],
    bp: [[112, 72], [114, 74], [116, 76], [118, 76]], weights: [60.4, 62.1, 64.0, 64.9], pulse: [78, 80, 82, 80],
    focus: 'One antenatal follow-up was missed; measurements are not inferred for that encounter',
    plan: 'Contact the patient, rebook the missed ANC review and confirm investigation completion.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    missed_visit: 2,
  },
  {
    key: 'kavya-joshi', name: 'Kavya Joshi', email: 'synthetic.kavya.joshi@dai-synthetic.invalid', doctor: 1,
    dob: '1994-02-23', weeks: 30, gravida: 2, parity: 1, blood_group: 'AB-', height: 159, pre_weight: 57,
    medical: 'Earlier pregnancy anaemia and raised blood pressure; both improving on follow-up',
    allergies: 'No known drug allergy recorded', previous: 'Previous uncomplicated term birth',
    obstetric: 'G2 P1; one prior live birth', risk_level: 'moderate', risk_factors: ['Previous abnormal BP and haemoglobin in this pregnancy'],
    hb: [9.8, 11.2], bp: [[146, 92], [136, 86], [122, 80], [118, 78]], weights: [57.4, 59.3, 61.4, 62.2],
    pulse: [84, 82, 78, 76], focus: 'Improving haemoglobin and blood pressure after earlier abnormal readings',
    plan: 'Continue current treatment and monitor BP and haemoglobin trend at the next scheduled review.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Ferrous sulfate', '200 mg elemental iron on alternate days', 'Alternate days'], ['Nifedipine', '20 mg', 'Twice daily']],
  },
  {
    key: 'farah-khan', name: 'Farah Khan', email: 'synthetic.farah.khan@dai-synthetic.invalid', doctor: 2,
    dob: '1989-07-30', weeks: 34, gravida: 3, parity: 2, blood_group: 'B+', height: 156, pre_weight: 65,
    medical: 'Hypothyroidism before pregnancy; gestational diabetes diagnosed after OGTT',
    allergies: 'Sulfonamide antibiotics: rash recorded', previous: 'Two prior uncomplicated term births',
    obstetric: 'G3 P2; two prior live births', risk_level: 'high',
    risk_factors: ['Hypothyroidism', 'Gestational diabetes', 'Higher maternal BMI'], hb: [10.6, 10.9],
    bp: [[124, 80], [126, 82], [128, 84], [130, 84]], weights: [65.5, 68.0, 71.2, 73.0], pulse: [82, 84, 86, 88],
    focus: 'Combined thyroid, glucose and growth surveillance with treatment response review',
    plan: 'Continue thyroxine and metformin, review home glucose readings and coordinate growth surveillance with the diabetes-in-pregnancy team.',
    medications: [['Levothyroxine', '75 mcg', 'Every morning on an empty stomach'], ['Metformin', '500 mg', 'Twice daily with meals'], ['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    ogtt: [92, 198, 166], tsh: [3.8, 4.6],
    extra_labs: [
      { visit: 3, panel: 'renal', code: 'creatinine', name: 'Serum creatinine', value_numeric: 0.72, unit: 'mg/dL', low: 0.5, high: 1.1, specimen: 'Venous blood' },
      { visit: 3, panel: 'liver', code: 'alt', name: 'Alanine aminotransferase', value_numeric: 24, unit: 'U/L', low: 7, high: 35, specimen: 'Venous blood' },
    ],
  },
  {
    key: 'ritika-malhotra', name: 'Ritika Malhotra', email: 'synthetic.ritika.malhotra@dai-synthetic.invalid', doctor: 3,
    dob: '1999-04-06', weeks: 26, gravida: 1, parity: 0, blood_group: 'A+', height: 166, pre_weight: 59,
    medical: 'Symptomatic lower urinary tract infection in the current pregnancy', allergies: 'No known drug allergy recorded',
    previous: 'No previous pregnancy', obstetric: 'G1 P0; primigravida', risk_level: 'moderate',
    risk_factors: ['Current urinary tract infection', 'Culture review and treatment completion'], hb: [11.4, 11.3],
    bp: [[110, 70], [112, 72], [114, 74], [116, 74]], weights: [59.3, 60.8, 62.4, 63.0], pulse: [80, 82, 84, 82],
    focus: 'Urinary symptoms with a connected urine culture and clinician treatment plan',
    plan: 'Complete the prescribed antibiotic course, review culture sensitivity and seek urgent care for fever, flank pain or worsening symptoms.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Nitrofurantoin', '100 mg', 'Twice daily']],
    extra_labs: [{ visit: 3, panel: 'culture', code: 'urine_culture', name: 'Urine culture', value_text: 'E. coli >100000 CFU/mL; nitrofurantoin sensitive', unit: 'CFU/mL', reference_text: 'No significant growth', specimen: 'Midstream urine', status: 'pending_review' }],
  },
  {
    key: 'tanvi-desai', name: 'Tanvi Desai', email: 'synthetic.tanvi.desai@dai-synthetic.invalid', doctor: 3,
    dob: '1992-10-18', weeks: 32, gravida: 2, parity: 1, blood_group: 'O+', height: 160, pre_weight: 56,
    medical: 'No chronic medical condition recorded', allergies: 'No known drug allergy recorded',
    previous: 'Previous uncomplicated term birth', obstetric: 'G2 P1; one prior live birth', risk_level: 'high',
    risk_factors: ['Reduced fetal movements reported today', 'Same-day obstetric assessment'], hb: [11.7, 11.6],
    bp: [[112, 72], [114, 74], [116, 76], [118, 78]], weights: [56.4, 58.1, 60.2, 61.1], pulse: [78, 80, 82, 84],
    focus: 'Reduced fetal movements reported today; same-day assessment arranged',
    plan: 'Same-day fetal heart rate and ultrasound assessment; do not rely on a home kick count if movements remain reduced.',
    medications: [['Folic acid', '400 mcg', 'Once daily'], ['Iron and folic acid', '60 mg elemental iron', 'Once daily']],
    urgent_today: true,
    ultrasound: [{ key: 'growth_34w', scan_week: 32, state: 'pending', scan_type: 'growth', image: 'growth_34w' }],
  },
];

const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const addDays = (value, days) => {
  const date = new Date(iso(value) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
};
const at = (date, hour, minute = 0) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && iso(new Date(value + 'T12:00:00Z')) === value;

function visitWeeks(patient) {
  return [9, 18, Math.min(26, patient.weeks - 4), patient.weeks - 1];
}

async function appointment(client, patient, doctor, facility, date, status, reason, index) {
  const start = 9 * 60 + Math.floor(index / 3) * 60 + (index % 3) * 20;
  const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
  return client.query(`INSERT INTO appointments
    (mother_id,doctor_id,requested_date,requested_time,slot_end,status,reason,doctor_notes,unit_label,room,facility_uuid,visit_type)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [patient.id, doctor.id, date, clock(start), clock(start + 20),
    status, reason, status === 'completed' ? patient.plan : null, facility.unit, facility.room, facility.id, 'ANC'])
    .then(result => result.rows[0].id);
}

async function observation(client, patient, doctor, appointmentId, visitDate, visitIndex, gestationalWeek) {
  const scan = visitIndex === 3;
  const values = {
    bp_systolic: patient.bp[visitIndex][0], bp_diastolic: patient.bp[visitIndex][1],
    pulse: patient.pulse[visitIndex], temperature_c: Number((36.5 + (visitIndex % 4) * 0.1 + Number(patient.key.length % 3) * 0.1).toFixed(1)),
    oxygen_saturation: 99 - (visitIndex % 2), weight_kg: patient.weights[visitIndex],
    fundal_height_cm: Number(Math.max(8, gestationalWeek * 0.78).toFixed(1)),
  };
  if (scan) values.fetal_heart_rate = 142 + (patient.key.length % 5) * 2;
  const targets = {};
  if (patient.hb[1] < 11) targets.haemoglobin = 'Review haemoglobin response at the next ANC visit';
  if (patient.risk_level === 'high' && patient.bp[visitIndex][0] >= 140) targets.blood_pressure = 'Clinician review of repeated blood pressure readings';
  const sourceId = `SYNTH-ANC-${patient.key.toUpperCase()}-${visitIndex + 1}`;
  await client.query(`INSERT INTO clinical_dashboard_entries
    (mother_id,doctor_id,recorded_on,source_kind,values_json,targets_json,scan_note,appointment_id,observed_at,source_record_id,measurement_status,record_key)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,'recorded',$11)`,
  [patient.id, doctor.id, visitDate, scan ? 'clinic_scan' : 'clinic_visit', JSON.stringify(values), JSON.stringify(targets),
    scan ? `Synthetic ANC Doppler observation. ${patient.focus}. Not a diagnostic ultrasound report.` : null,
    appointmentId, at(visitDate, 10, visitIndex * 7), sourceId, `${VERSION}:observation:${patient.key}:${visitIndex}`]);
}

async function investigation(client, patient, doctor, appointmentId, collectedOn, spec, index) {
  const status = spec.status || 'recorded';
  const review = status === 'pending_review' ? 'pending_clinician_review' : status === 'awaiting_result' ? 'pending_clinician_review' : 'reviewed';
  const sourceId = `SYNTH-LAB-${patient.key.toUpperCase()}-${String(index + 1).padStart(2, '0')}-${spec.code}`;
  await client.query(`INSERT INTO clinical_investigations
    (mother_id,appointment_id,panel_code,test_code,test_name,value_numeric,value_text,unit,reference_low,reference_high,
     reference_text,specimen_context,status,review_status,collected_on,resulted_on,source_type,source_record_id,
     reviewed_by,reviewed_at,notes,record_key,data_label)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'synthetic_lab_register',$17,$18,$19,$20,$21,$22)`,
  [patient.id, appointmentId, spec.panel, spec.code, spec.name, spec.value_numeric ?? null, spec.value_text ?? null,
    spec.unit || null, spec.low ?? null, spec.high ?? null,
    spec.reference_text || (spec.low != null && spec.high != null ? `${spec.low}–${spec.high} ${spec.unit || ''}`.trim() : null),
    spec.specimen || null, status, review, collectedOn, status === 'awaiting_result' ? null : collectedOn, sourceId,
    review === 'reviewed' ? doctor.id : null, review === 'reviewed' ? at(collectedOn, 16) : null,
    `Synthetic demonstration result. ${spec.note || 'No real patient measurement.'}`, `${VERSION}:investigation:${patient.key}:${index}`, LABEL]);
}

async function seedPatient(client, patient, doctor, date, counts) {
  const facility = FACILITIES[doctor.facility];
  const lmp = addDays(date, -patient.weeks * 7);
  const edd = addDays(lmp, 280);
  patient.id = (await client.query(`INSERT INTO mother_profiles
    (user_id,full_name,date_of_birth,address,pregnancy_status,lmp_date,edd_date,gravida,parity,blood_group,
     medical_conditions,allergies,current_medications,previous_complications,obstetric_history,height_cm,
     pre_pregnancy_weight_kg,risk_level,risk_factors,risk_assessed_at,data_label,care_start_date)
    VALUES($1,$2,$3,$4,'pregnant',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21) RETURNING user_id`,
  [patient.id, patient.name, patient.dob, 'Synthetic demonstration address, New Delhi', lmp, edd, patient.gravida, patient.parity,
    patient.blood_group, patient.medical, patient.allergies, patient.medications.filter(m => m[3] !== false).map(m => `${m[0]} ${m[1]} ${m[2]}`).join('; '),
    patient.previous, patient.obstetric, patient.height, patient.pre_weight, patient.risk_level, JSON.stringify(patient.risk_factors),
    at(date, 8), LABEL, lmp])).rows[0].user_id;
  await client.query(`INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at,include_history)
    VALUES($1,$2,$3::date+INTERVAL '30 days',TRUE)`, [patient.id, doctor.id, date]);
  await client.query(`INSERT INTO patient_access_events(mother_id,event_type,details)
    VALUES($1,'synthetic_demo_grant',$2::jsonb)`, [patient.id, JSON.stringify({ seed: VERSION, doctor_id: doctor.id, include_history: true, data_label: LABEL })]);
  for (const [index, medication] of patient.medications.entries()) {
    await client.query(`INSERT INTO medications(mother_id,name,dose,schedule,prescribed_by,active,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::date-INTERVAL '14 days')`,
    [patient.id, medication[0], medication[1], medication[2], doctor.name, medication[3] !== false, addDays(lmp, 35 + index)]);
  }
  await client.query(`INSERT INTO clinical_dashboard_plan(mother_id,doctor_id,title,description)
    VALUES($1,$2,$3,$4)`, [patient.id, doctor.id, `Synthetic ANC plan: ${patient.focus}`, `${patient.plan} Synthetic demonstration only.`]);

  const weeks = visitWeeks(patient);
  const visits = [];
  for (const [index, week] of weeks.entries()) {
    const visitDate = addDays(lmp, week * 7);
    const missed = patient.missed_visit === index;
    const status = missed ? 'cancelled' : 'completed';
    const reason = missed ? 'Missed antenatal follow-up; no measurements recorded' :
      index === 0 ? 'Booking antenatal assessment' : index === 3 ? `Recent ANC: ${patient.focus}` : 'Scheduled antenatal review';
    const appointmentId = await appointment(client, patient, doctor, facility, visitDate, status, reason, index);
    visits.push({ id: appointmentId, date: visitDate, week, missed });
    counts.appointments++;
    await client.query(`INSERT INTO anc_visits
      (mother_id,appointment_id,doctor_id,visit_date,gestational_week,status,visit_type,notes,follow_up_date,source_record_id,record_key,data_label)
      VALUES($1,$2,$3,$4,$5,$6,'ANC',$7,$8,$9,$10,$11)`,
    [patient.id, appointmentId, doctor.id, visitDate, week, missed ? 'missed' : 'completed',
      missed ? 'Encounter not completed. No clinical values were inferred; rebooking is required.' :
        `Synthetic ANC encounter. ${index === 3 ? patient.focus : 'Routine antenatal assessment with connected observations and investigation review.'}`,
      addDays(visitDate, index === 3 ? 7 : 28), `SYNTH-ANC-${patient.key.toUpperCase()}-${index + 1}`,
      `${VERSION}:anc:${patient.key}:${index}`, LABEL]);
    if (!missed) {
      await observation(client, patient, doctor, appointmentId, visitDate, index, week);
      counts.observations++;
      await client.query(`INSERT INTO visit_summaries
        (appointment_id,mother_id,doctor_id,version,status,summary_text,next_steps,follow_up,pending_tests,approved_at,approved_by)
        VALUES($1,$2,$3,1,'approved',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$3)`,
      [appointmentId, patient.id, doctor.id, `Synthetic consultation summary. ${patient.focus}.`,
        JSON.stringify([patient.plan]), JSON.stringify({ date: addDays(visitDate, index === 3 ? 7 : 28), instruction: 'Review at the scheduled ANC follow-up.' }),
        JSON.stringify([]), at(visitDate, 17)]);
      counts.consultations++;
    }
  }

  const latest = visits[visits.length - 1];
  const futureDate = addDays(date, patient.urgent_today ? 0 : 7);
  const futureReason = patient.urgent_today ? `Same-day review: ${patient.focus}` : `Planned follow-up: ${patient.focus}`;
  const futureId = await appointment(client, patient, doctor, facility, futureDate, 'confirmed', futureReason, 6);
  counts.appointments++;
  await client.query(`INSERT INTO anc_visits
    (mother_id,appointment_id,doctor_id,visit_date,gestational_week,status,visit_type,notes,follow_up_date,source_record_id,record_key,data_label)
    VALUES($1,$2,$3,$4,$5,'scheduled','ANC',$6,$7,$8,$9,$10)`,
  [patient.id, futureId, doctor.id, futureDate, patient.weeks + (patient.urgent_today ? 0 : 1), futureReason,
    futureDate, `SYNTH-ANC-${patient.key.toUpperCase()}-FOLLOWUP`, `${VERSION}:anc:${patient.key}:followup`, LABEL]);
  if (patient.urgent_today) {
    await client.query(`INSERT INTO doctor_queue_state(appointment_id,doctor_id,state,checked_in_at,version)
      VALUES($1,$2,'waiting',$3,1)`, [futureId, doctor.id, at(date, 8, 30)]);
    const values = { bp_systolic: 120, bp_diastolic: 78, pulse: 84, temperature_c: 36.7, oxygen_saturation: 99, weight_kg: patient.weights[3], fetal_heart_rate: 138 };
    await client.query(`INSERT INTO clinical_dashboard_entries
      (mother_id,doctor_id,recorded_on,source_kind,values_json,targets_json,scan_note,appointment_id,observed_at,source_record_id,measurement_status,record_key)
      VALUES($1,$2,$3,'clinic_scan',$4::jsonb,'{}',$5,$6,$7,$8,'recorded',$9)`,
    [patient.id, doctor.id, date, JSON.stringify(values), 'Synthetic same-day Doppler observation; clinician review remains required.', futureId,
      at(date, 9), `SYNTH-ANC-${patient.key.toUpperCase()}-URGENT`, `${VERSION}:observation:${patient.key}:urgent`]);
    counts.observations++;
    await client.query(`INSERT INTO health_logs(mother_id,log_type,data,logged_at)
      VALUES($1,'kick_session',$2::jsonb,$3)`, [patient.id, JSON.stringify({ kicks: 4, duration_sec: 1800, data_label: LABEL, note: 'Synthetic self-report; reduced movements.' }), at(date, 7, 45)]);
    counts.health_logs++;
  }

  const milestoneSpecs = [
    { week: 9, title: 'First antenatal assessment', order: 10 },
    { week: 20, title: 'Anomaly scan review', order: 20 },
    { week: 26, title: 'Glucose tolerance review', order: 30 },
    { week: 36, title: 'Birth plan and facility readiness', order: 40 },
  ];
  for (const milestone of milestoneSpecs) {
    const due = addDays(lmp, milestone.week * 7);
    const linked = visits.find(visit => visit.week === milestone.week && !visit.missed) ||
      (milestone.week === 26 && patient.weeks >= 26 ? latest : null);
    const completed = due <= latest.date && !!linked && !(patient.missed_visit != null && milestone.week === weeks[patient.missed_visit]);
    await client.query(`INSERT INTO care_milestones
      (mother_id,stage,category,title,due_date,completed_at,sort_order,appointment_id,completion_verification,verified_facility_name)
      VALUES($1,$2,'pregnancy',$3,$4,$5,$6,$7,$8,$9)`,
    [patient.id, milestone.week < 13 ? 'Trimester 1' : milestone.week < 28 ? 'Trimester 2' : 'Trimester 3', milestone.title,
      due, completed ? at(linked.date, 18) : null, milestone.order, completed ? linked.id : null,
      completed ? 'Synthetic completion linked to the recorded encounter' : null, completed ? facility.name : null]);
    counts.milestones++;
  }
  if (patient.missed_visit != null) {
    await client.query(`INSERT INTO care_milestones(mother_id,stage,category,title,guidance,due_date,sort_order,completion_verification)
      VALUES($1,'Trimester 2','pregnancy','Rebook missed ANC review','No encounter measurements were inferred. Contact and rebook the patient.',$2,25,NULL)`,
    [patient.id, visits[patient.missed_visit].date]);
    counts.milestones++;
  }

  const labs = [];
  const addLab = (visitIndex, spec) => labs.push({ visitIndex, spec });
  addLab(0, { panel: 'cbc', code: 'haemoglobin', name: 'Haemoglobin', value_numeric: patient.hb[0], unit: 'g/dL', low: 11, high: 16, specimen: 'Venous blood', note: 'Booking antenatal sample.' });
  addLab(0, { panel: 'blood_group', code: 'abo_rh', name: 'ABO and Rh group', value_text: patient.blood_group, unit: null, reference_text: 'Recorded blood group', specimen: 'Venous blood' });
  addLab(0, { panel: 'cbc', code: 'wbc', name: 'White blood cell count', value_numeric: Number((7.1 + (patient.key.length % 6) * 0.4).toFixed(1)), unit: 'x10^9/L', low: 4, high: 11, specimen: 'Venous blood' });
  addLab(0, { panel: 'cbc', code: 'platelets', name: 'Platelet count', value_numeric: 188 + (patient.key.length * 7) % 90, unit: 'x10^9/L', low: 150, high: 410, specimen: 'Venous blood' });
  if (patient.key.length % 3 === 0 || patient.tsh) addLab(0, { panel: 'thyroid', code: 'tsh', name: 'Thyroid-stimulating hormone', value_numeric: patient.tsh?.[0] ?? 1.7 + (patient.key.length % 4) * 0.3, unit: 'mIU/L', low: 0.4, high: 4.0, specimen: 'Venous blood' });
  addLab(1, { panel: 'urinalysis', code: 'urine_protein', name: 'Urine protein', value_text: 'Negative', unit: 'dipstick', reference_text: 'Negative', specimen: 'Midstream urine' });
  addLab(3, { panel: 'cbc', code: 'haemoglobin', name: 'Haemoglobin', value_numeric: patient.hb[1], unit: 'g/dL', low: 11, high: 16, specimen: 'Venous blood', note: 'Follow-up antenatal sample.' });
  if (patient.tsh) addLab(3, { panel: 'thyroid', code: 'tsh', name: 'Thyroid-stimulating hormone', value_numeric: patient.tsh[1], unit: 'mIU/L', low: 0.4, high: 4.0, specimen: 'Venous blood' });
  for (const extra of patient.extra_labs || []) addLab(extra.visit, extra);
  const ogtt = patient.ogtt || (patient.weeks >= 26 ? [82 + patient.key.length % 5, 132 + (patient.key.length % 7) * 3, 116 + (patient.key.length % 4) * 4] : null);
  if (ogtt) {
    const ogttDate = addDays(lmp, 26 * 7);
    const ogttAppointment = await appointment(client, patient, doctor, facility, ogttDate, 'completed', 'Glucose tolerance test and result review', 8);
    counts.appointments++;
    await client.query(`UPDATE care_milestones SET completed_at=$2,appointment_id=$3,completion_verification='Synthetic completion linked to the recorded investigation encounter',verified_facility_name=$4
      WHERE mother_id=$1 AND title='Glucose tolerance review'`, [patient.id, at(ogttDate, 18), ogttAppointment, facility.name]);
    const values = ogtt === 'awaiting_result' ? null : ogtt;
    for (const [index, spec] of [
      { code: 'ogtt_0h', name: 'OGTT fasting glucose', low: 92, high: null },
      { code: 'ogtt_1h', name: 'OGTT 1-hour glucose', low: null, high: 180 },
      { code: 'ogtt_2h', name: 'OGTT 2-hour glucose', low: null, high: 153 },
    ].entries()) {
      addLab(-1, { ...spec, panel: 'ogtt', value_numeric: values?.[index] ?? null, unit: 'mg/dL', specimen: '75 g oral glucose tolerance test', status: values ? 'recorded' : 'awaiting_result', note: values ? 'Synthetic OGTT sample.' : 'Sample collected; result not yet available.' });
      labs[labs.length - 1].appointmentId = ogttAppointment;
      labs[labs.length - 1].date = ogttDate;
    }
  }
  for (const [index, lab] of labs.entries()) {
    const linkedVisit = lab.visitIndex >= 0 ? visits[lab.visitIndex] : null;
    await investigation(client, patient, doctor, lab.appointmentId || linkedVisit.id, lab.date || linkedVisit.date, lab.spec, index);
    counts.investigations++;
  }
  if (patient.medical.includes('Rising blood pressure') || patient.key === 'kavya-joshi') {
    await client.query(`INSERT INTO health_logs(mother_id,log_type,data,logged_at)
      VALUES($1,'blood_pressure',$2::jsonb,$3)`, [patient.id, JSON.stringify({ systolic: patient.bp[3][0], diastolic: patient.bp[3][1], pulse: patient.pulse[3], data_label: LABEL }), at(latest.date, 8)]);
    counts.health_logs++;
  }
  return { id: patient.id, email: patient.email, doctor_id: doctor.id, facility_ref: facility.id, episode: lmp, lmp, edd, gestation_weeks: patient.weeks, scans: patient.ultrasound || [] };
}

function manifestPayload(date, doctors, patients) {
  return {
    version: VERSION,
    data_label: LABEL,
    as_of_date: date,
    notice: 'All patients, measurements, reports and images are synthetic demonstrations; not for clinical use.',
    doctors,
    patients: patients.map(patient => ({
      id: patient.id, email: patient.email, doctor_id: patient.doctor_id, facility_ref: patient.facility_ref,
      episode: patient.episode, pregnancy_context: { stage: 'pregnant', lmp: patient.lmp, edd: patient.edd, gestation_weeks: patient.gestation_weeks, data_label: LABEL, demo: true },
      scans: patient.scans.map(scan => ({ ...scan, scan_date: addDays(date, -(patient.gestation_weeks - scan.scan_week) * 7), data_label: LABEL })),
    })),
  };
}

async function writeManifest(client, date, file) {
  const doctors = [];
  for (const definition of DOCTORS) {
    const row = (await client.query('SELECT u.id,u.email,dp.full_name FROM users u JOIN doctor_profiles dp ON dp.user_id=u.id WHERE u.email=$1', [definition.email])).rows[0];
    if (!row) throw new Error(`Missing seeded demo doctor ${definition.email}`);
    doctors.push(row);
  }
  const patients = [];
  for (const definition of PATIENTS) {
    const row = (await client.query(`SELECT mp.user_id AS id,u.email,a.doctor_id,a.facility_uuid AS facility_ref,
      mp.lmp_date::text AS lmp,mp.edd_date::text AS edd,mp.data_label
      FROM mother_profiles mp JOIN users u ON u.id=mp.user_id JOIN appointments a ON a.mother_id=mp.user_id
      WHERE u.email=$1 ORDER BY a.id LIMIT 1`, [definition.email])).rows[0];
    if (!row) throw new Error(`Missing seeded demo patient ${definition.email}`);
    const gestationWeeks = Math.floor((Date.parse(date + 'T12:00:00Z') - Date.parse(row.lmp + 'T12:00:00Z')) / 604800000);
    patients.push({ ...row, id: Number(row.id), doctor_id: Number(row.doctor_id), episode: row.lmp, gestation_weeks: gestationWeeks, scans: definition.ultrasound || [] });
  }
  const payload = manifestPayload(date, doctors.map(doctor => ({ ...doctor, id: Number(doctor.id) })), patients);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
  return payload;
}

async function seedClinicalFoundationDemo(client, options = {}) {
  const date = options.date || today();
  if (!validDate(date)) throw new Error('A valid synthetic cohort date is required');
  const previous = (await client.query('SELECT source_sha256,counts FROM dai_local_seed WHERE version=$1', [VERSION])).rows[0];
  const manifestFile = options.manifestFile || path.join(ROOT, '.local/clinical-foundation-ultrasound.json');
  if (previous) {
    if (previous.source_sha256 !== options.sourceSha256 && options.sourceSha256) throw new Error('The synthetic clinical fixture changed; existing records were preserved.');
    const manifest = await writeManifest(client, previous.counts.as_of_date || date, manifestFile);
    return { alreadySeeded: true, counts: previous.counts, manifest };
  }
  const password = options.password || process.env.DAI_DEMO_PASSWORD;
  if (!password) throw new Error('DAI_DEMO_PASSWORD is required for synthetic demo accounts');
  const accounts = [...DOCTORS.map(doctor => doctor.email), ...PATIENTS.map(patient => patient.email)];
  const existing = await client.query('SELECT email FROM users WHERE email=ANY($1::text[])', [accounts]);
  if (existing.rows.length) throw new Error(`Reserved synthetic account ${existing.rows[0].email} already exists. No account was overwritten.`);
  const hash = await bcrypt.hash(password, 10);
  const sourceSha256 = options.sourceSha256 || crypto.createHash('sha256').update(JSON.stringify({ DOCTORS, PATIENTS, FACILITIES })).digest('hex');
  const counts = { patients: PATIENTS.length, doctors: DOCTORS.length, appointments: 0, anc_visits: 0, observations: 0, investigations: 0, consultations: 0, medications: 0, milestones: 0, health_logs: 0, as_of_date: date };
  const doctorRows = [];
  const patientRows = [];
  await client.query('BEGIN');
  try {
    for (const definition of DOCTORS) {
      const id = (await client.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,\'doctor\') RETURNING id', [definition.email, hash])).rows[0].id;
      const facility = FACILITIES[definition.facility];
      const nextDate = addDays(date, definition.next_day || 0);
      await client.query(`INSERT INTO doctor_profiles
        (user_id,full_name,specialization,medical_license_number,facility_name,credential_verified,qualifications,availability_status,next_available_at,data_label)
        VALUES($1,$2,$3,$4,$5,TRUE,$6,$7,$8,$9)`,
      [id, definition.name, definition.specialization, definition.registration, facility.name, definition.qualifications,
        definition.availability, at(nextDate, definition.next_hour), LABEL]);
      doctorRows.push({ ...definition, id });
    }
    for (const definition of PATIENTS) {
      const id = (await client.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,\'mother\') RETURNING id', [definition.email, hash])).rows[0].id;
      const patient = { ...definition, id };
      const doctor = doctorRows[definition.doctor];
      const row = await seedPatient(client, patient, doctor, date, counts);
      patientRows.push(row);
      counts.anc_visits += visitWeeks(patient).length + 1;
      counts.medications += patient.medications.length;
    }
    await client.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3::jsonb)', [VERSION, sourceSha256, JSON.stringify(counts)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  const manifest = await writeManifest(client, date, manifestFile);
  return { alreadySeeded: false, counts, manifest };
}

module.exports = { seedClinicalFoundationDemo, DOCTORS, PATIENTS, FACILITIES, VERSION };
