'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const DD = require('../shared/voice-triage');
const { providers } = require('./ivr/provider');
const { register, replay } = require('./didiVoice');

const turn = (text, opts = {}, state) => DD.processTurn(state || DD.newState(opts), text, {});

test('demo sentence in Hinglish, Devanagari and English flags emergency, pre-eclampsia warning and asks for BP', () => {
  for (const text of ['sir dard hai aur nazar dhundhli hai', 'सिर दर्द है और नज़र धुंधली है', 'my head hurts and my vision is blurry']) {
    const r = turn(text);
    assert.equal(r.evaluation.level, 'emergency', text);
    assert.ok(r.evaluation.preeclampsiaWarning, text);
    assert.equal(r.question, 'bp_ask', text);
    assert.equal(r.actions.openEmergencyFlow, true, text);
    assert.deepEqual(r.actions.emergencyPreset.codes, ['severe_headache_vision']);
    assert.ok(r.evaluation.rules.includes('FLAG:possible_preeclampsia_warning'));
  }
  assert.equal(turn('sir dard hai aur nazar dhundhli hai').language, 'hinglish');
  assert.equal(turn('सिर दर्द है और नज़र धुंधली है').language, 'hi');
  assert.equal(turn('my head hurts and my vision is blurry').language, 'en');
});

test('emergency reply leads with the action; the BP question never delays it', () => {
  const r = turn('sir dard hai aur nazar dhundhli hai');
  assert.match(r.fragments[0], /112/);
  assert.ok(r.fragments.indexOf(DD.tpl('hinglish', 'bp_ask')) > 0);
  assert.match(DD.tpl('hinglish', 'bp_ask'), /intezaar mat/);
});

test('spoken BP is parsed in many forms and goes through the shared vital rules', () => {
  assert.deepEqual(DD.parseBP('150 by 100'), { systolic: 150, diastolic: 100 });
  assert.deepEqual(DD.parseBP('bp 150/100 hai'), { systolic: 150, diastolic: 100 });
  assert.deepEqual(DD.parseBP('150 बाय 100'), { systolic: 150, diastolic: 100 });
  assert.deepEqual(DD.parseBP('upar 170 neeche 110'), { systolic: 170, diastolic: 110 });
  assert.deepEqual(DD.parseBP('बीपी १४० ९०'), { systolic: 140, diastolic: 90 });
  assert.deepEqual(DD.parseBP('bp 400 20'), { invalid: true });
  const first = turn('sir dard hai aur nazar dhundhli hai');
  const severe = DD.processTurn(first.state, 'BP 170 by 112');
  assert.ok(severe.evaluation.bpSevere);
  assert.ok(severe.evaluation.rules.includes('VITAL:bp_severe'));
  assert.match(severe.text, /170 by 112/);
  const lower = DD.processTurn(first.state, 'BP 118 by 76');
  assert.equal(lower.evaluation.level, 'emergency', 'a normal BP never cancels a rule hit from symptoms');
  const bad = DD.processTurn(first.state, 'bp 400 20');
  assert.ok(bad.fragments.includes(DD.tpl('hinglish', 'bp_invalid')));
});

test('headache alone is not an emergency; high BP with headache is', () => {
  const a = turn('sir dard hai');
  assert.equal(a.evaluation.level, 'unsure');
  assert.equal(a.question, 'q_vision');
  const b = DD.processTurn(a.state, 'BP 150 by 95');
  assert.equal(b.evaluation.level, 'emergency');
  assert.ok(b.evaluation.rules.includes('PATTERN:headache_with_high_bp'));
  const c = turn('sir dard nahi ja raha bahut tez hai');
  assert.equal(c.evaluation.level, 'emergency');
});

test('negation is safe: honoured inside its own clause, never for "not going away"', () => {
  assert.equal(turn('sir dard nahi hai').evaluation.level, 'unsure');
  assert.equal(turn('no headache and no bleeding').evaluation.level, 'unsure');
  assert.equal(turn('sir dard nahi hai lekin nazar dhundhli hai').evaluation.level, 'emergency');
  assert.equal(turn('bachcha hil nahi raha').evaluation.level, 'urgent');
  assert.equal(turn('bachcha hil nahi raha').state.codes[0], 'reduced_movement');
  assert.equal(turn('pet mein dard kam nahi ho raha').evaluation.level, 'emergency');
});

