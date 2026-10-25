'use strict';

// ============================================================================
// N. Privacy-preserving analytics dashboard.
//
//   GET /api/analytics/metrics                         definitions, privacy rules, limits
//   GET /api/analytics/report?metric=&group_by=&window=   aggregate, de-identified rows
//   GET /api/analytics/export.csv?metric=&group_by=&window=   the same rows as CSV (limited per day, logged)
//
// Rules enforced here, in code, not by convention:
//  - Only verified doctors can read it, and every view and export is written to analytics_access_log.
//  - Small groups are suppressed: a group needs at least K_MIN distinct people, counted per person, not per event.
//  - No overall total is published next to the groups, so a hidden group cannot be recovered by subtraction.
//  - Rates with very few events or non-events are shown as a band ("under 30%") instead of an exact value.
//  - Group sizes are banded, medians are shown only with enough follow-ups, and raw counts are never returned.
//  - Windows are fixed (30/90/180/365 days). Exports contain exactly the rows on screen, nothing else.
// Limits: repeated queries over different windows can still narrow down a small change, so access is
// audited. Missed visits are an estimate (see the caveat on the metric).
// ============================================================================

const K_MIN = 10;
const MIN_FOLLOWUPS_FOR_MEDIAN = 5;
const SMALL_CELL = 3;
const WINDOWS = [30, 90, 180, 365];
const EXPORT_LIMIT_PER_DAY = 5;
const REFERRAL_SETTLE_DAYS = 14;
const FOLLOWUP_SETTLE_DAYS = 7;

const METRICS = {
  missed_visits: {
    label: 'Missed-visit rate',
    group_by: ['facility'],
    description: 'Share of past appointments that were never marked completed or cancelled.',
    caveat: 'This is an estimate. An appointment also counts here if the clinic simply did not record that the visit happened.'
  },
  referral_completion: {
    label: 'Referral completion',
    group_by: ['facility', 'area'],
    description: 'Share of referrals, grouped by the receiving facility or its district, that reached "completed". Referrals from the last ' + REFERRAL_SETTLE_DAYS + ' days are left out so recent ones still in progress do not lower the rate. Also shows the median days to completion.',
    caveat: 'Referrals that are still open or were rejected count as not completed.'
  },
  time_to_follow_up: {
    label: 'Time to follow-up after a missed item',
    group_by: ['facility'],
    description: 'Median days from a missed care item being flagged to the first outreach attempt, and the share followed up. Items from the last ' + FOLLOWUP_SETTLE_DAYS + ' days are left out. Facility is the one on the mother\u2019s latest appointment.',
    caveat: 'Only outreach recorded in DAI is counted.'
  }
};

// ---------- pure engine (no database) ----------

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const peopleBand = (n) => (n < 20 ? '10\u201319' : n < 50 ? '20\u201349' : n < 100 ? '50\u201399' : '100+');

// Exact percentage only when both the events and the non-events are numerous enough; otherwise a band.
function rateCell(events, total) {
  if (!(total > 0)) return { rate_pct: null, rate_text: 'No data' };
  if (events < SMALL_CELL) return { rate_pct: null, rate_text: 'under 30%' };
  if (total - events < SMALL_CELL) return { rate_pct: null, rate_text: 'over 70%' };
  const pct = Math.round((events / total) * 100);
  return { rate_pct: pct, rate_text: pct + '%' };
}

