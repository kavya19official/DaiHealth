'use strict';

// Pure-logic tests for predictive risk trend, postpartum rules and emergency triage.
// No database needed:  node --test careRules.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseTrend, bpClass } = require('./riskTrend');
const { assessRisk } = require('./riskAssessment');
const PP = require('../shared/postpartum-rules');
const EM = require('../shared/emergency-triage');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const daysAgo = (n, h = 0) => new Date(NOW - n * 86400000 - h * 3600000).toISOString();

/* ---------------------------------------------------------------- risk trend */
test('bpClass thresholds', () => {
  assert.equal(bpClass(118, 76), 'normal');
  assert.equal(bpClass(132, 78), 'borderline');
  assert.equal(bpClass(140, 85), 'high');
  assert.equal(bpClass(128, 90), 'high');
  assert.equal(bpClass(160, 100), 'severe');
  assert.equal(bpClass(150, 110), 'severe');
});

test('trend: too few readings says so instead of guessing', () => {
  const r = analyseTrend({ bp: [{ at: daysAgo(1), systolic: 150, diastolic: 95 }, { at: daysAgo(0), systolic: 152, diastolic: 96 }] }, NOW);
  assert.equal(r.bp.trend.direction, 'insufficient');
});

test('trend: steadily rising BP is detected and flagged as a watch', () => {
  const bp = [[20, 118, 76], [14, 124, 79], [8, 131, 83], [2, 137, 87]].map(([d, s, di]) => ({ at: daysAgo(d), systolic: s, diastolic: di }));
  const r = analyseTrend({ bp }, NOW);
  assert.equal(r.bp.trend.direction, 'rising');
  assert.ok(r.bp.trend.systolic_per_week > 4);
  assert.ok(r.signals.some((s) => s.code === 'bp_rising' && s.level === 'watch'));
  assert.equal(r.overall, 'watch');
});

test('trend: two high readings in a week is urgent', () => {
  const bp = [{ at: daysAgo(5), systolic: 120, diastolic: 78 }, { at: daysAgo(3), systolic: 144, diastolic: 92 }, { at: daysAgo(1), systolic: 146, diastolic: 94 }];
  const r = analyseTrend({ bp }, NOW);
  assert.ok(r.signals.some((s) => s.code === 'bp_repeat_high' && s.level === 'urgent'));
  assert.equal(r.overall, 'urgent');
});

test('trend: severe reading within 24h is urgent; the same reading last week is not a "severe now" signal', () => {
  const recent = analyseTrend({ bp: [{ at: daysAgo(0, 3), systolic: 168, diastolic: 112 }] }, NOW);
  assert.ok(recent.signals.some((s) => s.code === 'bp_severe'));
  const old = analyseTrend({ bp: [{ at: daysAgo(6), systolic: 168, diastolic: 112 }] }, NOW);
  assert.ok(!old.signals.some((s) => s.code === 'bp_severe'));
});

test('trend: one high reading is only a "watch", with advice to recheck', () => {
  const r = analyseTrend({ bp: [{ at: daysAgo(0, 2), systolic: 142, diastolic: 88 }] }, NOW);
  assert.deepEqual(r.signals.map((s) => s.code), ['bp_one_high']);
  assert.equal(r.signals[0].level, 'watch');
});

test('trend: stale data is called out', () => {
  const r = analyseTrend({ bp: [{ at: daysAgo(30), systolic: 118, diastolic: 76 }] }, NOW);
  assert.ok(r.signals.some((s) => s.code === 'bp_stale' && s.level === 'info'));
  assert.equal(r.overall, 'ok');
});

test('glucose: "random" readings are never judged against a target; repeated high fasting is a watch', () => {
  const none = analyseTrend({ glucose: [{ at: daysAgo(1), mg_dl: 250, context: 'random' }, { at: daysAgo(2), mg_dl: 240, context: 'random' }] }, NOW);
  assert.ok(!none.signals.some((s) => s.code === 'glucose_repeat_high'));
  const hi = analyseTrend({ glucose: [{ at: daysAgo(1), mg_dl: 101, context: 'fasting' }, { at: daysAgo(3), mg_dl: 98, context: 'fasting' }, { at: daysAgo(4), mg_dl: 88, context: 'fasting' }] }, NOW);
  const s = hi.signals.find((x) => x.code === 'glucose_repeat_high');
  assert.ok(s && s.level === 'watch');
  assert.match(s.detail, /do not change medicines/);
});

test('risk level change produces a signal in the right direction', () => {
  const up = analyseTrend({ assessments: [{ at: daysAgo(6), risk_level: 'low risk' }, { at: daysAgo(1), risk_level: 'mid risk' }] }, NOW);
  assert.equal(up.assessments.change.direction, 'up');
  assert.ok(up.signals.some((s) => s.code === 'risk_up'));
  const down = analyseTrend({ assessments: [{ at: daysAgo(6), risk_level: 'high risk' }, { at: daysAgo(1), risk_level: 'mid risk' }] }, NOW);
  assert.ok(down.signals.some((s) => s.code === 'risk_down' && s.level === 'info'));
});

