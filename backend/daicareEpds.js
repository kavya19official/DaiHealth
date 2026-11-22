'use strict';

// Items are in the printed response order. EPDS permission and attribution are displayed in the UI.
const { items, scoreEPDS, priority } = require('../shared/sukoon');

async function optionalReview(env, features, fetchImpl = fetch) {
  const model = env.DAICARE_AI_MODEL;
  if (env.DAICARE_AI_ENABLED !== 'true' || !env.GEMINI_API_KEY || !/^gemini-[\w.-]+$/.test(model || '')) return 'unavailable';
  try {
    const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Identify whether these aggregate postpartum wellbeing trends should receive additional human review. You cannot diagnose, change emergency escalation, or recommend treatment. Reply with only review or no_additional_flag. Aggregates: ' + JSON.stringify(features) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 64, responseMimeType: 'application/json', responseSchema: { type:'STRING', enum:['review','no_additional_flag'] } }
      })
    });
    if (!response.ok) return 'unavailable';
    const result = await response.json();
    const label = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text || 'null');
    return ['review', 'no_additional_flag'].includes(label) ? label : 'unavailable';
  } catch { return 'unavailable'; }
}

module.exports = { items, scoreEPDS, priority, optionalReview };
