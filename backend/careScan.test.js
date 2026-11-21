'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createCanvas, PDFDocument } = require('@napi-rs/canvas');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');
const { timelineEntries } = require('./careScan');
const { extractPages, parsePages } = require('./careScanExtraction');

function makeScan(lines, margin = 0) {
  const canvas = createCanvas(1350 + margin, 140 + lines.length * 78);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.font = 'bold 46px sans-serif';
  lines.forEach((line, index) => ctx.fillText(line, 35, 75 + index * 78));
  return canvas;
}

const lines = [
  'Prescription date: 2026-03-05',
  'Tab Samplemed 500 mg twice daily',
  'Hb 11.2 g/dL',
  'Vaccine: BCG 2026-03-06',
  'ANC visit 2026-03-02'
];

test('keeps ambiguous and invalid dates blank and never fills a missing lab unit or vaccine date', () => {
  const { candidates } = parsePages([{ page: 3, text: [
    'Date: 2026-03-05', 'Hb 11.2', 'Vaccine: BCG', 'ANC visit 03/04/2026',
    'ANC visit 2026-02-30', 'ANC visit 14 Mar 2026', 'Cholesterol: 180 mg/dL', 'Patient age: 32 years'
  ].join('\n') }], 'lab_report', '2026-11-21');
  assert.equal(candidates.length, 6);
  assert.deepEqual(candidates.map(entry => entry.occurred_on), ['2026-03-05', '', '', '', '2026-03-14', '2026-03-05']);
  assert.equal(candidates[0].unit, '');
  assert.equal(candidates[5].unit, 'mg/dL');
  assert.ok(candidates.every(entry => entry.page === 3));
});

test('uses actual OCR for image-only PDFs', { timeout: 30_000 }, async () => {
  const scan = makeScan(lines);
  const pdf = new PDFDocument();
  const page = pdf.beginPage(675, scan.height / 2);
  page.drawImage(scan, 0, 0, 675, scan.height / 2);
  pdf.endPage();
  const { pages } = await extractPages(pdf.close(), 'application/pdf');
  const { candidates } = parsePages(pages, 'mcp_card', '2026-11-21');
  assert.deepEqual(candidates.map(entry => entry.kind), ['medicine', 'lab_result', 'vaccination', 'antenatal_visit']);
  assert.equal(candidates[0].dosage, '500 mg twice daily');
  assert.equal(candidates[1].result, '11.2');
});

