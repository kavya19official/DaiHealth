'use strict';
// ============================================================================
// Tamper-evident consent & access receipts.
//
//   GET /api/patient/audit/verify                 re-seal + re-verify her chain, return checkpoint
//   GET /api/patient/audit/events?limit&before    her audit events with chain positions
//   GET /api/patient/audit/public-key             Ed25519 public key for offline receipt checks
//   GET /api/patient/audit/events/:id/receipt     signed receipt download (issued on demand)
//   GET /api/patient/receipts                     receipts already issued
//
// Audit events are captured by triggers in db/consent_audit.sql. This module seals
// them into a per-mother HMAC-SHA256 hash chain (same construction as
// timelineEventStore) and signs receipts with an Ed25519 key that never leaves
// the server. Verification is real: every seal is recomputed from the event
// rows, so any silent edit or delete breaks the chain and fails closed.
// ============================================================================
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { canonical } = require('./timelineEventStore');

const integrity = () => Object.assign(
  Error('Consent audit verification failed. The log may have been altered; contact your care team.'),
  { status: 409 });

// HMAC key for the audit chain. Separate from the timeline key; falls back to it
// so existing deployments that already configured TIMELINE_AUDIT_KEY keep working.
function auditKey(env = process.env) {
  if (env.CONSENT_AUDIT_KEY && env.CONSENT_AUDIT_KEY.length >= 32) return env.CONSENT_AUDIT_KEY;
  if (env.TIMELINE_AUDIT_KEY && env.TIMELINE_AUDIT_KEY.length >= 32) return env.TIMELINE_AUDIT_KEY;
  if (env.DAI_LOCAL !== 'true') throw Object.assign(Error('Consent audit signing key is not configured'), { status: 503 });
  const file = path.join(__dirname, '../.local/consent-audit.key');
  try { return fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, crypto.randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' }); }
    catch (e2) { if (e2.code !== 'EEXIST') throw e2; }
    return fs.readFileSync(file, 'utf8');
  }
}

// Ed25519 key pair used to sign receipts. The private key lives in env or a
// 0600 file under .local; only the public half is ever served.
function receiptKeys(env = process.env) {
  const finish = (privateKey) => {
    const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    const keyId = 'ed25519-' + crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 24);
    return { privateKey, publicKeyPem, keyId };
  };
  if (env.CONSENT_RECEIPT_PRIVATE_KEY) {
    let pem = String(env.CONSENT_RECEIPT_PRIVATE_KEY).replace(/\\n/g, '\n');
    if (!pem.includes('PRIVATE KEY')) pem = Buffer.from(pem, 'base64').toString('utf8');
    return finish(crypto.createPrivateKey(pem));
  }
  if (env.DAI_LOCAL !== 'true') throw Object.assign(Error('Receipt signing key is not configured'), { status: 503 });
  const file = path.join(__dirname, '../.local/consent-receipt-private.pem');
  let pem;
  try { pem = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    try { fs.writeFileSync(file, pem, { mode: 0o600, flag: 'wx' }); }
    catch (e2) { if (e2.code !== 'EEXIST') throw e2; pem = fs.readFileSync(file, 'utf8'); }
  }
  return finish(crypto.createPrivateKey(pem));
}

const eventHash = (event, previous, key) => crypto.createHmac('sha256', key).update(canonical({
  id: String(event.id), mother_id: event.mother_id, source: event.source, event_type: event.event_type,
  actor_id: event.actor_id ?? null, subject_type: event.subject_type ?? null,
  subject_ref: event.subject_ref ?? null, resource: event.resource ?? null,
  allowed: event.allowed ?? null, payload: event.payload,
  occurred_at: new Date(event.occurred_at).toISOString(),
  recorded_at: new Date(event.recorded_at).toISOString(),
  previous
})).digest('hex');

