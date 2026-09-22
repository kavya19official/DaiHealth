'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

test('hospital workflows persist data and enforce human approval gates', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-hospital-'));
  process.env.HOSPITAL_STATE_FILE = path.join(temp, 'state.json');
  process.env.HOSPITAL_UPLOAD_DIR = path.join(temp, 'uploads');

  const app = express();
  app.use(express.json({ limit: '6mb' }));
  require('./hospitalPlatform')(app);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/hospital`;

  async function request(route, { method = 'GET', role = 'admin', body } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', 'x-hospital-role': role, 'x-hospital-actor': 'Test user' },
      body: body == null ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  const registry = await request('/registry?program=maternal');
  assert.equal(registry.status, 200);
  assert.equal(registry.body.patients.length, 2);
  assert.equal(registry.body.scope.includes('no clinical inference'), true);

  const before = await request('/patients/P-1002/gaps');
  assert.equal(before.body.gaps.some((gap) => gap.expectedType === 'Glucose tolerance test'), true);
  const event = await request('/patients/P-1002/events', { method: 'POST', role: 'care_team', body: { type: 'Glucose tolerance test', recordedAt: '2026-08-01', source: 'Lab system', documentRef: 'LAB-TEST' } });
  assert.equal(event.status, 201);
  const after = await request('/patients/P-1002/gaps');
  assert.equal(after.body.gaps.some((gap) => gap.expectedType === 'Glucose tolerance test'), false);

  const uploaded = await request('/documents/ingest', { method: 'POST', role: 'care_team', body: { patientId: 'P-1002', name: 'test-note.txt', type: 'referral_letter', mimeType: 'text/plain', contentBase64: Buffer.from('verified demo document').toString('base64'), factLabel: 'Referral note date', factValue: '2026-09-21' } });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.document.sizeBytes > 0, true);
  assert.equal(fs.existsSync(path.join(temp, uploaded.body.document.storageRef)), true);

  const pendingFactId = uploaded.body.fact.id;
  const blockedBrief = await request('/consultations/A-902/brief/review', { method: 'POST', role: 'doctor', body: {} });
  assert.equal(blockedBrief.status, 409);
  assert.equal((await request(`/consultations/A-902/facts/${pendingFactId}/accept`, { method: 'POST', role: 'doctor', body: { notes: 'Checked against uploaded document.' } })).status, 200);
  assert.equal((await request('/consultations/A-902/facts/F-3/accept', { method: 'POST', role: 'doctor', body: {} })).status, 200);
  assert.equal((await request('/consultations/A-902/brief/review', { method: 'POST', role: 'doctor', body: {} })).status, 200);

  const draftResult = await request('/content/draft', { method: 'POST', role: 'doctor', body: { type: 'patient handout', language: 'Hindi', source: 'KB-1', body: 'Reviewed education content.' } });
  const draftId = draftResult.body.draft.id;
  assert.equal((await request(`/content/${draftId}/publish`, { method: 'POST', role: 'doctor', body: {} })).status, 409);
  assert.equal((await request(`/content/${draftId}/approve`, { method: 'POST', role: 'doctor', body: { notes: 'Clinician approved.' } })).status, 200);
  const campaign = await request('/campaigns', { method: 'POST', role: 'doctor', body: { draftId, audience: 'Maternal continuity cohort', channel: 'in_app', scheduledFor: '2026-09-25T10:00:00+05:30' } });
  assert.equal(campaign.status, 201);

  const slot = await request('/clinic/slots/P-3094%3Acbc/reassign', { method: 'POST', role: 'front_desk', body: { channel: 'SMS' } });
  assert.equal(slot.status, 200);
  assert.equal(slot.body.state.notifications.length, 1);

  const sos = await request('/sos/trigger', { method: 'POST', role: 'care_team', body: { patientId: 'P-1002', location: 'Ward entrance', consentConfirmed: true, oneTimeLocationConsent: true } });
  assert.equal(sos.status, 201);
  const sosId = sos.body.request.id;
  assert.equal((await request(`/sos/${sosId}/respond`, { method: 'POST', role: 'care_team', body: { response: 'accept' } })).status, 409);
  assert.equal((await request(`/sos/${sosId}/authenticate`, { method: 'POST', role: 'care_team', body: {} })).status, 200);
  assert.equal((await request(`/sos/${sosId}/respond`, { method: 'POST', role: 'care_team', body: { response: 'accept' } })).status, 200);

  const forbidden = await request('/pathways/maternal/events', { method: 'POST', role: 'front_desk', body: { type: 'Test', offset: 10 } });
  assert.equal(forbidden.status, 403);
  const audit = await request('/audit');
  assert.equal(audit.body.audit.some((entry) => entry.action === 'document_ingested'), true);
  assert.equal(fs.existsSync(process.env.HOSPITAL_STATE_FILE), true);
});
