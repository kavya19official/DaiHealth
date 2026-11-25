'use strict';
// Phase 2 clinical intelligence engine. Deterministic rules only: every insight is computed from
// recorded measurements, investigations, visits and scans. Nothing here diagnoses or invents data.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { verifiedDoctor } = require('./clinicalDashboard');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'clinicalRules.json'), 'utf8'));
const ACTION_STATUSES = ['open','completed','deferred','not_applicable','follow_up'];
const FLAG_ACTIONS = { acknowledge: 'acknowledged', under_review: 'under_review', monitoring: 'monitoring', resolve: 'resolved', reopen: 'new' };
const asDate = v => v == null || v === '' ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fmt = (v, u) => v == null ? '—' : `${Number(v.toFixed ? v.toFixed(2) : v)}${u ? ' ' + u : ''}`;
const q = (pool, sql, params = []) => pool.query(sql, params).then(r => r.rows);
const one = (pool, sql, params = []) => q(pool, sql, params).then(r => r[0] || null);

function gestationFor(mother, visits, onDate) {
  const base = asDate(onDate) || new Date().toISOString().slice(0, 10);
  let best = null;
  for (const v of visits) {
    const visitDate = asDate(v.visit_date || v.date);
    const weeks = num(v.gestational_weeks ?? v.gestational_week ?? v.ga_weeks);
    if (!visitDate || weeks == null || visitDate > base || (v.status && !['completed','confirmed'].includes(v.status))) continue;
    const days = daysBetween(visitDate, base) + Math.round(num(v.gestational_days) ?? 0);
    const c = { weeks: weeks + Math.floor(days / 7), days: (weeks * 7 + days) % 7, visit_date: visitDate };
    if (!best || visitDate > best.visit_date) best = c;
  }
  if (best) return best;
  const eppc = asDate(mother.edd_date || mother.estimated_delivery_date);
  if (eppc) { const w = Math.max(0, Math.min(45, (280 - daysBetween(base, eppc)) / 7)); return { weeks: Math.round(w * 10) / 10, days: 0, source: 'edd' }; }
  return null;
}

async function parameterSeries(pool, motherId) {
  const entries = await q(pool, `SELECT id, source_kind, COALESCE(observed_at::date, recorded_on::date) recorded_on, values_json
    FROM clinical_dashboard_entries WHERE mother_id=$1 AND measurement_status IN ('recorded','pending_review') ORDER BY recorded_on`, [motherId]);
  const series = {};
  const push = (p, pt) => { (series[p] ||= []).push(pt); };
  for (const e of entries) {
    let values; try { values = JSON.parse(e.values_json || '{}'); } catch { continue; }
    for (const [param, cfg] of Object.entries(RULES.parameters)) {
      for (const field of cfg.fields || []) {
        const v = num(values[field]);
        if (v != null) { push(param, { value: v, on: asDate(e.recorded_on), kind: e.source_kind, id: e.id }); break; }
      }
    }
    if (num(values.bp_systolic) != null && num(values.bp_diastolic) != null)
      push('bp_pair', { systolic: num(values.bp_systolic), diastolic: num(values.bp_diastolic), on: asDate(e.recorded_on), id: e.id });
  }
  const labs = await q(pool, `SELECT id, test_code, test_name, value_numeric::float value_numeric, value_text, unit,
      COALESCE(resulted_on, collected_on)::date observed_on, review_status, status
    FROM clinical_investigations WHERE mother_id=$1 AND status IN ('recorded','pending_review') ORDER BY observed_on`, [motherId]);
  for (const i of labs) {
    const v = i.value_numeric != null ? num(i.value_numeric) : num(i.value_text);
    if (v == null) continue;
    push('lab:' + i.test_code, { value: v, on: asDate(i.observed_on), kind: 'lab', id: i.id, unit: i.unit, review_state: i.review_status });
  }
  for (const s of Object.values(series)) s.sort((a, b) => String(a.on).localeCompare(String(b.on)));
  return series;
}

