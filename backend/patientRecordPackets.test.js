'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { PNG } = require('pngjs');
const decode = require('../frontend/vendor/qr/jsQR');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');
const { register } = require('./patientRecordPackets');

test('patient QR round trip checks recipient, history scope, file permissions, expiry and revocation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-record-packets-'));
  const pool = createLocalPool(dir);
  let server;
  try {
    for (const file of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', file), 'utf8'));
    const roles = new Map();
    async function user(role) {
      const { rows: [row] } = await pool.query('INSERT INTO users (role,email,password_hash) VALUES ($1,$2,$3) RETURNING id',
        [role, 'packet-' + roles.size + '@dai-synthetic.invalid', 'fixture']);
      roles.set(row.id, role);
      return row.id;
    }
    const mother = await user('mother');
    const doctor = await user('doctor');
    const other = await user('doctor');
    await pool.query("INSERT INTO mother_profiles (user_id,full_name) VALUES ($1,'Synthetic QR Patient')", [mother]);
    for (const id of [doctor, other]) {
      await pool.query(`INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified)
        VALUES ($1,'Synthetic QR Doctor','OBG','SYN-PACKET-'||$1::int::text,true)`, [id]);
    }
    await pool.query("INSERT INTO appointments (mother_id,doctor_id,requested_date,reason,status) VALUES ($1,$2,CURRENT_DATE,'QR fixture','confirmed')", [mother, doctor]);
    await pool.query("INSERT INTO clinical_dashboard_consent(mother_id,doctor_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')", [mother, doctor]);
    async function report(title, sensitive) {
      const { rows: [row] } = await pool.query(`INSERT INTO patient_documents
        (mother_id,title,doc_type,original_filename,mime_type,size_bytes,storage_key,is_sensitive)
        VALUES ($1,$2,'lab_report','report.pdf','application/pdf',100,$2,$3) RETURNING id`, [mother, title, sensitive]);
      return row.id;
    }
    const shared = await report('Shared report', false);
    const privateReport = await report('Private report', true);
    const unshared = await report('Unshared report', false);
    for (const id of [shared, privateReport]) {
      await pool.query('INSERT INTO patient_document_shares(document_id,doctor_id,shared_by) VALUES ($1,$2,$3)', [id, doctor, mother]);
    }
    const app = express();
    app.use(express.json());
    register(app, {
      pool,
      authenticateToken(req, res, next) {
        const id = Number(req.headers['x-fixture-user']);
        if (!roles.has(id)) return res.sendStatus(401);
        req.user = { id, role: roles.get(id) };
        next();
      },
      authorizeRole: allowed => (req, res, next) => allowed.includes(req.user.role) ? next() : res.sendStatus(403)
    });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    async function call(url, actor, method = 'GET', body) {
      const res = await fetch(base + url, {
        method, headers: { 'x-fixture-user': actor, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
      });
      return { status: res.status, data: await res.json().catch(() => null), cache: res.headers.get('cache-control') };
    }
    const issue = '/patient/record-packets';
    const redeem = (code, actor = doctor) => call('/doctor/record-packets/redeem', actor, 'POST', { code });
    const mint = documentIds => call(issue, mother, 'POST', { doctor_id: doctor, document_ids: documentIds, confirmed: true });
    const options = await call(issue, mother);
    assert.deepEqual(options.data.recipients.map(recipient => recipient.id), [doctor]);
    assert.deepEqual((await call(issue + '/reports/' + doctor, mother)).data.reports.map(report => report.id), [shared]);
    assert.equal((await mint([unshared])).status, 404);
    assert.equal((await mint([privateReport])).status, 404);
    const result = await mint([shared]);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const png = PNG.sync.read(Buffer.from(result.data.qr.split(',')[1], 'base64'));
    const decoded = decode(new Uint8ClampedArray(png.data), png.width, png.height).data;
    assert.equal(decoded, result.data.code);
    assert.match(decoded, /^dai-record:v1:[A-Za-z0-9_-]{43}$/);
    assert.equal((await redeem(decoded, other)).status, 404);
    assert.equal((await redeem(decoded, mother)).status, 403);

    const packet = await redeem(decoded);
    assert.equal(packet.status, 200, JSON.stringify(packet.data));
    assert.match(packet.cache, /no-store/);
    assert.equal(packet.data.profile.name, 'Synthetic QR Patient');
    assert.equal(packet.data.profile.history, null);
    assert.deepEqual(packet.data.reports.map(report => report.id), [shared]);
    await pool.query('UPDATE patient_document_shares SET revoked_at=NOW() WHERE document_id=$1', [shared]);
    assert.equal((await redeem(decoded)).data.omitted_reports, 1);
    assert.equal((await call(issue + '/' + result.data.id, mother, 'DELETE')).status, 200);
    assert.equal((await redeem(decoded)).status, 404);

    const expired = (await mint([])).data;
    await pool.query("UPDATE patient_record_packets SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.id]);
    assert.equal((await redeem(expired.code)).status, 404);
    const revoked = (await mint([])).data;
    await pool.query('UPDATE clinical_dashboard_consent SET revoked_at=NOW() WHERE mother_id=$1', [mother]);
    assert.equal((await redeem(revoked.code)).status, 404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
