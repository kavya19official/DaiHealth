'use strict';

/**
 * Longitudinal view for predictive risk monitoring.
 *
 * riskAssessment.js answers "what is her risk from today's reading?". This
 * module answers "which way is it moving?" from the readings she has already
 * logged (health_logs) and the assessments already run (risk_assessments).
 *
 * Pure functions, no database: routes fetch rows and pass them in, which keeps
 * the clinical rules testable and in one place.
 *
 * Thresholds (paraphrased from ACOG / ADA pregnancy guidance — have a clinician
 * review before real-world use):
 *   blood pressure   high ≥140 systolic or ≥90 diastolic; severe ≥160 or ≥110
 *   glucose targets  fasting <95, 1 h after meal <140, 2 h after meal <120 mg/dL
 * A "trend" is only reported with enough readings over enough days; otherwise
 * the result says "not enough readings yet" instead of guessing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const BP = { high_sys: 140, high_dia: 90, severe_sys: 160, severe_dia: 110, border_sys: 130, border_dia: 80 };
const GLUCOSE_TARGET = { fasting: 95, after_meal_1h: 140, after_meal_2h: 120 };
const GLUCOSE_LABEL = { fasting: 'fasting', after_meal_1h: '1 hour after a meal', after_meal_2h: '2 hours after a meal', random: 'random' };
const RISK_RANK = { 'low risk': 0, 'mid risk': 1, 'high risk': 2 };

const toMs = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const r1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Least-squares slope of y against time, in units of y per WEEK. */
function slopePerWeek(points) {
  const n = points.length;
  if (n < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / (7 * DAY_MS));
  const ys = points.map((p) => p.y);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : num / den;
}

function bpClass(sys, dia) {
  if (sys >= BP.severe_sys || dia >= BP.severe_dia) return 'severe';
  if (sys >= BP.high_sys || dia >= BP.high_dia) return 'high';
  if (sys >= BP.border_sys || dia >= BP.border_dia) return 'borderline';
  return 'normal';
}

const sortAsc = (rows) => rows.map((r) => ({ ...r, t: toMs(r.at) })).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);

function analyseBP(rows, now, signals) {
  const all = sortAsc(rows).filter((r) => Number.isFinite(r.systolic) && Number.isFinite(r.diastolic));
  const points = all.map((r) => ({ at: new Date(r.t).toISOString(), systolic: r.systolic, diastolic: r.diastolic, class: bpClass(r.systolic, r.diastolic) }));
  const out = { points, count: all.length, latest: points[points.length - 1] || null, trend: { direction: 'insufficient', note: 'Log at least 3 blood-pressure readings over 5 or more days to see a trend.' } };
  if (!all.length) return out;

  const last = all[all.length - 1];
  const hoursSince = (now - last.t) / 3600000;
  out.latest = { ...points[points.length - 1], hours_ago: r1(hoursSince) };

  const weekAgo = all.filter((r) => now - r.t <= 7 * DAY_MS);
  const highWeek = weekAgo.filter((r) => bpClass(r.systolic, r.diastolic) === 'high' || bpClass(r.systolic, r.diastolic) === 'severe');
  out.last_7_days = { readings: weekAgo.length, high_readings: highWeek.length };

  // Trend over the last 28 days, only when there is enough to say something.
  const win = all.filter((r) => now - r.t <= 28 * DAY_MS);
  const spanDays = win.length ? (win[win.length - 1].t - win[0].t) / DAY_MS : 0;
  if (win.length >= 3 && spanDays >= 5) {
    const sSys = slopePerWeek(win.map((r) => ({ t: r.t, y: r.systolic })));
    const sDia = slopePerWeek(win.map((r) => ({ t: r.t, y: r.diastolic })));
    const dir = sSys >= 4 || sDia >= 3 ? 'rising' : (sSys <= -4 || sDia <= -3 ? 'falling' : 'steady');
    out.trend = {
      direction: dir,
      systolic_per_week: r1(sSys), diastolic_per_week: r1(sDia),
      readings_used: win.length, span_days: Math.round(spanDays),
      note: dir === 'rising' ? 'Your readings have been creeping up over the last few weeks.'
        : dir === 'falling' ? 'Your readings have been coming down over the last few weeks.'
          : 'Your readings have been steady over the last few weeks.'
    };
  }

  // ---- signals ----
  const lastClass = bpClass(last.systolic, last.diastolic);
  if (lastClass === 'severe' && hoursSince <= 24) {
    signals.push({ code: 'bp_severe', level: 'urgent', title: 'A recent reading was in the severe range',
      detail: `${last.systolic}/${last.diastolic} mmHg, ${Math.round(hoursSince)} h ago. This needs emergency care — call 112 or go to a facility now, especially with a headache, vision changes or belly pain.` });
  } else if (highWeek.length >= 2) {
    signals.push({ code: 'bp_repeat_high', level: 'urgent', title: 'High blood pressure on more than one reading this week',
      detail: `${highWeek.length} of ${weekAgo.length} readings in the last 7 days were 140/90 or higher. Please contact your doctor today.` });
  } else if ((lastClass === 'high') && hoursSince <= 48) {
    signals.push({ code: 'bp_one_high', level: 'watch', title: 'Your latest blood pressure was high',
      detail: `${last.systolic}/${last.diastolic} mmHg. Rest for 5–10 minutes and measure again. If it is still high, contact your doctor.` });
  }
  if (out.trend.direction === 'rising' && lastClass !== 'normal' && lastClass !== 'severe' && !signals.some((s) => s.code.startsWith('bp_'))) {
    signals.push({ code: 'bp_rising', level: 'watch', title: 'Blood pressure is trending upward',
      detail: `About ${out.trend.systolic_per_week > 0 ? '+' : ''}${out.trend.systolic_per_week} mmHg a week on the top number over ${out.trend.span_days} days. Share this at your next visit.` });
  }
  if (hoursSince > 14 * 24) {
    signals.push({ code: 'bp_stale', level: 'info', title: 'No recent blood-pressure reading',
      detail: `Your last reading was ${Math.round(hoursSince / 24)} days ago. A fresh reading keeps this view accurate.` });
  }
  return out;
}

