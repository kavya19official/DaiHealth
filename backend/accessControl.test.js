'use strict';
// K + L integration tests in the repo's PGlite convention. They need `npm install` (PGlite) and are not
// part of the database-free checks in accessControl.sql.test.js / followThrough.test.js.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), express = require('express');
const { createLocalPool } = require('./localPool'), { migrations } = require('../scripts/seed-local.cjs');
const registerAccess = require('./accessControl'), registerFollow = require('./followThrough');

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-kl-')), pool = createLocalPool(path.join(dir, 'db'));
  for (const file of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', file), 'utf8'));
  for (const [email, role] of [['m@synthetic.invalid', 'mother'], ['other@synthetic.invalid', 'mother'], ['d1@synthetic.invalid', 'doctor'], ['d2@synthetic.invalid', 'doctor']])
    await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2)", [email, role]);
  await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES(1,'SYNTHETIC Mother'),(2,'SYNTHETIC Other')");
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES(3,'SYNTHETIC One','Obstetrician','X1','Facility A'),(4,'SYNTHETIC Two','Obstetrician','X2','Facility B')");
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES(1,3,'2030-01-01','confirmed','fac-a'),(1,4,'2030-01-02','confirmed','fac-b')");
  const app = express(); app.use(express.json());
  const authenticateToken = (req, res, next) => { const id = Number(req.headers['x-user']); if (![1, 2, 3, 4].includes(id)) return res.sendStatus(401); req.user = { id, role: id >= 3 ? 'doctor' : 'mother' }; next(); };
  const authorizeRole = (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  registerAccess(app, { pool, authenticateToken, authorizeRole }); registerFollow(app, { pool, authenticateToken, authorizeRole });
  app.get('/api/doctor/patients/:motherId/probe', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    const id = await registerAccess.gateDoctor(pool, req, res, 'probe'); if (id == null) return; res.json({ ok: true });
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, user, method = 'GET', body) => { const r = await fetch(base + url, { method, headers: { 'x-user': String(user), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
  return { pool, call, close: async () => { server.close(); await pool.end(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('K: revoking a doctor or facility is enforced by backend authorisation, and views are logged', async () => {
  const t = await setup();
  try {
    const { call } = t;
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 200);
    assert.equal((await call('/api/doctor/patients/2/probe', 3)).status, 403);
    const list = await call('/api/patient/access', 1);
    assert.equal(list.data.doctors.length, 2); assert.equal(list.data.facilities.length, 2);
    assert.equal((await call('/api/patient/access/doctor/4', 2, 'PUT', { state: 'revoked' })).status, 404);   // not her care team
    assert.equal((await call('/api/patient/access/doctor/3', 1, 'PUT', { state: 'revoked' })).status, 200);
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 403);                                  // blocked by the server
    assert.equal((await call('/api/doctor/patients/1/probe', 4)).status, 200);                                  // other doctor unaffected
    assert.equal((await call('/api/patient/access/facility/fac-b', 1, 'PUT', { state: 'revoked' })).status, 200);
    assert.equal((await call('/api/doctor/patients/1/probe', 4)).status, 403);                                  // facility revoke closes that facility
    assert.equal((await call('/api/patient/access/doctor/3', 1, 'PUT', { state: 'granted' })).status, 200);
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 200);                                  // restored
    // A revocation by mother 1 must not affect another mother's relationship with the same doctor
    await t.pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES(2,4,'2030-01-03','confirmed','fac-b')");
    assert.equal((await call('/api/doctor/patients/2/probe', 4)).status, 200);
    const hist = (await call('/api/patient/access/history', 1)).data.entries;
    assert.ok(hist.some((e) => e.allowed === false) && hist.some((e) => e.allowed === true));
    assert.equal((await call('/api/patient/access/history', 3)).status, 403);
  } finally { await t.close(); }
});

test('L: a reason for delay never marks anything done, and is dropped once the item is completed', async () => {
  const t = await setup();
  try {
    const { call, pool } = t;
    await pool.query("INSERT INTO postpartum_profile(mother_id,delivery_date) VALUES(1,CURRENT_DATE - 20)");
    const kid = (await pool.query("INSERT INTO children(mother_id,name,date_of_birth,sex) VALUES(1,'SYNTHETIC Baby',CURRENT_DATE - 200,'female') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO children(mother_id,name,date_of_birth,sex) VALUES(2,'SYNTHETIC Other Baby',CURRENT_DATE - 200,'male')");
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'postpartum_contact', item_code: 'pnc_24h', reason: 'made_up' })).status, 400);
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'postpartum_contact', item_code: 'pnc_24h', reason: 'mother_unwell' })).status, 200);
    assert.equal((await pool.query("SELECT 1 FROM postpartum_contacts WHERE mother_id=1")).rows.length, 0);       // not marked done
    assert.equal((await call('/api/follow-through', 1)).data.delays.length, 1);
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'vaccine', item_code: 'bcg', child_id: kid + 1, reason: 'other' })).status, 404); // someone else's child
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'vaccine', item_code: 'bcg', child_id: kid, reason: 'vaccine_unavailable', new_target: '2000-01-01' })).status, 400); // past date
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'vaccine', item_code: 'bcg', child_id: kid, reason: 'vaccine_unavailable' })).status, 200);
    await pool.query("INSERT INTO postpartum_contacts(mother_id,contact_code,completed_on) VALUES(1,'pnc_24h',CURRENT_DATE)");
    assert.equal((await call('/api/follow-through/delays', 1, 'PUT', { kind: 'postpartum_contact', item_code: 'pnc_24h', reason: 'other' })).status, 409);
    const left = (await call('/api/follow-through', 1)).data.delays.map((d) => d.item_code);
    assert.deepEqual(left, ['bcg']);                                                                               // completed visit's reason is dropped
    assert.equal((await call('/api/follow-through', 2)).data.delays.length, 0);                                    // other mother sees nothing
  } finally { await t.close(); }
});
