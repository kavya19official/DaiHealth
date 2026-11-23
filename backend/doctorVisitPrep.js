'use strict';

const questionsBySource = {
  haemoglobin: 'Is there a more recent haemoglobin result to review?',
  blood_pressure: 'Are there more recent blood pressure readings to review?',
  weight: 'Is there a more recent weight measurement to review?',
  blood_glucose: 'What was the timing of the glucose reading relative to meals?',
  plan: 'Which parts of the recorded care plan are still current?'
};

function sourceDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function collectSources(chart) {
  const sources = [];
  for (const metric of chart.metrics) {
    if (!Object.hasOwn(questionsBySource, metric.key) || metric.key === 'plan') continue;
    for (const [readings, origin] of [
      [metric.readings, 'Clinical summary'],
      [metric.self_readings, 'Patient-reported reading']
    ]) {
      const reading = readings?.at(-1);
      if (reading?.value == null) continue;
      const value = reading.diastolic == null ? reading.value : reading.value + '/' + reading.diastolic;
      sources.push({
        id: sources.length + 1,
        kind: metric.key,
        label: metric.label,
        text: value + ' ' + metric.unit,
        date: sourceDate(reading.date),
        origin
      });
    }
  }
  for (const plan of chart.carePlan.slice(0, 3)) {
    sources.push({
      id: sources.length + 1,
      kind: 'plan',
      label: 'Recorded care plan',
      text: String(plan.title || '').slice(0, 160),
      date: sourceDate(plan.created_at),
      origin: 'Clinician-recorded plan'
    });
  }
  return sources;
}

function buildDraft(sources, priorityIds = []) {
  const byId = new Map(sources.map(source => [source.id, source]));
  const ordered = [...new Set([...priorityIds, ...byId.keys()])].filter(id => byId.has(id)).map(id => byId.get(id));
  const seen = new Set();
  const questions = [];
  for (const source of ordered) {
    if (seen.has(source.kind)) continue;
    seen.add(source.kind);
    questions.push({ text: questionsBySource[source.kind], sourceId: source.id });
  }
  if (!seen.has('plan')) questions.push({ text: 'Is there an existing care plan to reconcile?', sourceId: null });
  questions.push({ text: 'What would the patient like to discuss at this visit?', sourceId: null });

  return {
    sources: ordered,
    questions,
    note: [
      'Pre-visit chart review',
      ...ordered.map(s => [s.label + ': ' + s.text, s.date, s.origin].filter(Boolean).join(' · ')),
      ...(!ordered.length ? ['No recent measurements or care plans in the shared summary.'] : []),
      '',
      'To confirm during the visit:',
      ...questions.map(q => '- ' + q.text)
    ].join('\n'),
    message: 'Hello, I’m preparing for our next visit. Please bring any recent reports you would like to discuss and a list of questions you have. Thank you.'
  };
}

function configured(env) {
  return env.DAI_VISIT_PREP_AI_ENABLED === 'true' && !!env.GEMINI_API_KEY &&
    /^gemini-[\w.-]+$/.test(env.DAI_CONSULTATION_AI_MODEL || '');
}

async function prioritize(sources, env, fetchImpl) {
  if (sources.length < 2) return [];
  // The model picks source IDs. All clinical text is assembled from the chart on this server.
  const candidates = sources.map(({ id, kind, date, origin }) => ({ id, kind, date, origin }));
  const response = await fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(env.DAI_CONSULTATION_AI_MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Prioritize up to four sources for review before a maternal visit. Favor recent entries and coverage of distinct categories. Return only IDs from the input. No interpretations, diagnoses, or recommendations.' }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(candidates) }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 512,
          responseJsonSchema: {
            type: 'object', required: ['ids'],
            properties: { ids: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'integer' } } }
          }
        }
      })
    }
  );
  if (!response.ok) throw Error('Provider unavailable');
  const result = await response.json();
  const parts = result.candidates?.[0]?.content?.parts || [];
  const { ids } = JSON.parse(parts.filter(part => !part.thought).map(part => part.text || '').join(''));
  const valid = new Set(sources.map(source => source.id));
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length ||
      ids.some(id => !valid.has(id))) throw Error('Invalid source selection');
  return ids;
}

function register(app, { pool, guards, access, dashboard, consent, audit, env = process.env, fetchImpl = fetch }) {
  const providerRequests = new Map();
  app.get('/api/doctor/visit-prep/config', ...guards, (req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ ai: configured(env) });
  });
  app.post('/api/doctor/patients/:id/visit-prep', ...guards, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const id = await access(req, res, true);
      if (!id) return;
      const doctorId = req.user.id;
      const chart = await dashboard(pool, id);
      const sources = collectSources(chart);
      let priorityIds = [];
      let mode = 'local';
      if (req.body?.external_consent === true && configured(env) && sources.length > 1) {
        const now = Date.now();
        for (const [doctor, last] of providerRequests) {
          if (now - last >= 30000) providerRequests.delete(doctor);
        }
        if (!providerRequests.has(doctorId) && providerRequests.size < 10000) {
          providerRequests.set(doctorId, now);
          await audit(id, 'visit_prep_ai_requested', { doctor_id: doctorId, source_count: sources.length });
          if (!await access(req, res, true)) return;
          try {
            priorityIds = await prioritize(sources, env, fetchImpl);
            mode = 'ai';
          } catch {
            mode = 'fallback';
          }
        } else {
          mode = 'rate_limited';
        }
      }
      if (!await access(req, res, true)) return;
      await audit(id, 'visit_prep_view', { doctor_id: doctorId, mode });
      if (!await consent(pool, id, doctorId)) {
        return res.status(403).json({ error: 'Summary sharing has changed.' });
      }
      res.json({ ...buildDraft(sources, priorityIds), mode });
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'Could not prepare the visit. Please try again.' });
    }
  });
}

module.exports = { register, collectSources, buildDraft, prioritize };