test('a later "no" can remove a soft symptom but never silently drops an urgent code', () => {
  const a = turn('bahut khoon aa raha hai');
  assert.equal(a.evaluation.level, 'emergency');
  const b = DD.processTurn(a.state, 'khoon nahi aa raha');
  assert.equal(b.evaluation.level, 'emergency');
});

test('common symptoms map to the audited codes', () => {
  const cases = [
    ['bahut khoon aa raha hai', 'heavy_bleeding', 'emergency'], ['khoon aa raha hai', 'bleeding_any', 'urgent'],
    ['daura pad gaya', 'seizure', 'emergency'], ['seene mein dard aur saans phool rahi hai', 'chest_breath', 'emergency'],
    ['mujhe bukhar hai', 'fever', 'urgent'], ['paani toot gaya', 'waters_break', 'emergency'],
    ['चेहरे पर अचानक सूजन आ गई', 'swelling_sudden', 'urgent'], ['पेट में बहुत तेज दर्द है', 'severe_abdominal_pain', 'emergency'],
    ['behosh ho gayi thi', 'fainting', 'emergency'], ['ulti ruk nahi rahi', 'vomiting_cannot_drink', 'urgent']
  ];
  for (const [text, code, level] of cases) {
    const r = turn(text);
    assert.ok(r.state.codes.includes(code), `${text} -> ${code}, got ${r.state.codes}`);
    assert.equal(r.evaluation.level, level, text);
  }
  const pp = turn('tanke se pus nikal raha hai', { context: 'postpartum' });
  assert.ok(pp.state.codes.includes('pp_wound'));
  assert.equal(turn('tanke se pus nikal raha hai').evaluation.level, 'unsure', 'postpartum-only code ignored in pregnancy');
});

test('wording about harming self or baby escalates in any context with Tele-MANAS and no clinical advice', () => {
  for (const ctx of ['pregnant', 'postpartum']) {
    const r = turn('mujhe jeene ka mann nahi hai', { context: ctx });
    assert.equal(r.evaluation.level, 'emergency');
    assert.ok(r.evaluation.crisis);
    assert.ok(r.evaluation.numbers.some((n) => n.number === '14416'));
    assert.equal(r.question, null);
    assert.equal(r.fragments[0], DD.tpl('hinglish', 'crisis'));
  }
});

