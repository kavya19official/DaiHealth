/* O. Plain-language checker for clinician-written visit summaries.
   It only FLAGS things (jargon, very long sentences, medicine doses). It never rewrites or adds text:
   the clinician decides every word the patient sees. Shared by the browser editor and the server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlainLanguage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // term (lower case) -> simpler wording the clinician may choose to use
  var JARGON = {
    'hypertension': 'high blood pressure', 'hypotension': 'low blood pressure', 'anaemia': 'low blood (iron)', 'anemia': 'low blood (iron)',
    'gestational diabetes': 'high sugar in pregnancy', 'proteinuria': 'protein in the urine', 'edema': 'swelling', 'oedema': 'swelling',
    'antenatal': 'before the baby is born', 'postnatal': 'after the baby is born', 'postpartum': 'after the baby is born', 'haemoglobin': 'blood level',
    'hemoglobin': 'blood level', 'usg': 'ultrasound scan', 'ultrasonography': 'ultrasound scan', 'nst': 'baby heartbeat check', 'opd': 'clinic visit',
    'anc': 'pregnancy check-up', 'pnc': 'check-up after birth', 'bp': 'blood pressure', 'hb': 'blood level', 'ifa': 'iron and folic acid',
    'prn': 'only when needed', 'stat': 'right away', 'nil by mouth': 'no food or drink', 'adverse': 'harmful', 'contraindicated': 'not safe',
    'prophylaxis': 'protection', 'tds': 'three times a day', 'bd': 'twice a day', 'od': 'once a day', 'qid': 'four times a day'
  };
  var MAX_WORDS = 20;
  var DOSE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|ug|g|ml|iu|units?|tablets?|tabs?|capsules?|caps?|drops?|puffs?)\b/i;

  function words(s) { return (String(s).match(/[A-Za-z\u0900-\u097F0-9'-]+/g) || []); }

  // Returns [{ type, ... }]. Empty array means nothing to flag.
  function check(text) {
    var t = String(text == null ? '' : text), out = [], lower = t.toLowerCase();
    Object.keys(JARGON).forEach(function (term) {
      var re = new RegExp('(^|[^a-z])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])', 'i');
      if (re.test(lower)) out.push({ type: 'jargon', term: term, suggestion: JARGON[term] });
    });
    t.split(/(?<=[.!?\u0964])\s+|\n+/).forEach(function (sentence) {
      var n = words(sentence).length;
      if (n > MAX_WORDS) out.push({ type: 'long_sentence', words: n, text: sentence.trim().slice(0, 80) });
    });
    var dose = t.match(DOSE);
    if (dose) out.push({ type: 'dose', text: dose[0], message: 'Medicine names and doses belong on the signed prescription. Only repeat them here if you have confirmed them.' });
    return out;
  }

  return { check: check, JARGON: JARGON, MAX_WORDS: MAX_WORDS };
});
