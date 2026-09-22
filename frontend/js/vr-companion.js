(function () {
  'use strict';

  if (window.DAI_DISABLE_VR_COMPANION || document.getElementById('daiCareCompanion')) return;

  var api = window.DaiAPI || {};
  var companionName = 'Dr. Daya';
  var speechEnabled = localStorage.getItem('dai_companion_voice') === '1';
  var voices = [];

  function pageRole() {
    var path = location.pathname.toLowerCase();
    if (path.indexOf('doctor') >= 0) return 'doctor';
    if (path.indexOf('hospital') >= 0) return 'hospital';
    if (path.indexOf('auth') >= 0 || path.indexOf('index') >= 0 || path === '/') return 'guest';
    return 'mother';
  }

  var role = pageRole();
  var quickQuestions = {
    guest: ['What can दाई help with?', 'Does दाई diagnose patients?', 'How do the three portals work?'],
    mother: [
      'What tests am I supposed to get this month?',
      'When is my baby’s next vaccination due?',
      'What should I bring to my next appointment?',
      'I am nervous about delivery, is that normal?'
    ],
    doctor: ['Show today’s consult priorities.', 'How should I use the pre-consult brief?', 'Can drafts be sent automatically?'],
    hospital: ['How do I review care gaps?', 'How does slot reassignment work?', 'Does दाई assign clinical urgency?']
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function fallbackAnswer(question) {
    var q = String(question || '').toLowerCase();
    var prefix = role === 'doctor' ? 'For your doctor workflow: ' : role === 'hospital' ? 'For the hospital team: ' : '';
    if (/(dangerous|danger|symptom|bleeding|pain|fever|breath|dizzy|faint|what.?s wrong|wrong with me|emergency)/i.test(q)) {
      return 'I cannot tell whether a symptom is dangerous or diagnose what is happening. Please contact your doctor or hospital now. If urgent, use your local emergency number or the SOS option.';
    }
    if (/(should i take|can i take|medicine|medication|tablet|dose|dosage|supplement)/i.test(q)) {
      return 'I cannot advise on medicines, supplements, or doses. Please ask your doctor, pharmacist, or care team.';
    }
    if (/(high.?risk|high risk)/i.test(q)) {
      return 'Only a qualified clinician can decide whether a pregnancy is high-risk. दाई can show recorded items and doctor-set flags, but it does not make that decision.';
    }
    if (/(test|scan|month|20.?week|bring|appointment|checkup|check-up)/i.test(q)) {
      return prefix + 'Open the timeline and appointment cards to see expected tests, scans, due dates, and documents to bring. If something is missing, message the clinic for human confirmation.';
    }
    if (/(vaccination|vaccine|baby)/i.test(q)) {
      return 'Your baby’s vaccination schedule should appear in the child timeline. If a vaccine looks overdue or missing, confirm it with the clinic or PHC.';
    }
    if (/(gestational diabetes|anemia|anaemia|term|means|why do i need)/i.test(q)) {
      return 'I can explain general terms, but not interpret your personal reports. Gestational diabetes means high blood sugar first recognized during pregnancy. Anaemia means low haemoglobin.';
    }
    if (/(nearest clinic|reschedule|documents|government scheme|scheme|where|how do i)/i.test(q)) {
      return 'For logistics, use appointments, documents, and messages. You can request a reschedule and ask the care team which documents your facility needs.';
    }
    if (/(nervous|scared|anxious|worried|forgot)/i.test(q)) {
      return 'It is understandable to feel worried. I can help you prepare questions for your doctor. If you feel unwell or unsafe, contact your care team.';
    }
    return prefix + 'I can help with care timelines, appointments, documents, vaccinations, care-gap workflow, and using दाई. I cannot diagnose, recommend treatment, or score clinical risk.';
  }

  function addMessage(kind, text) {
    var feed = document.getElementById('careCompanionFeed');
    if (!feed) return;
    var item = document.createElement('div');
    item.className = 'care-message care-message--' + kind;
    item.innerHTML = '<div>' + escapeHtml(text) + '</div>';
    feed.appendChild(item);
    feed.scrollTop = feed.scrollHeight;
  }

  function setBusy(isBusy) {
    var root = document.getElementById('daiCareCompanion');
    var send = document.getElementById('careCompanionSend');
    if (root) root.classList.toggle('is-thinking', !!isBusy);
    if (send) send.disabled = !!isBusy;
  }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
  }

  function chooseEnglishVoice() {
    loadVoices();
    var english = voices.filter(function (v) {
      return /^en/i.test(v.lang || '') || /English/i.test(v.name || '');
    });
    return english.find(function (v) { return /Microsoft/i.test(v.name) && /(Aria|Jenny|Sonia|Emma|Natasha|Ava|Ana|Guy)/i.test(v.name); }) ||
      english.find(function (v) { return /Microsoft/i.test(v.name); }) ||
      english.find(function (v) { return /(Natural|Premium|Enhanced)/i.test(v.name); }) ||
      english[0] ||
      null;
  }

  function speak(text) {
    if (!speechEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(String(text || ''));
    var voice = chooseEnglishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice && voice.lang ? voice.lang : 'en-US';
    utterance.rate = 0.88;
    utterance.pitch = 0.98;
    utterance.volume = 0.9;
    var root = document.getElementById('daiCareCompanion');
    utterance.onstart = function () { if (root) root.classList.add('is-speaking'); };
    utterance.onend = utterance.onerror = function () { if (root) root.classList.remove('is-speaking'); };
    window.speechSynthesis.speak(utterance);
  }

  async function askCompanion(question) {
    addMessage('user', question);
    setBusy(true);
    var answer = '';
    try {
      var base = api.API_BASE || (location.origin + '/api');
      var response = await fetch(base + '/companion/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: role, message: question })
      });
      var data = await response.json().catch(function () { return {}; });
      answer = data.answer || fallbackAnswer(question);
    } catch (err) {
      answer = fallbackAnswer(question);
    }
    setBusy(false);
    addMessage('assistant', answer);
    speak(answer);
  }

  function togglePanel(force) {
    var root = document.getElementById('daiCareCompanion');
    var panel = document.getElementById('careCompanionPanel');
    var open = typeof force === 'boolean' ? force : !root.classList.contains('is-open');
    root.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) setTimeout(function () {
      var input = document.getElementById('careCompanionInput');
      if (input) input.focus();
    }, 80);
  }

  function render() {
    var root = document.createElement('aside');
    root.id = 'daiCareCompanion';
    root.className = 'care-companion care-companion--' + role;
    root.innerHTML =
      '<button class="care-launcher" id="careCompanionToggle" type="button" aria-label="Open Dr. Daya chatbot">' +
        '<span class="care-launcher__avatar" aria-hidden="true">द</span>' +
        '<span class="care-launcher__copy"><strong>Ask ' + companionName + '</strong><small>Care chatbot</small></span>' +
        '<span class="care-launcher__chev" aria-hidden="true">⌄</span>' +
      '</button>' +
      '<section class="care-panel" id="careCompanionPanel" aria-hidden="true" aria-label="Dr. Daya care chatbot">' +
        '<header class="care-panel__head">' +
          '<span class="care-panel__avatar" aria-hidden="true">द</span>' +
          '<div><h2>' + companionName + '</h2><p>English voice care chatbot</p></div>' +
          '<button class="care-close" id="careCompanionClose" type="button" aria-label="Close chatbot">×</button>' +
        '</header>' +
        '<div class="care-safety">Assistive only. No diagnosis, medicine advice, or clinical risk scoring.</div>' +
        '<div class="care-feed" id="careCompanionFeed"></div>' +
        '<div class="care-chips" id="careCompanionChips"></div>' +
        '<form class="care-form" id="careCompanionForm">' +
          '<input id="careCompanionInput" type="text" autocomplete="off" placeholder="Ask your question…">' +
          '<button id="careCompanionSend" type="submit" aria-label="Send message">Ask</button>' +
        '</form>' +
        '<button class="care-voice" id="careVoiceToggle" type="button" aria-pressed="' + (speechEnabled ? 'true' : 'false') + '">' + (speechEnabled ? 'English voice on' : 'English voice off') + '</button>' +
      '</section>';
    document.body.appendChild(root);

    document.getElementById('careCompanionToggle').addEventListener('click', function () { togglePanel(); });
    document.getElementById('careCompanionClose').addEventListener('click', function () { togglePanel(false); });
    document.getElementById('careVoiceToggle').addEventListener('click', function () {
      speechEnabled = !speechEnabled;
      localStorage.setItem('dai_companion_voice', speechEnabled ? '1' : '0');
      this.textContent = speechEnabled ? 'English voice on' : 'English voice off';
      this.setAttribute('aria-pressed', speechEnabled ? 'true' : 'false');
      if (!speechEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });
    document.getElementById('careCompanionForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('careCompanionInput');
      var value = input.value.trim();
      if (!value) return;
      input.value = '';
      askCompanion(value);
    });

    var chips = document.getElementById('careCompanionChips');
    (quickQuestions[role] || quickQuestions.mother).forEach(function (q) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = q;
      btn.addEventListener('click', function () { askCompanion(q); });
      chips.appendChild(btn);
    });
    addMessage('assistant', role === 'guest'
      ? 'Hi, I’m Dr. Daya, your दाई care chatbot. Ask me about the platform, portals, and safety boundaries.'
      : 'Hi, I’m Dr. Daya, your दाई care chatbot. Ask me about timelines, appointments, documents, or how to use this portal.');
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