function analyseGlucose(rows, now, signals) {
  const all = sortAsc(rows).filter((r) => Number.isFinite(r.mg_dl));
  const points = all.map((r) => {
    const target = GLUCOSE_TARGET[r.context];
    return { at: new Date(r.t).toISOString(), mg_dl: r.mg_dl, context: r.context, target: target || null, above_target: target ? r.mg_dl >= target : null };
  });
  const out = { points, count: all.length, latest: points[points.length - 1] || null, targets: GLUCOSE_TARGET };
  if (!all.length) return out;

  // Only readings with a target context (fasting / after a meal) can be judged; "random" has no target here.
  const week = points.filter((p) => p.target && now - Date.parse(p.at) <= 7 * DAY_MS);
  const above = week.filter((p) => p.above_target);
  out.last_7_days = { judged_readings: week.length, above_target: above.length };
  if (above.length >= 2) {
    const contexts = [...new Set(above.map((p) => GLUCOSE_LABEL[p.context]))].join(', ');
    signals.push({ code: 'glucose_repeat_high', level: 'watch', title: 'Blood sugar above the usual pregnancy targets more than once this week',
      detail: `${above.length} of ${week.length} readings (${contexts}) were at or above the usual targets. Share the log with your doctor this week — do not change medicines on your own.` });
  }
  return out;
}

function analyseWeight(rows) {
  const all = sortAsc(rows).filter((r) => Number.isFinite(r.kg));
  const points = all.map((r) => ({ at: new Date(r.t).toISOString(), kg: r.kg }));
  return { points, count: all.length, latest: points[points.length - 1] || null };
}

function analyseAssessments(rows) {
  const all = sortAsc(rows).filter((r) => r.risk_level in RISK_RANK);
  const points = all.map((r) => ({ at: new Date(r.t).toISOString(), risk_level: r.risk_level, rank: RISK_RANK[r.risk_level], trigger: r.trigger || null }));
  const out = { points, count: points.length, latest: points[points.length - 1] || null, change: null };
  if (points.length >= 2) {
    const a = points[points.length - 2], b = points[points.length - 1];
    out.change = { from: a.risk_level, to: b.risk_level, direction: b.rank > a.rank ? 'up' : (b.rank < a.rank ? 'down' : 'same') };
  }
  return out;
}

/**
 * @param {{bp:[{at,systolic,diastolic}], glucose:[{at,mg_dl,context}], weight:[{at,kg}], assessments:[{at,risk_level,trigger}]}} data
 * @param {number} nowMs
 */
function analyseTrend(data, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const signals = [];
  const bp = analyseBP(data.bp || [], now, signals);
  const glucose = analyseGlucose(data.glucose || [], now, signals);
  const weight = analyseWeight(data.weight || []);
  const assessments = analyseAssessments(data.assessments || []);

  if (assessments.change && assessments.change.direction === 'up') {
    signals.push({ code: 'risk_up', level: 'watch', title: `Risk level moved up: ${assessments.change.from} → ${assessments.change.to}`,
      detail: 'Open "Why this level?" to see which readings changed. Mention it to your doctor.' });
  } else if (assessments.change && assessments.change.direction === 'down') {
    signals.push({ code: 'risk_down', level: 'info', title: `Risk level moved down: ${assessments.change.from} → ${assessments.change.to}`,
      detail: 'Your recent readings look better than before. Keep logging so this stays accurate.' });
  }

  const rank = { urgent: 0, watch: 1, info: 2 };
  signals.sort((a, b) => rank[a.level] - rank[b.level]);

  const overall = signals.some((s) => s.level === 'urgent') ? 'urgent' : (signals.some((s) => s.level === 'watch') ? 'watch' : 'ok');
  return { overall, signals, bp, glucose, weight, assessments };
}

module.exports = { analyseTrend, bpClass, slopePerWeek, BP, GLUCOSE_TARGET };
