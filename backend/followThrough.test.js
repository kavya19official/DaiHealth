'use strict';
// L. Checks that do not need a database: only real schedule items are accepted, reasons come from a fixed
// list, and the postnatal schedule statuses the reminders rely on behave as expected.
const test = require('node:test'), assert = require('node:assert/strict');
const PP = require('../shared/postpartum-rules'), Ref = require('../shared/child-reference');
const { validate, REASONS } = require('./followThrough');

test('only real postnatal visits and vaccines can be given a delay reason', () => {
  assert.deepEqual(validate({ kind: 'postpartum_contact', item_code: PP.CONTACTS[0].code }), { kind: 'postpartum_contact', code: PP.CONTACTS[0].code });
  assert.deepEqual(validate({ kind: 'vaccine', item_code: 'bcg' }), { kind: 'vaccine', code: 'bcg' });
  for (const bad of [{ kind: 'vaccine', item_code: 'made_up' }, { kind: 'vaccine', item_code: '__proto__' }, { kind: 'postpartum_contact', item_code: 'bcg' }, { kind: 'other', item_code: 'x' }, {}, null])
    assert.ok(validate(bad).error, JSON.stringify(bad));
});

test('the reason list includes clinician advice and never offers a free-form medical reason', () => {
  assert.ok(REASONS.clinician_advised); assert.ok(REASONS.vaccine_unavailable); assert.ok(REASONS.other);
  assert.ok(Object.values(REASONS).every((t) => typeof t === 'string' && t.length < 80));
});

test('postnatal contacts are overdue only after their window, so reminders do not fire early', () => {
  const by = (today) => Object.fromEntries(PP.schedule('2026-10-01', today, {}).map((c) => [c.code, c.status]));
  const early = by('2026-10-02'), late = by('2026-10-30');
  assert.equal(early.pnc_week6, 'upcoming'); assert.equal(late.pnc_week6, 'upcoming');
  assert.equal(late.pnc_24h, 'overdue');
  assert.equal(PP.schedule('2026-10-01', '2026-10-30', { pnc_24h: '2026-10-01' }).find((c) => c.code === 'pnc_24h').status, 'done');
});

test('vaccine schedule marks a late dose as missed and a given dose as completed', () => {
  const s = Ref.vaccineSchedule('2026-01-01', {}, '2026-10-01'), bcg = s.find((v) => v.code === 'bcg');
  assert.equal(bcg.status, 'missed');
  const given = Ref.vaccineSchedule('2026-01-01', { bcg: '2026-01-02' }, '2026-10-01').find((v) => v.code === 'bcg');
  assert.equal(given.status, 'completed');
});
