'use strict';

// Items are in the printed response order. EPDS permission and attribution are displayed in the UI.
const items = [
  ['I have been able to laugh and see the funny side of things', ['As much as I always could', 'Not quite so much now', 'Definitely not so much now', 'Not at all']],
  ['I have looked forward with enjoyment to things', ['As much as I ever did', 'Rather less than I used to', 'Definitely less than I used to', 'Hardly at all']],
  ['I have blamed myself unnecessarily when things went wrong', ['Yes, most of the time', 'Yes, some of the time', 'Not very often', 'No, never']],
  ['I have been anxious or worried for no good reason', ['No, not at all', 'Hardly ever', 'Yes, sometimes', 'Yes, very often']],
  ['I have felt scared or panicky for no very good reason', ['Yes, quite a lot', 'Yes, sometimes', 'No, not much', 'No, not at all']],
  ['Things have been getting on top of me', ['Yes, most of the time I haven’t been able to cope at all', 'Yes, sometimes I haven’t been coping as well as usual', 'No, most of the time I have coped quite well', 'No, I have been coping as well as ever']],
  ['I have been so unhappy that I have had difficulty sleeping', ['Yes, most of the time', 'Yes, sometimes', 'Not very often', 'No, not at all']],
  ['I have felt sad or miserable', ['Yes, most of the time', 'Yes, quite often', 'Not very often', 'No, not at all']],
  ['I have been so unhappy that I have been crying', ['Yes, most of the time', 'Yes, quite often', 'Only occasionally', 'No, never']],
  ['The thought of harming myself has occurred to me', ['Yes, quite often', 'Sometimes', 'Hardly ever', 'Never']]
];
const reverse = new Set([2, 4, 5, 6, 7, 8, 9]);
const priority = (score, itemTen) => itemTen > 0 ? 'urgent' : score >= 13 ? 'follow_up' : 'routine';

function scoreEPDS(answers) {
  if (!Array.isArray(answers) || answers.length !== 10 ||
      !Array.from(answers).every(value => Number.isInteger(value) && value >= 0 && value <= 3)) return null;
  const scores = answers.map((value, index) => reverse.has(index) ? 3 - value : value);
  return { score: scores.reduce((sum, value) => sum + value, 0), itemTen: scores[9] };
}

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