function bandFor(cfg, gestation) {
  if (!cfg?.gestation_bands) return null;
  const weeks = gestation?.weeks ?? null;
  for (const band of cfg.gestation_bands) if (band.max_week == null || (weeks != null && weeks <= band.max_week)) return band;
  return cfg.gestation_bands[cfg.gestation_bands.length - 1];
}

function comparisons(series, gestation) {
  const out = [];
  for (const [param, points] of Object.entries(series)) {
    if (param === 'bp_pair' || param.startsWith('lab:')) {
      if (param.startsWith('lab:')) { /* labs compared below */ }
    }
    const valid = points.filter(p => p.value != null && p.on);
    if (valid.length < 2) continue;
    const prev = valid[valid.length - 2], cur = valid[valid.length - 1];
    const cfg = RULES.parameters[param] || RULES.investigations[param.replace(/^lab:/, '')];
    const unit = cfg?.unit || cur.unit || '';
    const band = cfg?.gestation_bands ? bandFor(cfg, gestation) : cfg;
    const delta = +(cur.value - prev.value).toFixed(3);
    let observation = 'Stable';
    if (band && band.low != null && band.high != null) {
      const curOut = cur.value < band.low || cur.value > band.high, prevOut = prev.value < band.low || prev.value > band.high;
      if (curOut && !prevOut) observation = 'Now outside reference range';
      else if (curOut && prevOut) observation = 'Still outside reference range';
      else if (!curOut && prevOut) observation = 'Returned inside reference range';
    }
    if (delta !== 0) {
      const dir = delta > 0 ? 'Increased' : 'Decreased';
      observation = observation === 'Stable' ? dir : `${observation}; ${dir.toLowerCase()} by ${fmt(Math.abs(delta), unit)}`;
    }
    out.push({ parameter: param, label: cfg?.label || param, previous: prev.value, current: cur.value, unit,
      previous_on: prev.on, current_on: cur.on, delta, observation,
      reference_low: band?.low ?? null, reference_high: band?.high ?? null,
      record_ids: [prev.id, cur.id].filter(Boolean) });
  }
  return out.sort((a, b) => String(b.current_on).localeCompare(String(a.current_on)));
}

