'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), express = require('express');
const F = require('./facilityFreshness');
const { rankFacilities, parsePreferences } = require('./facilityMatching');

const NOW = Date.parse('2026-10-24T10:00:00Z'), DAY = 86400000, HOUR = 3600000;
const ago = (ms) => new Date(NOW - ms).toISOString();

test('confirmation reports the real date and age, and never pretends an unconfirmed entry was verified', () => {
  assert.equal(F.confirmation({ verified_at: ago(10 * DAY) }, NOW).status, 'recent');
  assert.equal(F.confirmation({ verified_at: ago(200 * DAY) }, NOW).status, 'ageing');
  assert.equal(F.confirmation({ verified_at: ago(500 * DAY) }, NOW).status, 'stale');
  const dir = F.confirmation({ verified_at: null, verification_source: 'public_directory_compilation', last_updated: ago(3 * DAY) }, NOW);
  assert.equal(dir.status, 'unconfirmed'); assert.equal(dir.last_confirmed_at, null);
  assert.match(dir.label, /Never confirmed with the facility/); assert.match(dir.label, /2026-10-21/);
  assert.equal(F.confirmation({ verified_at: null }, NOW).status, 'unconfirmed');
  assert.equal(F.confirmation({ verification_source: 'synthetic_fixture', verified_at: ago(DAY) }, NOW).status, 'synthetic');
});

test('contact reliability stays hidden until enough reports exist and is labelled as unverified user reports', () => {
  assert.equal(F.contact(undefined).reliability, 'not_enough_reports');
  assert.equal(F.contact({ reached: 4, not_reached: 0 }).reliability, 'not_enough_reports');
  assert.equal(F.contact({ reached: 5, not_reached: 0 }).reliability, 'mostly_reachable');
  assert.equal(F.contact({ reached: 3, not_reached: 3 }).reliability, 'often_unreachable');
  assert.equal(F.contact({ reached: 4, not_reached: 2 }).reliability, 'mixed');
  assert.match(F.contact({ reached: 6, not_reached: 0 }).label, /not verified/);
});

test('reported availability ignores past slots, flags stale reports and says it is not a booking', () => {
  const slot = (startsIn, updatedAgo) => ({ starts_at: new Date(NOW + startsIn).toISOString(), updated_at: ago(updatedAgo), source: 'facility_front_desk' });
  assert.equal(F.availability([], NOW).status, 'none_reported');
  assert.equal(F.availability([slot(-HOUR, HOUR)], NOW).status, 'none_reported');
  assert.equal(F.availability([slot(DAY, 2 * HOUR)], NOW).status, 'reported');
  assert.equal(F.availability([slot(DAY, 100 * HOUR)], NOW).status, 'stale');
  assert.match(F.availability([slot(DAY, HOUR)], NOW).label, /not a booking/);
});

test('freshness carries no score or rank, and does not modify its input', () => {
  const f = { id: 1, verified_at: ago(5 * DAY), verification_source: 'manual_verification', services: [{ service_name: 'Antenatal care' }], slots: [] };
  const copy = JSON.stringify(f);
  const out = F.describeFreshness(f, { reached: 5, not_reached: 0 }, NOW);
  assert.equal(JSON.stringify(f), copy);
  assert.equal(/score|rank|best|rating/i.test(Object.keys(out).concat(Object.keys(out.confirmation)).join(' ')), false);
  assert.match(out.services.basis, /not separately verified/);
});

test('the ranking module never reads freshness data', () => {
  const src = fs.readFileSync(path.join(__dirname, 'facilityMatching.js'), 'utf8');
  assert.equal(/facilityFreshness|freshness|contact_report/.test(src), false);
});

test('search adds freshness after ranking without changing order; contact reports are validated and rate-limited', async () => {
  const rows = [
    { id: 1, name: 'A', active: true, latitude: 28.61, longitude: 77.2, verified_at: ago(5 * DAY), verification_source: 'manual_verification', services: [], capabilities: [], slots: [], languages: [] },
    { id: 2, name: 'B', active: true, latitude: 28.7, longitude: 77.3, verified_at: null, verification_source: 'public_directory_compilation', last_updated: ago(DAY), services: [], capabilities: [], slots: [], languages: [] }
  ];
  const reports = [];
  const pool = { async query(sql, params) {
    if (/FROM facility_contact_reports WHERE created_at/.test(sql)) return { rows: [{ facility_id: 2, reached: '1', not_reached: '5' }] };
    if (/FROM facilities f WHERE f.active/.test(sql)) return { rows };
    if (/SELECT 1 FROM facilities WHERE id/.test(sql)) return { rows: params[0] === 1 ? [{}] : [] };
    if (/FROM facility_contact_reports WHERE facility_id/.test(sql)) return { rows: reports.filter((r) => r.f === params[0] && r.u === params[1]).length ? [{}] : [] };
    if (/INSERT INTO facility_contact_reports/.test(sql)) { reports.push({ f: params[0], u: params[1], o: params[2] }); return { rows: [] }; }
    throw new Error('Unexpected query: ' + sql.slice(0, 60));
  } };
  const app = express(); app.use(express.json());
  const authenticateToken = (req, res, next) => { req.user = { id: Number(req.headers['x-user'] || 1), role: 'mother' }; next(); };
  const authorizeRole = () => (req, res, next) => next();
  require('./facilityDiscovery')(app, { pool, authenticateToken, authorizeRole });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const call = async (url, method = 'GET', body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
    const res = await call('/api/facilities/search?limit=10');
    assert.equal(res.status, 200);
    const expected = rankFacilities(rows, parsePreferences({ limit: '10' })).map((f) => f.id);
    assert.deepEqual(res.data.facilities.map((f) => f.id), expected);                 // same order as pure ranking
    assert.ok(res.data.facilities.every((f) => f.freshness && f.freshness.confirmation));
    const two = res.data.facilities.find((f) => f.id === 2).freshness;
    assert.equal(two.confirmation.status, 'unconfirmed'); assert.equal(two.contact.reliability, 'often_unreachable');
    assert.equal(res.data.facilities.find((f) => f.id === 1).freshness.contact.reliability, 'not_enough_reports');
    assert.equal((await call('/api/facilities/1/contact-report', 'POST', { outcome: 'great' })).status, 400);
    assert.equal((await call('/api/facilities/9/contact-report', 'POST', { outcome: 'reached' })).status, 404);
    assert.equal((await call('/api/facilities/1/contact-report', 'POST', { outcome: 'reached' })).status, 201);
    assert.equal((await call('/api/facilities/1/contact-report', 'POST', { outcome: 'reached' })).status, 429);
  } finally { server.close(); }
});