test('scans an authenticated upload, saves only explicit decisions, links the original and handles duplicates', { timeout: 60_000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-care-scan-test-'));
  const pool = createLocalPool(path.join(dir, 'db'));
  const previousDir = process.env.PATIENT_DOCS_DIR;
  process.env.PATIENT_DOCS_DIR = path.join(dir, 'files');
  let server;
  try {
    for (const file of migrations) await pool.query(await fs.readFile(path.join(__dirname, 'db', file), 'utf8'));
    for (const [id, role] of [[1, 'mother'], [2, 'mother'], [3, 'doctor']]) {
      await pool.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)', [id, id + '@synthetic.invalid', 'fixture', role]);
    }
    await pool.query("INSERT INTO children(id,mother_id,name,date_of_birth,sex) VALUES(10,2,'Synthetic child','2026-01-01','female'),(11,1,'Synthetic baby','2026-01-01','female')");
    const app = express();
    app.use(express.json({ limit: '8mb' }));
    require('./patientDocuments')(app, {
      pool,
      authenticateToken(req, res, next) {
        const id = Number(req.get('x-test-user'));
        if (![1, 2, 3].includes(id)) return res.sendStatus(401);
        req.user = { id, role: id === 3 ? 'doctor' : 'mother' };
        next();
      },
      authorizeRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
    });
    server = await new Promise(resolve => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    async function call(route, { user = 1, body, method = body ? 'POST' : 'GET' } = {}) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + route, {
        method, headers: { 'x-test-user': String(user), 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = response.headers.get('content-type')?.includes('application/json') ?
        await response.json() : Buffer.from(await response.arrayBuffer());
      return { status: response.status, data, headers: response.headers };
    }
    const extract = '/patient/care-scan/extract';
    const confirm = '/patient/care-scan/confirm';
    const png = makeScan(lines).toBuffer('image/png');
    const upload = {
      content_base64: png.toString('base64'), filename: 'synthetic.png',
      mime_type: 'image/png', document_type: 'mcp_card', child_id: null
    };
    assert.equal((await call(extract, { user: 0, body: upload })).status, 401);
    assert.equal((await call(extract, { user: 3, body: upload })).status, 403);
    assert.equal((await call(extract, { body: { ...upload, child_id: 10 } })).status, 400);
    assert.equal((await call(extract, { body: { ...upload, mime_type: 'image/jpeg' } })).status, 400);
    const { status, data: draft, headers } = await call(extract, { body: upload });
    assert.equal(status, 200);
    assert.match(headers.get('cache-control'), /no-store/);
    assert.equal(draft.candidates.length, 4);
    assert.deepEqual(await timelineEntries(pool, 1), []);
    assert.deepEqual(await fs.readdir(process.env.PATIENT_DOCS_DIR), []);

    const decisions = draft.candidates.map(({ source_line, ...entry }) =>
      ({ ...entry, decision: entry.kind === 'vaccination' ? 'reject' : 'verify' }));
    decisions[1].result = '11.3';
    const reviewed = { ...upload, review_token: draft.review_token, confirm_source: true, entries: decisions };
    assert.equal((await call(confirm, { user: 2, body: reviewed })).status, 400);
    assert.equal((await call(confirm, { body: { ...reviewed, confirm_source: false } })).status, 400);
    assert.equal((await call(confirm, { body: { ...reviewed, entries: decisions.slice(1) } })).status, 400);
    assert.equal((await call(confirm, { body: { ...reviewed, child_id: 11 } })).status, 409);
    assert.equal((await call(confirm, { body: { ...reviewed, entries: decisions.map(e => ({ ...e, decision: 'reject' })) } })).data.saved, 0);
    assert.deepEqual(await fs.readdir(process.env.PATIENT_DOCS_DIR), []);

    const saves = await Promise.all([call(confirm, { body: reviewed }), call(confirm, { body: reviewed })]);
    assert.deepEqual(saves.map(save => save.status).sort(), [200, 201]);
    const saved = saves.find(save => save.status === 201).data;
    assert.equal(saved.saved, 3);
    const rows = await timelineEntries(pool, 1);
    assert.deepEqual(rows.map(row => row.kind), ['antenatal_visit', 'medicine', 'lab_result']);
    assert.ok(rows.every(row => row.document_id === saved.document_id));
    assert.equal(rows[2].result, '11.3');
    assert.deepEqual(await timelineEntries(pool, 2), []);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM care_milestones')).rows[0].count, 0);
    assert.equal((await call(extract, { body: upload })).data.already_saved, true);

    const original = '/documents/' + saved.document_id + '/download';
    assert.equal((await call(original, { user: 2 })).status, 404);
    assert.equal((await call(original)).status, 403);
    const opened = await call(original + '?reveal=1');
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.data, png);

    const duplicateUpload = { ...upload, content_base64: makeScan(lines, 12).toBuffer('image/png').toString('base64') };
    const rescan = (await call(extract, { body: duplicateUpload })).data;
    assert.equal(rescan.candidates.length, 4);
    const skipped = await call(confirm, { body: { ...reviewed, ...duplicateUpload, review_token: rescan.review_token } });
    assert.equal(skipped.data.duplicates, 3);
    assert.equal(skipped.data.saved, 0);
    assert.equal((await fs.readdir(process.env.PATIENT_DOCS_DIR)).length, 1);

    const childSource = { ...duplicateUpload, child_id: 11, document_type: 'vaccination_card' };
    const childDraft = (await call(extract, { body: childSource })).data;
    const childDecisions = childDraft.candidates.map(entry => ({ ...entry,
      decision: entry.kind === 'vaccination' ? 'verify' : 'reject' }));
    const childSave = await call(confirm, { body: { ...childSource, confirm_source: true,
      review_token: childDraft.review_token, entries: childDecisions } });
    assert.equal(childSave.status, 201);
    assert.equal((await timelineEntries(pool, 1)).find(row => row.kind === 'vaccination').child_id, 11);

    assert.equal((await call('/documents/' + saved.document_id, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await timelineEntries(pool, 1)).map(row => row.kind), ['vaccination']);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await fs.rm(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.PATIENT_DOCS_DIR;
    else process.env.PATIENT_DOCS_DIR = previousDir;
  }
});
