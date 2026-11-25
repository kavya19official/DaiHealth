'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const bcrypt = require('../backend/node_modules/bcrypt');
const { doctors, scenarios } = require('./fixtures/workspace-foundation.cjs');

const root = path.join(__dirname, '..');
const version = 'workspace-foundation-v1';
const label = 'Synthetic workspace demonstration';
const domain = '@dai-synthetic.invalid';
const isoDay = (date, offset = 0) => new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const sha = data => createHash('sha256').update(data).digest('hex');
const json = JSON.stringify;
const code = (type, index) => 'foundation-' + type + '-' + String(index + 1).padStart(2, '0');
const time = date => date + 'T10:00:00+05:30';

function pdf(lines) {
  const commands = lines.map(line => '(' + line.replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7e]/g, '-') + ') Tj T*').join('\n');
  const stream = 'BT /F1 11 Tf 52 780 Td 19 TL\n' + commands + '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body);
    body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  return Buffer.from(body + 'xref\n0 6\n0000000000 65535 f \n' + offsets.join('') +
    'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n' + Buffer.byteLength(body) + '\n%%EOF\n');
}

function labsFor(patient, visit, index, last) {
  const hematocrit = Number((visit.hb * 3).toFixed(1));
  const mcv = 82 + (patient.index * 2 + index * 3) % 14;
  const rows = [
    ['Haemoglobin', visit.hb, 'g/dL', '11.0-15.0'],
    ['Haematocrit', hematocrit, '%', '33-45'],
    ['Mean corpuscular volume', mcv, 'fL', '80-100'],
    ['Red blood cell count', (hematocrit * 10 / mcv).toFixed(2), '10^6/uL', '3.80-5.20'],
    ['Platelet count', 224 + (patient.index * 17 + index * 23) % 95, '10^3/uL', '150-450'],
    ['White blood cell count', (6.7 + (patient.index * 3 + index * 2) % 39 / 10).toFixed(1), '10^3/uL', '4.0-11.0'],
  ];
  if (!index) rows.push(['ABO blood group', patient.blood.slice(0, -1), 'qualitative', null],
    ['Rh factor', patient.blood.endsWith('+') ? 'Positive' : 'Negative', 'qualitative', null]);
  if (last) rows.push(...(patient.labs || []));
  return rows.map(([label, value, unit, reference_range]) => ({
    label, value: String(value), unit, measured_on: visit.date, ...(reference_range && { reference_range }),
  }));
}