// Seals every unsealed event for one mother and verifies the whole chain.
// MUST run inside a transaction on a dedicated client: it takes the per-mother
// chain-head row lock, which serialises it against the capture triggers.
async function sealPending(db, motherId, { key } = {}) {
  key = key || auditKey();
  await db.query('INSERT INTO consent_audit_heads(mother_id) VALUES($1) ON CONFLICT DO NOTHING', [motherId]);
  const head = (await db.query('SELECT * FROM consent_audit_heads WHERE mother_id=$1 FOR UPDATE', [motherId])).rows[0];
  const events = (await db.query('SELECT * FROM consent_audit_events WHERE mother_id=$1 ORDER BY id', [motherId])).rows;
  const seals = (await db.query('SELECT * FROM consent_audit_seals WHERE mother_id=$1 ORDER BY sequence', [motherId])).rows;
  if (seals.length > events.length || Number(head.sequence) !== seals.length) throw integrity();
  let previous = '';
  for (let i = 0; i < events.length; i++) {
    const event = events[i], digest = eventHash(event, previous, key), seal = seals[i];
    if (seal) {
      if (String(seal.event_id) !== String(event.id) || Number(seal.sequence) !== i + 1 ||
          seal.previous_hash !== previous || seal.event_hash !== digest) throw integrity();
    } else {
      await db.query('INSERT INTO consent_audit_seals(event_id,mother_id,sequence,previous_hash,event_hash) VALUES($1,$2,$3,$4,$5)',
        [event.id, motherId, i + 1, previous, digest]);
    }
    if (i === seals.length - 1 && head.head_hash !== digest) throw integrity();
    previous = digest;
  }
  await db.query('UPDATE consent_audit_heads SET sequence=$2,head_hash=$3 WHERE mother_id=$1',
    [motherId, events.length, previous]);
  const all = (await db.query('SELECT * FROM consent_audit_seals WHERE mother_id=$1 ORDER BY sequence', [motherId])).rows;
  return { events, seals: all, sequence: events.length, head_hash: previous };
}

const intOrNull = (v) => {
  if (Number.isSafeInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) { const n = Number(v); return Number.isSafeInteger(n) ? n : null; }
  return null;
};

async function actorLabel(db, event) {
  const id = event.actor_id ?? intOrNull(event.payload?.doctor_id) ?? intOrNull(event.payload?.actor_id);
  if (id == null) return { id: null, name: null };
  const row = (await db.query(
    'SELECT full_name FROM doctor_profiles WHERE user_id=$1 UNION ALL SELECT full_name FROM mother_profiles WHERE user_id=$1 LIMIT 1',
    [id])).rows[0];
  return { id, name: row?.full_name || null };
}

function effectBlock(event) {
  if (!/revok/i.test(event.event_type)) return undefined;
  const occurred = new Date(event.occurred_at).toISOString();
  const details = event.payload || {};
  const effective = details.effective_at || details.updated_at || occurred;
  return {
    kind: 'consent_or_access_change',
    occurred_at: occurred,
    effective_at: new Date(effective).toISOString(),
    enforcement: 'Immediate. Backend authorisation re-checks consent state on every clinician request; blocked attempts are themselves audit-logged.'
  };
}