function detectFlags(series, cmps, gestation, visits, gaps, ultrasoundPending, pregnancyActive = true) {
  const candidates = [];
  const add = c => candidates.push(c);
  const gest = gestation ? `${gestation.weeks}w${gestation.days}d` : 'gestation not recorded';
  for (const cmp of cmps) {
    const cfg = RULES.parameters[cmp.parameter] || RULES.investigations[cmp.parameter.replace(/^lab:/, '')];
    if (!cfg) continue;
    const cur = cmp.current, bandLow = cmp.reference_low, bandHigh = cmp.reference_high;
    if (bandLow != null && bandHigh != null && (cur < bandLow || cur > bandHigh)) {
      const severe = cfg.severe_high != null && cur >= cfg.severe_high;
      add({ category: 'abnormal_measurement', parameter: cmp.parameter, severity: severe ? 'urgent' : 'review',
        fingerprint: `abn:${cmp.parameter}:${cmp.current_on}:${cur}`,
        title: `${cmp.label} ${cur} ${cmp.unit} outside reference range`,
        current_value: cur, previous_value: cmp.previous, unit: cmp.unit, current_on: cmp.current_on, previous_on: cmp.previous_on,
        reference_low: bandLow, reference_high: bandHigh,
        reason: `Latest recorded ${cmp.label.toLowerCase()} is outside the configured ${gest} reference band (${bandLow}–${bandHigh} ${cmp.unit}). A single measurement requires clinical correlation; this is not a diagnosis.`,
        record_ids: cmp.record_ids });
    }
    const deltaReview = cfg.delta_review ?? (cmp.parameter === 'bp_systolic' ? 20 : cmp.parameter === 'bp_diastolic' ? 15 : cmp.parameter === 'weight_kg' ? 1.0 : null);
    if (deltaReview != null && Math.abs(cmp.delta) >= deltaReview) {
      add({ category: 'significant_change', parameter: cmp.parameter, severity: 'review',
        fingerprint: `chg:${cmp.parameter}:${cmp.current_on}:${cur}`,
        title: `${cmp.label} changed ${cmp.delta > 0 ? '+' : ''}${cmp.delta} ${cmp.unit} since ${cmp.previous_on}`,
        current_value: cur, previous_value: cmp.previous, unit: cmp.unit, current_on: cmp.current_on, previous_on: cmp.previous_on,
        reference_low: bandLow, reference_high: bandHigh,
        reason: `Change of ${fmt(Math.abs(cmp.delta), cmp.unit)} between ${cmp.previous_on} and ${cmp.current_on} meets the configured review threshold (${deltaReview} ${cmp.unit}).`,
        record_ids: cmp.record_ids });
    }
  }
  for (const [param, pts] of Object.entries(series)) {
    const cfg = RULES.parameters[param];
    if (!cfg || param === 'bp_pair' || param.startsWith('lab:')) continue;
    const valid = pts.filter(p => p.value != null && p.on).slice(-4);
    if (valid.length < RULES.trends.min_points) continue;
    const first = valid[0], last = valid[valid.length - 1];
    const delta = last.value - first.value;
    const decline = RULES.trends.decline_review[param], rise = RULES.trends.rise_review[param];
    if (!((decline != null && delta <= decline) || (rise != null && delta >= rise))) continue;
    const direction = delta < 0 ? 'declining' : 'rising';
    add({ category: 'deteriorating_trend', parameter: param, severity: 'review',
      fingerprint: `trend:${param}:${last.on}:${last.value}`,
      title: `${cfg.label} ${direction} trend across ${valid.length} measurements`,
      current_value: last.value, previous_value: first.value, unit: cfg.unit || '', current_on: last.on, previous_on: first.on,
      reason: `Across ${valid.length} recorded measurements (${first.on} → ${last.on}) the value moved ${fmt(Math.abs(delta), cfg.unit)} ${direction}, meeting the configured trend threshold.`,
      record_ids: valid.map(p => p.id).filter(Boolean) });
  }
  if (pregnancyActive && gestation && visits.length) {
    const lastVisit = visits.map(v => asDate(v.visit_date || v.date)).filter(Boolean).sort().pop();
    const days = lastVisit ? daysBetween(lastVisit, new Date().toISOString().slice(0, 10)) : null;
    if (days == null || days > 28) add({ category: 'missing_information', parameter: 'anc_visit', severity: 'info',
      fingerprint: `miss:anc:${lastVisit || 'never'}`,
      title: 'No recorded ANC visit in the last 28 days', current_on: null,
      reason: lastVisit ? `Last recorded ANC visit was ${lastVisit} (${days} days ago).` : 'No ANC visit is recorded.',
      record_ids: visits.slice(-3).map(v => v.id).filter(Boolean) });
  }
  for (const g of gaps || []) {
    if (g.status === 'overdue') add({ category: 'overdue_investigation', parameter: g.key, severity: 'review',
      fingerprint: `gap:${g.key}:overdue`, title: `Overdue: ${g.label}`, current_on: null,
      reason: `Gestational age is ${gestation ? gestation.weeks + 'w' + gestation.days + 'd' : 'unknown'}; expected by week ${g.by_week} with no recorded completion.`, record_ids: [] });
    else if (g.status === 'pending' && g.by_week != null && gestation && gestation.weeks >= g.by_week)
      add({ category: 'overdue_investigation', parameter: g.key, severity: 'info',
        fingerprint: `gap:${g.key}:pending`, title: `Pending: ${g.label}`, current_on: null,
        reason: `Expected by week ${g.by_week}; not yet recorded as completed. Missing data is not treated as a normal result.`, record_ids: [] });
  }
  for (const u of ultrasoundPending || []) add({ category: 'pending_ultrasound_review', parameter: 'ultrasound', severity: 'review',
    fingerprint: `us:${u.id}`, title: `Ultrasound ${u.scan_type || 'scan'} awaiting clinician review`, current_on: asDate(u.scan_date),
    reason: `Scan ${u.id} (${u.scan_type || 'ultrasound'}) analysis status "${u.analysis_status}" has no clinician review recorded. AI output is advisory.`,
    record_ids: [u.id] });
  return candidates;
}

