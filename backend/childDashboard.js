// ===========================================================================
// Child dashboard routes
//
// Registered from server.js. Mother routes are scoped to the authenticated
// mother's own children (children.mother_id = req.user.id) — another mother's
// child id always looks like "not found", never "forbidden". Tables: see
// db/child_dashboard.sql. Vaccine and milestone codes, and the growth
// reference, live in ../shared/child-reference.js so the browser and this file
// use exactly the same schedule.
//
//   GET    /api/children                              every child + vaccinations, growth, milestones
//   POST   /api/children                              add a child
//   PATCH  /api/children/:id                          edit a child
//   DELETE /api/children/:id                          remove a child and all of their records
//   GET    /api/children/:id/photo                    the profile picture (owner only)
//   PUT    /api/children/:id/photo                    raw image/jpeg or image/png body (<= 600 KB)
//   DELETE /api/children/:id/photo
//   PUT    /api/children/:id/vaccinations/:code       {given_on, facility?}
//   DELETE /api/children/:id/vaccinations/:code
//   POST   /api/children/:id/growth                   {measured_on, weight_kg?, height_cm?, head_cm?}
//   DELETE /api/children/:id/growth/:logId
//   POST   /api/children/:id/growth/import-legacy     copy the old shared growth-widget entries onto this child
//   PUT    /api/children/:id/milestones/:code         {achieved_on}
//   DELETE /api/children/:id/milestones/:code
//   GET    /api/doctor/patients/:motherId/children    doctor: read-only summary (same access rule as the
//                                                     doctor's other patient views: an appointment exists)
// ============================================================================
const express = require('express');
const Ref = require('../shared/child-reference.js');

