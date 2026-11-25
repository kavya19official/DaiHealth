'use strict';

const doctors = [
  ['Aditi Saran', 'MD, Obstetrics and Gynaecology', 'Obstetrics & Gynaecology', 0, 'available'],
  ['Neel Kapoor', 'DNB, Obstetrics and Gynaecology', 'Maternal Medicine', 1, 'busy'],
  ['Ira Bhasin', 'MS, Obstetrics and Gynaecology', 'Maternal-Fetal Medicine', 0, 'available'],
  ['Farah Dutt', 'MD, Obstetrics and Gynaecology', 'Antenatal Care', 1, 'offline'],
];

const scenarios = [
  { name:'Meera Ahuja', age:27, week:31, doctor:0, height:161, blood:'O+', visits:[
    [10,108,68,56.2,11.9,null,159,'Booking history documented.'],
    [21,110,70,59.6,11.6,21,145,'Illustrative anatomy scan review released.'],
    [30,112,71,64.1,11.7,30,142,'Reviewed serial observations and booked the next ANC visit.']] },
  { name:'Kavya Sen', age:31, week:34, doctor:1, height:157, blood:'B+', visits:[
    [12,112,72,61.0,12.1,null,151,'Baseline observations recorded.'],
    [23,125,80,64.9,11.9,23,146,'Serial blood pressure readings reviewed.'],
    [33,145,93,69.0,11.5,32,149,'Repeat office BP documented and clinician follow-up booked.']],
    labs:[['Urine protein','Negative','qualitative','Negative'],['Creatinine',0.65,'mg/dL','0.50–1.00'],['ALT',23,'U/L','7–35']], follow:2 },
  { name:'Anika Shah', age:24, week:29, doctor:0, height:154, blood:'A+', visits:[
    [11,104,65,49.8,11.2,null,157,'Booking CBC filed.'],
    [21,106,66,53.0,10.1,21,147,'Clinician discussed haemoglobin trend.'],
    [28,108,68,56.6,9.5,28,145,'Repeat CBC requested and reviewed with the patient.']],
    history:'Previous iron deficiency noted in history.', medication:'Oral iron documented by clinician.' },
  { name:'Rhea Bose', age:29, week:33, doctor:1, height:160, blood:'AB+', visits:[
    [10,114,73,69.2,12.4,null,156,'Prepregnancy weight documented.'],
    [22,117,74,75.6,12.0,22,146,'Reviewed serial clinic weights.'],
    [32,119,76,82.7,11.6,32,140,'Agreed to bring weight and activity records to follow-up.']],
    preWeight:68.5 },
  { name:'Nisha Gill', age:26, week:27, doctor:2, height:158, blood:'O+', visits:[
    [9,106,67,57.4,12.2,null,163,'Prenatal history reviewed.'],
    [19,109,69,60.7,11.9,19,150,'Reviewed screening schedule.'],
    [26,110,70,64.3,11.7,26,147,'OGTT ordered. No result has been received.']], pending:true },
  { name:'Tara Rao', age:34, week:32, doctor:2, height:164, blood:'A−', visits:[
    [12,111,71,63.2,12.6,null,154,'Prior delivery history reviewed.'],
    [21,112,72,67.1,12.2,21,144,'Agreed to revisit birth planning in the third trimester.'],
    [31,113,74,71.6,11.9,31,146,'Prior operative delivery records reviewed for birth planning.']],
    gravida:2, parity:1, obstetric:'Prior caesarean birth with postpartum haemorrhage documented.', risks:['Prior postpartum haemorrhage','Prior caesarean birth'] },
  { name:'Diya Menon', age:28, week:23, doctor:2, height:162, blood:'B+', visits:[
    [8,105,66,54.5,12.4,null,158,'Booking record created.'],
    [15,109,67,56.6,12.0,null,152,'Requested antenatal imaging appointment.'],
    [22,110,70,59.0,11.8,22,148,'Ultrasound teaching frame submitted and awaiting clinician review.']], scan:'pending' },
  { name:'Sana Mir', age:30, week:31, doctor:3, height:159, blood:'O−', visits:[
    [9,112,68,58.5,11.9,null,160,'Booking and blood group recorded.'],
    [17,111,69,60.9,11.7,17,148,'Discussed access to the next clinic appointment.'],
    [24,114,72,63.1,11.5,24,147,'Follow-up booked. The patient did not attend the subsequent visit.']], missed:true },
  { name:'Avni Das', age:25, week:30, doctor:0, height:155, blood:'A+', visits:[
    [10,103,64,50.2,9.3,null,162,'Low haemoglobin documented in the booking report.'],
    [19,106,66,53.8,10.3,19,150,'Repeat CBC recorded together with medication reconciliation.'],
    [29,110,68,58.1,11.3,29,143,'Clinician reviewed the improved haemoglobin trend.']],
    medication:'Oral iron documented by clinician.' },
  { name:'Ishita Roy', age:37, week:35, doctor:1, height:156, blood:'B+', visits:[
    [12,126,79,73.5,12.1,null,153,'Existing conditions and prior obstetric history reconciled.'],
    [23,132,82,78.1,11.8,23,146,'Serial BP and renal and liver report reviewed.'],
    [34,138,88,82.2,11.6,34,142,'Reviewed serial observations and scheduled follow-up.']],
    gravida:3, parity:1, obstetric:'Prior gestational diabetes and one early pregnancy loss.', history:'Chronic hypertension documented before this pregnancy.',
    risks:['Chronic hypertension','Prior gestational diabetes'], labs:[['Creatinine',0.71,'mg/dL','0.50–1.00'],['AST',24,'U/L','8–33'],['ALT',28,'U/L','7–35'],['Urine protein','Trace','qualitative','Negative']], follow:3 },
  { name:'Mira Thomas', age:32, week:28, doctor:3, height:163, blood:'AB−', visits:[
    [10,109,70,59.1,11.8,null,157,'Existing thyroid treatment reconciled.'],
    [18,111,70,62.0,11.6,18,151,'Thyroid report filed with the antenatal chart.'],
    [27,114,73,66.4,11.5,27,145,'Repeat thyroid studies reviewed in context of known history.']],
    history:'Treated hypothyroidism.', medication:'Levothyroxine documented by clinician.', allergy:'Penicillin (reported rash).',
    labs:[['TSH',2.2,'mIU/L','0.4–4.0'],['Free T4',1.1,'ng/dL','0.8–1.8']] },
  { name:'Palak Jain', age:28, week:32, doctor:3, height:160, blood:'O+', visits:[
    [11,107,67,56.8,12.1,null,159,'Initial screening history recorded.'],
    [20,109,69,60.2,11.9,20,148,'Screening appointment arranged.'],
    [31,111,70,65.8,11.7,31,145,'Clinician reviewed the completed glucose screening report.']],
    labs:[['OGTT fasting',82,'mg/dL',null],['OGTT 1 hour',139,'mg/dL',null],['OGTT 2 hour',114,'mg/dL',null]] },
];

module.exports = { doctors, scenarios };