function careGaps(gestation, investigations, ultrasoundScans, pregnancyActive = true) {
  const doneCodes = new Set(investigations.map(i => i.test_code));
  const weeks = gestation?.weeks ?? null;
  return RULES.careGaps.map(g => {
    const matchedTests = (g.test_codes || []).filter(c => doneCodes.has(c));
    const matchedScan = (ultrasoundScans || []).some(s => g.ultrasound_type && String(s.scan_type || '').includes(g.ultrasound_type));
    const done = matchedTests.length > 0 || matchedScan;
    const byWeek = g.by_week ?? g.required_by_week;
    const status = !pregnancyActive ? 'not_applicable' : done ? 'completed' : (weeks == null ? 'pending' : weeks > byWeek ? 'overdue' : 'pending');
    return { key: g.key, label: g.label, status, by_week: byWeek, completed_via: matchedTests[0] || (matchedScan ? 'ultrasound' : null), gestation_weeks: weeks };
  });
}

function buildSummary(mother, gestation, cmps, flags, gaps, scans, investigations) {
  const statements = [];
  statements.push({ kind: 'fact', text: `Patient ${mother.full_name || 'record ' + motherId} — ${mother.pregnancy_status || 'pregnancy'} record.`, source: 'profile' });
  if (gestation) statements.push({ kind: 'calculated', text: `Estimated gestation ${gestation.weeks} weeks + ${gestation.days} days${gestation.source === 'edd' ? ' (from EDD)' : ' (from last recorded ANC visit)'}.`, source: 'anc_visits' });
  else statements.push({ kind: 'missing', text: 'Gestational age cannot be estimated — no ANC visit or EDD recorded.', source: 'anc_visits' });
  for (const c of cmps.filter(c => c.observation !== 'Stable').slice(0, 3))
    statements.push({ kind: 'calculated', text: `${c.label}: ${fmt(c.previous, c.unit)} on ${c.previous_on} → ${fmt(c.current, c.unit)} on ${c.current_on} (${c.observation}).`, source: 'clinical_dashboard_entries' });
  const openFlags = flags.filter(f => ['new','under_review','monitoring'].includes(f.status));
  statements.push({ kind: 'automated', text: openFlags.length ? `${openFlags.length} active flag${openFlags.length > 1 ? 's' : ''}: ${openFlags.slice(0, 3).map(f => f.title).join('; ')}${openFlags.length > 3 ? '…' : ''}.` : 'No active clinical flags — absence of flags is not a guarantee of safety.', source: 'clinical_flags' });
  const overdue = gaps.filter(g => g.status === 'overdue');
  if (overdue.length) statements.push({ kind: 'automated', text: `Overdue care activities: ${overdue.map(g => g.label).join(', ')}.`, source: 'care_gaps' });
  for (const s of (scans || []).filter(s => s.analysis_status && s.analysis_status !== 'reviewed' && !s.reviewed_at).slice(0, 2))
    statements.push({ kind: 'automated', text: `Ultrasound ${s.scan_type || 'scan'} (${s.scan_date}) awaits clinician review; AI analysis is advisory.`, source: 'ultrasound_scans' });
  const latestLab = investigations.filter(i => i.value_numeric != null || i.value_text != null).slice(-1)[0];
  if (latestLab) statements.push({ kind: 'fact', text: `Latest investigation: ${latestLab.test_name || latestLab.test_code} ${latestLab.value_numeric ?? latestLab.value_text ?? ''} ${latestLab.unit || ''} on ${asDate(latestLab.resulted_on || latestLab.collected_on)}.`, source: 'clinical_investigations' });
  return statements;
}

function buildTrends(series, gestation) {
  const out = [];
  for (const [param, pts] of Object.entries(series)) {
    if (param === 'bp_pair' || param.startsWith('lab:')) continue;
    const valid = pts.filter(p => p.value != null && p.on);
    if (valid.length < 2) continue;
    const cfg = RULES.parameters[param] || RULES.investigations[param.replace(/^lab:/, '')];
    out.push({ parameter: param, label: cfg?.label || param, unit: cfg?.unit || valid[0].unit || '',
      points: valid.map(p => ({ on: p.on, value: p.value, gestation_weeks: gestation?.weeks ?? null, record_id: p.id })) });
  }
  return out;
}