const MAX_CHILDREN_PER_MOTHER = 10;
const MAX_PHOTO_BYTES = 600 * 1024;
const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
const CERTIFICATE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SEXES = ['female', 'male', 'other'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const cleanStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const blank = (v) => v === undefined || v === null || v === '';

// Parses an optional number. -> { value } (null when blank) or { error }.
function optNum(raw, label, min, max, decimals, integer) {
  if (blank(raw)) return { value: null };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { error: `${label} must be a number` };
  if (integer && !Number.isInteger(n)) return { error: `${label} must be a whole number` };
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}` };
  return { value: decimals == null ? n : Number(n.toFixed(decimals)) };
}

const CHILD_SELECT = `
  SELECT c.id, c.name, to_char(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, c.sex, c.born_at_weeks,
         c.birth_weight_kg::float8 AS birth_weight_kg, c.birth_length_cm::float8 AS birth_length_cm,
         c.blood_group, c.allergies, c.notes, c.created_at,
         (p.child_id IS NOT NULL) AS has_photo,
         floor(extract(epoch FROM p.updated_at) * 1000)::float8 AS photo_v
    FROM children c
    LEFT JOIN child_photos p ON p.child_id = c.id`;

const shapeChild = (r) => ({
  id: r.id, name: r.name, date_of_birth: r.date_of_birth, sex: r.sex, born_at_weeks: r.born_at_weeks,
  birth_weight_kg: r.birth_weight_kg, birth_length_cm: r.birth_length_cm, blood_group: r.blood_group,
  allergies: r.allergies, notes: r.notes, created_at: r.created_at,
  has_photo: !!r.has_photo, photo_v: r.photo_v == null ? null : Number(r.photo_v),
});

const GROWTH_SELECT = `SELECT id, child_id, to_char(measured_on, 'YYYY-MM-DD') AS measured_on,
       weight_kg::float8 AS weight_kg, height_cm::float8 AS height_cm, head_cm::float8 AS head_cm
  FROM child_growth_logs`;

module.exports = function registerChildDashboardRoutes(app, { pool, authenticateToken, authorizeRole }) {
  const motherOnly = [authenticateToken, authorizeRole(['mother'])];
  const doctorOnly = [authenticateToken, authorizeRole(['doctor'])];

  const fail = (res, label, error, msg = 'Something went wrong') => {
    console.error(label + ':', error);
    res.status(500).json({ error: msg });
  };
  const parseId = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };

  // The server's own "today" (a mother's phone may be a day ahead — India vs UTC — so future
  // dates get one day of slack).
  const todayISO = async (db = pool) => (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  const notInFuture = (iso, today) => Ref.daysBetween(today, iso) <= 1;

  const findOwnChild = async (motherId, childId, db = pool) => {
    const r = await db.query(`${CHILD_SELECT} WHERE c.id = $1 AND c.mother_id = $2`, [childId, motherId]);
    return r.rows[0] ? shapeChild(r.rows[0]) : null;
  };

  // Loads :id, checks it is this mother's, and hands the child to the handler.
  const withChild = (handler) => async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid child' });
      const child = await findOwnChild(req.user.id, id);
      if (!child) return res.status(404).json({ error: 'Child not found' });
      await handler(req, res, child);
    } catch (e) { fail(res, 'Child route', e); }
  };

  // ==========================================================================
  // Children
  // ==========================================================================

  async function loadRecords(childIds) {
    if (!childIds.length) return { vax: [], growth: [], ms: [] };
    const [vax, growth, ms] = await Promise.all([
      pool.query(`SELECT child_id, vaccine_code, to_char(given_on, 'YYYY-MM-DD') AS given_on, facility
                    FROM child_vaccinations WHERE child_id = ANY($1::int[]) ORDER BY given_on`, [childIds]),
      pool.query(`${GROWTH_SELECT} WHERE child_id = ANY($1::int[]) ORDER BY measured_on, id`, [childIds]),
      pool.query(`SELECT child_id, milestone_code, to_char(achieved_on, 'YYYY-MM-DD') AS achieved_on
                    FROM child_milestones WHERE child_id = ANY($1::int[])`, [childIds]),
    ]);
    return { vax: vax.rows, growth: growth.rows, ms: ms.rows };
  }

  app.get('/api/children', ...motherOnly, async (req, res) => {
    try {
      const kids = (await pool.query(`${CHILD_SELECT} WHERE c.mother_id = $1 ORDER BY c.date_of_birth DESC, c.id`, [req.user.id])).rows.map(shapeChild);
      const rec = await loadRecords(kids.map((k) => k.id));
      const certs = kids.length
        ? await pool.query('SELECT child_id, vaccine_code FROM child_vaccination_certificates WHERE child_id = ANY($1::int[])', [kids.map((k) => k.id)])
        : { rows: [] };
      const hasCert = new Set(certs.rows.map((r) => `${r.child_id}:${r.vaccine_code}`));
      const legacy = await pool.query('SELECT COUNT(*)::int AS n FROM growth_logs WHERE mother_id = $1', [req.user.id]);
      res.json({
        children: kids.map((k) => ({
          ...k,
          vaccinations: rec.vax.filter((v) => v.child_id === k.id).map(({ vaccine_code, given_on, facility }) => ({
            vaccine_code, given_on, hospital_or_doctor: facility,
            dose_number: Object.prototype.hasOwnProperty.call(Ref.VACCINE_BY_CODE, vaccine_code) ? Ref.VACCINE_BY_CODE[vaccine_code].dose : null,
            has_certificate: hasCert.has(`${k.id}:${vaccine_code}`),
          })),
          growth: rec.growth.filter((g) => g.child_id === k.id).map(({ child_id, ...g }) => g),
          milestones: rec.ms.filter((m) => m.child_id === k.id).map(({ milestone_code, achieved_on }) => ({ milestone_code, achieved_on })),
        })),
        legacy_growth_count: legacy.rows[0].n,
      });
    } catch (e) { fail(res, 'List children', e, 'Failed to load your children'); }
  });

  // Validates the profile fields. `partial` = PATCH (only the fields that were sent).
  function readChildBody(body, partial) {
    const b = body || {};
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

    if (!partial || has('name')) {
      const name = cleanStr(b.name, 120);
      if (!name) return { error: 'Enter your child’s name' };
      out.name = name;
    }
    if (!partial || has('date_of_birth')) {
      if (!isRealDate(b.date_of_birth)) return { error: 'Enter a valid date of birth' };
      out.date_of_birth = b.date_of_birth;
    }
    if (!partial || has('sex')) {
      if (!SEXES.includes(b.sex)) return { error: 'Choose girl, boy or other' };
      out.sex = b.sex;
    }
    if (has('born_at_weeks')) {
      const w = optNum(b.born_at_weeks, 'Weeks at birth', 22, 44, null, true);
      if (w.error) return { error: w.error };
      out.born_at_weeks = w.value;
    }
    if (has('birth_weight_kg')) {
      const w = optNum(b.birth_weight_kg, 'Birth weight', 0.4, 7, 2);
      if (w.error) return { error: w.error };
      out.birth_weight_kg = w.value;
    }
    if (has('birth_length_cm')) {
      const l = optNum(b.birth_length_cm, 'Birth length', 20, 65, 1);
      if (l.error) return { error: l.error };
      out.birth_length_cm = l.value;
    }
    if (has('blood_group')) {
      if (!blank(b.blood_group) && !BLOOD_GROUPS.includes(b.blood_group)) return { error: 'Choose a valid blood group' };
      out.blood_group = blank(b.blood_group) ? null : b.blood_group;
    }
    if (has('allergies')) out.allergies = cleanStr(b.allergies, 300) || null;
    if (has('notes')) out.notes = cleanStr(b.notes, 500) || null;
    return { values: out };
  }

  const dobProblem = (dob, today) => {
    if (!notInFuture(dob, today)) return 'A date of birth can’t be in the future';
    if (Ref.daysBetween(dob, today) > 18 * 366) return 'This dashboard is for children up to 18 years old';
    return null;
  };

  app.post('/api/children', ...motherOnly, async (req, res) => {
    try {
      const parsed = readChildBody(req.body, false);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const v = parsed.values;
      const problem = dobProblem(v.date_of_birth, await todayISO());
      if (problem) return res.status(400).json({ error: problem });

      const count = await pool.query('SELECT COUNT(*)::int AS n FROM children WHERE mother_id = $1', [req.user.id]);
      if (count.rows[0].n >= MAX_CHILDREN_PER_MOTHER) return res.status(400).json({ error: `You can add up to ${MAX_CHILDREN_PER_MOTHER} children` });

      const ins = await pool.query(
        `INSERT INTO children (mother_id, name, date_of_birth, sex, born_at_weeks, birth_weight_kg, birth_length_cm, blood_group, allergies, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [req.user.id, v.name, v.date_of_birth, v.sex, v.born_at_weeks ?? null, v.birth_weight_kg ?? null, v.birth_length_cm ?? null,
         v.blood_group ?? null, v.allergies ?? null, v.notes ?? null]);
      const child = await findOwnChild(req.user.id, ins.rows[0].id);
      res.status(201).json({ child: { ...child, vaccinations: [], growth: [], milestones: [] } });
    } catch (e) { fail(res, 'Add child', e, 'Failed to add your child'); }
  });

  app.patch('/api/children/:id', ...motherOnly, withChild(async (req, res, child) => {
    const parsed = readChildBody(req.body, true);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.values;
    if (!Object.keys(v).length) return res.status(400).json({ error: 'Nothing to update' });

    if (v.date_of_birth && v.date_of_birth !== child.date_of_birth) {
      const problem = dobProblem(v.date_of_birth, await todayISO());
      if (problem) return res.status(400).json({ error: problem });
      // Records can't pre-date the birth.
      const early = await pool.query(
        `SELECT 1 FROM child_vaccinations WHERE child_id = $1 AND given_on < $2::date
         UNION ALL SELECT 1 FROM child_growth_logs WHERE child_id = $1 AND measured_on < $2::date
         UNION ALL SELECT 1 FROM child_milestones WHERE child_id = $1 AND achieved_on < $2::date LIMIT 1`, [child.id, v.date_of_birth]);
      if (early.rows.length) return res.status(409).json({ error: 'Some saved vaccines, measurements or milestones are dated before that birth date. Remove or correct them first.' });
    }

    const cols = Object.keys(v);
    await pool.query(`UPDATE children SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND mother_id = $2`,
      [child.id, req.user.id, ...cols.map((c) => v[c])]);
    res.json({ child: await findOwnChild(req.user.id, child.id) });
  }));

  app.delete('/api/children/:id', ...motherOnly, withChild(async (req, res, child) => {
    await pool.query('DELETE FROM children WHERE id = $1 AND mother_id = $2', [child.id, req.user.id]);
    res.json({ message: 'Child removed' });
  }));

  // ==========================================================================
  // Photo — sent as the raw image body (the browser resizes it first), so no
  // base64 inflation and no multipart parser. Only ever served to the owner.
  // ==========================================================================
  const rawImage = (req, res, next) =>
    express.raw({ type: ['image/jpeg', 'image/png'], limit: MAX_PHOTO_BYTES })(req, res, (err) => {
      if (!err) return next();
      if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That photo is too large — choose a smaller one' });
      return res.status(400).json({ error: 'Could not read that photo' });
    });

  const looksLike = (buf, mime) => (mime === 'image/jpeg'
    ? buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    : buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));

  app.put('/api/children/:id/photo', ...motherOnly, rawImage, withChild(async (req, res, child) => {
    const mime = (req.headers['content-type'] || '').split(';')[0].trim();
    const body = req.body;
    if (!['image/jpeg', 'image/png'].includes(mime) || !Buffer.isBuffer(body) || !body.length) {
      return res.status(415).json({ error: 'Upload a JPEG or PNG photo' });
    }
    if (!looksLike(body, mime)) return res.status(400).json({ error: 'That file doesn’t look like a valid photo' });
    await pool.query(
      `INSERT INTO child_photos (child_id, mime_type, data) VALUES ($1, $2, $3)
       ON CONFLICT (child_id) DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP`,
      [child.id, mime, body]);
    const updated = await findOwnChild(req.user.id, child.id);
    res.json({ has_photo: updated.has_photo, photo_v: updated.photo_v });
  }));

  app.delete('/api/children/:id/photo', ...motherOnly, withChild(async (req, res, child) => {
    await pool.query('DELETE FROM child_photos WHERE child_id = $1', [child.id]);
    res.json({ has_photo: false, photo_v: null });
  }));

  app.get('/api/children/:id/photo', ...motherOnly, withChild(async (req, res, child) => {
    const r = await pool.query('SELECT mime_type, data FROM child_photos WHERE child_id = $1', [child.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No photo' });
    res.setHeader('Content-Type', r.rows[0].mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');   // the client adds ?v=<photo_v>, so a new photo busts this
    res.send(r.rows[0].data);
  }));

  // ==========================================================================
  // Vaccinations
  // ==========================================================================
  app.put('/api/children/:id/vaccinations/:code', ...motherOnly, withChild(async (req, res, child) => {
    const code = req.params.code;
    const vax = Object.prototype.hasOwnProperty.call(Ref.VACCINE_BY_CODE, code) ? Ref.VACCINE_BY_CODE[code] : null;
    if (!vax) return res.status(400).json({ error: 'Unknown vaccine' });
    const givenOn = (req.body || {}).given_on;
    if (!isRealDate(givenOn)) return res.status(400).json({ error: 'Enter the date the dose was given' });
    if (givenOn < child.date_of_birth) return res.status(400).json({ error: 'A dose can’t be given before the child was born' });
    if (!notInFuture(givenOn, await todayISO())) return res.status(400).json({ error: 'The date given can’t be in the future' });
    const b = req.body || {};
    const facility = cleanStr(b.hospital_or_doctor ?? b.facility, 120) || null;

    const r = await pool.query(
      `INSERT INTO child_vaccinations (child_id, vaccine_code, given_on, facility) VALUES ($1, $2, $3, $4)
       ON CONFLICT (child_id, vaccine_code) DO UPDATE SET given_on = EXCLUDED.given_on, facility = EXCLUDED.facility
       RETURNING vaccine_code, to_char(given_on, 'YYYY-MM-DD') AS given_on, facility`,
      [child.id, code, givenOn, facility]);
    const cert = await pool.query('SELECT 1 FROM child_vaccination_certificates WHERE child_id = $1 AND vaccine_code = $2', [child.id, code]);
    const row = r.rows[0];
    res.json({ vaccination: { vaccine_code: row.vaccine_code, given_on: row.given_on, hospital_or_doctor: row.facility, dose_number: vax.dose ?? null, has_certificate: !!cert.rows.length } });
  }));

  app.delete('/api/children/:id/vaccinations/:code', ...motherOnly, withChild(async (req, res, child) => {
    // ON DELETE CASCADE on child_vaccination_certificates takes the certificate with it.
    const r = await pool.query('DELETE FROM child_vaccinations WHERE child_id = $1 AND vaccine_code = $2', [child.id, req.params.code]);
    if (!r.rowCount) return res.status(404).json({ error: 'That dose wasn’t marked as given' });
    res.json({ message: 'Removed' });
  }));

  // ---- Vaccination certificate: the mother's proof-of-vaccination photo/PDF for one dose ----
  const rawCertificate = (req, res, next) =>
    express.raw({ type: CERTIFICATE_TYPES, limit: MAX_CERTIFICATE_BYTES })(req, res, (err) => {
      if (!err) return next();
      if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large — the limit is 5 MB' });
      return res.status(400).json({ error: 'Could not read that file' });
    });

  app.put('/api/children/:id/vaccinations/:code/certificate', ...motherOnly, rawCertificate, withChild(async (req, res, child) => {
    const code = req.params.code;
    const given = await pool.query('SELECT 1 FROM child_vaccinations WHERE child_id = $1 AND vaccine_code = $2', [child.id, code]);
    if (!given.rows.length) return res.status(409).json({ error: 'Mark this dose as given before attaching a certificate' });

    const mime = (req.headers['content-type'] || '').split(';')[0].trim();
    const body = req.body;
    if (!CERTIFICATE_TYPES.includes(mime) || !Buffer.isBuffer(body) || !body.length) {
      return res.status(415).json({ error: 'Upload a JPEG, PNG or PDF file' });
    }
    if (mime === 'image/jpeg' && !(body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) return res.status(400).json({ error: 'That file doesn’t look like a valid photo' });
    if (mime === 'image/png' && !(body.length > 8 && body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))) return res.status(400).json({ error: 'That file doesn’t look like a valid photo' });
    if (mime === 'application/pdf' && !(body.length > 4 && body.slice(0, 5).toString('latin1') === '%PDF-')) return res.status(400).json({ error: 'That file doesn’t look like a valid PDF' });

    const originalName = cleanStr(req.query.filename, 200) || `certificate.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
    await pool.query(
      `INSERT INTO child_vaccination_certificates (child_id, vaccine_code, mime_type, original_name, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (child_id, vaccine_code) DO UPDATE SET mime_type = EXCLUDED.mime_type, original_name = EXCLUDED.original_name,
         size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data, uploaded_at = CURRENT_TIMESTAMP`,
      [child.id, code, mime, originalName, body.length, body]);
    res.json({ has_certificate: true });
  }));

  app.get('/api/children/:id/vaccinations/:code/certificate', ...motherOnly, withChild(async (req, res, child) => {
    const r = await pool.query('SELECT mime_type, original_name, data FROM child_vaccination_certificates WHERE child_id = $1 AND vaccine_code = $2', [child.id, req.params.code]);
    if (!r.rows.length) return res.status(404).json({ error: 'No certificate uploaded' });
    const row = r.rows[0];
    const asciiName = row.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(row.data);
  }));

  app.delete('/api/children/:id/vaccinations/:code/certificate', ...motherOnly, withChild(async (req, res, child) => {
    const r = await pool.query('DELETE FROM child_vaccination_certificates WHERE child_id = $1 AND vaccine_code = $2', [child.id, req.params.code]);
    if (!r.rowCount) return res.status(404).json({ error: 'No certificate to remove' });
    res.json({ has_certificate: false });
  }));

  // ==========================================================================
  // Growth
  // ==========================================================================
  app.post('/api/children/:id/growth', ...motherOnly, withChild(async (req, res, child) => {
    const b = req.body || {};
    if (!isRealDate(b.measured_on)) return res.status(400).json({ error: 'Enter the date measured' });
    if (b.measured_on < child.date_of_birth) return res.status(400).json({ error: 'A measurement can’t be dated before the child was born' });
    if (!notInFuture(b.measured_on, await todayISO())) return res.status(400).json({ error: 'The date measured can’t be in the future' });

    const w = optNum(b.weight_kg, 'Weight', 0.4, 150, 2);
    const h = optNum(b.height_cm, 'Height', 20, 220, 1);
    const hc = optNum(b.head_cm, 'Head circumference', 20, 70, 1);
    const err = w.error || h.error || hc.error;
    if (err) return res.status(400).json({ error: err });
    if (w.value === null && h.value === null && hc.value === null) return res.status(400).json({ error: 'Enter at least a weight, a height or a head size' });

    const r = await pool.query(
      `INSERT INTO child_growth_logs (child_id, measured_on, weight_kg, height_cm, head_cm) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, to_char(measured_on, 'YYYY-MM-DD') AS measured_on, weight_kg::float8 AS weight_kg, height_cm::float8 AS height_cm, head_cm::float8 AS head_cm`,
      [child.id, b.measured_on, w.value, h.value, hc.value]);
    res.status(201).json({ growth: r.rows[0] });
  }));

  app.delete('/api/children/:id/growth/:logId', ...motherOnly, withChild(async (req, res, child) => {
    const logId = parseId(req.params.logId);
    if (!logId) return res.status(400).json({ error: 'Invalid entry' });
    const r = await pool.query('DELETE FROM child_growth_logs WHERE id = $1 AND child_id = $2', [logId, child.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Entry not found' });
    res.json({ message: 'Deleted' });
  }));

  // Before there were child profiles, growth was one shared list on the mother's account. Let her
  // copy it onto a child (skipping anything before the birth or already copied).
  app.post('/api/children/:id/growth/import-legacy', ...motherOnly, withChild(async (req, res, child) => {
    const r = await pool.query(
      `INSERT INTO child_growth_logs (child_id, measured_on, weight_kg, height_cm)
       SELECT $1, g.log_date, g.weight_kg, g.height_cm FROM growth_logs g
        WHERE g.mother_id = $2 AND g.log_date >= $3::date AND g.log_date <= CURRENT_DATE + 1
          AND (g.weight_kg IS NOT NULL OR g.height_cm IS NOT NULL)
          AND (g.weight_kg IS NULL OR g.weight_kg BETWEEN 0.4 AND 150)
          AND (g.height_cm IS NULL OR g.height_cm BETWEEN 20 AND 220)
          AND NOT EXISTS (SELECT 1 FROM child_growth_logs c WHERE c.child_id = $1 AND c.measured_on = g.log_date
                            AND c.weight_kg IS NOT DISTINCT FROM g.weight_kg AND c.height_cm IS NOT DISTINCT FROM g.height_cm)
       RETURNING id`,
      [child.id, req.user.id, child.date_of_birth]);
    const all = await pool.query(`${GROWTH_SELECT} WHERE child_id = $1 ORDER BY measured_on, id`, [child.id]);
    res.json({ imported: r.rowCount, growth: all.rows.map(({ child_id, ...g }) => g) });
  }));

  // ==========================================================================
  // Developmental milestones
  // ==========================================================================
  app.put('/api/children/:id/milestones/:code', ...motherOnly, withChild(async (req, res, child) => {
    const code = req.params.code;
    if (!Object.prototype.hasOwnProperty.call(Ref.MILESTONE_CODES, code)) return res.status(400).json({ error: 'Unknown milestone' });
    const on = (req.body || {}).achieved_on;
    if (!isRealDate(on)) return res.status(400).json({ error: 'Enter a valid date' });
    if (on < child.date_of_birth) return res.status(400).json({ error: 'That date is before the child was born' });
    if (!notInFuture(on, await todayISO())) return res.status(400).json({ error: 'The date can’t be in the future' });
    const r = await pool.query(
      `INSERT INTO child_milestones (child_id, milestone_code, achieved_on) VALUES ($1, $2, $3)
       ON CONFLICT (child_id, milestone_code) DO UPDATE SET achieved_on = EXCLUDED.achieved_on
       RETURNING milestone_code, to_char(achieved_on, 'YYYY-MM-DD') AS achieved_on`, [child.id, code, on]);
    res.json({ milestone: r.rows[0] });
  }));

  app.delete('/api/children/:id/milestones/:code', ...motherOnly, withChild(async (req, res, child) => {
    const r = await pool.query('DELETE FROM child_milestones WHERE child_id = $1 AND milestone_code = $2', [child.id, req.params.code]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not marked' });
    res.json({ message: 'Removed' });
  }));

  // ==========================================================================
  // Doctor: read-only summary of a patient's children. Same rule as the other
  // doctor patient views — the doctor must have an appointment with the mother.
  // No photos and no notes are shared; allergies and blood group are, because
  // they matter clinically.
  // ==========================================================================
  app.get('/api/doctor/patients/:motherId/children', ...doctorOnly, async (req, res) => {
    try {
      const motherId = parseId(req.params.motherId);
      if (!motherId) return res.status(400).json({ error: 'Invalid patient id' });
      const relation = await pool.query('SELECT 1 FROM appointments WHERE doctor_id = $1 AND mother_id = $2 LIMIT 1', [req.user.id, motherId]);
      if (!relation.rows.length) return res.status(403).json({ error: 'You do not have access to this patient' });

      const today = await todayISO();
      const kids = (await pool.query(`${CHILD_SELECT} WHERE c.mother_id = $1 ORDER BY c.date_of_birth DESC, c.id`, [motherId])).rows.map(shapeChild);
      const rec = await loadRecords(kids.map((k) => k.id));

      const children = kids.map((k) => {
        const given = {};
        rec.vax.filter((v) => v.child_id === k.id).forEach((v) => { given[v.vaccine_code] = v.given_on; });
        const sum = Ref.summarizeSchedule(Ref.vaccineSchedule(k.date_of_birth, given, today));
        const growth = rec.growth.filter((g) => g.child_id === k.id);
        const lastWeight = growth.filter((g) => g.weight_kg != null).pop() || null;
        const lastAny = growth[growth.length - 1] || null;

        const flags = [];
        if (sum.missed.length) flags.push({ level: 'amber', text: `${sum.missed.length} vaccine${sum.missed.length === 1 ? '' : 's'} missed` });
        let weightStatus = null;
        if (lastWeight) {
          weightStatus = Ref.weightStatus(k.sex, Ref.chartAgeMonths(k.date_of_birth, lastWeight.measured_on, k.born_at_weeks), lastWeight.weight_kg);
          if (weightStatus === 'severe') flags.push({ level: 'red', text: 'Weight well below the WHO reference (under −3 SD)' });
          else if (weightStatus === 'low') flags.push({ level: 'amber', text: 'Weight below the WHO reference (under −2 SD)' });
        }
        const dayAge = Ref.daysBetween(k.date_of_birth, today);
        const checkpoint = Ref.MILESTONES.filter((c) => c.months * 30.4375 <= dayAge);
        const expected = checkpoint.reduce((n, c) => n + c.items.length, 0);
        const achieved = rec.ms.filter((m) => m.child_id === k.id).length;

        return {
          id: k.id, name: k.name, sex: k.sex, date_of_birth: k.date_of_birth, age_text: Ref.ageText(k.date_of_birth, today),
          born_at_weeks: k.born_at_weeks, birth_weight_kg: k.birth_weight_kg, blood_group: k.blood_group, allergies: k.allergies,
          vaccines: {
            completed: sum.completed, total: sum.total,
            missed: sum.missed.map((v) => ({ code: v.code, name: v.name, stage: v.stage, due_date: v.dueDate })),
            due: sum.due.map((v) => ({ code: v.code, name: v.name, stage: v.stage, due_date: v.dueDate })),
            next: sum.next ? { name: sum.next.name, stage: sum.next.stage, due_date: sum.next.dueDate } : null,
          },
          growth: {
            entries: growth.length,
            latest: lastAny ? { measured_on: lastAny.measured_on, weight_kg: lastAny.weight_kg, height_cm: lastAny.height_cm, head_cm: lastAny.head_cm } : null,
            latest_weight: lastWeight ? { measured_on: lastWeight.measured_on, weight_kg: lastWeight.weight_kg, status: weightStatus } : null,
          },
          milestones: { achieved, expected_by_age: expected },
          flags,
        };
      });
      res.json({ children });
    } catch (e) { fail(res, 'Doctor child summary', e, 'Failed to load the patient’s children'); }
  });
};