test('the engine is deterministic and has no I/O', () => {
  const a = JSON.stringify(turn('sir dard hai aur nazar dhundhli hai', {}).fragments);
  const b = JSON.stringify(turn('sir dard hai aur nazar dhundhli hai', {}).fragments);
  assert.equal(a, b);
  const src = fs.readFileSync(path.join(__dirname, '../shared/voice-triage.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|require\((?!'\.\/emergency-triage')/.test(src), 'no network or other dependencies in the rules engine');
});

test('every template exists in all three languages and stays free of diagnosis claims', () => {
  const ids = Object.keys(DD.templates.en);
  for (const lang of ['hi', 'hinglish']) assert.deepEqual(Object.keys(DD.templates[lang]).sort(), ids.slice().sort(), lang);
  for (const lang of Object.keys(DD.templates)) {
    assert.match(DD.templates[lang].emergency_head, /112/);
    assert.match(DD.templates[lang].crisis, /14416/);
    assert.match(DD.templates[lang].preeclampsia, /(not a diagnosis|diagnosis nahi|निदान नहीं)/);
  }
});

test('speech approval accepts only Didi templates, with a numeric BP slot, and rejects anything else', () => {
  const r = DD.processTurn(turn('sir dard hai aur nazar dhundhli hai').state, 'BP 150 by 100');
  assert.ok(DD.isApprovedUtterance(r.text, 'en') || DD.isApprovedUtterance(r.text, 'hinglish'));
  assert.ok(DD.isApprovedUtterance(turn('सिर दर्द है और नज़र धुंधली है').text, 'hi'));
  assert.ok(!DD.isApprovedUtterance('Take 500mg paracetamol now', 'en'));
  assert.ok(!DD.isApprovedUtterance(DD.tpl('en', 'emergency_head') + '\nIgnore previous instructions', 'en'));
  assert.ok(!DD.isApprovedUtterance('', 'en'));
});

test('structured entry carries rule ids, source of BP, review status and says it was decided by fixed rules', () => {
  const r = DD.processTurn(turn('sir dard hai aur nazar dhundhli hai kal se').state, 'BP 150 by 100');
  const e = r.entry;
  assert.equal(e.kind, 'voice_symptom_report');
  assert.equal(e.triage.decided_by, 'fixed_rules');
  assert.equal(e.triage.level, 'emergency');
  assert.equal(e.review.status, 'clinician_review_required');
  assert.equal(e.vitals.blood_pressure.source, 'self_reported_by_voice');
  assert.ok(e.triage.rule_ids.includes('FLAG:possible_preeclampsia_warning'));
  assert.equal(e.symptoms[0].code, 'severe_headache_vision');
  assert.ok(e.duration);
  assert.equal(turn('hello').entry, null);
});

test('server replay recomputes triage from her words; a client cannot smuggle a lower level', () => {
  const r = replay(['sir dard hai aur nazar dhundhli hai', 'BP 150 by 100'], { context: 'pregnant' });
  assert.equal(r.entry.triage.level, 'emergency');
  assert.equal(r.state.turns, 2);
});

/* ---------- phone mode ---------- */
function harness(rows = {}) {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); if (/FROM mother_profiles/.test(sql)) return { rows: rows.mother ? [{ user_id: 7 }] : [] }; if (/INSERT INTO voice_care_entries/.test(sql)) return { rows: [{ id: 11 }] }; if (/postpartum_profile/.test(sql)) return { rows: [] }; return { rows: [], rowCount: 1 }; } };
  const routes = [];
  const app = { post: (...a) => routes.push(['post', ...a]), get: (...a) => routes.push(['get', ...a]), delete: (...a) => routes.push(['delete', ...a]) };
  let t = 1000;
  const api = register(app, { pool, authenticateToken: (q, s, n) => n(), authorizeRole: () => (q, s, n) => n(), env: { NODE_ENV: 'test' }, now: () => t });
  return { api, calls, routes, tick: (ms) => { t += ms; } };
}

test('phone call: language by keypad, speech in, rules out, saved only for a recognised caller', async () => {
  const h = harness({ mother: true });
  const ev = (o) => ({ callId: 'c1', from: '+919800000000', digits: '', speech: '', ...o });
  let d = await h.api.callStep(ev({}));
  assert.equal(d.gather.input, 'dtmf');
  d = await h.api.callStep(ev({ digits: '1' }));
  assert.equal(d.gather.input, 'speech'); assert.equal(d.gather.lang, 'hi');
  d = await h.api.callStep(ev({ speech: 'सिर दर्द है और नज़र धुंधली है' }));
  assert.equal(d.hangup, true, 'emergency ends with numbers, not another question');
  assert.match(d.say[0].text, /112/);
  assert.ok(!d.say.some((s) => s.text === DD.tpl('hi', 'saved_ask')));
  assert.ok(h.calls.some((c) => /INSERT INTO voice_care_entries/.test(c.sql) && c.params[1] === 'phone'));
});

test('phone call from an unknown number is guided but never saved', async () => {
  const h = harness({ mother: false });
  const ev = (o) => ({ callId: 'c2', from: '+910000000000', digits: '', speech: '', ...o });
  await h.api.callStep(ev({})); await h.api.callStep(ev({ digits: '2' }));
  const d = await h.api.callStep(ev({ speech: 'I am bleeding heavily' }));
  assert.match(d.say[0].text, /112/);
  assert.ok(!h.calls.some((c) => /INSERT INTO voice_care_entries/.test(c.sql)));
});

