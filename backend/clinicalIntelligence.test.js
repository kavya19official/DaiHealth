'use strict';
// Unit tests for the deterministic clinical intelligence engine (no DB required for pure functions).
const test = require('node:test');
const assert = require('node:assert/strict');
const { comparisons, careGaps, gestationFor, RULES } = require('./clinicalIntelligence');

const gest = { weeks: 28, days: 4 };

test('gestationFor prefers latest ANC visit GA over EDD', () => {
  const mother = { estimated_delivery_date: '2026-12-01' };
  const visits = [
    { visit_date: '2026-08-01', gestational_weeks: 20, gestational_days: 0, id: 1 },
    { visit_date: '2026-09-01', gestational_weeks: 24, gestational_days: 2, id: 2 },
  ];
  const g = gestationFor(mother, visits, '2026-09-15');
  assert.ok(g.weeks >= 26 && g.weeks <= 27, `expected ~26w, got ${g.weeks}`);
});

test('gestationFor falls back to EDD when no visits', () => {
  const g = gestationFor({ estimated_delivery_date: '2026-12-01' }, [], '2026-09-15');
  assert.ok(g && g.source === 'edd');
  assert.equal(gestForNull(), null);
  function gestForNull() { return gestationFor({}, [], '2026-09-15'); }
});

test('comparisons detects BP rise outside reference band', () => {
  const series = {
    bp_systolic: [
      { value: 118, on: '2026-08-01', id: 1 },
      { value: 146, on: '2026-09-01', id: 2 },
    ],
  };
  const cmps = comparisons(series, gest);
  assert.equal(cmps.length, 1);
  const c = cmps[0];
  assert.equal(c.current, 146);
  assert.equal(c.previous, 118);
  assert.equal(c.delta, 28);
  assert.match(c.observation, /outside reference range/i);
  assert.equal(c.reference_high, 140);
});

test('comparisons reports stable values without inventing observations', () => {
  const series = { weight_kg: [
    { value: 59.2, on: '2026-08-01', id: 1 },
    { value: 59.3, on: '2026-09-01', id: 2 },
  ] };
  const cmps = comparisons(series, gest);
  assert.equal(cmps[0].observation, 'Increased');
});

test('careGaps marks overdue investigation past its week', () => {
  const gaps = careGaps({ weeks: 30, days: 0 }, [], []);
  const bg = gaps.find(g => g.key === 'blood_group');
  assert.equal(bg.status, 'overdue');
  const early = careGaps({ weeks: 10, days: 0 }, [], []);
  assert.equal(early.find(g => g.key === 'blood_group').status, 'pending');
});

test('careGaps completes when matching investigation exists', () => {
  const gaps = careGaps({ weeks: 30, days: 0 }, [{ test_code: 'haemoglobin' }], []);
  assert.equal(gaps.find(g => g.key === 'haemoglobin').status, 'completed');
});

test('rules file has no generic adult ranges applied blindly', () => {
  // Hb uses trimester bands, not a single adult range
  const hb = RULES.parameters.hb;
  assert.ok(hb.gestation_bands.length >= 2);
  assert.ok(hb.gestation_bands.every(b => b.low != null && b.high != null));
});
