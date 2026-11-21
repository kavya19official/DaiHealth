'use strict';
/* Dai Didi — voice care guide, server side.
 *
 *   POST   /api/didi/entries                 mother saves a voice report (server replays her words through the fixed rules)
 *   GET    /api/didi/entries                 mother lists her own
 *   DELETE /api/didi/entries/:id             mother deletes one
 *   GET    /api/doctor/patients/:motherId/didi-entries   verified doctor with access
 *   POST   /api/didi/ivr/:provider           phone mode webhook (stub | twilio | exotel)
 *
 * Urgency is decided only by shared/voice-triage.js (fixed rules over shared/emergency-triage.js).
 * No language model is involved in any decision or in any sentence that is spoken.
 */
const express = require('express');
const DD = require('../shared/voice-triage');
const { providers } = require('./ivr/provider');

const PHONE = {
  en: {
    welcome: 'Welcome to Dhruv, a care guide for mothers.',
    choose: 'For Hindi press 1. For English press 2.',
    talk: 'After the beep, tell me what you are feeling. What you say will be written in your care timeline. I do not diagnose.',
    nospeech: 'I could not hear you. Please tell me again what you are feeling.',
    goodbye: 'Take care. If anything gets worse, call 112.',
    unknown: 'I could not find your number in DAI, so this call will not be saved to a record.'
  },
  hi: {
    welcome: 'ध्रुव में आपका स्वागत है। यह माँओं के लिए एक देखभाल गाइड है।',
    choose: 'हिंदी के लिए 1 दबाइए। English ke liye 2 dabaiye.',
    talk: 'बीप के बाद बताइए कि आप क्या महसूस कर रही हैं। आप जो कहेंगी वह आपके केयर टाइमलाइन में लिखा जाएगा। मैं निदान नहीं करती।',
    nospeech: 'मुझे आपकी आवाज़ सुनाई नहीं दी। कृपया फिर से बताइए कि आप क्या महसूस कर रही हैं।',
    goodbye: 'अपना ध्यान रखिए। अगर कुछ भी बढ़े तो 112 पर कॉल कीजिए।',
    unknown: 'आपका नंबर DAI में नहीं मिला, इसलिए यह कॉल किसी रिकॉर्ड में सेव नहीं होगी।'
  }
};

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

/** Replay the mother's own words through the shared engine. Pure; used by the app save and by phone calls. */
function replay(turns, { context = 'pregnant', gestWeeks = null, forceLang = null } = {}) {
  let result = null;
  for (const t of turns) {
    result = DD.processTurn(result ? result.state : DD.newState({ context, gestWeeks }), t, forceLang ? { forceLang } : {});
  }
  return result;
}

