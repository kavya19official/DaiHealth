'use strict';

const crypto = require('node:crypto');
const { deflateRawSync } = require('node:zlib');
const QR = require('qrcode');
const { stage } = require('../frontend/js/patient-model');

const day = 86400;
const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const encode = value => Buffer.from(value).toString('base64url');
const utcDate = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const shortText = value => typeof value === 'string' ? [...value.trim()].slice(0, 140).join('') || null : null;
const recordedAllergies = value => typeof value === 'string' && value.trim() ? value : null;
const blood = value => /^(A|B|AB|O)[+-]$/.test(value || '') ? value : null;

function signingKeys(env) {
  const configured = env.DAI_CARE_CAPSULE_KEYS;
  const secrets = configured ? configured.split(',').map(key => key.trim()) : [];
  if (!secrets.length && (env.DAI_LOCAL === 'true' || env.DAI_CONTAINER_DEMO === 'true') && env.JWT_SECRET) {
    secrets.push(encode(crypto.createHmac('sha256', env.JWT_SECRET).update('dai-care-capsule-v1').digest()));
  }
  if (secrets.some(secret => !/^[A-Za-z0-9_-]{43}$/.test(secret) || encode(Buffer.from(secret, 'base64url')) !== secret)) {
    throw Error('Care Capsule signing seeds must be 32-byte base64url values.');
  }
  return [...new Set(secrets)].map(secret => {
    const n = BigInt('0x' + Buffer.from(secret, 'base64url').toString('hex'));
    const scalar = Buffer.from((n % (order - 1n) + 1n).toString(16).padStart(64, '0'), 'hex');
    const curve = crypto.createECDH('prime256v1');
    curve.setPrivateKey(scalar);
    const point = curve.getPublicKey();
    const kid = encode(crypto.createHash('sha256').update(point).digest().subarray(0, 12));
    const jwk = { kty: 'EC', crv: 'P-256', x: encode(point.subarray(1, 33)), y: encode(point.subarray(33)) };
    return { kid, jwk, privateKey: crypto.createPrivateKey({ key: { ...jwk, d: encode(scalar) }, format: 'jwk' }) };
  });
}

function signCapsule(payload, key) {
  const compressed = encode(deflateRawSync(Buffer.from(JSON.stringify(payload))));
  const encoded = 'DAIC1.' + key.kid + '.' + compressed;
  const signature = crypto.sign('sha256', Buffer.from(encoded), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return encoded + '.' + encode(signature);
}

function capsuleUrl(req, value, env) {
  const configured = env.DAI_PUBLIC_ORIGIN;
  const origin = configured || req.get('origin');
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' &&
        !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) return null;
    if (!configured && base.host !== (req.get('x-forwarded-host') || req.get('host'))) return null;
    const url = new URL('/care-capsule/index.html', base.origin);
    url.hash = value;
    return url.href;
  } catch {
    return null;
  }
}

async function subjectFields(pool, mother, child) {
  if (child != null) {
    const { rows: [profile] } = await pool.query(
      'SELECT blood_group,allergies FROM children WHERE id=$1 AND mother_id=$2', [child, mother]
    );
    if (!profile) return null;
    const { rows } = await pool.query(`
      SELECT vaccine_code AS code,to_char(given_on,'YYYY-MM-DD') AS date
      FROM child_vaccinations WHERE child_id=$1 AND given_on<=CURRENT_DATE
      ORDER BY given_on DESC,vaccine_code ASC LIMIT 4`, [child]);
    return {
      allergies: recordedAllergies(profile.allergies),
      blood_group: blood(profile.blood_group),
      vaccines: rows.length ? rows : null
    };
  }
  const { rows: [profile] } = await pool.query(`
    SELECT blood_group,allergies,pregnancy_status,lmp_date,care_start_date,risk_level,risk_factors
    FROM mother_profiles WHERE user_id=$1`, [mother]);
  if (!profile) return null;
  profile.lmp_date = utcDate(profile.lmp_date);
  profile.care_start_date = utcDate(profile.care_start_date);
  const week = stage(profile).week;
  const factors = (Array.isArray(profile.risk_factors) ? profile.risk_factors : [])
    .map(factor => shortText(factor?.label)).filter(Boolean).slice(0, 3);
  return {
    allergies: recordedAllergies(profile.allergies),
    blood_group: blood(profile.blood_group),
    recorded_risk: shortText(profile.risk_level),
    risk_factors: factors.length ? factors : null,
    pregnancy_week: Number.isInteger(week) && week >= 0 && week <= 45 ? week : null
  };
}

