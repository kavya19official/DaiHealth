'use strict';

// Pure-logic tests for shared/child-reference.js (no database needed).
const assert = require('node:assert/strict');
const test = require('node:test');
const Ref = require('../shared/child-reference.js');

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} ±${tol}, got ${actual}`);

test('WHO growth standards reproduce published reference values', () => {
  // Published WHO weight-for-age, boys: birth median 3.3, 6 months -2SD 6.4 / -3SD 5.7
  near(Ref.growthValueAtZ('wfa', 'male', 0, 0), 3.3, 0.06, 'boy birth median');
  near(Ref.growthValueAtZ('wfa', 'male', 6, -2), 6.4, 0.06, 'boy 6m -2SD');
  near(Ref.growthValueAtZ('wfa', 'male', 6, -3), 5.7, 0.06, 'boy 6m -3SD');
  // Girls length-for-age 24 months median 85.7 cm; boys head circumference 12 months median 46.1 cm
  near(Ref.growthValueAtZ('lhfa', 'female', 24, 0), 85.7, 0.1, 'girl 24m length');
  near(Ref.growthValueAtZ('hcfa', 'male', 12, 0), 46.1, 0.1, 'boy 12m head');
  // z-score and value are inverses
  near(Ref.growthZ('wfa', 'female', 9, Ref.growthValueAtZ('wfa', 'female', 9, -1.7)), -1.7, 1e-9, 'round trip');
});

test('percentiles and statuses', () => {
  near(Ref.zToPercentile(0), 50, 0.01);
  near(Ref.zToPercentile(-2), 2.28, 0.05);
  near(Ref.zToPercentile(1), 84.13, 0.05);
  assert.equal(Ref.growthStatus('wfa', -3.2), 'severe');
  assert.equal(Ref.growthStatus('wfa', -2.1), 'low');
  assert.equal(Ref.growthStatus('wfa', 0), 'ok');
  assert.equal(Ref.growthStatus('hcfa', 2.4), 'high');
  assert.equal(Ref.growthStatus('lhfa', 2.4), 'ok');   // tall is only flagged beyond +3
  assert.equal(Ref.growthStatus('lhfa', 3.1), 'high');
  assert.equal(Ref.growthStatus('wfa', null), null);
});

test('weightStatus keeps its old contract and now covers 0–60 months', () => {
  assert.equal(Ref.weightStatus('male', 6, 5.0), 'severe');
  assert.equal(Ref.weightStatus('male', 6, 6.0), 'low');
  assert.equal(Ref.weightStatus('male', 6, 7.9), 'ok');
  assert.equal(Ref.weightStatus('male', 6, 12), 'ok');          // heavy is never reported as a weight flag
  assert.equal(Ref.weightStatus('male', 30, 10.5), 'low');      // beyond the old 12-month limit
  assert.equal(Ref.weightStatus('male', 61, 18), null);          // outside the standard
  assert.equal(Ref.weightStatus('other', 6, 7), null);           // no reference for 'other'
  assert.equal(Ref.growthAssess('wfa', 'other', 6, 7), null);
  assert.equal(Ref.growthAssess('wfa', 'male', 6, -1), null);
});

test('growthCurves returns ordered reference lines clipped to 0–60 months', () => {
  const c = Ref.growthCurves('wfa', 'female', 0, 100, 3);
  assert.deepEqual(Object.keys(c).sort(), ['-2', '-3', '0', '2', '3']);
  assert.equal(c[0][0].m, 0);
  assert.ok(c[0][c[0].length - 1].m <= 60);
  c[0].forEach((p, i) => { assert.ok(c[-2][i].v < p.v && p.v < c[2][i].v); });
  assert.equal(Ref.growthCurves('wfa', 'other', 0, 12), null);
});

test('chartAgeMonths uses corrected age for babies born early, until two', () => {
  // born at 32 weeks => 8 weeks (56 days) early
  near(Ref.chartAgeMonths('2026-01-01', '2026-05-01', 32), (120 - 56) / 30.4375, 1e-9);
  near(Ref.chartAgeMonths('2026-01-01', '2026-05-01', 39), 120 / 30.4375, 1e-9);
  near(Ref.chartAgeMonths('2022-01-01', '2026-01-01', 32), 1461 / 30.4375, 1e-9);   // past two: chronological
});

test('vaccine reminders: coming up / due / missed windows, optional never nags', () => {
  const dob = '2026-01-01';
  const at = (today) => Ref.upcomingVaccines(Ref.vaccineSchedule(dob, {}, today)).map((v) => v.code + ':' + v.status);
  // opv1/penta1/rota1/fipv1 fall due on day 42 (2026-02-12). 15 days ahead: not yet a reminder.
  assert.ok(!at('2026-01-28').includes('opv1:upcoming'));
  // 14 days ahead: reminder starts
  assert.ok(at('2026-01-29').includes('opv1:upcoming'));
  // within a week: due
  assert.ok(at('2026-02-08').includes('opv1:due'));
  // pcv1 is state-dependent: never in reminders
  assert.ok(!at('2026-02-08').some((x) => x.startsWith('pcv1')));
  // given doses drop out
  const given = Ref.upcomingVaccines(Ref.vaccineSchedule(dob, { opv1: '2026-02-12' }, '2026-02-13')).map((v) => v.code);
  assert.ok(!given.includes('opv1'));
  assert.ok(Ref.SCHEDULE_SOURCE.name && Ref.SCHEDULE_SOURCE.disclaimer);
});

test('milestone checkpoints cover 2–60 months and report a status', () => {
  assert.deepEqual(Ref.MILESTONES.map((c) => c.months), [2, 4, 6, 9, 12, 15, 18, 24, 30, 36, 48, 60]);
  Ref.MILESTONES.forEach((c) => assert.equal(c.items.length, 4));
  const codes = Ref.MILESTONES.flatMap((c) => c.items.map((i) => i.code));
  assert.equal(new Set(codes).size, codes.length, 'milestone codes are unique');
  codes.forEach((code) => assert.ok(code.length <= 20, code + ' fits the VARCHAR(20) column'));

  const chk = Ref.MILESTONES.find((c) => c.months === 12);
  const all = Object.fromEntries(chk.items.map((i) => [i.code, '2026-01-01']));
  assert.equal(Ref.milestoneCheckpointStatus(13, chk, all).status, 'complete');
  assert.equal(Ref.milestoneCheckpointStatus(9, chk, {}).status, 'upcoming');
  assert.equal(Ref.milestoneCheckpointStatus(12, chk, {}).status, 'in_progress');
  assert.equal(Ref.milestoneCheckpointStatus(13.9, chk, {}).status, 'in_progress');
  assert.equal(Ref.milestoneCheckpointStatus(14, chk, {}).status, 'discuss');
  const one = { [chk.items[0].code]: '2026-01-01' };
  assert.deepEqual(Ref.milestoneCheckpointStatus(20, chk, one), { months: 12, status: 'discuss', done: 1, total: 4 });
});

test('health timeline merges every record, newest first, appointments flagged', () => {
  const child = { name: 'Asha', date_of_birth: '2026-01-01', born_at_weeks: 38, birth_weight_kg: 3.1, birth_length_cm: 49 };
  const tl = Ref.buildTimeline({
    child,
    vaccinations: [{ vaccine_code: 'bcg', given_on: '2026-01-02', facility: 'City Hospital' }],
    growth: [{ id: 7, measured_on: '2026-03-01', weight_kg: 5.2, height_cm: 58, head_cm: null }],
    milestones: [{ milestone_code: 'm2_smile', achieved_on: '2026-03-01' }],
    events: [{ id: 3, event_type: 'illness', title: 'Fever and cough', details: 'Rested, paracetamol per doctor', event_date: '2026-03-01', doctor_name: 'R. Rao', facility: null }],
    appointments: [
      { id: 1, requested_date: '2026-03-20', status: 'confirmed', reason: '4-month check-up', doctor_name: 'R. Rao', doctor_notes: null },
      { id: 2, requested_date: '2026-02-10', status: 'completed', reason: 'Vaccines', doctor_name: 'R. Rao', doctor_notes: 'All well' },
      { id: 3, requested_date: '2026-02-15', status: 'cancelled', reason: 'x', doctor_name: 'R. Rao' },
    ],
  }, '2026-03-10');

  assert.deepEqual(tl.map((e) => e.type), ['appointment', 'health', 'growth', 'milestone', 'appointment', 'vaccine', 'birth']);
  assert.equal(tl[0].upcoming, true);
  assert.equal(tl[0].title, 'Appointment with Dr. R. Rao');
  assert.equal(tl[4].upcoming, false);
  assert.equal(tl[4].title, 'Visit with Dr. R. Rao');
  assert.match(tl[4].detail, /Doctor’s note: All well/);
  assert.equal(tl.some((e) => e.refId === 3 && e.type === 'appointment'), false, 'cancelled appointments are left out');
  assert.equal(tl[2].detail, '5.2 kg · 58 cm');
  assert.equal(tl[3].detail, Ref.MILESTONES[0].items[1].text);
  assert.equal(tl[5].title, 'BCG given');
  assert.equal(tl[6].detail, 'born at 38 weeks · 3.1 kg · 49 cm');
  assert.deepEqual(Ref.buildTimeline({ child }, '2026-03-10').map((e) => e.type), ['birth']);
});
