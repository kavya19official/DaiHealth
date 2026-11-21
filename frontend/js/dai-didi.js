/* Dai Didi — voice-first care guide (patient dashboard).
 *
 * Flow: mother speaks (hi-IN / en-IN browser speech recognition) -> the shared fixed-rule engine
 * (/shared/voice-triage.js, the same file the server re-runs on save) understands it -> Didi answers
 * with a pre-written template, spoken by Gemini TTS (browser voice as a clearly-labelled fallback)
 * -> a structured entry is shown and, with her OK, saved to her timeline.
 *
 * Urgency is never decided by a language model. The engine runs on the device, so the emergency
 * path still works when the network is slow. Needs: window.DaiDidi, window.CareExt (care-extensions.js).
 */
(function () {
  'use strict';
  var DD = window.DaiDidi;
  if (!DD || document.getElementById('daiDidi')) return;

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var api = function () { return window.DaiAPI; };
  var ctxOf = function () { return window.CareExt && window.CareExt.currentContext ? window.CareExt.currentContext() : 'pregnant'; };
  var weeksOf = function () { var w = window.CareExt && window.CareExt.gestWeeks ? window.CareExt.gestWeeks() : null; return Number.isFinite(w) && ctxOf() === 'pregnant' ? w : null; };
  var isGuest = function () { return !!(window.CareExt && window.CareExt.isGuest && window.CareExt.isGuest()) || localStorage.getItem('dai_guest') === '1'; };

  var S = { open: false, engine: null, turns: [], last: null, recog: null, listening: false, speakId: 0, audio: null, url: null, uiLang: 'hi', openedFor: '', saved: false, busy: false };
  var tts = new Map();

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  var tr = function (en, hi) { return S.uiLang === 'en' ? en : hi; };

  /* ---------- DOM ---------- */
  var root = el('div', { id: 'daiDidi' });
  root.innerHTML =
    '<button type="button" class="dd-launch" aria-expanded="false" aria-controls="ddPanel"><span class="dd-orb" aria-hidden="true">🎙</span><span><span class="dd-l1">Dai Didi</span><small class="dd-l2">बोलकर बताइए</small></span></button>' +
    '<section class="dd-panel" id="ddPanel" role="dialog" aria-label="Dai Didi voice guide" hidden>' +
    '<header class="dd-head"><span aria-hidden="true" style="font-size:24px">🪔</span><div><strong>Dai Didi</strong><small class="dd-sub"></small></div>' +
    '<select class="dd-lang" aria-label="Language"><option value="hi">हिंदी / Hinglish</option><option value="en">English</option></select>' +
    '<button type="button" class="dd-x" aria-label="Close">×</button></header>' +
    '<div class="dd-banner" role="alert" hidden></div>' +
    '<div class="dd-feed" role="log" aria-live="polite"></div>' +
    '<div class="dd-entry" hidden></div>' +
    '<div class="dd-status" role="status"></div>' +
    '<div class="dd-mic"><button type="button" class="dd-micbtn" aria-pressed="false" aria-label="Speak">🎙</button></div>' +
    '<form class="dd-type"><input type="text" maxlength="500" autocomplete="off" aria-label="Type instead"><button type="submit" class="dd-btn">OK</button></form>' +
    '<div class="dd-chips"></div>' +
    '<details class="dd-phone"><summary></summary><div class="dd-phonebody"></div></details>' +
    '<p class="dd-note"></p></section>';
  document.body.appendChild(root);

  var $ = function (sel) { return root.querySelector(sel); };
  var panel = $('.dd-panel'), launch = $('.dd-launch'), feed = $('.dd-feed'), banner = $('.dd-banner'), entryBox = $('.dd-entry'),
    status = $('.dd-status'), micBtn = $('.dd-micbtn'), typeForm = $('.dd-type'), typeInput = $('.dd-type input'), chips = $('.dd-chips');

  var DEMOS = [
    ['sir dard hai aur nazar dhundhli hai', 'सिर दर्द है और नज़र धुंधली है'],
    ['BP 150 by 100', 'BP 150 by 100'],
    ['bachcha hil nahi raha', 'bachcha hil nahi raha'],
    ['I have fever and chills', 'I have fever and chills']
  ];

  function labels() {
    $('.dd-sub').textContent = tr('Voice care guide · I do not diagnose', 'आवाज़ वाली केयर गाइड · मैं निदान नहीं करती');
    $('.dd-l2').textContent = tr('Talk instead of typing', 'बोलकर बताइए');
    typeInput.placeholder = tr('Or type here…', 'या यहाँ लिखिए…');
    $('.dd-phone summary').textContent = tr('Phone call mode (demo simulator)', 'फ़ोन कॉल मोड (डेमो सिम्युलेटर)');
    $('.dd-note').textContent = tr(
      'Fixed safety rules decide how urgent this is, never an AI model. Your words are saved only if you choose to save. Guidance, not a diagnosis.',
      'कितना ज़रूरी है, यह तय करने वाले तय नियम हैं, कोई AI मॉडल नहीं। आपकी बात तभी सेव होगी जब आप चाहें। मार्गदर्शन, निदान नहीं।');
    chips.replaceChildren();
    DEMOS.forEach(function (d) {
      var b = el('button', { type: 'button' }, d[S.uiLang === 'en' ? 1 : 0]);
      b.addEventListener('click', function () { say(d[S.uiLang === 'en' ? 1 : 0]); });
      chips.appendChild(b);
    });
    if (!Recognition) micBtn.title = tr('This browser cannot listen. Please type.', 'यह ब्राउज़र सुन नहीं सकता। कृपया लिखिए।');
    setStatus(S.listening ? tr('Listening…', 'सुन रही हूँ…') : '');
  }
  function setStatus(t) { status.textContent = t || ''; }

  /* ---------- Conversation ---------- */
  function bubble(who, text, cls) {
    var m = el('div', { class: 'dd-msg ' + who + (cls ? ' ' + cls : '') }, text);
    feed.appendChild(m); feed.scrollTop = feed.scrollHeight; return m;
  }

  function intro() {
    var lang = S.uiLang === 'en' ? 'en' : 'hinglish';
    var text = DD.tpl(S.uiLang === 'en' ? 'en' : 'hi', 'guide_note') + '\n' + DD.tpl(S.uiLang === 'en' ? 'en' : 'hi', 'listen_prompt');
    bubble('didi', text);
    speak(text, S.uiLang === 'en' ? 'en' : 'hi');
    void lang;
  }

  function say(text) {
    text = String(text || '').trim().slice(0, 500);
    if (!text) return;
    stopListening(); stopSpeaking();
    bubble('me', text);
    S.turns.push(text);
    var result = DD.processTurn(S.engine || DD.newState({ context: ctxOf(), gestWeeks: weeksOf() }), text, { langHint: S.uiLang === 'en' ? 'en' : 'hi' });
    S.engine = result.state; S.last = result; S.saved = false;
    var em = result.evaluation.level === 'emergency';
    bubble('didi', result.text, em ? 'em' : '');
    root.classList.toggle('dd-emergency', em);
    renderBanner(result); renderEntry(result);
    if (result.actions.openEmergencyFlow) maybeOpenEmergency(result);
    speak(result.text, result.language === 'en' ? 'en' : 'hi').then(function (ok) {
      // Hands-free follow-up: if Didi asked something, listen for the answer without another tap.
      if (ok !== 'stopped' && result.question && S.open && Recognition && !S.listening) startListening();
    });
  }

  function renderBanner(result) {
    var ev = result.evaluation;
    banner.replaceChildren();
    if (ev.level !== 'emergency') { banner.hidden = true; return; }
    banner.hidden = false;
    banner.appendChild(document.createTextNode((ev.crisis ? tr('Please get help now. ', 'कृपया अभी मदद लीजिए। ') : tr('Emergency signs found. ', 'आपातकालीन संकेत मिले। '))));
    (result.actions.numbers || []).forEach(function (n) {
      var a = el('a', { href: 'tel:' + String(n.number).replace(/[^\d+]/g, '') }, tr('Call ', 'कॉल ') + n.number);
      banner.appendChild(a); banner.appendChild(document.createTextNode('  '));
    });
  }

  function chip(text, cls) { return el('span', { class: 'dd-chip' + (cls ? ' ' + cls : '') }, text); }

  function renderEntry(result) {
    var en = result.entry;
    entryBox.replaceChildren();
    if (!en) { entryBox.hidden = true; return; }
    entryBox.hidden = false;
    entryBox.appendChild(el('h4', {}, tr('Written for your timeline', 'आपके टाइमलाइन के लिए लिखा गया')));
    var line = el('div');
    line.appendChild(chip(en.triage.level.toUpperCase(), en.triage.level));
    if (en.triage.preeclampsia_warning) line.appendChild(chip(tr('Possible pre-eclampsia warning', 'प्री-एक्लेम्पसिया की संभावित चेतावनी'), 'emergency'));
    en.symptoms.forEach(function (s) { line.appendChild(chip(s.label)); });
    en.other_symptoms.forEach(function (s) { line.appendChild(chip(s.label)); });
    var bp = en.vitals && en.vitals.blood_pressure;
    if (bp) line.appendChild(chip('BP ' + bp.systolic + '/' + bp.diastolic + ' (' + tr('told by voice', 'बोलकर बताया') + ')'));
    if (en.duration) line.appendChild(chip(tr('Since: ', 'कब से: ') + en.duration));
    entryBox.appendChild(line);
    entryBox.appendChild(el('div', { style: 'margin-top:.35rem;color:#6b4a85;font-size:12px' }, tr('Clinician review: ', 'क्लिनिशियन समीक्षा: ') + en.review.status.replace(/_/g, ' ')));
    var row = el('div', { class: 'dd-row' });
    var save = el('button', { type: 'button', class: 'dd-btn primary' }, S.saved ? tr('Saved ✓', 'सेव हो गया ✓') : tr('Save to my timeline', 'मेरे टाइमलाइन में सेव करें'));
    save.disabled = S.saved || S.busy;
    if (isGuest()) { save.disabled = true; save.title = tr('Sign in to save', 'सेव करने के लिए साइन इन करें'); }
    save.addEventListener('click', saveEntry);
    row.appendChild(save);
    if (result.actions.openEmergencyFlow) {
      var open = el('button', { type: 'button', class: 'dd-btn danger' }, tr('Open emergency flow', 'इमरजेंसी फ़्लो खोलें'));
      open.addEventListener('click', function () { openEmergency(result, true); });
      row.appendChild(open);
    }
    var reset = el('button', { type: 'button', class: 'dd-btn' }, tr('Start over', 'फिर से शुरू'));
    reset.addEventListener('click', resetChat);
    row.appendChild(reset);
    entryBox.appendChild(row);
  }

  function maybeOpenEmergency(result) {
    var sig = result.actions.emergencyPreset.codes.slice().sort().join(',');
    if (S.openedFor === sig) return;          // already opened for exactly this set; the button reopens it on demand
    S.openedFor = sig;
    openEmergency(result, false);
  }
  function openEmergency(result, manual) {
    var preset = result.actions.emergencyPreset;
    if (!preset || !preset.codes.length) return;
    if (window.CareExt && window.CareExt.openSOS) window.CareExt.openSOS(preset);
    else if (manual) bubble('didi', tr('Please call 112 now.', 'कृपया अभी 112 पर कॉल कीजिए।'), 'em');
  }

  async function saveEntry() {
    if (S.busy || S.saved || !S.turns.length || isGuest() || !api()) return;
    S.busy = true; renderEntry(S.last);
    try {
      var r = await api().apiRequest('/didi/entries', { method: 'POST', body: { turns: S.turns, context: ctxOf() } });
      if (r && r.entry) {
        S.saved = true;
        var lang = S.last.language === 'en' ? 'en' : (S.last.language === 'hi' ? 'hi' : 'hinglish');
        var t = DD.tpl(lang, 'saved_ok');
        bubble('didi', t); speak(t, lang === 'en' ? 'en' : 'hi');
      }
    } catch (e) { setStatus(tr('Could not save. Your note is still here.', 'सेव नहीं हो पाया। आपका नोट यहीं है।')); }
    S.busy = false; renderEntry(S.last);
  }

  function resetChat() {
    stopListening(); stopSpeaking();
    S.engine = null; S.turns = []; S.last = null; S.saved = false; S.openedFor = '';
    feed.replaceChildren(); banner.hidden = true; entryBox.hidden = true; root.classList.remove('dd-emergency');
    intro();
  }

  /* ---------- Listening (browser speech recognition) ---------- */
  function startListening() {
    if (!Recognition) { setStatus(tr('This browser cannot listen. Please type.', 'यह ब्राउज़र सुन नहीं सकता। कृपया लिखिए।')); typeInput.focus(); return; }
    stopSpeaking();
    var r = new Recognition();
    S.recog = r; r.lang = S.uiLang === 'en' ? 'en-IN' : 'hi-IN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    var live = null, finalText = '';
    r.onstart = function () { S.listening = true; micBtn.setAttribute('aria-pressed', 'true'); setStatus(tr('Listening…', 'सुन रही हूँ…')); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      if (!live) live = bubble('me', '', 'live');
      live.textContent = finalText + interim;
    };
    r.onerror = function (e) {
      if (live) live.remove(); live = null;
      setStatus(e.error === 'not-allowed' ? tr('Microphone permission denied. Please type.', 'माइक्रोफ़ोन की अनुमति नहीं मिली। कृपया लिखिए।') : tr('Could not hear you. Tap and try again, or type.', 'सुन नहीं पाई। फिर से दबाइए या लिखिए।'));
    };
    r.onend = function () {
      S.listening = false; micBtn.setAttribute('aria-pressed', 'false'); S.recog = null;
      if (live) { live.remove(); live = null; }
      if (finalText.trim()) say(finalText); else if (!status.textContent) setStatus('');
    };
    try { r.start(); } catch (e) { setStatus(tr('Microphone unavailable. Please type.', 'माइक्रोफ़ोन उपलब्ध नहीं। कृपया लिखिए।')); }
  }
  function stopListening() { if (S.recog) { var r = S.recog; S.recog = null; r.onend = null; try { r.abort(); } catch (e) { /* already stopped */ } } S.listening = false; micBtn.setAttribute('aria-pressed', 'false'); }

  /* ---------- Speaking: Gemini TTS first, browser voice as a labelled fallback ---------- */
  function stopSpeaking() {
    S.speakId++;
    if (S.audio) { S.audio.onended = null; S.audio.onerror = null; S.audio.pause(); S.audio = null; }
    if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  async function speak(text, lang) {
    stopSpeaking();
    var id = S.speakId;
    setStatus(tr('Preparing voice…', 'आवाज़ तैयार हो रही है…'));
    try {
      var key = lang + '|' + text, blob = tts.get(key);
      if (!blob) {
        var resp = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ text: text, language: lang }), signal: AbortSignal.timeout(35000) });
        if (!resp.ok) throw new Error('tts ' + resp.status);
        blob = await resp.blob();
        if (!/^audio\//i.test(blob.type) || !blob.size) throw new Error('no audio');
        if (tts.size >= 20) tts.delete(tts.keys().next().value);
        tts.set(key, blob);
      }
      if (id !== S.speakId) return 'stopped';
      S.url = URL.createObjectURL(blob); var audio = new Audio(S.url); S.audio = audio;
      return await new Promise(function (resolve) {
        audio.onplaying = function () { setStatus(tr('Speaking…', 'बोल रही हूँ…')); };
        audio.onended = function () { if (id === S.speakId) setStatus(''); resolve('ended'); };
        audio.onerror = function () { resolve(browserVoice(text, lang, id)); };
        audio.play().catch(function () { resolve(browserVoice(text, lang, id)); });
      });
    } catch (e) {
      return browserVoice(text, lang, id);
    }
  }
  function browserVoice(text, lang, id) {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis || id !== S.speakId) { setStatus(tr('Voice unavailable. Read the reply above.', 'आवाज़ उपलब्ध नहीं। ऊपर जवाब पढ़िए।')); return resolve('failed'); }
      var parts = text.split('\n').filter(Boolean), i = 0;
      setStatus(tr('Gemini voice unavailable. Using this device’s voice.', 'Gemini आवाज़ उपलब्ध नहीं। इस डिवाइस की आवाज़ इस्तेमाल हो रही है।'));
      (function next() {
        if (id !== S.speakId || i >= parts.length) { if (id === S.speakId) setStatus(''); return resolve(id === S.speakId ? 'ended' : 'stopped'); }
        var u = new SpeechSynthesisUtterance(parts[i++]); u.lang = lang === 'en' ? 'en-IN' : 'hi-IN'; u.rate = 0.95;
        u.onend = next; u.onerror = next; window.speechSynthesis.speak(u);
      })();
    });
  }

  /* ---------- Phone call mode: demo simulator against the stub IVR provider ---------- */
  (function phone() {
    var body = $('.dd-phonebody'), callId = 'sim-' + Math.random().toString(36).slice(2, 10);
    body.innerHTML = '<p style="margin:.3rem 0">Same fixed rules over a call. In production this sits behind Twilio or Exotel; here a stub provider answers.</p>' +
      '<div class="dd-row"><input type="tel" class="dd-from" placeholder="Registered phone (optional)" style="flex:1;border:1px solid #d9c3ea;border-radius:10px;padding:.35rem .5rem"><button type="button" class="dd-btn" data-act="dial">📞 Dial</button></div>' +
      '<div class="dd-row"><button type="button" class="dd-btn" data-act="1">Press 1 (हिंदी)</button><button type="button" class="dd-btn" data-act="2">Press 2 (English)</button></div>' +
      '<div class="dd-row"><input type="text" class="dd-say" placeholder="What the caller says…" style="flex:1;border:1px solid #d9c3ea;border-radius:10px;padding:.35rem .5rem"><button type="button" class="dd-btn" data-act="say">Speak</button></div>' +
      '<div class="dd-phonelog" aria-live="polite"></div>';
    var log = body.querySelector('.dd-phonelog');
    async function hit(payload) {
      payload.call_id = callId;
      try {
        var r = await fetch('/api/didi/ivr/stub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        var j = await r.json();
        if (!r.ok) { log.textContent += '\n! ' + (j.error || r.status); return; }
        log.textContent += '\n☎ ' + j.spoken.replace(/\n/g, '\n  ') + (j.directive.hangup ? '\n— call ended —' : '');
        if (j.directive.hangup) callId = 'sim-' + Math.random().toString(36).slice(2, 10);
        log.scrollTop = log.scrollHeight;
      } catch (e) { log.textContent += '\n! phone guide unreachable'; }
    }
    body.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'dial') { log.textContent = ''; hit({ from: body.querySelector('.dd-from').value }); }
      else if (act === '1' || act === '2') hit({ digits: act, from: body.querySelector('.dd-from').value });
      else if (act === 'say') { var v = body.querySelector('.dd-say'); if (v.value.trim()) { log.textContent += '\n🗣 ' + v.value; hit({ speech: v.value, from: body.querySelector('.dd-from').value }); v.value = ''; } }
    });
  })();

  /* ---------- Wiring ---------- */
  function open() {
    S.open = true; panel.hidden = false; launch.hidden = true; launch.setAttribute('aria-expanded', 'true');
    if (!feed.children.length) intro();
    micBtn.focus();
  }
  function close() {
    S.open = false; panel.hidden = true; launch.hidden = false; launch.setAttribute('aria-expanded', 'false');
    stopListening(); stopSpeaking(); launch.focus();
  }
  launch.addEventListener('click', open);
  $('.dd-x').addEventListener('click', close);
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) close(); });
  micBtn.addEventListener('click', function () { if (S.listening) stopListening(); else startListening(); });
  typeForm.addEventListener('submit', function (e) { e.preventDefault(); var v = typeInput.value; typeInput.value = ''; say(v); });
  $('.dd-lang').addEventListener('change', function (e) { S.uiLang = e.target.value; labels(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { stopListening(); stopSpeaking(); } });
  window.addEventListener('pagehide', function () { stopListening(); stopSpeaking(); });

  labels();
  window.DaiDidiUI = { open: open, close: close, say: say };
  if (location.hash === '#dai-didi') open();
})();
