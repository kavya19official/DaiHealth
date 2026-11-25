'use strict';

// Runs against the launcher and exercises the real authentication, ACLs and read paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const base = process.env.DAI_TEST_URL || 'http://localhost:3001';
const password = process.env.DAI_TEST_DEMO_PASSWORD || 'Dai-Synthetic-2026!';
const root = path.join(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'.local/workspace-foundation.json'),'utf8'));
const same = assert.deepEqual;
const marked = x => JSON.stringify(x).includes('Synthetic workspace demonstration');
const domain = '@dai-synthetic.invalid';

async function request(url, { cookie, token, method='GET', body, expected=200, binary=false }={}) {
  const response = await fetch(base + url, {
    method, headers:{ Origin:base, ...(cookie&&{Cookie:cookie}), ...(token&&{Authorization:'Bearer '+token}), ...(body&&{'Content-Type':'application/json'}) },
    ...(body&&{body:JSON.stringify(body)}), signal:AbortSignal.timeout(35000),
  });
  if (response.status!==expected) throw Error(method + ' ' + url + ' returned ' + response.status + ': ' + await response.text());
  if (binary) return { headers:response.headers, bytes:Buffer.from(await response.arrayBuffer()) };
  return { data:await response.json(), cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ') };
}

async function login(code, role, secret=password) {
  const result = await request('/api/auth/login',{method:'POST',body:{email:code+domain,password:secret},expected:secret===password?200:401});
  if (secret!==password) return;
  assert.equal(result.data.user.role,role);
  assert.ok(result.cookie);
  return { user:result.data.user, get:(url,expected)=>request(url,{cookie:result.cookie,expected}).then(r=>r.data),
    open:(url,expected)=>request(url,{cookie:result.cookie,binary:true,expected}),
    post:(url,body,expected)=>request(url,{cookie:result.cookie,method:'POST',body,expected}).then(r=>r.data) };
}

function fromMonitorDB() {
  const db = new DatabaseSync(path.join(root,'.local/portal.db'),{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mother WHERE source_id LIKE 'foundation-mother-%'").get().n,12);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM portal_user WHERE source_id LIKE 'foundation-doctor-%'").get().n,4);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM anc_visit WHERE source_id LIKE 'foundation-mother-%'").get().n,36);
    for (const p of manifest.patients) {
      const visits = db.prepare('SELECT visit_date,details FROM anc_visit WHERE mother_id=? ORDER BY visit_date').all(p.portalId);
      same(visits.map(v=>[v.visit_date,JSON.parse(v.details).bp_systolic]),p.visits.map(v=>[v.date,v.values.bp_systolic]));
      const scans = db.prepare('SELECT patient_account_id,doctor_account_id,image_ciphertext FROM ultrasound_workspace_scan WHERE source_id=?').all(p.code+'-scan');
      assert.equal(scans.length,1);
      assert.equal(scans[0].patient_account_id,p.id);
      assert.equal(scans[0].doctor_account_id,manifest.doctors[p.doctor].id);
      assert.ok(!Buffer.from(scans[0].image_ciphertext).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
      const reports = db.prepare(`SELECT r."values" AS result FROM investigation_result r JOIN investigation_order o ON o.id=r.order_id
        WHERE o.mother_id=? AND o.status='completed'`).all(p.portalId).map(r=>JSON.parse(r.result));
      const byId = new Map(reports.map(x=>[x.workspace_document_id+':'+x.result_value+':'+x.unit,x]));
      for (const visit of p.visits) for (const lab of visit.report.observations) {
        const result = byId.get(visit.report.document_id+':'+lab.value+':'+lab.unit);
        assert.equal(result.measured_on,visit.date);
        assert.equal(result.workspace_verified_report_id,visit.report.verified_id);
      }
    }
  } finally { db.close(); }
}


async function verifyMonitoring() {
  const origin = '/hospital-admin/api';
  const sessions = [];
  for (const doctor of manifest.doctors) {
    const login = await request(origin+'/auth/login',{method:'POST',body:{email:doctor.code+domain,password}});
    const otp = await request(origin+'/auth/otp',{method:'POST',body:{challenge_id:login.data.challenge_id,code:login.data.demo_otp}});
    assert.ok(otp.data.access_token);
    sessions.push(otp.data.access_token);
  }
  const asUUID = raw => raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  // Wait for the existing asynchronous monitoring job to reach the latest case.
  const db = new DatabaseSync(path.join(root,'.local/portal.db'),{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const scanCount = db.prepare(`SELECT COUNT(*) n FROM clinical_monitor_run r
      JOIN mother m ON m.id=r.mother_id WHERE m.source_id LIKE 'foundation-mother-%'`);
    const expires = Date.now()+105000;
    while (scanCount.get().n!==12 && Date.now()<expires) await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(scanCount.get().n,12,'Existing monitoring worker produced a snapshot for each synthetic case');
  } finally { db.close(); }
  for (const p of manifest.patients) {
    const endpoint = origin+'/clinical-monitor/patients/'+asUUID(p.portalId);
    const { data } = await request(endpoint,{token:sessions[p.doctor]});
    assert.equal(data.snapshot.as_of,manifest.today);
    assert.equal(data.snapshot.coverage.anc_visits,3);
    assert.equal(data.snapshot.coverage.synthetic,true);
    await request(endpoint,{token:sessions[(p.doctor+2)%sessions.length],expected:404});
  }
}

async function main() {
  assert.equal(manifest.patients.length,12);
  assert.equal(manifest.doctors.length,4);
  await login(manifest.doctors[0].code,'doctor','wrong-password-for-smoke-test');
  const doctors = [];
  for (const d of manifest.doctors) {
    const doctor = await login(d.code,'doctor');
    const workspace = await doctor.get('/api/doctor/workspace');
    same(workspace.patients.map(p=>p.id).sort(),manifest.patients.filter(p=>manifest.doctors[p.doctor].id===d.id).map(p=>p.id).sort());
    assert.equal(workspace.doctor.qualification,d.qualification);
    doctors.push(doctor);
  }
  const ownedScans = [];
  for (const [index,p] of manifest.patients.entries()) {
    const mother = await login(p.code,'mother');
    const doctor = doctors[p.doctor];
    const unrelated = doctors[(p.doctor+1)%doctors.length];
    const expectedVisits = p.visits.slice().reverse();
    const clinicalPath = '/api/doctor/patients/'+p.id;
    const [record, patientDashboard, doctorDashboard, timeline, notes, scanList] = await Promise.all([
      mother.get('/api/patient/records'),mother.get('/api/patient/dashboard'),doctor.get(clinicalPath+'/dashboard'),
      mother.get('/api/timeline/enhanced'),mother.get('/api/patient/visit-summaries'),mother.get('/api/patient/ultrasound'),
    ]);
    same(record.clinical.visits,doctorDashboard.history.visits);
    same(patientDashboard.history.visits,record.clinical.visits);
    same(record.clinical.visits.map(v=>[v.appointment_id,v.visit_date,v.bp_systolic,v.temperature_c,v.spo2_percent,v.fetal_heart_rate]),
      expectedVisits.map(v=>[v.id,v.date,v.values.bp_systolic,v.values.temperature_c,v.values.spo2_percent,v.values.fetal_heart_rate]));
    assert.ok(record.clinical.visits.every(v=>v.bmi>0&&marked(v.summary_text)));
    assert.equal(patientDashboard.pregnancy.edd,p.edd);
    assert.equal(notes.summaries.length,3);
    assert.equal(notes.next_appointment.date,p.nextDate);
    assert.ok(timeline.milestones.some(m=>String(m.due_date).slice(0,10)===p.nextDate&&!m.completed_at));
    assert.equal(notes.summaries[0].pending_tests.length,p.pendingDate?1:0);
    if (p.missedDate) assert.ok(timeline.milestones.some(m=>m.title==='Missed antenatal follow-up'&&!m.completed_at));
    const labId = expectedVisits[0].report.document_id;
    const labPath = '/api/documents/'+labId;
    const verify = '/verified-records';
    const scan = scanList.items[0];
    assert.equal(scanList.items.length,1);
    assert.equal(scan.status,p.scan==='pending'?'pending':'reviewed');
    assert.ok(scan.demo_image&&scan.image_available&&!scan.assessment.model_ran);
    const [ownLab,sharedLab,doctorScans,original,image,summary] = await Promise.all([
      mother.get(labPath+verify),doctor.get(labPath+verify),doctor.get(clinicalPath+'/ultrasound'),
      mother.open(labPath+'/download'),mother.open('/api/patient/ultrasound/'+scan.id+'/image'),
      doctor.get('/api/doctor/visit-summaries/'+expectedVisits[0].id),
      unrelated.get(clinicalPath+'/dashboard',403),unrelated.get(labPath+verify,404),unrelated.get(clinicalPath+'/ultrasound',403),
    ]);
    same(sharedLab.records[0].observations,expectedVisits[0].report.observations);
    same(ownLab.records,sharedLab.records);
    assert.equal(doctorScans.items[0].id,scan.id);
    assert.equal(summary.approved.summary_text,notes.summaries[0].summary_text);
    assert.equal(original.bytes.subarray(0,5).toString(),'%PDF-');
    assert.match(image.headers.get('Content-Type'),/^image\/png/);
    assert.ok(image.bytes.length>1000);
    ownedScans.push({id:scan.id,mother,labPath});
    if (!index) {
      const entry = { recorded_on:expectedVisits[0].date,appointment_id:expectedVisits[0].id,source_kind:'clinic_visit',values:{spo2_percent:101} };
      await doctor.post(clinicalPath+'/dashboard/entries',entry,400);
      await doctor.post(clinicalPath+'/dashboard/entries',{...entry,appointment_id:2147483647,values:{spo2_percent:98}},400);
      const nearby = await mother.get('/api/patient/booking-options');
      assert.equal(nearby.assigned_doctor_id,doctor.user.id);
      const overview = await mother.get('/api/patient/overview');
      assert.equal(overview.metrics.find(m=>m.type==='blood_pressure').readings[0].value,expectedVisits[0].values.bp_systolic);
    }
  }
  await ownedScans[0].mother.get('/api/patient/ultrasound/'+ownedScans[1].id,404);
  await ownedScans[0].mother.get(ownedScans[1].labPath+'/verified-records',404);
  await ownedScans[0].mother.get('/api/doctor/workspace',403);
  fromMonitorDB();
  await verifyMonitoring();
  console.log('Verified 12 patient logins, 4 clinician logins, 36 linked ANC visits, consultation notes, lab sources, encrypted scan images, monitoring runs and access isolation.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