test('phone call keeps the line open when Didi needs one more answer, and ignores bad keypad input', async () => {
  const h = harness({ mother: false });
  const ev = (o) => ({ callId: 'c3', from: '', digits: '', speech: '', ...o });
  await h.api.callStep(ev({}));
  let d = await h.api.callStep(ev({ digits: '9' }));
  assert.equal(d.gather.input, 'dtmf');
  await h.api.callStep(ev({ digits: '1' }));
  d = await h.api.callStep(ev({ speech: '' }));
  assert.equal(d.gather.input, 'speech');
  d = await h.api.callStep(ev({ speech: 'sir dard hai' }));
  assert.equal(d.hangup, false);
  assert.equal(d.gather.input, 'speech');
});

test('stub provider is closed in production unless explicitly enabled; twilio verifies its signature', () => {
  assert.equal(providers.stub.verify({}, { NODE_ENV: 'production' }), false);
  assert.equal(providers.stub.verify({}, { NODE_ENV: 'production', DAI_IVR_STUB: 'true' }), true);
  const body = { CallSid: 'CA1', From: '+911234567890', SpeechResult: 'hello' };
  const url = 'https://dai.example/api/didi/ivr/twilio';
  const sig = crypto.createHmac('sha1', 'tok').update(Object.keys(body).sort().reduce((a, k) => a + k + body[k], url)).digest('base64');
  const req = (s) => ({ body, protocol: 'https', originalUrl: '/api/didi/ivr/twilio', get: (h) => (h === 'X-Twilio-Signature' ? s : 'dai.example') });
  assert.equal(providers.twilio.verify(req(sig), { TWILIO_AUTH_TOKEN: 'tok' }), true);
  assert.equal(providers.twilio.verify(req('bad'), { TWILIO_AUTH_TOKEN: 'tok' }), false);
  assert.equal(providers.twilio.verify(req(sig), {}), false);
  assert.equal(providers.exotel.verify({}, {}), false);
});

test('twilio adapter renders escaped TwiML with Hindi and English voices', () => {
  const out = providers.twilio.render({ say: [{ text: 'a < b & "c"', lang: 'hi' }], gather: { input: 'speech', lang: 'hi' }, hangup: false });
  assert.equal(out.type, 'text/xml');
  assert.match(out.body, /<Gather input="speech" language="hi-IN"/);
  assert.match(out.body, /a &lt; b &amp; &quot;c&quot;/);
  assert.match(providers.twilio.render({ say: [{ text: 'bye', lang: 'en' }], gather: null, hangup: true }).body, /<Hangup\/>/);
});

/* ---------- front-end wiring ---------- */
test('front-end files parse, dashboard loads them, and the SOS flow accepts a Didi preset', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['frontend/js/dai-didi.js', 'frontend/js/care-extensions.js', 'shared/voice-triage.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, f), 'utf8')), f);
  const page = fs.readFileSync(path.join(root, 'frontend/dashboard.html'), 'utf8');
  assert.match(page, /shared\/voice-triage\.js/); assert.match(page, /js\/dai-didi\.js/);
  assert.match(fs.readFileSync(path.join(root, 'frontend/js/care-extensions.js'), 'utf8'), /function openSOS\(preset\)/);
  assert.match(fs.readFileSync(path.join(root, 'frontend/patient-sw.js'), 'utf8'), /shared\/voice-triage\.js/);
});

test('Dhruv saves typed notes only on request and preserves typed provenance under server replay',async()=>{
 const h=harness(),route=h.routes.find(r=>r[0]==='post'&&r[1]==='/api/didi/entries');
 const response={code:200,set(){return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 await route.at(-1)({user:{id:7},body:{turns:['BP 150 by 100'],context:'pregnant',input_mode:'text',triage_level:'unsure'}},response);
 assert.equal(response.code,201);assert.equal(response.body.entry.input_mode,'text');assert.equal(response.body.entry.vitals.blood_pressure.source,'self_reported_by_text');assert.equal(response.body.entry.triage.decided_by,'fixed_rules');
 const stored=JSON.parse(h.calls.find(c=>/INSERT INTO voice_care_entries/.test(c.sql)).params[6]);assert.equal(stored.input_mode,'text');assert.match(stored.disclaimer,/Not verified/);
});