// Builds, signs and stores the receipt for one audit event. Idempotent via
// UNIQUE(audit_event_id): repeated calls return the same receipt. `db` must be
// a client inside a transaction where sealPending has already run.
async function issueReceipt(db, motherId, eventId, { env = process.env, keys } = {}) {
  const event = (await db.query('SELECT * FROM consent_audit_events WHERE id=$1 AND mother_id=$2', [eventId, motherId])).rows[0];
  if (!event) return null;
  const seal = (await db.query('SELECT * FROM consent_audit_seals WHERE event_id=$1', [eventId])).rows[0];
  if (!seal) throw integrity();
  const head = (await db.query('SELECT * FROM consent_audit_heads WHERE mother_id=$1', [motherId])).rows[0];
  const rk = keys || receiptKeys(env);
  const actor = await actorLabel(db, event);
  const issuedAt = (await db.query('SELECT NOW() AS t')).rows[0].t;
  const payload = {
    receipt_version: 1,
    receipt_id: 'dai-rcpt-' + String(event.id),
    data_label: 'synthetic',
    mother_id: motherId,
    issued_at: new Date(issuedAt).toISOString(),
    event: {
      id: String(event.id), source: event.source, event_type: event.event_type,
      actor_id: actor.id, actor_name: actor.name,
      subject_type: event.subject_type ?? null, subject_ref: event.subject_ref ?? null,
      resource: event.resource ?? null, allowed: event.allowed ?? null,
      occurred_at: new Date(event.occurred_at).toISOString(),
      recorded_at: new Date(event.recorded_at).toISOString(),
      details: event.payload
    },
    ...(effectBlock(event) ? { effect: effectBlock(event) } : {}),
    chain: {
      algorithm: 'HMAC-SHA256', scope: 'per-mother consent and access audit chain',
      sequence: Number(seal.sequence), previous_hash: seal.previous_hash,
      event_hash: seal.event_hash, head_hash: head.head_hash, head_sequence: Number(head.sequence)
    },
    signer: { algorithm: 'Ed25519', key_id: rk.keyId }
  };
  const signature = crypto.sign(null, Buffer.from(canonical(payload), 'utf8'), rk.privateKey).toString('base64');
  const ins = await db.query(
    'INSERT INTO consent_receipts(mother_id,audit_event_id,receipt_type,payload,signature,key_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(audit_event_id) DO NOTHING RETURNING *',
    [motherId, eventId, event.event_type, JSON.stringify(payload), signature, rk.keyId]);
  return ins.rows[0] || (await db.query('SELECT * FROM consent_receipts WHERE audit_event_id=$1', [eventId])).rows[0];
}

// Convenience for consent-mutation routes already inside a transaction: seal
// the chain, then receipt the mother's most recent audit event.
async function issueLatestReceipt(db, motherId, opts = {}) {
  await sealPending(db, motherId, opts);
  const event = (await db.query('SELECT id FROM consent_audit_events WHERE mother_id=$1 ORDER BY id DESC LIMIT 1', [motherId])).rows[0];
  return event ? issueReceipt(db, motherId, event.id, opts) : null;
}

// The downloadable document: the exact signed payload plus signature and the
// public key needed to verify it offline.
function receiptDocument(row, publicKeyPem) {
  return {
    ...row.payload,
    signature: row.signature,
    public_key: publicKeyPem,
    verification: {
      signature_algorithm: 'Ed25519',
      signed_payload: 'All fields except signature, public_key and verification, serialised as canonical JSON (sorted keys, no whitespace).',
      chain_algorithm: 'HMAC-SHA256',
      public_key_fingerprint: row.key_id
    }
  };
}

