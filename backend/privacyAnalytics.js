'use strict';

// ============================================================================
// N. Privacy-preserving analytics dashboard.
//
//   GET /api/analytics/metrics                         definitions, privacy rules, limits
//   GET /api/analytics/report?metric=&group_by=&window=   aggregate, de-identified rows
//   GET /api/analytics/export.csv?report_id=   exact owned report snapshot as CSV (limited, logged)
//
// Rules enforced here, in code, not by convention:
//  - Only verified doctors can read it, and every view and export is written to analytics_access_log.
//  - Small groups are suppressed: a group needs at least K_MIN distinct people, counted per person, not per event.
//  - No overall total is published next to the groups, so a hidden group cannot be recovered by subtraction.
//  - Rates with very few events or non-events are shown as a band ("under 30%") instead of an exact value.
//  - Group sizes are banded, medians are shown only with enough follow-ups, and raw counts are never returned.
//  - Windows are fixed (30/90/180/365 days). Exports use an owned 15-minute redacted report snapshot.
// Limits: repeated queries over different windows can still narrow down a small change, so access is
// audited. Missed visits are an estimate (see the caveat on the metric).
// ============================================================================

const { randomUUID } = require('node:crypto');
const SNAPSHOT_MINUTES = 15;
const K_MIN = 10;
const MIN_FOLLOWUPS_FOR_MEDIAN = 5;
const SMALL_CELL = 3;
const WINDOWS = [30, 90, 180, 365];
const EXPORT_LIMIT_PER_DAY = 5;
const REFERRAL_SETTLE_DAYS = 14;
const FOLLOWUP_SETTLE_DAYS = 7;

