// ============================================================================
// Mother dashboard routes
//
// Registered from server.js. Everything here is mother-only and scoped to the
// authenticated mother's own rows (mother_id = req.user.id). Tables: see
// db/mother_dashboard.sql.
//
// This file deliberately contains ONLY what the existing API lacked. Logging
// meals, water, supplements, contractions (with the 5-1-1 check) and baby growth
// already has routes under /api/wellness in server.js — and the doctor's
// continuity view reads the same tables — so the dashboard writes through those
// routes and these additions are built on the same tables, never beside them.
//
//   GET    /api/profile/pregnancy        LMP anchor, EDD, confirmed?, delivered?
//   PATCH  /api/profile/pregnancy        set LMP or EDD (re-times open milestones)
//   PATCH  /api/profile/contact          phone + emergency contact
//   GET    /api/wellness/history         ?from=&to= multi-day view of the wellness tables
//   DELETE /api/wellness/:kind/:id       nutrition | growth | contractions (own rows)
//   GET    /api/medications              the mother's own medication / supplement names
//   POST   /api/medications
//   DELETE /api/medications/:id          (soft delete; adherence history is kept)
//   GET    /api/health-logs              ?types=a,b&from=&to=&limit=
//   POST   /api/health-logs              {log_type, data, logged_at?}
//   DELETE /api/health-logs/:id
//   GET    /api/reports
//   POST   /api/reports
//   DELETE /api/reports/:id
// ============================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const cleanStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isRealDate = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// ---------------------------------------------------------------------------
// Per-type validators. Each returns { data } (a freshly built object holding
// only the whitelisted keys) or { error }. Client JSON is never stored as-is.
// ---------------------------------------------------------------------------
const GLUCOSE_CONTEXTS = ['fasting', 'after_meal_1h', 'after_meal_2h', 'random'];
const LOG_VALIDATORS = {
  blood_pressure(d) {
    if (!isInt(d.systolic, 60, 260) || !isInt(d.diastolic, 30, 160)) {
      return { error: 'Enter whole-number systolic (60–260) and diastolic (30–160) values' };
    }
    if (d.systolic <= d.diastolic) return { error: 'Systolic must be higher than diastolic' };
    const out = { systolic: d.systolic, diastolic: d.diastolic };
    if (d.pulse != null && d.pulse !== '') {
      if (!isInt(d.pulse, 30, 220)) return { error: 'Pulse must be between 30 and 220' };
      out.pulse = d.pulse;
    }
    return { data: out };
  },
  weight(d) {
    if (!isNum(d.kg, 20, 250)) return { error: 'Weight must be between 20 and 250 kg' };
    return { data: { kg: Math.round(d.kg * 10) / 10 } };
  },
  blood_glucose(d) {
    if (!isNum(d.mg_dl, 20, 600)) return { error: 'Glucose must be between 20 and 600 mg/dL' };
    if (!GLUCOSE_CONTEXTS.includes(d.context)) return { error: 'Choose fasting, 1 hour after a meal, 2 hours after a meal, or random' };
    return { data: { mg_dl: Math.round(d.mg_dl), context: d.context } };
  },
  kick_session(d) {
    if (!isInt(d.kicks, 0, 200)) return { error: 'Kick count must be between 0 and 200' };
    if (!isInt(d.duration_sec, 1, 6 * 60 * 60)) return { error: 'Session length must be between 1 second and 6 hours' };
    return { data: { kicks: d.kicks, duration_sec: d.duration_sec } };
  },
};
const LOG_TYPES = Object.keys(LOG_VALIDATORS);

