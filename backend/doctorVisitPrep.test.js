'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { register, collectSources, buildDraft, prioritize } = require('./doctorVisitPrep');

const chart = {
  metrics: [{
    key: 'blood_pressure', label: 'Blood pressure', unit: 'mmHg',
    readings: [{ value: 115, diastolic: 72, date: '2026-04-02' }, { value: 120, diastolic: 80, date: '2026-04-12' }],
    self_readings: [{ value: 118, diastolic: 78, date: '2026-04-13' }]
  }],
  carePlan: [{ title: 'Existing plan', created_at: '2026-04-14' }]
};
const env = {
  DAI_VISIT_PREP_AI_ENABLED: 'true',
  DAI_CONSULTATION_AI_MODEL: 'gemini-test',
  GEMINI_API_KEY: 'test'
};
const response = ids => ({
  ok: true,
  async json() {
    return { candidates: [{ content: { parts: [{ text: JSON.stringify({ ids }) }] } }] };
  }
});

test('uses latest shared measurements, preserves provenance and links questions to sources', () => {
  const sources = collectSources(chart);
  const draft = buildDraft(sources, [3]);
  assert.deepEqual(draft.sources.map(s => s.id), [3, 1, 2]);
  assert.equal(draft.questions[0].sourceId, 3);
  assert.equal(draft.questions.filter(q => q.sourceId === 1 || q.sourceId === 2).length, 1);
  assert.match(draft.note, /120\/80 mmHg/);
  assert.doesNotMatch(draft.note, /115\/72/);
  assert.match(draft.note, /Patient-reported reading/);
  assert.match(buildDraft([]).note, /No recent measurements/);
});

test('sends only categorical metadata and rejects fabricated source IDs', async () => {
  const sources = collectSources(chart);
  const ids = await prioritize(sources, env, async (url, request) => {
    const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
    assert.deepEqual(Object.keys(input[0]), ['id', 'kind', 'date', 'origin']);
    assert.doesNotMatch(request.body, /120\/80|Existing plan/);
    return response([3, 1]);
  });
  assert.deepEqual(ids, [3, 1]);
  await assert.rejects(() => prioritize(sources, env, async () => response([999])), /Invalid source/);
});

test('requires access and opt-in, falls back on provider failure, and discards results after revocation', async () => {
  let post;
  let allowed = false;
  let calls = 0;
  const app = { get() {}, post(path, ...handlers) { post = handlers.at(-1); } };
  register(app, {
    guards: [], env,
    access: async (req, res) => allowed ? 7 : (res.status(403).json({ error: 'Denied' }), null),
    dashboard: async () => chart,
    consent: async () => allowed,
    audit: async () => {},
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw Error('Offline');
      allowed = false;
      return response([3]);
    }
  });

  async function run(doctor, optIn) {
    const res = {
      code: 200,
      set(key, value) { this[key] = value; return this; },
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; }
    };
    await post({ body: { external_consent: optIn }, user: { id: doctor } }, res);
    return res;
  }
  assert.equal((await run(1, true)).code, 403);
  allowed = true;
  assert.equal((await run(1, false)).body.mode, 'local');
  assert.equal(calls, 0);
  assert.equal((await run(1, true)).body.mode, 'fallback');
  assert.equal((await run(1, true)).body.mode, 'rate_limited');
  assert.equal(calls, 1);
  const revoked = await run(2, true);
  assert.equal(revoked.code, 403);
  assert.equal(revoked.body.note, undefined);
  assert.equal(revoked['Cache-Control'], 'private, no-store');
});