/* ----------------------------------------------------------- risk explanation */
test('explanation: describes neighbours, names what stands out, and states the caveat', () => {
  const r = assessRisk({ age: 30, systolic: 150, diastolic: 96, blood_sugar: 9 });
  assert.ok(r.explanation.summary[0].includes('most similar records'));
  assert.equal(r.explanation.drivers[0].code, 'sbp');
  assert.match(r.explanation.caveat, /not a diagnosis/);
});

test('explanation: says when a clinical rule overrode the model, and lists guessed inputs', () => {
  // Normal vitals but known diabetes + a high-severity factor pushes a "low risk" kNN result up.
  const r = assessRisk({ age: 26, systolic: 112, diastolic: 72, preexisting_diabetes: true });
  if (r.knn_level === 'low risk') {
    assert.equal(r.explanation.escalated, true);
    assert.ok(r.explanation.summary.some((l) => l.startsWith('Clinical rules raised the level')));
  }
  assert.ok(r.explanation.data_gaps.some((g) => /Blood sugar was not logged/.test(g)));
  assert.equal(r.risk_level === 'low risk', false);
});

/* ------------------------------------------------------------------ postpartum */
test('postpartum: day maths and phases', () => {
  assert.equal(PP.daysBetween('2026-10-01', '2026-10-21'), 20);
  assert.equal(PP.phaseFor(0).code, 'first_24h');
  assert.equal(PP.phaseFor(5).code, 'first_week');
  assert.equal(PP.phaseFor(30).code, 'early_weeks');
  assert.equal(PP.phaseFor(60).code, 'fourth_trimester');
  assert.equal(PP.phaseFor(200).code, 'beyond');
  assert.equal(PP.phaseFor(-1), null);
});

test('postpartum: contact status — open, overdue, upcoming, done', () => {
  const s = PP.schedule('2026-10-01', '2026-10-21', { pnc_24h: '2026-10-02' }); // day 20
  const by = Object.fromEntries(s.map((c) => [c.code, c.status]));
  assert.equal(by.pnc_24h, 'done');
  assert.equal(by.pnc_day3, 'overdue');
  assert.equal(by.bp_check, 'overdue');
  assert.equal(by.pnc_week2, 'overdue');
  assert.equal(by.pnc_week6, 'upcoming');
  const day4 = PP.schedule('2026-10-01', '2026-10-05', {});          // day 4
  assert.equal(day4.find((c) => c.code === 'pnc_week2').status, 'upcoming');
  assert.equal(day4.find((c) => c.code === 'bp_check').status, 'open');
  assert.equal(day4.find((c) => c.code === 'pnc_day3').status, 'open');
  assert.equal(PP.schedule('2026-10-01', '2026-10-09', {}).find((c) => c.code === 'pnc_week2').status, 'open'); // day 8
});

const clean = (o) => { const r = PP.sanitizeCheckin(o); assert.ok(r.answers, r.error); return r.answers; };

test('check-in sanitising rejects bad input and drops unknown keys', () => {
  assert.ok(PP.sanitizeCheckin({ bleeding: 'torrent' }).error);
  assert.ok(PP.sanitizeCheckin({ bp_systolic: 120 }).error);            // only one BP number
  assert.ok(PP.sanitizeCheckin({ bp_systolic: 80, bp_diastolic: 90 }).error);
  assert.ok(PP.sanitizeCheckin({ temp_f: 40 }).error);
  assert.ok(PP.sanitizeCheckin({ phq2_interest: 2 }).error);            // only one mood answer
  const a = clean({ bleeding: 'light', evil: 'x', __proto__: { x: 1 } });
  assert.equal('evil' in a, false);
});

test('check-in: a normal day is ok', () => {
  const e = PP.evaluateCheckin(clean({ bleeding: 'light', pain: 2, temp_f: 98.4, bp_systolic: 112, bp_diastolic: 72, phq2_interest: 0, phq2_mood: 1 }), { daysPP: 5 });
  assert.equal(e.level, 'ok');
  assert.deepEqual(e.flags, []);
});

test('check-in: emergencies', () => {
  const lvl = (o, d = 5) => PP.evaluateCheckin(clean(o), { daysPP: d }).level;
  assert.equal(lvl({ bleeding: 'heavy' }), 'emergency');
  assert.equal(lvl({ chest_or_breath: true }), 'emergency');
  assert.equal(lvl({ fits_or_faint: true }), 'emergency');
  assert.equal(lvl({ self_harm: true }), 'emergency');
  assert.equal(lvl({ bp_systolic: 164, bp_diastolic: 104 }), 'emergency');
  assert.equal(lvl({ headache_severe: true, vision_changes: true }), 'emergency');
  assert.equal(lvl({ headache_severe: true, bp_systolic: 146, bp_diastolic: 92 }), 'emergency');
});