module.exports = function registerMotherDashboardRoutes(app, { pool, authenticateToken, authorizeRole, MILESTONE_TEMPLATE }) {
  const motherOnly = [authenticateToken, authorizeRole(['mother'])];
  const fail = (res, label, error, msg = 'Something went wrong') => {
    console.error(label + ':', error);
    res.status(500).json({ error: msg });
  };

  // ==========================================================================
  // Pregnancy profile
  // ==========================================================================
  const readPregnancy = async (motherId) => {
    const r = await pool.query(
      `SELECT to_char(mp.care_start_date::date, 'YYYY-MM-DD')        AS care_start_date,
              to_char(mp.care_start_date::date + 280, 'YYYY-MM-DD')  AS edd,
              (mp.pregnancy_confirmed_at IS NOT NULL)                AS confirmed,
              (SELECT cm.completed_at FROM care_milestones cm
                WHERE cm.mother_id = mp.user_id AND cm.stage = 'Delivery' AND cm.category = 'pregnancy'
                ORDER BY cm.sort_order LIMIT 1)                      AS delivered_at
         FROM mother_profiles mp WHERE mp.user_id = $1`,
      [motherId]
    );
    return r.rows[0] || null;
  };

  app.get('/api/profile/pregnancy', ...motherOnly, async (req, res) => {
    try {
      const p = await readPregnancy(req.user.id);
      if (!p) return res.status(404).json({ error: 'Profile not found' });
      res.json({ pregnancy: p });
    } catch (e) { fail(res, 'Read pregnancy', e, 'Failed to load pregnancy details'); }
  });

  // Set the pregnancy anchor from either the last menstrual period or a due
  // date. Milestone due dates are LMP + fixed day offsets (MILESTONE_TEMPLATE),
  // so open milestones are re-based; completed ones are history and untouched.
  app.patch('/api/profile/pregnancy', ...motherOnly, async (req, res) => {
    const { lmp_date, edd_date } = req.body || {};
    if ((lmp_date == null) === (edd_date == null)) {
      return res.status(400).json({ error: 'Provide either lmp_date or edd_date' });
    }
    const input = lmp_date != null ? lmp_date : edd_date;
    if (!isRealDate(input)) return res.status(400).json({ error: 'Enter a valid date (YYYY-MM-DD)' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await readPregnancy(req.user.id);
      if (!current) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Profile not found' }); }
      if (current.delivered_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Delivery is already recorded, so pregnancy dates can no longer be changed' });
      }

      // Derive LMP and gestational age in SQL so "today" and date maths use a
      // single clock and no client/server timezone can shift the result.
      const calc = await client.query(
        `SELECT lmp::text AS lmp, (CURRENT_DATE - lmp) AS gest_days
           FROM (SELECT CASE WHEN $2 = 'edd' THEN $1::date - 280 ELSE $1::date END AS lmp) t`,
        [input, lmp_date != null ? 'lmp' : 'edd']
      );
      const { lmp, gest_days: gestDays } = calc.rows[0];
      if (gestDays < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: lmp_date != null
          ? 'Your last period cannot be in the future'
          : 'That due date is more than 40 weeks away' });
      }
      if (gestDays > 294) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'That date is more than 42 weeks ago — please check it' });
      }

      await client.query(
        'UPDATE mother_profiles SET care_start_date = $2::date, pregnancy_confirmed_at = CURRENT_TIMESTAMP WHERE user_id = $1',
        [req.user.id, lmp]
      );
      await client.query(
        `UPDATE care_milestones cm
            SET due_date = $2::date + t.days
           FROM unnest($3::int[], $4::int[]) AS t(sort_order, days)
          WHERE cm.mother_id = $1 AND cm.completed_at IS NULL AND cm.sort_order = t.sort_order`,
        [req.user.id, lmp, MILESTONE_TEMPLATE.map((_, i) => i), MILESTONE_TEMPLATE.map((m) => m.days)]
      );

      await client.query('COMMIT');
      res.json({ message: 'Pregnancy dates saved', pregnancy: await readPregnancy(req.user.id) });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      fail(res, 'Update pregnancy', e, 'Failed to save pregnancy dates');
    } finally {
      client.release();
    }
  });

  // Phone + emergency contact (used by the SOS panel's "Call emergency contact").
  app.patch('/api/profile/contact', ...motherOnly, async (req, res) => {
    const PHONE_RE = /^[+\d][\d\s\-()]{5,19}$/;   // <= 20 chars: mother_profiles phone columns are VARCHAR(20)
    const body = req.body || {};
    const sets = [];
    const vals = [req.user.id];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    for (const [field, max] of [['phone', 20], ['emergency_contact_phone', 20], ['emergency_contact_name', 255]]) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && typeof body[field] !== 'string') return res.status(400).json({ error: `Invalid ${field}` });
      const v = body[field] === null ? '' : body[field].trim();
      if (v.length > max) return res.status(400).json({ error: `${field} is too long` });
      if (field.endsWith('phone') && v && !PHONE_RE.test(v)) return res.status(400).json({ error: 'Enter a valid phone number' });
      add(field, v || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    try {
      const r = await pool.query(
        `UPDATE mother_profiles SET ${sets.join(', ')} WHERE user_id = $1
         RETURNING phone, emergency_contact_name, emergency_contact_phone`,
        vals
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Profile not found' });
      res.json({ message: 'Contact details saved', contact: r.rows[0] });
    } catch (e) { fail(res, 'Update contact', e, 'Failed to save contact details'); }
  });

  // ==========================================================================
  // Wellness: multi-day history + deletes, on top of the existing wellness tables
  // (GET /api/wellness only returns a single day; there was no way to see last
  // week's hydration or supplement adherence, or to remove a mistaken entry).
  // ==========================================================================
  app.get('/api/wellness/history', ...motherOnly, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!isRealDate(from) || !isRealDate(to) || from > to) {
        return res.status(400).json({ error: 'Valid from/to dates (YYYY-MM-DD, from <= to) are required' });
      }
      if ((new Date(to) - new Date(from)) / DAY_MS > 92) {
        return res.status(400).json({ error: 'Date range too large (max 92 days)' });
      }
      const id = req.user.id;
      const [water, supplements, nutrition, contractions, growth] = await Promise.all([
        pool.query(`SELECT to_char(log_date, 'YYYY-MM-DD') AS log_date, glasses FROM water_logs
                     WHERE mother_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date`, [id, from, to]),
        pool.query(`SELECT to_char(log_date, 'YYYY-MM-DD') AS log_date, supplement, taken FROM supplement_logs
                     WHERE mother_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date`, [id, from, to]),
        pool.query(`SELECT id, to_char(log_date, 'YYYY-MM-DD') AS log_date, text, logged_at FROM nutrition_logs
                     WHERE mother_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY logged_at`, [id, from, to]),
        pool.query(`SELECT id, to_char(log_date, 'YYYY-MM-DD') AS log_date,
                            -- started_at is a TIMESTAMP (no zone) that always holds the UTC clock time the client
                            -- sent; say so explicitly so it is read back as the same instant on any server timezone.
                            (started_at AT TIME ZONE 'UTC') AS started_at, duration_ms, gap_ms FROM contraction_logs
                     WHERE mother_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY started_at`, [id, from, to]),
        // Baby growth is a lifetime record (it never "resets"), so it is not date-windowed.
        pool.query(`SELECT id, to_char(log_date, 'YYYY-MM-DD') AS log_date, weight_kg::float8 AS weight_kg, height_cm::float8 AS height_cm FROM growth_logs
                     WHERE mother_id = $1 ORDER BY log_date, id`, [id]),
      ]);
      res.json({ water: water.rows, supplements: supplements.rows, nutrition: nutrition.rows, contractions: contractions.rows, growth: growth.rows });
    } catch (e) { fail(res, 'Wellness history', e, 'Failed to load wellness history'); }
  });

  // Table names come from this fixed map, never from user input.
  const WELLNESS_DELETABLE = { nutrition: 'nutrition_logs', growth: 'growth_logs', contractions: 'contraction_logs' };
  app.delete('/api/wellness/:kind/:id', ...motherOnly, async (req, res) => {
    try {
      const table = WELLNESS_DELETABLE[req.params.kind];
      const id = parseInt(req.params.id, 10);
      if (!table || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid entry' });
      const r = await pool.query(`DELETE FROM ${table} WHERE id = $1 AND mother_id = $2 RETURNING id`, [id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Entry not found' });
      res.json({ message: 'Entry deleted' });
    } catch (e) { fail(res, 'Delete wellness entry', e, 'Failed to delete entry'); }
  });

  // ==========================================================================
  // Medication / supplement list. Only the *names* live here; "taken today" is
  // recorded through the existing PUT /api/wellness/supplements (keyed by this
  // name), so a doctor's adherence figure keeps counting them.
  // ==========================================================================
  app.get('/api/medications', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name, dose, schedule, prescribed_by FROM medications WHERE mother_id = $1 AND active ORDER BY created_at, id',
        [req.user.id]
      );
      res.json({ medications: r.rows });
    } catch (e) { fail(res, 'Fetch medications', e, 'Failed to load medications'); }
  });

  app.post('/api/medications', ...motherOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const name = cleanStr(b.name, 50);          // supplement_logs.supplement is VARCHAR(50)
      if (!name) return res.status(400).json({ error: 'Medication name is required' });

      const existing = await pool.query(
        'SELECT COUNT(*)::int AS n, BOOL_OR(LOWER(name) = LOWER($2)) AS dup FROM medications WHERE mother_id = $1 AND active',
        [req.user.id, name]
      );
      if (existing.rows[0].dup) return res.status(400).json({ error: 'You are already tracking that medication' });
      if (existing.rows[0].n >= 30) return res.status(400).json({ error: 'You can track up to 30 medications' });

      const r = await pool.query(
        `INSERT INTO medications (mother_id, name, dose, schedule, prescribed_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, dose, schedule, prescribed_by`,
        [req.user.id, name, cleanStr(b.dose, 80) || null, cleanStr(b.schedule, 80) || null, cleanStr(b.prescribed_by, 120) || null]
      );
      res.status(201).json({ message: 'Medication added', medication: r.rows[0] });
    } catch (e) { fail(res, 'Add medication', e, 'Failed to add medication'); }
  });

  app.delete('/api/medications/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query(
        'UPDATE medications SET active = FALSE WHERE id = $1 AND mother_id = $2 AND active RETURNING id',
        [id, req.user.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Medication not found' });
      res.json({ message: 'Medication removed' });
    } catch (e) { fail(res, 'Remove medication', e, 'Failed to remove medication'); }
  });

  // ==========================================================================
  // Health logs (blood pressure, weight, blood glucose, kick sessions)
  // ==========================================================================
  app.get('/api/health-logs', ...motherOnly, async (req, res) => {
    try {
      const types = req.query.types ? String(req.query.types).split(',') : LOG_TYPES;
      if (!types.every((t) => LOG_TYPES.includes(t))) return res.status(400).json({ error: 'Unknown log type' });

      const vals = [req.user.id, types];
      let where = 'mother_id = $1 AND log_type = ANY($2)';
      for (const [key, op] of [['from', '>='], ['to', '<']]) {
        if (req.query[key] === undefined) continue;
        const d = new Date(String(req.query[key]));
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `Invalid "${key}" date` });
        vals.push(d.toISOString());
        where += ` AND logged_at ${op} $${vals.length}`;
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
      vals.push(limit);

      const r = await pool.query(
        `SELECT id, log_type, data, logged_at FROM health_logs
          WHERE ${where} ORDER BY logged_at DESC, id DESC LIMIT $${vals.length}`,
        vals
      );
      res.json({ logs: r.rows });
    } catch (e) { fail(res, 'Fetch health logs', e, 'Failed to load health logs'); }
  });

  app.post('/api/health-logs', ...motherOnly, async (req, res) => {
    try {
      const { log_type, data, logged_at } = req.body || {};
      const validate = LOG_VALIDATORS[log_type];
      if (!validate) return res.status(400).json({ error: 'Unknown log type' });
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Missing log data' });

      const result = validate(data);
      if (result.error) return res.status(400).json({ error: result.error });

      let when = new Date();
      if (logged_at !== undefined) {
        when = new Date(logged_at);
        if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date' });
        if (when.getTime() > Date.now() + 5 * 60 * 1000) return res.status(400).json({ error: 'That time is in the future' });
        if (when.getTime() < Date.now() - 3 * 365 * DAY_MS) return res.status(400).json({ error: 'That date is too far in the past' });
      }

      const r = await pool.query(
        `INSERT INTO health_logs (mother_id, log_type, data, logged_at)
         VALUES ($1, $2, $3, $4) RETURNING id, log_type, data, logged_at`,
        [req.user.id, log_type, JSON.stringify(result.data), when.toISOString()]
      );
      res.status(201).json({ message: 'Logged', log: r.rows[0] });
    } catch (e) { fail(res, 'Create health log', e, 'Failed to save entry'); }
  });

  app.delete('/api/health-logs/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query('DELETE FROM health_logs WHERE id = $1 AND mother_id = $2 RETURNING id', [id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Entry not found' });
      res.json({ message: 'Entry deleted' });
    } catch (e) { fail(res, 'Delete health log', e, 'Failed to delete entry'); }
  });

  // ==========================================================================
  // Test / scan reports
  // ==========================================================================
  app.get('/api/reports', ...motherOnly, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, title, to_char(report_date, 'YYYY-MM-DD') AS report_date, lab_name, result_summary, milestone_id
           FROM health_reports WHERE mother_id = $1 ORDER BY report_date DESC, id DESC`,
        [req.user.id]
      );
      res.json({ reports: r.rows });
    } catch (e) { fail(res, 'Fetch reports', e, 'Failed to load reports'); }
  });

  app.post('/api/reports', ...motherOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const title = cleanStr(b.title, 160);
      if (!title) return res.status(400).json({ error: 'Report title is required' });
      if (!isRealDate(b.report_date)) return res.status(400).json({ error: 'Enter a valid report date' });

      let milestoneId = null;
      if (b.milestone_id != null) {
        if (!Number.isInteger(b.milestone_id)) return res.status(400).json({ error: 'Invalid milestone' });
        const own = await pool.query('SELECT 1 FROM care_milestones WHERE id = $1 AND mother_id = $2', [b.milestone_id, req.user.id]);
        if (!own.rows.length) return res.status(400).json({ error: 'Milestone not found' });
        milestoneId = b.milestone_id;
      }

      const r = await pool.query(
        `INSERT INTO health_reports (mother_id, title, report_date, lab_name, result_summary, milestone_id)
         SELECT $1, $2, $3::date, $4, $5, $6
          WHERE $3::date BETWEEN CURRENT_DATE - 1826 AND CURRENT_DATE + 1
         RETURNING id, title, to_char(report_date, 'YYYY-MM-DD') AS report_date, lab_name, result_summary, milestone_id`,
        [req.user.id, title, b.report_date, cleanStr(b.lab_name, 160) || null, cleanStr(b.result_summary, 2000) || null, milestoneId]
      );
      if (!r.rows.length) return res.status(400).json({ error: 'Report date must be within the last 5 years and not in the future' });
      res.status(201).json({ message: 'Report saved', report: r.rows[0] });
    } catch (e) { fail(res, 'Create report', e, 'Failed to save report'); }
  });

  app.delete('/api/reports/:id', ...motherOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query('DELETE FROM health_reports WHERE id = $1 AND mother_id = $2 RETURNING id', [id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
      res.json({ message: 'Report deleted' });
    } catch (e) { fail(res, 'Delete report', e, 'Failed to delete report'); }
  });
};