async function upsertFlags(pool, motherId, doctorId, candidates) {
  for (const c of candidates) {
    await pool.query(`INSERT INTO clinical_flags(mother_id,doctor_id,fingerprint,category,parameter,title,current_value,previous_value,unit,current_on,previous_on,reference_low,reference_high,reason,record_ids,severity)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
      ON CONFLICT(mother_id,fingerprint) DO UPDATE SET last_seen_at=NOW(), doctor_id=EXCLUDED.doctor_id,
        status=CASE WHEN clinical_flags.status='resolved' THEN 'monitoring' ELSE clinical_flags.status END,
        resolved_at=CASE WHEN clinical_flags.status='resolved' THEN NULL ELSE clinical_flags.resolved_at END,
        resolution_note=CASE WHEN clinical_flags.status='resolved' THEN NULL ELSE clinical_flags.resolution_note END`,
      [motherId, doctorId, c.fingerprint, c.category, c.parameter, c.title, c.current_value ?? null, c.previous_value ?? null,
       c.unit ?? null, c.current_on ?? null, c.previous_on ?? null, c.reference_low ?? null, c.reference_high ?? null,
       c.reason, JSON.stringify(c.record_ids || []), c.severity || 'review']);
  }
}

async function syncActions(pool, motherId, doctorId, flags, gaps, ultrasoundPending) {
  const actions = [];
  for (const f of flags.filter(f => ['new','under_review','monitoring'].includes(f.status)))
    actions.push({ key: `flag:${f.id}`, title: `Review flag: ${f.title}`, detail: f.reason, source: 'flag', ids: f.record_ids });
  for (const g of gaps.filter(g => g.status === 'overdue'))
    actions.push({ key: `gap:${g.key}`, title: `Arrange ${g.label}`, detail: `Overdue since week ${g.by_week}; gestation ${g.gestation_weeks ?? '?'}w.`, source: 'care_gap', ids: [] });
  for (const u of ultrasoundPending || [])
    actions.push({ key: `us:${u.id}`, title: `Review ultrasound ${u.scan_type || ''} (${u.scan_date})`, detail: 'AI analysis is advisory; clinician review required before release.', source: 'ultrasound', ids: [u.id] });
  for (const a of actions)
    await pool.query(`INSERT INTO clinical_actions(mother_id,doctor_id,action_key,title,detail,source,record_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(mother_id,action_key) DO UPDATE SET title=EXCLUDED.title, detail=EXCLUDED.detail, record_ids=EXCLUDED.record_ids, updated_at=NOW()`,
      [motherId, doctorId, a.key, a.title, a.detail, a.source, JSON.stringify(a.ids)]);
  if (actions.length)
    await pool.query(`UPDATE clinical_actions SET status='not_applicable', status_note='No longer suggested by current data.', updated_at=NOW()
      WHERE mother_id=$1 AND status='open' AND action_key <> ALL($2::text[])`, [motherId, actions.map(a => a.key)]);
  else
    await pool.query(`UPDATE clinical_actions SET status='not_applicable', status_note='No longer suggested by current data.', updated_at=NOW() WHERE mother_id=$1 AND status='open'`, [motherId]);
  return q(pool, `SELECT * FROM clinical_actions WHERE mother_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'follow_up' THEN 1 ELSE 2 END, updated_at DESC`, [motherId]);
}