test('check-in: urgent and watch', () => {
  const lvl = (o, d = 5) => PP.evaluateCheckin(clean(o), { daysPP: d }).level;
  assert.equal(lvl({ bp_systolic: 142, bp_diastolic: 90 }), 'urgent');
  assert.equal(lvl({ temp_f: 100.6 }), 'urgent');
  assert.equal(lvl({ calf_pain: true }), 'urgent');
  assert.equal(lvl({ wound_problem: true }), 'urgent');
  assert.equal(lvl({ baby_concern: true }), 'urgent');
  assert.equal(lvl({ headache_severe: true }), 'urgent');
  assert.equal(lvl({ pain: 9 }), 'urgent');
  assert.equal(lvl({ breast_problem: true }), 'watch');
  assert.equal(lvl({ breast_problem: true, temp_f: 101 }), 'urgent');
  assert.equal(lvl({ phq2_interest: 2, phq2_mood: 2 }), 'watch');
  assert.equal(lvl({ phq2_interest: 1, phq2_mood: 1 }), 'ok');
  assert.equal(lvl({ bp_systolic: 134, bp_diastolic: 84 }), 'watch');
  assert.equal(lvl({ bleeding: 'moderate' }, 5), 'ok');
  assert.equal(lvl({ bleeding: 'moderate' }, 20), 'watch');
});

test('check-in: flags are sorted most severe first', () => {
  const e = PP.evaluateCheckin(clean({ bleeding: 'heavy', temp_f: 101, phq2_interest: 3, phq2_mood: 3 }), { daysPP: 5 });
  assert.deepEqual(e.flags.map((f) => f.level), ['emergency', 'urgent', 'watch']);
});

/* ------------------------------------------------------------------- emergency */
test('triage: no symptoms is "unsure" and still tells her to get help if worried', () => {
  const t = EM.triage([], { context: 'pregnant' });
  assert.equal(t.level, 'unsure');
  assert.match(t.steps[0], /call your doctor/i);
});

test('triage: highest level wins; unknown and wrong-context codes are ignored', () => {
  const t = EM.triage(['fever', 'seizure', 'nonsense', 'pp_calf'], { context: 'pregnant' });
  assert.equal(t.level, 'emergency');
  assert.deepEqual(t.matched.map((m) => m.code).sort(), ['fever', 'seizure']);
  assert.equal(EM.triage(['fever'], { context: 'pregnant' }).level, 'urgent');
});

test('triage: labour signs before 37 weeks — or with unknown gestation — are emergencies', () => {
  assert.equal(EM.triage(['contractions'], { context: 'pregnant', gestWeeks: 39 }).level, 'urgent');
  assert.equal(EM.triage(['contractions'], { context: 'pregnant', gestWeeks: 33 }).level, 'emergency');
  assert.equal(EM.triage(['waters_break'], { context: 'pregnant' }).level, 'emergency');
});

test('triage: a fresh severe BP escalates on its own; a stale one is ignored', () => {
  const fresh = EM.triage([], { context: 'pregnant', latestBP: { systolic: 166, diastolic: 108, hoursAgo: 3 } });
  assert.equal(fresh.level, 'emergency');
  const stale = EM.triage([], { context: 'pregnant', latestBP: { systolic: 166, diastolic: 108, hoursAgo: 60 } });
  assert.equal(stale.level, 'unsure');
  assert.equal(EM.triage(['fever'], { context: 'pregnant', latestBP: { systolic: 144, diastolic: 92, hoursAgo: 5 } }).level, 'urgent');
});

test('triage: self-harm adds the mental-health helpline and a safety step', () => {
  const t = EM.triage(['pp_self_harm'], { context: 'postpartum' });
  assert.equal(t.level, 'emergency');
  assert.ok(t.numbers.some((n) => n.number === '14416'));
  assert.ok(t.firstAid.some((l) => /not stay alone/i.test(l)));
});

test('triage never claims a facility was told or accepted her', () => {
  const t = EM.triage(['heavy_bleeding'], { context: 'postpartum' });
  const blob = JSON.stringify(t).toLowerCase();
  for (const bad of ['accepted', 'notified the hospital', 'bed available', 'beds available', 'we have informed']) assert.ok(!blob.includes(bad), bad);
});

test('summary: missing data is "Not recorded", never invented; readings carry their age', () => {
  const s = EM.buildSummary({
    name: 'Asha', age: 27, context: 'pregnant', gestWeeks: null, symptoms: ['reduced_movement'],
    latestBP: { systolic: 138, diastolic: 88, at: daysAgo(2) }, contact: { name: 'Ravi', phone: '9876543210' }
  }, NOW);
  assert.match(s.text, /Gestation: Not recorded/);
  assert.match(s.text, /Allergies: Not recorded/);
  assert.match(s.text, /Last blood sugar: Not recorded/);
  assert.match(s.text, /138\/88 mmHg \(logged 2 days ago\)/);
  assert.match(s.text, /Ravi · 9876543210/);
  assert.match(s.disclaimer, /does not mean any facility has been informed/);
  assert.equal(s.triage_level, 'urgent');
});

test('summary: postpartum context shows days since delivery, not gestation', () => {
  const s = EM.buildSummary({ context: 'postpartum', daysPostpartum: 6, deliveryType: 'caesarean', symptoms: ['heavy_bleeding'] }, NOW);
  assert.match(s.text, /Days since delivery: 6/);
  assert.match(s.text, /Delivery type: caesarean/);
  assert.ok(!/Gestation/.test(s.text));
});