// Verifies a downloaded receipt document against a public key PEM.
function verifyReceipt(doc, publicKeyPem) {
  const { signature, public_key, verification, ...signed } = doc;
  try {
    return crypto.verify(null, Buffer.from(canonical(signed), 'utf8'),
      crypto.createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch { return false; }
}

async function withTx(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const r = await fn(db);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { db.release(); }
}

module.exports = function registerConsentAudit(app, { pool, authenticateToken, authorizeRole, env = process.env } = {}) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  const fail = (res, e) => {
    if (!e.status) console.error('Consent audit:', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not load the consent audit log' });
  };

  app.get('/api/patient/audit/verify', ...own, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const r = await withTx(pool, (db) => sealPending(db, req.user.id, { key: auditKey(env) }));
      res.json({
        valid: true, sequence: r.sequence, head_hash: r.head_hash, events: r.events.length,
        algorithm: 'HMAC-SHA256', verified_at: new Date().toISOString(),
        coverage: 'DAI-recorded consent and access events only; external hospital-system logs are not included.'
      });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/patient/audit/events', ...own, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      const before = req.query.before == null ? null : Number(req.query.before);
      if (before != null && !Number.isSafeInteger(before)) return res.status(400).json({ error: 'Invalid history cursor' });
      const r = await withTx(pool, async (db) => {
        const sealed = await sealPending(db, req.user.id, { key: auditKey(env) });
        const rows = (await db.query(
          `SELECT e.id, e.source, e.event_type, e.actor_id, e.subject_type, e.subject_ref, e.resource, e.allowed,
                  e.payload, e.occurred_at, e.recorded_at, s.sequence, s.event_hash, r.id AS receipt_id
             FROM consent_audit_events e
             JOIN consent_audit_seals s ON s.event_id = e.id
             LEFT JOIN consent_receipts r ON r.audit_event_id = e.id
            WHERE e.mother_id = $1 ${before != null ? 'AND e.id < $3' : ''}
            ORDER BY e.id DESC LIMIT $2`,
          before != null ? [req.user.id, limit + 1, before] : [req.user.id, limit + 1])).rows;
        const names = new Map();
        const ids = [...new Set(rows.flatMap((e) => [e.actor_id, intOrNull(e.payload?.doctor_id), intOrNull(e.payload?.actor_id)]).filter((x) => Number.isSafeInteger(x)))];
        if (ids.length) {
          const profs = (await db.query(
            'SELECT user_id, full_name FROM doctor_profiles WHERE user_id = ANY($1::int[]) UNION ALL SELECT user_id, full_name FROM mother_profiles WHERE user_id = ANY($1::int[])',
            [ids])).rows;
          for (const p of profs) names.set(p.user_id, p.full_name);
        }
        const events = rows.slice(0, limit).map((e) => ({
          id: Number(e.id), source: e.source, event_type: e.event_type,
          actor_id: e.actor_id ?? intOrNull(e.payload?.doctor_id) ?? intOrNull(e.payload?.actor_id),
          actor_name: names.get(e.actor_id ?? intOrNull(e.payload?.doctor_id) ?? intOrNull(e.payload?.actor_id)) || null,
          subject_type: e.subject_type, subject_ref: e.subject_ref, resource: e.resource, allowed: e.allowed,
          details: e.payload, occurred_at: e.occurred_at, sequence: Number(e.sequence), event_hash: e.event_hash,
          receipt_id: e.receipt_id != null ? Number(e.receipt_id) : null
        }));
        return { events, more: rows.length > limit, checkpoint: { sequence: sealed.sequence, head_hash: sealed.head_hash } };
      });
      res.json({ ...r, next_before: r.more && r.events.length ? String(r.events[r.events.length - 1].id) : null });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/patient/audit/public-key', ...own, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { publicKeyPem, keyId } = receiptKeys(env);
      res.json({ algorithm: 'Ed25519', key_id: keyId, public_key: publicKeyPem });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/patient/receipts', ...own, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const rows = (await pool.query(
        `SELECT r.id, r.audit_event_id, r.receipt_type, r.key_id, r.issued_at, e.event_type, e.occurred_at, e.actor_id, e.resource
           FROM consent_receipts r JOIN consent_audit_events e ON e.id = r.audit_event_id
          WHERE r.mother_id = $1 ORDER BY r.id DESC LIMIT 100`, [req.user.id])).rows;
      res.json({ receipts: rows });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/patient/audit/events/:eventId/receipt', ...own, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="dai-receipt-${req.params.eventId}.json"` });
    try {
      const eventId = Number(req.params.eventId);
      if (!Number.isSafeInteger(eventId)) return res.status(400).json({ error: 'Invalid audit event' });
      const doc = await withTx(pool, async (db) => {
        await sealPending(db, req.user.id, { key: auditKey(env) });
        const row = await issueReceipt(db, req.user.id, eventId, { env });
        if (!row) return null;
        return receiptDocument(row, receiptKeys(env).publicKeyPem);
      });
      if (!doc) return res.status(404).json({ error: 'Audit event not found' });
      res.json(doc);
    } catch (e) { fail(res, e); }
  });
};

module.exports.sealPending = sealPending;
module.exports.issueReceipt = issueReceipt;
module.exports.issueLatestReceipt = issueLatestReceipt;
module.exports.verifyReceipt = verifyReceipt;
module.exports.receiptDocument = receiptDocument;
module.exports.auditKey = auditKey;
module.exports.receiptKeys = receiptKeys;
module.exports.eventHash = eventHash;