const METRICS = {
  missed_visits: {
    label: 'Unresolved past visits (estimate)',
    source: 'Doctor appointments',
    rate_label: 'Unresolved visits',
    interpretation: 'estimate',
    group_by: ['facility'],
    description: 'Share of past, non-cancelled doctor appointments still marked pending or confirmed. Today and future appointments are excluded using the India calendar date.',
    caveat: 'This is an estimate. An appointment also counts here if the clinic simply did not record that the visit happened.'
  },
  recorded_no_shows: {
    label: 'Recorded facility no-shows',
    group_by: ['facility'],
    source: 'Facility appointments',
    rate_label: 'Recorded no-shows',
    interpretation: 'recorded_status',
    description: 'Share of past, non-cancelled facility appointments explicitly marked no_show. Today and future appointments are excluded using the India calendar date.',
    caveat: 'Pending or confirmed appointments are not counted as recorded no-shows. Missing status updates can understate this measure. Doctor appointments are a separate source and are not combined.'
  },
  referral_completion: {
    source: 'Facility referrals',
    rate_label: 'Completed referrals',
    interpretation: 'recorded_status',
    label: 'Referral completion',
    group_by: ['facility', 'area'],
    description: 'Share of referrals, grouped by the receiving facility or its district, that reached "completed". Referrals from the last ' + REFERRAL_SETTLE_DAYS + ' days are left out so recent ones still in progress do not lower the rate. Also shows the median days to completion.',
    caveat: 'Referrals that are still open or were rejected count as not completed.'
  },
  time_to_follow_up: {
    source: 'Missed-care items and outreach attempts',
    rate_label: 'Outreach attempted',
    interpretation: 'recorded_status',
    label: 'Time to follow-up after a missed item',
    group_by: ['facility'],
    description: 'Median days from a missed care item being flagged to the first outreach attempt, and the share followed up. Items from the last ' + FOLLOWUP_SETTLE_DAYS + ' days are left out. Facility comes from the linked missed appointment, or the latest appointment on or before the item was flagged. A later appointment is never used.',
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
      const days = r.durations.filter(v => v !== null && v !== '').map(Number).filter(v => Number.isFinite(v) && v >= 0);
      row.median_days = Number(r.duration_people) >= MIN_FOLLOWUPS_FOR_MEDIAN && days.length >= MIN_FOLLOWUPS_FOR_MEDIAN ? Math.round(median(days) * 10) / 10 : null;
      if (row.median_days === null) row.median_note = 'At least 5 distinct people with valid recorded durations are needed';
    }
    out.push(row);
  }
  return {
    metric, group_by: groupBy, window_days: windowDays, k_min: K_MIN, generated_at: now.toISOString(),
    definition: { id: metric, ...METRICS[metric] },
    scope: 'Network-wide aggregates for verified clinicians; not an assigned-patient roster.',
    timezone: 'Asia/Kolkata',
    data_quality: { unassigned_facility: rows.some(r => r.key === 'unassigned'),
      notice: 'Missing facility attribution is kept separate. No historical facility is guessed from a current clinician profile.' },
    rows: out, hidden_groups: hidden,
    notes: ['Groups with fewer than ' + K_MIN + ' people are hidden.',
      'No overall patient or event total is published. Repeated queries can still disclose changes; access is audited.',
      'People are banded. Rates with fewer than 3 events or non-events use a broad band; medians require 5 distinct people.',
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
    '# source=' + (METRICS[report.metric]?.source || report.metric),
    '# interpretation=' + (METRICS[report.metric]?.caveat || ''),
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
  facility: { key: 'f.id::text', label: 'f.name' },
  area: { key: "COALESCE(NULLIF(lower(TRIM(f.district)),''),'unassigned')", label: "COALESCE(NULLIF(lower(TRIM(f.district)),''),'No district recorded')" }
};

function registerPrivacyAnalytics(app, { pool, authenticateToken, authorizeRole }) {
  const { verifiedDoctor } = require('./clinicalDashboard');
  const gate = [authenticateToken, authorizeRole(['doctor'])];
  const fail = (res, label, e) => { console.error(label + ':', e.message); res.status(503).json({ error: 'Analytics could not be loaded. Try again; no empty report has been substituted.' }); };
  app.use('/api/analytics', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  async function verified(req, res) {
    if (await verifiedDoctor(pool, req.user.id)) return true;
    res.status(403).json({ error: 'Analytics are limited to verified clinicians' }); return false;
  }
  function filters(req, res) {
    if (Object.entries(req.query).some(([k, v]) => !['metric', 'group_by', 'window'].includes(k) || typeof v !== 'string')) {
      res.status(400).json({ error: 'Choose one measure, grouping and fixed period; extra filters are not supported.' }); return null;
    }
    const metric = req.query.metric || 'missed_visits';
    if (!Object.hasOwn(METRICS, metric)) { res.status(400).json({ error: 'Unknown measure' }); return null; }
    const def = METRICS[metric], groupBy = req.query.group_by || def.group_by[0];
    const days = Number(req.query.window || 90);
    if (!def.group_by.includes(groupBy) || !WINDOWS.includes(days)) { res.status(400).json({ error: 'Choose a supported grouping and a period of ' + WINDOWS.join(', ') + ' days.' }); return null; }
    return { metric, groupBy, days };
  }
  async function facilityLabels(db) {
    // Historical appointment identity first. Conflicting clinician labels are never resolved arbitrarily.
    const r = await db.query(`SELECT x.facility_uuid::text AS uuid,
       CASE WHEN COUNT(DISTINCT NULLIF(TRIM(dp.facility_name),'')) = 1 THEN MIN(NULLIF(TRIM(dp.facility_name),'')) END AS name
       FROM appointments x LEFT JOIN doctor_profiles dp ON dp.user_id=x.doctor_id
       WHERE NULLIF(TRIM(x.facility_uuid),'') IS NOT NULL GROUP BY x.facility_uuid`);
    const labels = new Map(r.rows.map(x => [x.uuid, x.name]));
    const directory = await db.query('SELECT facility_code, name FROM facilities');
    for (const f of directory.rows) labels.set(f.facility_code, f.name);
    return labels;
  }
  async function collect(db, metric, groupBy, days, now) {
    const values = [days, now.toISOString()];
    const dateWindow = "requested_date >= ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date - $1::int AND requested_date < ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date";
    if (metric === 'recorded_no_shows') {
      return (await db.query(`SELECT f.id::text AS key, f.name AS label, COUNT(DISTINCT a.user_id) AS people, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE a.status='no_show') AS positive
        FROM facility_appointments a JOIN facilities f ON f.id=a.facility_id
        WHERE ${dateWindow} AND a.status <> 'cancelled' GROUP BY f.id, f.name`, values)).rows;
    }
    if (metric === 'missed_visits') {
      const r = await db.query(`SELECT COALESCE(NULLIF(TRIM(a.facility_uuid),''),'unassigned') AS key,
        COUNT(DISTINCT a.mother_id) AS people, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE a.status IN ('pending','confirmed')) AS positive
        FROM appointments a WHERE ${dateWindow} AND a.status <> 'cancelled' GROUP BY 1`, values);
      const labels = await facilityLabels(db);
      return r.rows.map(x => ({ ...x, label: x.key === 'unassigned' ? 'No facility recorded' : labels.get(x.key) || 'Unmapped facility · ' + String(x.key).slice(-8) }));
    }
    if (metric === 'referral_completion') {
      const g = GROUP_SQL[groupBy];
      return (await db.query(`SELECT ${g.key} AS key, ${g.label} AS label, COUNT(DISTINCT fr.user_id) AS people, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE fr.status='completed') AS positive,
        COUNT(DISTINCT fr.user_id) FILTER (WHERE fr.status='completed' AND fr.completed_at>=fr.created_at AND fr.completed_at<=$2::timestamptz) AS duration_people,
        ARRAY_AGG((EXTRACT(EPOCH FROM (fr.completed_at-fr.created_at))/86400.0)::float8)
          FILTER (WHERE fr.status='completed' AND fr.completed_at>=fr.created_at AND fr.completed_at<=$2::timestamptz) AS durations
        FROM facility_referrals fr JOIN facilities f ON f.id=fr.to_facility_id
        WHERE fr.created_at >= $2::timestamptz - $1::int * INTERVAL '1 day'
          AND fr.created_at < $2::timestamptz - ${REFERRAL_SETTLE_DAYS} * INTERVAL '1 day'
        GROUP BY 1,2`, values)).rows;
    }
    const r = await db.query(`WITH base AS (
      SELECT mci.id, mci.mother_id, mci.created_at,
        (SELECT MIN(oa.attempt_date) FROM outreach_attempts oa WHERE oa.missed_care_id=mci.id
          AND oa.attempt_date>=mci.created_at AND oa.attempt_date<=$2::timestamptz) AS first_attempt,
        COALESCE(NULLIF(TRIM(linked.facility_uuid),''),
          (SELECT NULLIF(TRIM(a2.facility_uuid),'') FROM appointments a2 WHERE a2.mother_id=mci.mother_id
            AND NULLIF(TRIM(a2.facility_uuid),'') IS NOT NULL AND a2.requested_date <= mci.created_at::date
            ORDER BY a2.requested_date DESC,a2.id DESC LIMIT 1)) AS facility_uuid
      FROM missed_care_items mci LEFT JOIN appointments linked ON linked.id=mci.appointment_id AND linked.mother_id=mci.mother_id
      WHERE mci.created_at >= $2::timestamptz - $1::int * INTERVAL '1 day'
        AND mci.created_at < $2::timestamptz - ${FOLLOWUP_SETTLE_DAYS} * INTERVAL '1 day')
      SELECT COALESCE(b.facility_uuid,'unassigned') AS key, COUNT(DISTINCT b.mother_id) AS people, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE b.first_attempt IS NOT NULL) AS positive,
        COUNT(DISTINCT b.mother_id) FILTER (WHERE b.first_attempt IS NOT NULL) AS duration_people,
        ARRAY_AGG((EXTRACT(EPOCH FROM (b.first_attempt-b.created_at))/86400.0)::float8)
          FILTER (WHERE b.first_attempt IS NOT NULL) AS durations FROM base b GROUP BY 1`, values);
    const labels = await facilityLabels(db);
    return r.rows.map(x => ({ ...x, label: x.key === 'unassigned' ? 'No facility recorded' : labels.get(x.key) || 'Unmapped facility · ' + String(x.key).slice(-8) }));
  }
  async function audit(db, user, kind, r) {
    await db.query('INSERT INTO analytics_access_log(user_id,kind,metric,group_by,window_days,rows_shown,rows_hidden) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [user,kind,r.metric,r.group_by,r.window_days,r.rows.length-r.hidden_groups,r.hidden_groups]);
  }
  app.get('/api/analytics/metrics', ...gate, async (req, res) => {
    try { if (!await verified(req,res)) return;
      res.json({ metrics:Object.entries(METRICS).map(([id,m])=>({id,...m})), k_min:K_MIN, windows:WINDOWS,
        export_limit_per_day:EXPORT_LIMIT_PER_DAY, snapshot_minutes:SNAPSHOT_MINUTES,
        scope:'Network-wide aggregates for verified clinicians; not an assigned-patient roster.' });
    } catch(e) { fail(res,'Analytics definitions',e); }
  });
  app.get('/api/analytics/report', ...gate, async (req, res) => {
    let db;
    try {
      if (!await verified(req,res)) return;
      const f=filters(req,res); if(!f)return;
      db=await pool.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const now=new Date(), rows=await collect(db,f.metric,f.groupBy,f.days,now);
      const r=buildReport({metric:f.metric,groupBy:f.groupBy,windowDays:f.days,rows,now});
      r.report_id=randomUUID(); r.expires_at=new Date(now.getTime()+SNAPSHOT_MINUTES*60000).toISOString();
      const appointmentDates=['missed_visits','recorded_no_shows'].includes(f.metric);
      const indiaDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const startDate=new Date(indiaDate+'T00:00:00Z');startDate.setUTCDate(startDate.getUTCDate()-f.days);
      r.period={ start:appointmentDates?startDate.toISOString().slice(0,10):new Date(now.getTime()-f.days*86400000).toISOString(), end:appointmentDates?indiaDate:now.toISOString(),
        excluded_recent_days:f.metric==='referral_completion'?REFERRAL_SETTLE_DAYS:f.metric==='time_to_follow_up'?FOLLOWUP_SETTLE_DAYS:0,
        basis:['missed_visits','recorded_no_shows'].includes(f.metric)?'Past appointment dates, India calendar days':'Record creation time; recent records excluded as described' };
      await db.query('DELETE FROM analytics_report_snapshots WHERE expires_at<NOW()');
      await db.query('INSERT INTO analytics_report_snapshots(id,user_id,report,expires_at) VALUES($1,$2,$3::jsonb,$4)',[r.report_id,req.user.id,JSON.stringify(r),r.expires_at]);
      await audit(db,req.user.id,'view',r); await db.query('COMMIT'); res.json(r);
    } catch(e) { if(db)await db.query('ROLLBACK').catch(()=>{}); fail(res,'Analytics report',e); }
    finally { db?.release(); }
  });
  app.get('/api/analytics/export.csv', ...gate, async (req,res)=>{
    let db;
    try {
      if(!await verified(req,res))return;
      const id=req.query.report_id;
      if(Object.keys(req.query).length!==1 || typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({error:'Show a report first, then download that report.'});
      db=await pool.connect();await db.query('BEGIN');
      // Serialize this user's quota check and audit, including concurrent export requests.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      const snapshot=(await db.query('SELECT report FROM analytics_report_snapshots WHERE id=$1 AND user_id=$2 AND expires_at>NOW()',[id,req.user.id])).rows[0];
      if(!snapshot){await db.query('ROLLBACK');return res.status(410).json({error:'This report is expired or unavailable. Show a fresh report before downloading.'});}
      const used=Number((await db.query("SELECT COUNT(*) AS n FROM analytics_access_log WHERE user_id=$1 AND kind='export' AND created_at>NOW()-INTERVAL '1 day'",[req.user.id])).rows[0].n);
      if(used>=EXPORT_LIMIT_PER_DAY){await db.query('ROLLBACK');return res.status(429).json({error:'Export limit reached: 5 downloads per rolling 24 hours. Try again when an earlier download leaves that window.'});}
      const r=snapshot.report; await audit(db,req.user.id,'export',r); await db.query('COMMIT');
      res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="dai-analytics-'+r.metric+'-'+r.window_days+'d.csv"'}).send(reportToCsv(r));
    }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});fail(res,'Analytics export',e);}finally{db?.release();}
  });
}
module.exports=registerPrivacyAnalytics;
Object.assign(module.exports,{buildReport,reportToCsv,rateCell,peopleBand,median,csvCell,K_MIN,METRICS,WINDOWS,EXPORT_LIMIT_PER_DAY,MIN_FOLLOWUPS_FOR_MEDIAN,SMALL_CELL});
