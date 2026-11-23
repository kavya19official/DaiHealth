'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { register, matchesReport, reviewItems } = require('./doctorFollowupAgent');

test('chooses evidence checks from the approved task type and keeps undated tasks out of overdue', () => {
  assert.equal(matchesReport('CBC', 'Complete blood count report'), true);
  assert.equal(matchesReport('CBC', 'ECBC extract'), false);
  const items = reviewItems({
    id: 2,
    pending_tests: [{ name: 'CBC', due_date: '2025-03-01' }, { name: 'LFT', due_date: '2025-03-01' }],
    next_steps: ['Bring the care card'],
    follow_up: { due_date: '2025-03-01' },
    reports: [{ id: 1, title: 'Complete blood count report' }],
    next_visit: { id: 3, status: 'confirmed' },
    test_visits: [{ id: 4, reason: 'Full blood count', status: 'scheduled' }]
  }, '2025-03-02');
  assert.deepEqual(items.map(item => item.status), ['report_to_review', 'overdue', 'visit_to_check', 'check_manually']);
  assert.equal(items[0].reminder, null);
  assert.match(items[1].reminder, /checking in/);
  assert.equal(items[3].reminder, null);
  const [scheduled] = reviewItems({
    id: 3, pending_tests: [{ name: 'CBC', due_date: '2025-03-01' }],
    test_visits: [{ id: 4, reason: 'Full blood count', status: 'scheduled' }]
  }, '2025-03-02');
  assert.equal(scheduled.status, 'visit_to_check');
  assert.equal(scheduled.appointment.id, 4);
  assert.equal(scheduled.reminder, null);
});

test('queue uses approved plans and eligible reports only, saves reviews and honors revocation', async () => {
  const pool = new PGlite();
  try {
    await pool.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, closed_at TIMESTAMP);
      CREATE TABLE mother_profiles (user_id INTEGER, full_name TEXT);
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY, mother_id INTEGER, doctor_id INTEGER, requested_date DATE,
        status TEXT, facility_uuid TEXT, child_id INTEGER, visit_type TEXT, reason TEXT
      );
      CREATE TABLE patient_documents (
        id INTEGER PRIMARY KEY, mother_id INTEGER, title TEXT, report_date DATE, uploaded_at TIMESTAMP,
        child_id INTEGER, deleted_at TIMESTAMP, is_sensitive BOOLEAN, doc_type TEXT,
        verification_status TEXT, appointment_id INTEGER, uploaded_by_role TEXT, uploaded_by INTEGER
      );
      CREATE TABLE patient_document_shares (document_id INTEGER, doctor_id INTEGER, revoked_at TIMESTAMP, expires_at TIMESTAMP);
      CREATE TABLE patient_preferences (user_id INTEGER, preferences JSONB);
      CREATE TABLE patient_access_controls (mother_id INTEGER, grantee_type TEXT, grantee_ref TEXT, state TEXT);
      INSERT INTO users VALUES (1,NULL),(2,NULL),(3,NULL);
      INSERT INTO mother_profiles VALUES (1,'Synthetic Patient');
      INSERT INTO appointments VALUES
        (10,1,2,'2025-03-01','completed',NULL,NULL,NULL,NULL),
        (11,1,2,'2025-03-08','confirmed',NULL,NULL,'Follow-up',NULL);
      INSERT INTO patient_documents VALUES
        (20,1,'Complete blood count','2025-03-03',NOW(),NULL,NULL,false,'lab_report','pending',10,'mother',1),
        (21,1,'CBC private','2025-03-03',NOW(),NULL,NULL,true,'lab_report','pending',10,'mother',1),
        (22,1,'CBC unshared','2025-03-03',NOW(),NULL,NULL,false,'lab_report','pending',10,'mother',1),
        (23,1,'CBC child','2025-03-03',NOW(),99,NULL,false,'lab_report','pending',10,'mother',1),
        (24,1,'CBC older result','2025-02-25',NOW(),NULL,NULL,false,'lab_report','pending',NULL,'mother',1);
      INSERT INTO patient_document_shares VALUES
        (20,2,NULL,NULL),(21,2,NULL,NULL),(23,2,NULL,NULL),(24,2,NULL,NULL);
    `);
    await pool.exec(await readFile(path.join(__dirname, 'db/visit_summaries.sql'), 'utf8'));
    await pool.exec(`
      INSERT INTO visit_summaries
        (id,appointment_id,mother_id,doctor_id,status,version,pending_tests,follow_up,next_steps)
      VALUES (30,10,1,2,'approved',1,'[{"name":"CBC","due_date":"2025-03-05"}]',
        '{"due_date":"2025-03-08"}','["Bring the care card"]'),
        (31,10,1,2,'draft',0,'[{"name":"Draft-only test"}]','{}','[]');
    `);
    let get, put;
    register({ get(route, ...handlers) { get = handlers.at(-1); }, put(route, ...handlers) { put = handlers.at(-1); } }, {
      pool, authenticateToken() {}, authorizeRole: () => () => {}, verify: async () => true
    });
    async function call(handler, request = {}) {
      const res = {
        code: 200,
        set() { return this; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await handler({ user: { id: 2 }, query: {}, ...request }, res);
      return res;
    }
    const items = (await call(get)).body.items;
    assert.equal(items.length, 3);
    assert.deepEqual(items.find(item => item.key === 'test:0').reports.map(report => report.id), [20]);
    assert.equal(items.find(item => item.key === 'visit').appointment.id, 11);
    assert.deepEqual((await call(get, { user: { id: 3 } })).body.items, []);
    const review = { params: { summaryId: '30' }, body: { item_key: 'test:0' } };
    assert.equal((await call(put, { ...review, user: { id: 3 } })).code, 404);
    assert.equal((await call(put, review)).body.reviewed, true);
    assert.equal((await call(put, review)).body.reviewed, true);
    assert.equal((await call(get)).body.items.length, 2);
    await pool.exec("INSERT INTO patient_access_controls VALUES (1,'doctor','2','revoked')");
    assert.deepEqual((await call(get)).body.items, []);
    assert.equal((await call(put, review)).code, 404);
  } finally {
    await pool.close();
  }
});