function register(app, { pool, authenticateToken, authorizeRole, env = process.env }) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  const keys = signingKeys(env);
  const fail = res => res.status(500).json({ error: 'Could not complete the Care Capsule request.' });
  const childId = value => value == null || value === '' ? null : Number(value);
  const validChild = value => value === null || Number.isInteger(value) && value > 0 && value <= 2147483647;

  app.get('/api/care-capsule/trust', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!keys.length) return res.status(503).json({ error: 'Care Capsule signing is unavailable.' });
    try {
      const { rows } = await pool.query('SELECT c.id FROM care_capsules c LEFT JOIN users u ON u.id=c.mother_id WHERE c.expires_at>NOW() AND (c.revoked_at IS NOT NULL OR u.id IS NULL OR u.closed_at IS NOT NULL)');
      res.json({ version: 1, synced_at: new Date().toISOString(),
        keys: keys.map(({ kid, jwk }) => ({ kid, jwk })), revoked: rows.map(({ id }) => id) });
    } catch { fail(res); }
  });

  app.get('/api/patient/care-capsules', ...own, async (req, res) => {
    try {
      const mother = req.user.id;
      const { rows: children } = await pool.query('SELECT id,name FROM children WHERE mother_id=$1 ORDER BY date_of_birth DESC,id', [mother]);
      const { rows: capsules } = await pool.query(`SELECT id,subject,expires_at FROM care_capsules
        WHERE mother_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`, [mother]);
      res.json({ children, capsules });
    } catch { fail(res); }
  });

  app.get('/api/patient/care-capsules/fields', ...own, async (req, res) => {
    const child = childId(req.query.child_id);
    if (!validChild(child)) return res.status(400).json({ error: 'Invalid child record.' });
    try {
      const fields = await subjectFields(pool, req.user.id, child);
      if (!fields) return res.status(404).json({ error: 'Record unavailable.' });
      res.json({ fields });
    } catch { fail(res); }
  });

  app.post('/api/patient/care-capsules', ...own, async (req, res) => {
    const body = req.body || {};
    const child = childId(body.child_id);
    const selection = body.fields;
    if (!validChild(child) || body.confirmed !== true || ![1, 7, 30].includes(body.days) || !selection ||
        typeof selection !== 'object' || Array.isArray(selection) || !Object.keys(selection).length) {
      return res.status(400).json({ error: 'Select available fields, choose an expiry, and confirm sharing.' });
    }
    if (!keys.length) return res.status(503).json({ error: 'Care Capsule signing is unavailable.' });
    try {
      const available = await subjectFields(pool, req.user.id, child);
      if (!available) return res.status(404).json({ error: 'Record unavailable.' });
      const fields = {};
      for (const [name, preview] of Object.entries(selection)) {
        if (!Object.hasOwn(available, name) || available[name] == null) {
          return res.status(400).json({ error: 'Select only available fields.' });
        }
        if (JSON.stringify(available[name]) !== JSON.stringify(preview)) {
          return res.status(409).json({ error: 'The selected values changed. Reopen Care Capsule and review the latest values.' });
        }
        if (name === 'allergies' && Buffer.byteLength(preview) > 2048) {
          return res.status(400).json({ error: 'The recorded allergy text is too long for a capsule.' });
        }
        fields[name] = available[name];
      }
      const issued = Math.floor(Date.now() / 1000);
      const payload = {
        v: 1, id: crypto.randomUUID(), subject: child == null ? 'mother' : 'child',
        iat: issued, exp: issued + body.days * day, fields
      };
      const url = capsuleUrl(req, signCapsule(payload, keys[0]), env);
      if (!url) return res.status(503).json({ error: 'Open DaiHealth on its HTTPS address to create a capsule.' });
      if (Buffer.byteLength(url) > 900) return res.status(400).json({ error: 'The capsule is too large to scan reliably. Select fewer fields.' });
      const qr = await QR.toDataURL(url, { width: 560, margin: 4, errorCorrectionLevel: 'M' });
      await pool.query('INSERT INTO care_capsules(id,mother_id,subject,expires_at) VALUES ($1,$2,$3,to_timestamp($4))',
        [payload.id, req.user.id, payload.subject, payload.exp]);
      res.status(201).json({ id: payload.id, qr, expires_at: new Date(payload.exp * 1000).toISOString() });
    } catch { fail(res); }
  });

  app.delete('/api/patient/care-capsules/:id', ...own, async (req, res) => {
    const id = req.params.id;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return res.status(404).json({ error: 'Capsule unavailable.' });
    try {
      const { rows } = await pool.query(`UPDATE care_capsules SET revoked_at=COALESCE(revoked_at,NOW())
        WHERE id=$1 AND mother_id=$2 RETURNING id`, [id, req.user.id]);
      if (!rows.length) return res.status(404).json({ error: 'Capsule unavailable.' });
      res.json({ revoked: true });
    } catch { fail(res); }
  });
}

module.exports = { register, signingKeys, signCapsule };
