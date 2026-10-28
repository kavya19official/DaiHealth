'use strict';
// N. Privacy rules, tested without a database: the engine is pure, and the HTTP layer runs against a fake pool.
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express');
const A = require('./privacyAnalytics');

const row = (key, people, total, positive, durations) => ({ key, label: 'Facility ' + key, people, total, positive, ...(durations ? { durations, duration_people: durations.length } : {}) });
const report = (rows, metric = 'missed_visits') => A.buildReport({ metric, groupBy: 'facility', windowDays: 90, rows });

test('groups with fewer than K people are hidden and carry no numbers at all', () => {
  const r = report([row('a', 9, 40, 10), row('b', 10, 40, 10), row('c', 3, 4, 1)]);
  const a = r.rows.find((x) => x.key === 'a'), c = r.rows.find((x) => x.key === 'c');
  for (const hidden of [a, c]) {
    assert.equal(hidden.suppressed, true);
    assert.deepEqual(Object.keys(hidden).sort(), ['key', 'label', 'reason', 'suppressed']);   // nothing else leaks
  }
  assert.equal(r.rows.find((x) => x.key === 'b').suppressed, false);
  assert.equal(r.hidden_groups, 2); assert.equal(A.K_MIN, 10);
});

test('no overall total or exact count is returned, so hidden groups cannot be recovered by subtraction', () => {
  const r = report([row('a', 4, 4, 1), row('b', 25, 100, 20)]);
  assert.equal('overall' in r, false); assert.equal('total' in r, false);
  const shown = r.rows.find((x) => x.key === 'b');
  assert.equal('people' in shown, false); assert.equal('total' in shown, false); assert.equal('positive' in shown, false);
  assert.equal(shown.people_band, '20\u201349');
  assert.match(JSON.stringify(r), /^(?!.*"people":)/);
});

test('rates are exact only when events and non-events are both numerous enough', () => {
  assert.deepEqual(A.rateCell(20, 100), { rate_pct: 20, rate_text: '20%' });
  assert.equal(A.rateCell(1, 50).rate_text, 'under 30%'); assert.equal(A.rateCell(1, 50).rate_pct, null);
  assert.equal(A.rateCell(0, 50).rate_text, 'under 30%');
  assert.equal(A.rateCell(49, 50).rate_text, 'over 70%');
  assert.equal(A.rateCell(0, 0).rate_text, 'No data');
});

test('a median is shown only with enough completed cases', () => {
  const few = report([row('a', 30, 30, 4, [1, 2, 3, 4])], 'time_to_follow_up').rows[0];
  assert.equal(few.median_days, null); assert.ok(few.median_note);
  const enough = report([row('a', 30, 30, 5, [1, 2, 3, 4, 10])], 'time_to_follow_up').rows[0];
  assert.equal(enough.median_days, 3);
  assert.equal(A.median([1, 3]), 2); assert.equal(A.median([]), null);
});

test('people are banded and the band edges are right', () => {
  assert.deepEqual([10, 19, 20, 49, 50, 99, 100, 500].map(A.peopleBand), ['10\u201319', '10\u201319', '20\u201349', '20\u201349', '50\u201399', '50\u201399', '100+', '100+']);
});

test('CSV contains exactly the published rows, hides suppressed ones and blocks spreadsheet formulas', () => {
  const r = report([{ ...row('a', 30, 100, 20), label: '=HYPERLINK("http://x")' }, row('b', 2, 2, 1)]);
  const csv = A.reportToCsv(r);
  assert.match(csv, /^# DaiHealth aggregate analytics/);
  assert.match(csv, /minimum_group_size=10/);
  assert.ok(csv.includes("'=HYPERLINK"));                          // neutralised
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  const body = csv.split('\r\n').filter((l) => l && !l.startsWith('#')).slice(1);
  assert.equal(body.length, 2);
  assert.match(body[1], /hidden,hidden/);                          // suppressed row has no values
  assert.equal(/"?20%"?/.test(body[1]), false);
});

test('repeated events from one person cannot unlock a median; invalid durations are ignored', () => {
 const r=report([{...row('a',20,20,10,[null,'',-1,1,2,3,4,5]),duration_people:1}], 'time_to_follow_up');
 assert.equal(r.rows[0].median_days,null);
 assert.match(r.rows[0].median_note,/distinct people/);
});
