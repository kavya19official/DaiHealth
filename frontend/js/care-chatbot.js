(function () {
  if (document.getElementById('daiCareChatbot')) return;

  var voiceOn = false;
  var currentAudio = null;
  var messages = [];
  var safeReplies = [
    {
      test: /(dangerous|symptom|bleeding|pain|fever|emergency|what'?s wrong)/i,
      reply: 'I cannot diagnose symptoms or judge danger. Please contact your doctor or emergency care now if this feels urgent. I can help you note this concern for your care team.'
    },
    {
      test: /(medicine|medication|dose|tablet|supplement|take .*mg|should i take)/i,
      reply: 'I cannot tell you what medicine or dose to take. Please ask your doctor, pharmacist, or care team before changing anything.'
    },
    {
      test: /(high.?risk|risk pregnancy|am i risk)/i,
      reply: 'Only a qualified clinician can decide whether a pregnancy is high-risk. DAI can show doctor-set flags and appointment information, but it does not infer clinical risk.'
    },
    {
      test: /(diagnose|treatment|recommend treatment|clinical advice)/i,
      reply: 'DAI does not diagnose or recommend treatment. It supports follow-up, appointments, documents, and reviewed communication.'
    }
  ];
  var helpfulReplies = [
    {
      test: /(what.*dai|help|platform|what can)/i,
      reply: 'DAI helps hospitals, doctors, and mothers stay aligned on appointments, care timelines, documents, follow-up gaps, and reviewed communication.'
    },
    {
      test: /(portal|mother|doctor|hospital|three)/i,
      reply: 'The mother portal focuses on personal care timelines and appointments. The doctor portal focuses on today’s patients and consult context. The hospital portal focuses on registry, queue, audits, and operations.'
    },
    {
      test: /(appointment|reschedule|schedule|booking)/i,
      reply: 'You can use the portal to view appointment information and request changes. Final scheduling is handled by the care team.'
    },
    {
      test: /(test|scan|vaccination|documents|bring)/i,
      reply: 'For tests, scans, vaccinations, or documents, DAI can show timeline items and reminders that were configured by the care team. Please confirm medical details with your hospital.'
    },
    {
      test: /(audit|override|review|approved|approval)/i,
      reply: 'Every important action is designed to stay reviewable. Drafts and AI-assisted content need human review before they are used.'
    }
  ];

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (text) node.textContent = text;
    return node;
  }

  function ensureStyles() {
    if (document.getElementById('daiCareChatbotStyles')) return;
    var style = el('style', { id: 'daiCareChatbotStyles' });
    style.textContent = [
      '.care-chatbot{position:fixed;right:1.25rem;bottom:1.25rem;z-index:2147483000;font-family:inherit}',
      '.care-chatbot__launcher{border:1px solid rgba(132,63,117,.18);border-radius:999px;background:#fff;color:#6f2b63;box-shadow:0 18px 45px rgba(70,29,63,.16);cursor:pointer;font-weight:800;padding:.9rem 1.2rem}',
      '.care-chatbot__panel{width:min(380px,calc(100vw - 2rem));max-height:min(620px,calc(100vh - 2rem));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(132,63,117,.16);border-radius:24px;background:#fff;box-shadow:0 22px 60px rgba(70,29,63,.18)}',
      '.care-chatbot__panel[hidden]{display:none}',
      '.care-chatbot__header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1rem .85rem;border-bottom:1px solid #f0dce9}',
      '.care-chatbot__header strong{display:block;color:#371331;font-size:1.05rem}.care-chatbot__header span{display:block;color:#8a7484;font-size:.86rem;margin-top:.15rem}',
      '.care-chatbot__close{width:2rem;height:2rem;border:0;border-radius:50%;background:#f8edf4;color:#6f2b63;cursor:pointer;font-size:1rem}',
      '.care-chatbot__notice{margin:.9rem 1rem 0;border-left:3px solid #c63f83;border-radius:12px;background:#fbf2f7;color:#6f2b63;font-size:.84rem;line-height:1.45;padding:.75rem .85rem}',
      '.care-chatbot__feed{display:flex;flex:1;flex-direction:column;gap:.7rem;min-height:220px;overflow:auto;padding:1rem}',
      '.care-chatbot__message{max-width:88%;border-radius:18px;font-size:.94rem;line-height:1.45;padding:.75rem .9rem}.care-chatbot__message--bot{align-self:flex-start;background:#f8edf4;color:#422039}.care-chatbot__message--user{align-self:flex-end;background:#c63f83;color:#fff}',
      '.care-chatbot__chips{display:flex;gap:.5rem;overflow-x:auto;padding:0 1rem .85rem}.care-chatbot__chips button,.care-chatbot__voice{border:1px solid #ead4e3;border-radius:999px;background:#fff;color:#6f2b63;cursor:pointer;font-weight:700;white-space:nowrap;padding:.55rem .8rem}',
      '.care-chatbot__form{display:flex;gap:.55rem;border-top:1px solid #f0dce9;padding:.85rem 1rem}.care-chatbot__form input{flex:1;min-width:0;border:1px solid #ead4e3;border-radius:999px;color:#371331;font:inherit;padding:.75rem .9rem}.care-chatbot__form button{border:0;border-radius:999px;background:#c63f83;color:#fff;cursor:pointer;font-weight:800;padding:.75rem 1rem}.care-chatbot__voice{align-self:flex-start;margin:0 1rem 1rem}',
      '@media(max-width:520px){.care-chatbot{right:.75rem;bottom:.75rem}}'
    ].join('');
    document.head.appendChild(style);
  }

  function getApiBase() {
    if (window.DaiAPI && window.DaiAPI.API_BASE) return window.DaiAPI.API_BASE;
    var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    var isBackendOrigin = isLocal && location.port === '3001';
    var isRenderOrigin = /\.onrender\.com$/.test(location.hostname);
    if (isBackendOrigin || isRenderOrigin) return '/api';
    if (isLocal) return location.protocol + '//' + location.hostname + ':3001/api';
    return 'https://daihealth.onrender.com/api';
  }

  function stopSpeech() {
    if (currentAudio) {
      if (currentAudio.dataset && currentAudio.dataset.objectUrl) {
        URL.revokeObjectURL(currentAudio.dataset.objectUrl);
      }
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  async function speak(text) {
    if (!voiceOn) return;
    stopSpeech();
    try {
      var response = await fetch(getApiBase() + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      if (!response.ok) throw new Error('TTS unavailable');
      var blob = await response.blob();
      var audioUrl = URL.createObjectURL(blob);
      currentAudio = new Audio(audioUrl);
      currentAudio.dataset.objectUrl = audioUrl;
      currentAudio.onended = function () {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
      };
      await currentAudio.play();
    } catch (error) {
      console.error('Gemini Charon TTS failed:', error);
      var feed = document.querySelector('.care-chatbot__feed');
      if (feed) {
        renderMessage(feed, 'bot', 'Voice is unavailable right now. Please check GEMINI_API_KEY and redeploy.');
      }
    }
  }

  function getReply(text) {
    var match = safeReplies.concat(helpfulReplies).find(function (entry) {
      return entry.test.test(text);
    });
    if (match) return match.reply;
    return 'I can help with DAI workflows, appointments, timelines, portal navigation, documents, and safety boundaries. For medical decisions, please ask your care team.';
  }

  function renderMessage(feed, who, text) {
    var row = el('div', { class: 'care-chatbot__message care-chatbot__message--' + who });
    row.textContent = text;
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
  }

  function init() {
    ensureStyles();
    var root = el('div', { class: 'care-chatbot', id: 'daiCareChatbot' });
    var launcher = el('button', {
      class: 'care-chatbot__launcher',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'careChatbotPanel'
    }, 'Ask Dr. Daya');
    var panel = el('section', {
      class: 'care-chatbot__panel',
      id: 'careChatbotPanel',
      'aria-label': 'Dr. Daya care chatbot',
      hidden: ''
    });
    panel.innerHTML =
      '<header class="care-chatbot__header">' +
      '<div><strong>Dr. Daya</strong><span>English care chatbot</span></div>' +
      '<button type="button" class="care-chatbot__close" aria-label="Close chatbot">x</button>' +
      '</header>' +
      '<div class="care-chatbot__notice">Assistive only. No diagnosis, treatment advice, or clinical risk scoring.</div>' +
      '<div class="care-chatbot__feed" role="log" aria-live="polite"></div>' +
      '<div class="care-chatbot__chips">' +
      '<button type="button">What can DAI help with?</button>' +
      '<button type="button">Does DAI diagnose patients?</button>' +
      '<button type="button">How do the three portals work?</button>' +
      '</div>' +
      '<form class="care-chatbot__form">' +
      '<input type="text" aria-label="Ask Dr. Daya" placeholder="Ask about DAI..." autocomplete="off">' +
      '<button type="submit">Send</button>' +
      '</form>' +
      '<button type="button" class="care-chatbot__voice">Gemini voice off</button>';

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    var feed = panel.querySelector('.care-chatbot__feed');
    var form = panel.querySelector('form');
    var input = panel.querySelector('input');
    var voiceButton = panel.querySelector('.care-chatbot__voice');

    function openPanel() {
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      if (!messages.length) {
        messages.push('intro');
        renderMessage(feed, 'bot', 'Hi, I am Dr. Daya. Ask me about DAI, appointments, portals, documents, or safety boundaries.');
      }
      setTimeout(function () { input.focus(); }, 0);
    }

    function closePanel() {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      stopSpeech();
      launcher.focus();
    }

    function ask(text) {
      var clean = String(text || '').trim();
      if (!clean) return;
      renderMessage(feed, 'user', clean);
      input.value = '';
      var reply = getReply(clean);
      renderMessage(feed, 'bot', reply);
      speak(reply);
    }

    launcher.addEventListener('click', function () {
      if (panel.hidden) openPanel();
      else closePanel();
    });
    panel.querySelector('.care-chatbot__close').addEventListener('click', closePanel);
    panel.querySelectorAll('.care-chatbot__chips button').forEach(function (button) {
      button.addEventListener('click', function () { ask(button.textContent); });
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      ask(input.value);
    });
    voiceButton.addEventListener('click', function () {
      voiceOn = !voiceOn;
      voiceButton.textContent = voiceOn ? 'Gemini voice on' : 'Gemini voice off';
      if (!voiceOn) stopSpeech();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