async function assemble(pool, motherId, doctorId, opts = {}) {
  const mother = await one(pool, 'SELECT * FROM mother_profiles WHERE user_id=$1', [motherId]);
  if (!mother) return null;
  const visits = await q(pool, `SELECT v.*, a.id appointment_id FROM anc_visits v LEFT JOIN appointments a ON a.id=v.appointment_id WHERE v.mother_id=$1 ORDER BY v.visit_date`, [motherId]);
  const investigations = await q(pool, "SELECT * FROM clinical_investigations WHERE mother_id=$1 AND status IN ('recorded','pending_review','awaiting_result') ORDER BY COALESCE(resulted_on, collected_on)", [motherId]);
  const series = await parameterSeries(pool, motherId);
  const pregnancyActive = !['delivered','postpartum','post_partum'].includes(String(mother.pregnancy_status || '').toLowerCase());
  const gestation = pregnancyActive ? gestationFor(mother, visits) : null;
  const cmps = comparisons(series, gestation);
  const scans = opts.ultrasoundScans || [];
  const gaps = careGaps(gestation, investigations, scans, pregnancyActive);
  const candidates = detectFlags(series, cmps, gestation, visits, gaps, scans, pregnancyActive);
  await upsertFlags(pool, motherId, doctorId, candidates);
  const flags = await q(pool, `SELECT * FROM clinical_flags WHERE mother_id=$1 AND status <> 'resolved'
    ORDER BY CASE severity WHEN 'urgent' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, last_seen_at DESC`, [motherId]);
  const actions = await syncActions(pool, motherId, doctorId, flags, gaps, scans);
  const summary = buildSummary(mother, gestation, cmps, flags, gaps, scans, investigations);
  return { mother_id: motherId, generated_at: new Date().toISOString(), gestation, summary, comparisons: cmps,
    flags, care_gaps: gaps, actions, trends: buildTrends(series, gestation),
    limitations: ['Deterministic rules only — no diagnosis is made.', 'Missing measurements are gaps, never normal results.', 'AI ultrasound output is advisory pending clinician review.'] };
}

function portalScans(motherId) {
  const file = process.env.DAI_PORTAL_DB || path.join(__dirname, '../hospital_portal/data/app.db');
  if (!fs.existsSync(file)) return [];
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare(`SELECT s.id, s.scan_type, s.scan_date, s.analysis_status, s.reviewed_at FROM ultrasound_scans s WHERE s.mother_id=? ORDER BY s.scan_date DESC`).all(motherId);
    db.close();
    return rows;
  } catch { return []; }
}