function register(app, { pool, authenticateToken, authorizeRole, env = process.env, now = () => Date.now() }) {
  const mother = [authenticateToken, authorizeRole(['mother'])];
  const sessions = new Map();
  const hits = new Map();

  async function contextFor(motherId) {
    try {
      const r = await pool.query("SELECT 1 FROM postpartum_profile WHERE mother_id=$1 AND delivery_date <= CURRENT_DATE AND delivery_date >= CURRENT_DATE - 42", [motherId]);
      return r.rows.length ? 'postpartum' : 'pregnant';
    } catch { return 'pregnant'; }
  }

  async function persist(motherId, result, turns, channel, existingId, emergencyEventId) {
    const entry = { ...result.entry, channel };
    const level = result.evaluation.level;
    if (existingId) {
      await pool.query('UPDATE voice_care_entries SET entry=$3, spoken_turns=$4, triage_level=$5, review_status=$6, language=$7 WHERE id=$1 AND mother_id=$2',
        [existingId, motherId, JSON.stringify(entry), JSON.stringify(turns), level, entry.review.status, result.language]);
      return existingId;
    }
    const r = await pool.query(
      `INSERT INTO voice_care_entries (mother_id, channel, language, context, triage_level, review_status, entry, spoken_turns, emergency_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [motherId, channel, result.language, result.state.context, level, entry.review.status, JSON.stringify(entry), JSON.stringify(turns), emergencyEventId || null]);
    return r.rows[0].id;
  }

  app.post('/api/didi/entries', ...mother, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    const turns = Array.isArray(b.turns) ? b.turns.filter((t) => typeof t === 'string').map((t) => clean(t, 500)).filter(Boolean).slice(0, 12) : [];
    if (!turns.length) return res.status(400).json({ error: 'Nothing was said to save' });
    try {
      const context = b.context === 'postpartum' || b.context === 'pregnant' ? b.context : await contextFor(req.user.id);
      const result = replay(turns, { context });
      if (!result || !result.entry) return res.status(422).json({ error: 'No symptom was understood, so nothing was saved' });
      const inputMode=['text','dictation','speech'].includes(b.input_mode)?b.input_mode:'speech';
      result.entry={...result.entry,input_mode:inputMode,disclaimer:'Guidance from fixed rules, not a diagnosis. Self-reported through Dhruv. Not verified by a clinician.'};
      if(result.entry.vitals?.blood_pressure&&inputMode!=='speech')result.entry.vitals.blood_pressure.source='self_reported_by_'+inputMode;
      result.entry.review={...result.entry.review,reason:result.entry.review.reason.replace('voice report','self-report')};
      const eventId = Number.isInteger(b.emergency_event_id) ? b.emergency_event_id : null;
      const id = await persist(req.user.id, result, turns, 'app', null, eventId);
      res.status(201).json({ entry: { id, ...result.entry, channel: 'app' } });
    } catch (e) { console.error('Didi save error:', e.message); res.status(500).json({ error: 'Could not save your voice note' }); }
  });

  app.get('/api/didi/entries', ...mother, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const r = await pool.query('SELECT id, channel, triage_level, review_status, entry, created_at FROM voice_care_entries WHERE mother_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      res.json({ entries: r.rows });
    } catch { res.status(500).json({ error: 'Could not load voice notes' }); }
  });

  app.delete('/api/didi/entries/:id', ...mother, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid note' });
    try {
      const r = await pool.query('DELETE FROM voice_care_entries WHERE id=$1 AND mother_id=$2', [id, req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Note not found' });
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: 'Could not delete this note' }); }
  });

  app.get('/api/doctor/patients/:motherId/didi-entries', authenticateToken, authorizeRole(['doctor']), async (req, res) => {
    try {
      if (!await require('./clinicalDashboard').verifiedDoctor(pool, req.user.id)) return res.status(403).json({ error: 'Verified clinician credentials are required' });
      const motherId = await require('./accessControl').gateDoctor(pool, req, res, 'timeline');
      if (motherId == null) return;
      const r = await pool.query('SELECT id, channel, triage_level, review_status, entry, spoken_turns, created_at FROM voice_care_entries WHERE mother_id=$1 ORDER BY created_at DESC LIMIT 50', [motherId]);
      res.set('Cache-Control', 'no-store').json({ entries: r.rows, label: 'Self-reported through Dhruv (text or voice). Fixed-rule flags, not a diagnosis.' });
    } catch { res.status(500).json({ error: 'Could not load voice notes' }); }
  });

  /* ---------------- Phone mode ---------------- */
  async function motherByPhone(from) {
    const digits = String(from || '').replace(/\D/g, '').slice(-10);
    if (digits.length < 10) return null;
    try {
      const r = await pool.query("SELECT user_id FROM mother_profiles WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = $1 LIMIT 2", [digits]);
      return r.rows.length === 1 ? r.rows[0].user_id : null;
    } catch { return null; }
  }

  function sweep() {
    const t = now();
    for (const [k, v] of sessions) if (v.expires <= t) sessions.delete(k);
    if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  }

  /** One webhook hit -> one directive. Exported for tests through register's return value. */
  async function callStep(ev) {
    sweep();
    let s = sessions.get(ev.callId);
    if (!s) {
      const motherId = await motherByPhone(ev.from);
      s = { stage: 'lang', lang: 'hi', motherId, turns: [], state: null, entryId: null, expires: now() + 30 * 60000 };
      sessions.set(ev.callId, s);
      return { say: [{ text: PHONE.hi.welcome, lang: 'hi' }, { text: PHONE.en.welcome, lang: 'en' }, { text: PHONE.hi.choose, lang: 'hi' }, { text: 'For English press 2.', lang: 'en' }], gather: { input: 'dtmf', numDigits: 1 }, hangup: false };
    }
    s.expires = now() + 30 * 60000;
    if (s.stage === 'lang') {
      if (ev.digits !== '1' && ev.digits !== '2') return { say: [{ text: PHONE.hi.choose, lang: 'hi' }, { text: 'For English press 2.', lang: 'en' }], gather: { input: 'dtmf', numDigits: 1 }, hangup: false };
      s.lang = ev.digits === '2' ? 'en' : 'hi';
      s.stage = 'talk';
      s.context = s.motherId ? await contextFor(s.motherId) : 'pregnant';
      const say = [{ text: PHONE[s.lang].talk, lang: s.lang }];
      if (!s.motherId) say.push({ text: PHONE[s.lang].unknown, lang: s.lang });
      return { say, gather: { input: 'speech', lang: s.lang }, hangup: false };
    }
    if (!ev.speech.trim()) return { say: [{ text: PHONE[s.lang].nospeech, lang: s.lang }], gather: { input: 'speech', lang: s.lang }, hangup: false };

    const turn = clean(ev.speech, 500);
    s.turns.push(turn);
    const result = DD.processTurn(s.state || DD.newState({ context: s.context }), turn, { forceLang: s.lang });
    s.state = result.state;
    const saveAsk = DD.tpl(s.lang, 'saved_ask');
    const frags = result.fragments.filter((f) => f !== saveAsk);          // saving on a call needs no spoken question
    if (s.motherId && result.entry) {
      try { s.entryId = await persist(s.motherId, result, s.turns, 'phone', s.entryId, null); } catch (e) { console.error('Didi call save error:', e.message); }
    }
    const say = frags.map((f) => ({ text: f, lang: s.lang }));
    const emergency = result.evaluation.level === 'emergency';
    if (emergency || !result.question) {
      say.push({ text: PHONE[s.lang].goodbye, lang: s.lang });
      sessions.delete(ev.callId);
      return { say, gather: null, hangup: true };
    }
    return { say, gather: { input: 'speech', lang: s.lang }, hangup: false };
  }

  app.post('/api/didi/ivr/:provider', express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }), async (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider) return res.status(404).json({ error: 'Unknown phone provider' });
    const t = now();
    const ip = req.ip || 'x', h = hits.get(ip) || { n: 0, exp: t + 600000 };
    if (h.exp < t) { h.n = 0; h.exp = t + 600000; }
    if (++h.n > 240) return res.status(429).json({ error: 'Too many calls' });
    hits.set(ip, h); if (hits.size > 5000) hits.delete(hits.keys().next().value);
    try {
      if (!provider.verify(req, env)) return res.status(403).json({ error: 'Phone webhook not verified or not enabled' });
      const ev = provider.parse(req);
      if (!ev.callId) return res.status(400).json({ error: 'Missing call id' });
      const out = provider.render(await callStep(ev));
      res.set({ 'Content-Type': out.type, 'Cache-Control': 'no-store' }).send(out.body);
    } catch (e) { res.status(e.status || 500).json({ error: e.status === 501 ? e.message : 'Phone guide unavailable. Call 112 in an emergency.' }); }
  });

  return { callStep, sessions };
}

module.exports = { register, replay, PHONE };
