'use strict';
// Consent audit chain + signed receipts, in the repo's PGlite convention.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), express = require('express'), crypto = require('node:crypto');
const { createLocalPool } = require('./localPool'), { migrations } = require('../scripts/seed-local.cjs');
const registerAccess = require('./accessControl'), registerAudit = require('./consentAudit');

// Keys are injected through the environment so both the routes and the
// accessControl receipt hook (which reads process.env) sign consistently.
const AUDIT_KEY = 'test-only-consent-audit-key-0123456789abcdef';
const { privateKey: RECEIPT_KEY } = crypto.generateKeyPairSync('ed25519');
process.env.CONSENT_AUDIT_KEY = AUDIT_KEY;
process.env.CONSENT_RECEIPT_PRIVATE_KEY = RECEIPT_KEY.export({ type: 'pkcs8', format: 'pem' });

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-consent-audit-')), pool = createLocalPool(path.join(dir, 'db'));
  for (const file of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', file), 'utf8'));
  for (const [email, role] of [['m@synthetic.invalid', 'mother'], ['other@synthetic.invalid', 'mother'], ['d1@synthetic.invalid', 'doctor'], ['d2@synthetic.invalid', 'doctor']])
    await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'fake',$2)", [email, role]);
  await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES(1,'SYNTHETIC Mother'),(2,'SYNTHETIC Other')");
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,facility_name) VALUES(3,'SYNTHETIC One','Obstetrician','X1','Facility A'),(4,'SYNTHETIC Two','Obstetrician','X2','Facility B')");
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,facility_uuid) VALUES(1,3,'2030-01-01','confirmed','fac-a'),(1,4,'2030-01-02','confirmed','fac-b')");
  const app = express(); app.use(express.json());
  const authenticateToken = (req, res, next) => { const id = Number(req.headers['x-user']); if (![1, 2, 3, 4].includes(id)) return res.sendStatus(401); req.user = { id, role: id >= 3 ? 'doctor' : 'mother' }; next(); };
  const authorizeRole = (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  registerAccess(app, { pool, authenticateToken, authorizeRole });
  registerAudit(app, { pool, authenticateToken, authorizeRole, env: process.env });
  app.get('/api/doctor/patients/:motherId/probe', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    const id = await registerAccess.gateDoctor(pool, req, res, 'probe'); if (id == null) return; res.json({ ok: true });
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, user, method = 'GET', body) => {
    const r = await fetch(base + url, { method, headers: { 'x-user': String(user), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
  };
  return { pool, call, close: async () => { server.close(); await pool.end(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('consent and access events are hash-chained, sealed and tamper-evident', async () => {
  const t = await setup();
  try {
    const { call, pool } = t;
    // A clinician view is captured by the access-log trigger.
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 200);
    let verify = await call('/api/patient/audit/verify', 1);
    assert.equal(verify.status, 200); assert.equal(verify.data.valid, true); assert.equal(verify.data.events, 1);
    assert.match(verify.data.head_hash, /^[0-9a-f]{64}$/);

    // Events list exposes the record access with its chain position.
    const events = await call('/api/patient/audit/events?limit=10', 1);
    assert.equal(events.status, 200);
    const accessEvent = events.data.events.find((e) => e.event_type === 'record_access');
    assert.ok(accessEvent); assert.equal(accessEvent.actor_name, 'SYNTHETIC One'); assert.equal(accessEvent.resource, 'probe');

    // On-demand signed receipt verifies against the served public key.
    const pub = await call('/api/patient/audit/public-key', 1);
    assert.equal(pub.data.algorithm, 'Ed25519');
    const receipt = await call('/api/patient/audit/events/' + accessEvent.id + '/receipt', 1);
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers.get('content-disposition'), /attachment/);
    assert.equal(registerAudit.verifyReceipt(receipt.data, pub.data.public_key), true);
    assert.equal(receipt.data.event.event_type, 'record_access');
    assert.equal(receipt.data.event.actor_name, 'SYNTHETIC One');
    assert.equal(receipt.data.chain.algorithm, 'HMAC-SHA256');

    // Tamper: rewrite a payload behind the triggers' backs -> verification fails closed.
    const eventId = accessEvent.id;
    const original = (await pool.query('SELECT payload FROM consent_audit_events WHERE id=$1', [eventId])).rows[0].payload;
    await pool.query('ALTER TABLE consent_audit_events DISABLE TRIGGER immutable_audit_events');
    await pool.query("UPDATE consent_audit_events SET payload='{\"resource\":\"forged\"}'::jsonb WHERE id=$1", [eventId]);
    const tampered = await call('/api/patient/audit/verify', 1);
    assert.equal(tampered.status, 409);
    await pool.query('UPDATE consent_audit_events SET payload=$1::jsonb WHERE id=$2', [JSON.stringify(original), eventId]);
    await pool.query('ALTER TABLE consent_audit_events ENABLE TRIGGER immutable_audit_events');
    assert.equal((await call('/api/patient/audit/verify', 1)).data.valid, true);

    // The log itself refuses UPDATE/DELETE.
    await assert.rejects(() => pool.query("UPDATE consent_audit_events SET event_type='x' WHERE mother_id=1"), /append-only/);
    await assert.rejects(() => pool.query('DELETE FROM consent_audit_seals'), /append-only/);
    await assert.rejects(() => pool.query('DELETE FROM consent_receipts'), /append-only/);

    // Another mother sees none of it.
    assert.equal((await call('/api/patient/audit/events?limit=10', 2)).data.events.length, 0);
    assert.equal((await call('/api/patient/audit/events/' + eventId + '/receipt', 2)).status, 404);
    assert.equal((await call('/api/patient/audit/verify', 3)).status, 403);
  } finally { await t.close(); }
});

test('revocation produces a receipt with exact timestamps and blocks access immediately', async () => {
  const t = await setup();
  try {
    const { call } = t;
    const revoke = await call('/api/patient/access/doctor/3', 1, 'PUT', { state: 'revoked', reason: 'test' });
    assert.equal(revoke.status, 200); assert.ok(revoke.data.receipt_id);
    assert.match(revoke.data.message, /signed receipt/);

    // Access is blocked by the server straight away, and the blocked attempt is audited too.
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 403);
    assert.equal((await call('/api/doctor/patients/1/probe', 4)).status, 200);

    const events = await call('/api/patient/audit/events?limit=20', 1);
    const revoked = events.data.events.find((e) => e.event_type === 'access_revoked');
    assert.ok(revoked);
    const denied = events.data.events.find((e) => e.event_type === 'access_denied');
    assert.ok(denied);

    const receipt = await call('/api/patient/audit/events/' + revoked.id + '/receipt', 1);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.event.event_type, 'access_revoked');
    assert.equal(receipt.data.effect.enforcement.includes('Immediate'), true);
    // Exact revocation timestamp and the moment restrictions took effect.
    assert.ok(!Number.isNaN(Date.parse(receipt.data.effect.occurred_at)));
    assert.ok(!Number.isNaN(Date.parse(receipt.data.effect.effective_at)));
    assert.equal(receipt.data.event.details.effective_at, receipt.data.effect.effective_at);
    assert.equal(receipt.data.event.details.grantee_ref, '3');

    // Granting again is also receipted.
    const grant = await call('/api/patient/access/doctor/3', 1, 'PUT', { state: 'granted' });
    assert.equal(grant.status, 200); assert.ok(grant.data.receipt_id);
    assert.equal((await call('/api/doctor/patients/1/probe', 3)).status, 200);

    // Receipts list shows issued receipts; re-downloading is idempotent.
    const list = await call('/api/patient/receipts', 1);
    assert.ok(list.data.receipts.length >= 2);
    const again = await call('/api/patient/audit/events/' + revoked.id + '/receipt', 1);
    assert.equal(again.data.receipt_id, receipt.data.receipt_id);
    assert.equal(again.data.signature, receipt.data.signature);
  } finally { await t.close(); }
});