async function seedReport(db, uploadDir, patient, visit, index, last, doctor, appointmentId) {
  const observations = labsFor(patient, visit, index, last);
  const title = 'Synthetic antenatal laboratory panel';
  const lines = [title, patient.code + ' | ' + patient.name, doctor.facility.name, 'Collected and reported: ' + visit.date,
    'Fictional results. Reference intervals are illustrative source metadata.', '',
    ...observations.map(o => [o.label, o.value, o.unit, o.reference_range ? 'Reference: ' + o.reference_range : ''].filter(Boolean).join(' | '))];
  const bytes = pdf(lines);
  const filename = patient.code + '-visit-' + (index + 1) + '.pdf';
  const storageKey = version + '-' + sha(bytes).slice(0, 16) + '-' + filename;
  const localFile = path.join(uploadDir, storageKey);
  try {
    fs.writeFileSync(localFile, bytes, { mode:0o600, flag:'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST' || !fs.readFileSync(localFile).equals(bytes)) throw error;
  }
  const report = (await db.query(`INSERT INTO patient_documents
    (mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key,notes,report_date,facility_name,report_category,verification_status,reviewed_by,uploaded_at,appointment_id,uploaded_by,uploaded_by_role,reviewed_at,doctor_note)
    VALUES($1,$2,'lab_report',$3,'application/pdf',$4,$5,$6,$7,$8,'blood','verified',$9,$10,$11,$9,'doctor',$10,$6) RETURNING id`,
    [patient.id,title,filename,bytes.length,storageKey,label,visit.date,doctor.facility.name,doctor.id,time(visit.date),appointmentId])).rows[0];
  const draft = randomUUID();
  await db.query(`INSERT INTO document_intake_drafts(id,document_id,created_by,source_sha256,source_text,candidates,warnings,status,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,'[]','verified',$7)`,[draft,report.id,doctor.id,sha(bytes),lines.join('\n'),
    json({report_date:visit.date,document_type:'lab_report',observations}),time(visit.date)]);
  const verified = randomUUID();
  await db.query(`INSERT INTO verified_report_records(id,draft_id,document_id,mother_id,report_date,document_type,observations,verified_by,review_note,created_at)
    VALUES($1,$2,$3,$4,$5,'lab_report',$6,$7,$8,$9)`,[verified,draft,report.id,patient.id,visit.date,json(observations),doctor.id,
    label + '. Reference intervals, where listed, come from the fictional report.',time(visit.date)]);
  await db.query('INSERT INTO patient_document_shares(document_id,doctor_id,shared_by,shared_at) VALUES($1,$2,$3,$4)',
    [report.id,doctor.id,patient.id,time(visit.date)]);
  await db.query(`INSERT INTO patient_document_events(document_id,actor_id,event_type,detail)
    VALUES($1,$2,'verify',$3)`,[report.id,doctor.id,json({seed:version,synthetic:true,record:verified})]);
  return { document_id:report.id, verified_id:verified, observations };
}

async function milestone(db, id, date, week, title, completed) {
  const stage = week < 13 ? 'Trimester 1' : week < 28 ? 'Trimester 2' : 'Trimester 3';
  return (await db.query(`INSERT INTO care_milestones
    (mother_id,stage,category,title,due_date,sort_order,completed_at)
    VALUES($1,$2,'pregnancy',$3,$4,$5,$6) RETURNING id`,[id,stage,title,date,week,completed ? time(date) : null])).rows[0].id;
}

async function appointment(db, patient, doctor, date, status, reason, milestoneId, slotHour) {
  const appt = (await db.query(`INSERT INTO appointments
    (mother_id,doctor_id,requested_date,requested_time,status,reason,visit_type,facility_uuid,unit_uuid,unit_label,milestone_id,room)
    VALUES($1,$2,$3,$4,$5,$6,'ANC',$7,$8,$9,$10,$11) RETURNING id`,
    [patient.id,doctor.id,date,slotHour + ':00',status,reason,doctor.facility.facility_id,doctor.facility.unit_id,doctor.facility.unit_label,milestoneId,doctor.facility.room])).rows[0];
  const state = status === 'completed' ? 'done' : status === 'cancelled' ? 'no_show' : 'booked';
  await db.query('INSERT INTO doctor_queue_state(appointment_id,doctor_id,state,completed_at) VALUES($1,$2,$3,$4)',
    [appt.id,doctor.id,state,state === 'booked' ? null : time(date)]);
  return appt.id;
}

async function seedPatient(db, uploadDir, patient, doctor, today) {
  const visitDates = patient.visits.map(v => isoDay(patient.lmp, v[0] * 7 + 2));
  const nextDate = isoDay(today, patient.follow || 7 + patient.index % 4);
  const missedDate = patient.missed ? isoDay(patient.lmp, 28 * 7 + 2) : null;
  const pendingDate = patient.pending ? isoDay(today, 3) : null;
  const slot = 9 + patient.index % 3;
  const linkedVisits = [];
  for (const [index, fields] of patient.visits.entries()) {
    const [week,bp_systolic,bp_diastolic,weight_kg,hb,fundal_height_cm,fetal_heart_rate,note] = fields;
    const date = visitDates[index];
    const last = index === patient.visits.length - 1;
    const title = index ? 'Antenatal follow-up' : 'First antenatal visit';
    const step = await milestone(db,patient.id,date,week,title,true);
    const id = await appointment(db,patient,doctor,date,'completed',label + ' · ' + title,step,slot);
    const values = { bp_systolic,bp_diastolic,weight_kg,hb,
      pulse:72 + (patient.index * 5 + index * 3) % 18,
      temperature_c:Number((36.4 + (patient.index + index * 2) % 8 / 10).toFixed(1)),
      spo2_percent:98 + (patient.index + index) % 3,
      ...(fundal_height_cm != null && {fundal_height_cm}),
      ...(last && patient.labs?.find(lab => lab[0] === 'OGTT fasting') &&
        { glucose_mg_dl:patient.labs.find(lab => lab[0] === 'OGTT fasting')[1] }),
    };
    await db.query(`INSERT INTO clinical_dashboard_entries
      (mother_id,doctor_id,appointment_id,recorded_on,source_kind,values_json,created_at)
      VALUES($1,$2,$3,$4,'clinic_visit',$5,$6),($1,$2,$3,$4,'clinic_scan',$7,$6)`,
      [patient.id,doctor.id,id,date,json(values),time(date),json({fetal_heart_rate})]);
    const followUp = last ? missedDate || nextDate : visitDates[index + 1];
    const tests = last && pendingDate ? [{name:'Gestational diabetes screening (OGTT)',due_date:pendingDate,note:'Awaiting results'}] : [];
    await db.query(`INSERT INTO visit_summaries
      (appointment_id,mother_id,doctor_id,version,status,summary_text,follow_up,pending_tests,approved_at,approved_by,created_at,updated_at)
      VALUES($1,$2,$3,1,'approved',$4,$5,$6,$7,$3,$7,$7)`,
      [id,patient.id,doctor.id,label + '. ' + note,json({text:'Next antenatal appointment',due_date:followUp}),json(tests),time(date)]);
    const report = await seedReport(db,uploadDir,patient,{...values,date},index,last,doctor,id);
    linkedVisits.push({ id, date, week, note, values:{...values,fetal_heart_rate}, report });
  }
  if (missedDate) {
    const step = await milestone(db,patient.id,missedDate,28,'Missed antenatal follow-up',false);
    await appointment(db,patient,doctor,missedDate,'cancelled','Synthetic ANC follow-up · did not attend',step,slot);
  }
  const upcomingWeek = Math.floor((Date.parse(nextDate) - Date.parse(patient.lmp)) / 604800000);
  const next = await milestone(db,patient.id,nextDate,upcomingWeek,'Next antenatal follow-up',false);
  await appointment(db,patient,doctor,nextDate,'confirmed','Synthetic ANC follow-up',next,slot);
  if (pendingDate) await milestone(db,patient.id,pendingDate,patient.week,'Gestational diabetes screening (OGTT)',false);
  const scanVisit = patient.scan === 'pending' ? linkedVisits[2] : linkedVisits[1];
  await milestone(db,patient.id,scanVisit.date,scanVisit.week,
    patient.scan === 'pending' ? 'Ultrasound review pending' : 'Ultrasound review released',patient.scan !== 'pending');
  for (const [index, v] of linkedVisits.filter(v => v.week >= 24).entries()) {
    const recordedDate = isoDay(v.date,1);
    const data = json({kicks:8 + (patient.index + index) % 6,duration_sec:780 + patient.index * 41 + index * 23});
    const loggedAt = recordedDate + 'T18:00:00+05:30';
    await db.query(`INSERT INTO patient_daily_entries(mother_id,mutation_id,log_date,kind,data,logged_at)
      VALUES($1,$2,$3,'kick_session',$4,$5)`,[patient.id,randomUUID(),recordedDate,data,loggedAt]);
    await db.query(`INSERT INTO health_logs(mother_id,log_type,data,logged_at)
      VALUES($1,'kick_session',$2,$3)`,[patient.id,data,loggedAt]);
  }
  return { ...patient, visits:linkedVisits, pendingDate, missedDate, nextDate };
}

async function seedWorkspace(db, source) {
  if (process.env.DAI_SEED_WORKSPACE_FOUNDATION !== 'true') return null;
  if (process.env.DAI_LOCAL !== 'true' || process.env.DAI_DEMO !== 'true' ||
      process.env.DAI_HOSTED_DEMO === 'true' || process.env.DAI_CONTAINER_DEMO === 'true') {
    throw Error('Workspace fixtures require the local synthetic launcher.');
  }
  const manifest = path.join(root,'.local/workspace-foundation.json');
  const previous = (await db.query('SELECT counts FROM dai_local_seed WHERE version=$1',[version])).rows[0];
  if (previous) {
    writeManifest(manifest, previous.counts);
    return previous.counts;
  }
  const units = source.prepare(`SELECT f.id AS facility_id,f.name,u.id AS unit_id,u.code AS unit_label,u.department_id,u.room
    FROM facility f JOIN unit u ON u.facility_id=f.id
    WHERE f.source_id LIKE 'HOSP-SYN-%' AND EXISTS (
      SELECT 1 FROM portal_user p WHERE p.unit_id=u.id AND p.role='consultant' AND p.verified=1)
    ORDER BY f.source_id,u.source_id`).all();
  const hospitals = [...new Set(units.map(unit=>unit.facility_id))]
    .map(id=>units.filter(unit=>unit.facility_id===id)).filter(rows=>rows.length>=2).slice(0,2);
  if (hospitals.length !== 2) throw Error('Workspace fixtures need two seeded maternity facilities with two verified consultant units each.');
  const uploadDir = process.env.PATIENT_DOCS_DIR || path.join(root,'backend/data/patient-documents');
  fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  const hash = await bcrypt.hash(process.env.DAI_DEMO_PASSWORD,10);
  const data = { version, today, doctors:[], patients:[] };
  await db.query('BEGIN');
  try {
    const account = async (sourceCode, role) => (await db.query(
      'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[sourceCode+domain,hash,role])).rows[0].id;
    for (const [index,[name,qualification,specialty,hospital,availability]] of doctors.entries()) {
      const sourceCode = code('doctor',index);
      const id = await account(sourceCode,'doctor');
      const facility = hospitals[hospital][Math.floor(index / 2)];
      const syntheticName = 'SYNTHETIC · Dr ' + name;
      const license = 'DEMO-DW-' + (index + 1);
      await db.query(`INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name,credential_verified,qualification)
        VALUES($1,$2,$3,$4,$5,TRUE,$6)`,[id,syntheticName,specialty,license,facility.name,qualification]);
      await db.query('INSERT INTO instant_doctor_availability(doctor_id,status) VALUES($1,$2)',[id,availability]);
      const portalId = randomUUID().replaceAll('-','');
      await db.query('INSERT INTO dai_local_source_link VALUES($1,$2,$3,$4)',['doctor',sourceCode,portalId,id]);
      data.doctors.push({id,code:sourceCode,portalId,name:syntheticName,qualification,specialty,facility,license,availability});
    }
    for (const [index, sample] of scenarios.entries()) {
      const sourceCode = code('mother',index);
      const id = await account(sourceCode,'mother');
      const portalId = randomUUID().replaceAll('-','');
      const name = 'SYNTHETIC · ' + sample.name;
      const lmp = isoDay(today,-sample.week * 7 - 4);
      const edd = isoDay(lmp,280);
      const birth = (Number(today.slice(0,4)) - sample.age) + today.slice(4,7) + '-01';
      await db.query(`INSERT INTO mother_profiles(user_id,full_name,date_of_birth,care_start_date,lmp_date,edd_date,pregnancy_status,
        gravida,parity,medical_conditions,previous_complications,allergies,current_medications,height_cm,pre_pregnancy_weight_kg,blood_group,risk_factors)
        VALUES($1,$2,$3,$4::date,$4::date,$5,'pregnant',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id,name,birth,lmp,edd,sample.gravida || 1,sample.parity ?? 0,sample.history || 'No medical conditions reported',
          sample.obstetric || (sample.parity ? 'No previous complication reported' : 'First pregnancy'),sample.allergy || 'No known allergies reported',
          sample.medication || 'Prenatal supplements documented',sample.height,sample.preWeight || sample.visits[0][3] - 0.8,sample.blood,json(sample.risks || [])]);
      const doctor = data.doctors[sample.doctor];
      await db.query('INSERT INTO dai_local_source_link VALUES($1,$2,$3,$4)',['mother',sourceCode,portalId,id]);
      await db.query(`INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at,include_history)
        VALUES($1,$2,NOW()+INTERVAL '30 days',TRUE)`,[id,doctor.id]);
      if (sample.week>=24) await db.query(`INSERT INTO patient_daily_consent(mother_id,doctor_id,expires_at)
        VALUES($1,$2,NOW()+INTERVAL '30 days')`,[id,doctor.id]);
      data.patients.push(await seedPatient(db,uploadDir,{...sample,index,id,code:sourceCode,portalId,name,lmp,edd,prepregnancy_weight_kg:sample.preWeight || sample.visits[0][3] - 0.8},doctor,today));
    }
    await db.query('INSERT INTO dai_local_seed(version,source_sha256,counts) VALUES($1,$2,$3)',
      [version,sha(json({doctors,scenarios})),json(data)]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  writeManifest(manifest,data);
  console.log('Workspace foundation: seeded 12 synthetic patients and 4 doctors.');
  return data;
}

function writeManifest(filename, data) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary,json(data),{mode:0o600,flag:'wx'});
  fs.renameSync(temporary,filename);
}

module.exports = { seedWorkspace };