module.exports = function (app, { pool, authenticateToken, authorizeRole }) {
  // Idempotent schema ensure: local PGlite has no migration runner, production uses seed-local.cjs.
  const schemaReady = pool.query(fs.readFileSync(path.join(__dirname, 'db/clinical_intelligence.sql'), 'utf8')).catch(() => {});
  const authenticate = (req, res, next) => authenticateToken(req, res, async () => {
    const user = req.user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctor access required.' });
    if (!await verifiedDoctor(pool, user.id)) return res.status(403).json({ error: 'Verified doctor profile required.' });
    next();
  });
  const access = async (req, motherId) => {
    const rows = await q(pool, 'SELECT mother_id FROM appointments WHERE doctor_id=$1', [req.user.id]);
    const shared = await q(pool, `SELECT mother_id FROM clinical_dashboard_consent WHERE doctor_id=$1 AND revoked_at IS NULL AND expires_at>NOW()`, [req.user.id]);
    return rows.some(r => Number(r.mother_id) === Number(motherId)) || shared.some(r => Number(r.mother_id) === Number(motherId));
  };
  app.get('/api/doctor/patients/:id/intelligence', authenticate, async (req, res) => {
    try {
      await schemaReady;
      const motherId = Number(req.params.id);
      if (!await access(req, motherId)) return res.status(403).json({ error: 'This patient is not available in your care records.' });
      const result = await assemble(pool, motherId, req.user.id, { ultrasoundScans: portalScans(motherId) });
      if (!result) return res.status(404).json({ error: 'Patient record not found.' });
      res.json(result);
    } catch (e) { console.error('intelligence:', e.message); res.status(500).json({ error: 'Clinical intelligence unavailable.' }); }
  });
  app.post('/api/doctor/patients/:id/flags/:flagId', authenticate, async (req, res) => {
    try {
      await schemaReady;
      const motherId = Number(req.params.id), flagId = Number(req.params.flagId);
      const action = String(req.body?.action || ''), note = String(req.body?.note || '').slice(0, 2000);
      if (!FLAG_ACTIONS[action]) return res.status(400).json({ error: 'Unknown flag action.' });
      const flag = await one(pool, 'SELECT * FROM clinical_flags WHERE id=$1 AND mother_id=$2', [flagId, motherId]);
      if (!flag) return res.status(404).json({ error: 'Flag not found.' });
      if (!await access(req, motherId)) return res.status(403).json({ error: 'This patient is not available in your care records.' });
      const status = FLAG_ACTIONS[action];
      await pool.query(`UPDATE clinical_flags SET status=$1::varchar, resolved_at=CASE WHEN $1::text='resolved' THEN NOW() ELSE NULL END,
        resolution_note=CASE WHEN $1::text='resolved' THEN $2::text ELSE resolution_note END, last_seen_at=NOW() WHERE id=$3`, [status, note || null, flagId]);
      await pool.query('INSERT INTO clinical_flag_events(flag_id,actor_id,event,note) VALUES($1,$2,$3,$4)', [flagId, req.user.id, action, note || null]);
      res.json({ ok: true, flag: await one(pool, 'SELECT * FROM clinical_flags WHERE id=$1', [flagId]) });
    } catch (e) { console.error('flag update:', e.message); res.status(500).json({ error: 'Flag update failed.' }); }
  });
  app.post('/api/doctor/patients/:id/actions/:actionId', authenticate, async (req, res) => {
    try {
      await schemaReady;
      const motherId = Number(req.params.id), actionId = Number(req.params.actionId);
      const status = String(req.body?.status || ''), note = String(req.body?.note || '').slice(0, 2000);
      if (!ACTION_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown action status.' });
      const row = await one(pool, 'SELECT * FROM clinical_actions WHERE id=$1 AND mother_id=$2', [actionId, motherId]);
      if (!row) return res.status(404).json({ error: 'Action not found.' });
      if (!await access(req, motherId)) return res.status(403).json({ error: 'This patient is not available in your care records.' });
      await pool.query('UPDATE clinical_actions SET status=$1, status_note=$2, updated_at=NOW() WHERE id=$3', [status, note || null, actionId]);
      res.json({ ok: true, action: await one(pool, 'SELECT * FROM clinical_actions WHERE id=$1', [actionId]) });
    } catch (e) { console.error('action update:', e.message); res.status(500).json({ error: 'Action update failed.' }); }
  });
  app.get('/api/doctor/intelligence/queue', authenticate, async (req, res) => {
    try {
      await schemaReady;
      const patients = await q(pool, 'SELECT DISTINCT mother_id FROM appointments WHERE doctor_id=$1', [req.user.id]);
      const shared = await q(pool, `SELECT mother_id FROM clinical_dashboard_consent WHERE doctor_id=$1 AND revoked_at IS NULL AND expires_at>NOW()`, [req.user.id]);
      const ids = [...new Set([...patients, ...shared].map(r => Number(r.mother_id)))];
      const queue = [];
      for (const id of ids) {
        const counts = await q(pool, `SELECT status, COUNT(*)::int n FROM clinical_flags WHERE mother_id=$1 GROUP BY status`, [id]);
        const by = Object.fromEntries(counts.map(c => [c.status, c.n]));
        const openActions = (await one(pool, `SELECT COUNT(*)::int n FROM clinical_actions WHERE mother_id=$1 AND status IN ('open','follow_up')`, [id])).n;
        const urgent = (await one(pool, `SELECT COUNT(*)::int n FROM clinical_flags WHERE mother_id=$1 AND severity='urgent' AND status IN ('new','under_review','monitoring')`, [id])).n;
        queue.push({ mother_id: id, urgent_flags: urgent, review_flags: (by.new || 0) + (by.under_review || 0) + (by.monitoring || 0), open_actions: openActions });
      }
      res.json({ queue: queue.filter(x => x.urgent_flags + x.review_flags + x.open_actions > 0), evaluated: ids.length });
    } catch { res.status(500).json({ error: 'Queue unavailable.' }); }
  });
};
Object.assign(module.exports, { assemble, RULES, parameterSeries, comparisons, careGaps, gestationFor });