// rows: [{ key, label, people, total, positive, durations? }]. Returns only publishable values.
function buildReport({ metric, groupBy, windowDays, rows, now = new Date() }) {
  const out = []; let hidden = 0;
  const sorted = [...rows].sort((a, b) => String(a.label || a.key).localeCompare(String(b.label || b.key)));
  for (const r of sorted) {
    const people = Number(r.people) || 0;
    if (people < K_MIN) { hidden++; out.push({ key: r.key, label: r.label, suppressed: true, reason: 'Fewer than ' + K_MIN + ' people' }); continue; }
    const row = { key: r.key, label: r.label, suppressed: false, people_band: peopleBand(people), ...rateCell(Number(r.positive) || 0, Number(r.total) || 0) };
    if (Array.isArray(r.durations)) {
      const days = r.durations.map(Number).filter(Number.isFinite);
      row.median_days = days.length >= MIN_FOLLOWUPS_FOR_MEDIAN ? Math.round(median(days) * 10) / 10 : null;
      if (row.median_days === null) row.median_note = 'Not enough completed cases to report a median';
    }
    out.push(row);
  }
  return {
    metric, group_by: groupBy, window_days: windowDays, k_min: K_MIN, generated_at: now.toISOString(),
    rows: out, hidden_groups: hidden,
    notes: ['Groups with fewer than ' + K_MIN + ' people are hidden.',
      'No overall total is shown, so hidden groups cannot be worked out by subtraction.',
      'Percentages are shown as a band when there are very few events.',
      METRICS[metric].caveat]
  };
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                    // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function reportToCsv(report) {
  const hasMedian = report.rows.some((r) => 'median_days' in r);
  const head = ['group', 'people', 'rate'].concat(hasMedian ? ['median_days'] : []).concat(['note']);
  const lines = [
    '# DaiHealth aggregate analytics. De-identified. Do not attempt to identify individuals.',
    '# metric=' + report.metric + ' group_by=' + report.group_by + ' window_days=' + report.window_days + ' minimum_group_size=' + report.k_min,
    '# generated=' + report.generated_at,
    head.join(',')
  ];
  for (const r of report.rows) {
    const cells = r.suppressed
      ? [r.label || r.key, 'hidden', 'hidden'].concat(hasMedian ? ['hidden'] : []).concat([r.reason])
      : [r.label || r.key, r.people_band, r.rate_text].concat(hasMedian ? [r.median_days == null ? '' : r.median_days] : []).concat([r.median_note || '']);
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- database + routes ----------

const GROUP_SQL = {
  referral_completion: {
    facility: { key: 'f.id::text', label: 'f.name' },
    area: { key: 'lower(f.district)', label: 'f.district' }
  }
};

function registerPrivacyAnalytics(app, { pool, authenticateToken, authorizeRole }) {
  const { verifiedDoctor } = require('./clinicalDashboard');
  const gate = [authenticateToken, authorizeRole(['doctor'])];
  const fail = (res, label, e) => { console.error(label + ':', e.message); res.status(500).json({ error: 'Analytics are unavailable right now' }); };

  async function facilityLabels() {
    const r = await pool.query(`SELECT x.facility_uuid::text AS uuid, MIN(dp.facility_name) AS name
        FROM appointments x JOIN doctor_profiles dp ON dp.user_id = x.doctor_id
       WHERE x.facility_uuid IS NOT NULL AND x.facility_uuid <> '' GROUP BY x.facility_uuid`);
    return new Map(r.rows.map((x) => [x.uuid, x.name]));
  }
  const labelFor = (labels, key) => key === 'unassigned' ? 'No facility recorded' : (labels.get(key) || 'Unnamed facility \u00b7' + String(key).slice(-4));

  async function collect(metric, groupBy, days) {
    if (metric === 'missed_visits') {
      const r = await pool.query(
        `SELECT COALESCE(NULLIF(a.facility_uuid,''),'unassigned') AS k, COUNT(DISTINCT a.mother_id) AS people, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.status IN ('pending','confirmed')) AS positive
           FROM appointments a
          WHERE a.requested_date >= CURRENT_DATE - $1::int AND a.requested_date < CURRENT_DATE AND a.status <> 'cancelled'
          GROUP BY 1`, [days]);
      const labels = await facilityLabels();
      return r.rows.map((x) => ({ key: x.k, label: labelFor(labels, x.k), people: Number(x.people), total: Number(x.total), positive: Number(x.positive) }));
    }
    if (metric === 'referral_completion') {
      const g = GROUP_SQL.referral_completion[groupBy];
      const r = await pool.query(
        `SELECT ${g.key} AS k, ${g.label} AS label, COUNT(DISTINCT fr.user_id) AS people, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE fr.status = 'completed') AS positive,
                ARRAY_AGG((EXTRACT(EPOCH FROM (fr.completed_at - fr.created_at)) / 86400.0)::float8) FILTER (WHERE fr.status = 'completed' AND fr.completed_at IS NOT NULL) AS durations
           FROM facility_referrals fr JOIN facilities f ON f.id = fr.to_facility_id
          WHERE fr.created_at >= NOW() - $1::int * INTERVAL '1 day' AND fr.created_at < NOW() - ${REFERRAL_SETTLE_DAYS} * INTERVAL '1 day'
          GROUP BY 1, 2`, [days]);
      return r.rows.map((x) => ({ key: x.k, label: x.label, people: Number(x.people), total: Number(x.total), positive: Number(x.positive), durations: x.durations || [] }));
    }
    const r = await pool.query(
      `WITH base AS (
         SELECT mci.id, mci.mother_id, mci.created_at,
                (SELECT MIN(oa.attempt_date) FROM outreach_attempts oa WHERE oa.missed_care_id = mci.id) AS first_attempt,
                (SELECT a2.facility_uuid FROM appointments a2 WHERE a2.mother_id = mci.mother_id AND a2.facility_uuid IS NOT NULL AND a2.facility_uuid <> ''
                  ORDER BY a2.requested_date DESC LIMIT 1) AS facility_uuid
           FROM missed_care_items mci
          WHERE mci.created_at >= NOW() - $1::int * INTERVAL '1 day' AND mci.created_at < NOW() - ${FOLLOWUP_SETTLE_DAYS} * INTERVAL '1 day')
       SELECT COALESCE(NULLIF(b.facility_uuid,''),'unassigned') AS k, COUNT(DISTINCT b.mother_id) AS people, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE b.first_attempt IS NOT NULL) AS positive,
              ARRAY_AGG((EXTRACT(EPOCH FROM (b.first_attempt - b.created_at)) / 86400.0)::float8) FILTER (WHERE b.first_attempt IS NOT NULL) AS durations
         FROM base b GROUP BY 1`, [days]);
    const labels = await facilityLabels();
    return r.rows.map((x) => ({ key: x.k, label: labelFor(labels, x.k), people: Number(x.people), total: Number(x.total), positive: Number(x.positive), durations: x.durations || [] }));
  }

  // Validates input, checks the caller is a verified doctor, returns the report (and audits the view).
  async function prepare(req, res, kind) {
    if (!(await verifiedDoctor(pool, req.user.id))) { res.status(403).json({ error: 'Analytics are limited to verified clinicians' }); return null; }
    const metric = String(req.query.metric || 'missed_visits'), def = METRICS[metric];
    if (!def) { res.status(400).json({ error: 'Unknown measure' }); return null; }
    const groupBy = String(req.query.group_by || def.group_by[0]);
    if (!def.group_by.includes(groupBy)) { res.status(400).json({ error: groupBy === 'area' ? 'Area grouping is not available for this measure yet' : 'Unsupported grouping' }); return null; }
    const days = Number(req.query.window || 90);
    if (!WINDOWS.includes(days)) { res.status(400).json({ error: 'Choose a window of ' + WINDOWS.join(', ') + ' days' }); return null; }
    if (kind === 'export') {
      const used = (await pool.query("SELECT COUNT(*) AS n FROM analytics_access_log WHERE user_id=$1 AND kind='export' AND created_at > NOW() - INTERVAL '1 day'", [req.user.id])).rows[0].n;
      if (Number(used) >= EXPORT_LIMIT_PER_DAY) { res.status(429).json({ error: 'Daily export limit reached (' + EXPORT_LIMIT_PER_DAY + '). Try again tomorrow.' }); return null; }
    }
    const report = buildReport({ metric, groupBy, windowDays: days, rows: await collect(metric, groupBy, days) });
    await pool.query('INSERT INTO analytics_access_log(user_id,kind,metric,group_by,window_days,rows_shown,rows_hidden) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [req.user.id, kind, metric, groupBy, days, report.rows.length - report.hidden_groups, report.hidden_groups]);
    return report;
  }

  app.get('/api/analytics/metrics', ...gate, async (req, res) => {
    try {
      if (!(await verifiedDoctor(pool, req.user.id))) return res.status(403).json({ error: 'Analytics are limited to verified clinicians' });
      res.set('Cache-Control', 'no-store').json({ metrics: Object.entries(METRICS).map(([id, m]) => ({ id, ...m })), k_min: K_MIN, windows: WINDOWS, export_limit_per_day: EXPORT_LIMIT_PER_DAY });
    } catch (e) { fail(res, 'Analytics metrics', e); }
  });
  app.get('/api/analytics/report', ...gate, async (req, res) => {
    try { const r = await prepare(req, res, 'view'); if (r) res.set('Cache-Control', 'no-store').json(r); }
    catch (e) { fail(res, 'Analytics report', e); }
  });
  app.get('/api/analytics/export.csv', ...gate, async (req, res) => {
    try {
      const r = await prepare(req, res, 'export'); if (!r) return;
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dai-analytics-' + r.metric + '-' + r.window_days + 'd.csv"', 'Cache-Control': 'no-store' }).send(reportToCsv(r));
    } catch (e) { fail(res, 'Analytics export', e); }
  });
}

module.exports = registerPrivacyAnalytics;
Object.assign(module.exports, { buildReport, reportToCsv, rateCell, peopleBand, median, csvCell, K_MIN, METRICS, WINDOWS, EXPORT_LIMIT_PER_DAY, MIN_FOLLOWUPS_FOR_MEDIAN, SMALL_CELL });
