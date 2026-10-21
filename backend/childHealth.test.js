'use strict';

// Route-level tests for the child-health features. They need a PostgreSQL database with every
// migration in backend/db applied (see README), so they are skipped unless one is provided:
//
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/dai npm test
//
// The test creates its own users and removes them (and everything hanging off them) at the end.
const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const URL = process.env.TEST_DATABASE_URL;
const Ref = require('../shared/child-reference.js');

test('child health routes', { skip: URL ? false : 'set TEST_DATABASE_URL to run' }, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: URL });
  const tag = `t${Date.now()}`;
  const userIds = [];
  const mkUser = async (role, name) => {
    const u = await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', $2) RETURNING id", [`${tag}-${name}@test.local`, role]);
    userIds.push(u.rows[0].id);
    if (role === 'mother') await pool.query('INSERT INTO mother_profiles (user_id, full_name) VALUES ($1, $2)', [u.rows[0].id, name]);
    else await pool.query("INSERT INTO doctor_profiles (user_id, full_name, specialization, medical_license_number) VALUES ($1, $2, 'Paediatrics', $3)", [u.rows[0].id, name, tag + name]);
    return u.rows[0].id;
  };
  const motherA = await mkUser('mother', 'MotherA');
  const motherB = await mkUser('mother', 'MotherB');
  const doctor = await mkUser('doctor', 'DrRao');
  const otherDoctor = await mkUser('doctor', 'DrNoRelation');

  const app = express();
  app.use(express.json());
  const authenticateToken = (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'Authentication required' });
    const [id, role] = h.split(':');
    req.user = { id: Number(id), role };
    next();
  };
  const authorizeRole = (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }));
  require('./childDashboard')(app, { pool, authenticateToken, authorizeRole });
  require('./notifications')(app, { pool, authenticateToken });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(async () => {
    server.close();
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
    await pool.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (as, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-test-user': as }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const A = `${motherA}:mother`, B = `${motherB}:mother`, DR = `${doctor}:doctor`, DR2 = `${otherDoctor}:doctor`;
  const today = (await pool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")).rows[0].d;
  const daysAgo = (n) => Ref.addDaysISO(today, -n);

  // A boy born 32 days ago: OPV-1 / Pentavalent-1 etc. fall due in 10 days (day 42) => "coming up" reminder window.
  const created = await call(A, 'POST', '/api/children', { name: 'Arjun', date_of_birth: daysAgo(32), sex: 'male', born_at_weeks: 39, birth_weight_kg: 3.2 });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.child.health_events, []);
  const cid = created.body.child.id;

  await t.test('medical history: validation, CRUD and ownership', async () => {
    const bad = (body) => call(A, 'POST', `/api/children/${cid}/health-events`, body);
    assert.equal((await bad({ event_type: 'flu', title: 'x', event_date: today })).status, 400, 'unknown type');
    assert.equal((await bad({ event_type: 'illness', title: '  ', event_date: today })).status, 400, 'blank title');
    assert.equal((await bad({ event_type: 'illness', title: 'Cold', event_date: '2026-13-40' })).status, 400, 'impossible date');
    assert.equal((await bad({ event_type: 'illness', title: 'Cold', event_date: daysAgo(40) })).status, 400, 'before birth');
    assert.equal((await bad({ event_type: 'illness', title: 'Cold', event_date: Ref.addDaysISO(today, 5) })).status, 400, 'future');

    const ok = await bad({ event_type: 'illness', title: 'Cold and cough', details: 'Steam, fluids', event_date: daysAgo(3), doctor_name: 'Dr Rao', facility: 'City Clinic' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.health_event.title, 'Cold and cough');
    assert.equal(ok.body.health_event.event_date, daysAgo(3));
    const eid = ok.body.health_event.id;

    const list = await call(A, 'GET', `/api/children/${cid}/health-events`);
    assert.equal(list.body.health_events.length, 1);
    const inChildren = (await call(A, 'GET', '/api/children')).body.children.find((c) => c.id === cid);
    assert.equal(inChildren.health_events.length, 1);

    assert.equal((await call(B, 'GET', `/api/children/${cid}/health-events`)).status, 404, 'another mother cannot read');
    assert.equal((await call(B, 'POST', `/api/children/${cid}/health-events`, { event_type: 'note', title: 'hi', event_date: today })).status, 404);
    assert.equal((await call(B, 'PATCH', `/api/children/${cid}/health-events/${eid}`, { title: 'hijack' })).status, 404);
    assert.equal((await call(B, 'DELETE', `/api/children/${cid}/health-events/${eid}`)).status, 404);
    assert.equal((await call(DR, 'GET', `/api/children/${cid}/health-events`)).status, 403, 'mother-only route');

    const patched = await call(A, 'PATCH', `/api/children/${cid}/health-events/${eid}`, { title: 'Cold, cough, mild fever', details: '' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.health_event.title, 'Cold, cough, mild fever');
    assert.equal(patched.body.health_event.details, null);
    assert.equal((await call(A, 'PATCH', `/api/children/${cid}/health-events/${eid}`, {})).status, 400);

    // A date of birth can't move past an existing history entry
    const dob = await call(A, 'PATCH', `/api/children/${cid}`, { date_of_birth: daysAgo(1) });
    assert.equal(dob.status, 409);

    assert.equal((await call(A, 'DELETE', `/api/children/${cid}/health-events/${eid}`)).status, 200);
    assert.equal((await call(A, 'DELETE', `/api/children/${cid}/health-events/${eid}`)).status, 404);
  });

  await t.test('paediatric appointments are tied to the child and the mother', async () => {
    const path = `/api/children/${cid}/appointments`;
    assert.equal((await call(A, 'POST', path, { requested_date: today })).status, 400, 'doctor required');
    assert.equal((await call(A, 'POST', path, { doctor_id: doctor })).status, 400, 'date required');
    assert.equal((await call(A, 'POST', path, { doctor_id: motherB, requested_date: today })).status, 400, 'must be a doctor');
    assert.equal((await call(A, 'POST', path, { doctor_id: doctor, requested_date: daysAgo(10) })).status, 400, 'not in the past');
    assert.equal((await call(B, 'POST', path, { doctor_id: doctor, requested_date: today })).status, 404, 'other mother');

    const made = await call(A, 'POST', path, { doctor_id: doctor, requested_date: Ref.addDaysISO(today, 6), reason: '6-week check-up and vaccines' });
    assert.equal(made.status, 201);
    const apptId = made.body.appointment_id;

    const list = await call(A, 'GET', path);
    assert.equal(list.body.appointments.length, 1);
    const a = list.body.appointments[0];
    assert.equal(a.status, 'pending');
    assert.equal(a.doctor_name, 'DrRao');
    assert.equal(a.requested_date, Ref.addDaysISO(today, 6));
    assert.equal((await call(B, 'GET', path)).status, 404);

    // it is a normal appointment row too, so the doctor's existing flows see it
    const row = (await pool.query('SELECT mother_id, doctor_id, child_id FROM appointments WHERE id = $1', [apptId])).rows[0];
    assert.deepEqual(row, { mother_id: motherA, doctor_id: doctor, child_id: cid });

    assert.equal((await call(B, 'PATCH', `${path}/${apptId}/cancel`)).status, 404, 'other mother cannot cancel');
    assert.equal((await call(A, 'PATCH', `${path}/${apptId}/cancel`)).status, 200);
    assert.equal((await call(A, 'PATCH', `${path}/${apptId}/cancel`)).status, 404, 'already cancelled');
    assert.equal((await call(A, 'GET', path)).body.appointments[0].status, 'cancelled');

    await call(A, 'POST', path, { doctor_id: doctor, requested_date: today, reason: 'Review' });   // leaves one live appointment for later steps
  });

  await t.test('milestones accept the new 30–60 month checkpoints', async () => {
    assert.equal((await call(A, 'PUT', `/api/children/${cid}/milestones/m60_hop`, { achieved_on: today })).status, 200);
    assert.equal((await call(A, 'PUT', `/api/children/${cid}/milestones/m99_nope`, { achieved_on: today })).status, 400);
    const got = (await call(A, 'GET', '/api/children')).body.children.find((c) => c.id === cid);
    assert.deepEqual(got.milestones.map((m) => m.milestone_code), ['m60_hop']);
  });

  await t.test('notifications: vaccine lead-time reminder and WHO growth flags for weight, length and head', async () => {
    // 32 days old boy: head 33 cm is well under -3 SD (median ~37), length 54 cm and weight 4.4 kg are normal
    const g = await call(A, 'POST', `/api/children/${cid}/growth`, { measured_on: today, weight_kg: 4.4, height_cm: 54, head_cm: 33 });
    assert.equal(g.status, 201);
    const n = await call(A, 'GET', '/api/notifications');
    assert.equal(n.status, 200);
    const keys = n.body.notifications.filter((x) => x.child_id === cid).map((x) => x.title);

    assert.ok(keys.some((k) => /OPV-1 is coming up for Arjun/.test(k)), 'coming-up reminder: ' + JSON.stringify(keys));
    assert.ok(keys.some((k) => /Pentavalent-1 is coming up for Arjun/.test(k)));
    assert.ok(!keys.some((k) => /PCV-1/.test(k)), 'state-dependent vaccine is never a reminder');
    assert.ok(keys.some((k) => /head size is well below the WHO reference/.test(k)), 'head flag');
    assert.ok(!keys.some((k) => /weight is/.test(k)), 'normal weight is not flagged');
    assert.ok(!keys.some((k) => /length\/height is/.test(k)), 'normal length is not flagged');
    // the appointment booked for tomorrow-ish is in the 3-day window only if within 3 days; today's is
    assert.ok(n.body.notifications.some((x) => x.category === 'appointment'), 'appointment reminder');

    // Marking the doses given clears the reminder
    for (const code of ['opv1', 'penta1', 'rota1', 'fipv1']) {
      assert.equal((await call(A, 'PUT', `/api/children/${cid}/vaccinations/${code}`, { given_on: today })).status, 200);
    }
    const after = (await call(A, 'GET', '/api/notifications')).body.notifications.filter((x) => x.child_id === cid).map((x) => x.title);
    assert.ok(!after.some((k) => /OPV-1|Pentavalent-1/.test(k)), 'reminders clear once given: ' + JSON.stringify(after));
  });

  await t.test('doctor summary includes medical history, only for doctors with an appointment', async () => {
    await call(A, 'POST', `/api/children/${cid}/health-events`, { event_type: 'allergy', title: 'Rash after new formula', event_date: daysAgo(2) });
    const res = await call(DR, 'GET', `/api/doctor/patients/${motherA}/children`);
    assert.equal(res.status, 200);
    const k = res.body.children.find((c) => c.id === cid);
    assert.equal(k.history.length, 1);
    assert.equal(k.history[0].title, 'Rash after new formula');
    assert.equal(k.milestones.achieved, 1);
    assert.equal((await call(DR2, 'GET', `/api/doctor/patients/${motherA}/children`)).status, 403);
    assert.equal((await call(A, 'GET', `/api/doctor/patients/${motherA}/children`)).status, 403);
  });

  await t.test('removing the child removes its history but keeps the mother\'s appointment', async () => {
    assert.equal((await call(A, 'DELETE', `/api/children/${cid}`)).status, 200);
    assert.equal((await pool.query('SELECT 1 FROM child_health_events WHERE child_id = $1', [cid])).rowCount, 0);
    const appts = await pool.query('SELECT child_id FROM appointments WHERE mother_id = $1', [motherA]);
    assert.ok(appts.rowCount >= 1);
    appts.rows.forEach((r) => assert.equal(r.child_id, null));
  });
});
