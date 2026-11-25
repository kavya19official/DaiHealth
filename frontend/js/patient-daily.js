/* Daily self-reports use the existing, authenticated mother-only APIs. */
(function () {
  'use strict';
  const panel = document.getElementById('panel-daily');
  if (!panel) return;
  const home = document.getElementById('homeKickCounter');
  const api = window.DaiAPI;
  const homeField = id => home?.querySelector('[data-daily="' + id + '"]');
  const get = id => panel.querySelector('[data-daily="' + id + '"]');
  const language = () => window.DaiI18n?.getLang() === 'hi';
  const text = (en, hi) => language() ? hi : en;
  let day = '', owner = null, loading = 0, kick = null, contraction = null;
  let lastContraction = null, wellness = null, loaded = false, loadedDay = '', busy = false, startingFromHome = false;

  function notice(message, showOnHome = startingFromHome || !!kick) {
    get('status').textContent = message;
    if (showOnHome && homeField('status')) homeField('status').textContent = message;
  }

  function seconds(start) {
    return Math.max(1, Math.floor((Date.now() - start) / 1000));
  }

  function clock(value) {
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  }

  function localDay(date) {
    return api.localDateStr(new Date(date));
  }

  function row(list, title, detail) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = title;
    small.textContent = detail;
    li.append(strong, small);
    list.append(li);
  }

  function listEmpty(list) {
    if (!list.children.length) {row(list, text('No entries yet', 'अभी कोई रिकॉर्ड नहीं'), text('Your saved entries appear here.', 'आपके सहेजे रिकॉर्ड यहाँ दिखेंगे।'));list.lastElementChild.dataset.dailyEmpty='1';}
  }

  function updateTimers() {
    get('kick-time').textContent = clock(kick ? seconds(kick.start) : 0);
    get('kick-count').textContent = kick ? kick.count : 0;
    get('kick-start').disabled = !!kick || busy || !loaded || day !== api.localDateStr();
    get('kick-tap').disabled = !kick || kick.count >= 200 || busy;
    get('kick-save').disabled = !kick || busy;
    get('kick-discard').disabled = !kick || busy;
    if (home) {
      for (const key of ['kick-time', 'kick-count']) {
        const value = get(key).textContent;
        if (homeField(key).textContent !== value) homeField(key).textContent = value;
      }
      for (const action of ['start', 'tap', 'save', 'discard']) {
        const control = homeField('kick-' + action);
        control.hidden = action === 'start' ? !!kick : !kick;
        control.disabled = action === 'start' ? busy || startingFromHome || !!contraction : get('kick-' + action).disabled;
      }
    }
    get('contraction-time').textContent = clock(contraction ? seconds(contraction.start) : 0);
    get('contraction-start').disabled = !!contraction || busy || !loaded || day !== api.localDateStr();
    get('contraction-save').disabled = !contraction || busy;
    get('contraction-discard').disabled = !contraction || busy;
    get('day').disabled = !!kick || !!contraction || busy;
    get('water-add').disabled = busy || !loaded || (wellness && wellness.water_glasses >= 8);
  }

  async function load() {
    const version = ++loading;
    loaded = false;
    updateTimers();
    get('water-count').textContent = '—';
    ['meals', 'kicks', 'contractions', 'symptoms'].forEach(key => get(key).replaceChildren());
    get('iron').checked = false;
    get('calcium').checked = false;
    get('pregnancy').hidden = true;
    panel.querySelectorAll('form button, input[type="checkbox"], [data-action="water"]').forEach(el => { el.disabled = true; });
    notice(text('Loading your entries…', 'आपके रिकॉर्ड लोड हो रहे हैं…'));
    const requestedDay = day;
    const cached = !navigator.onLine ? await window.DaiDaily?.cached(day) : null;
    const user = cached?.base.user || await api.fetchCurrentUser();
    if (version !== loading) return;
    if (!user || user.role !== 'mother') {
      notice(text('Sign in as a patient to save daily tracking.', 'दैनिक रिकॉर्ड सहेजने के लिए मरीज़ के रूप में साइन इन करें।'));
      return;
    }
    if (owner !== user.id) {
      owner = user.id;
      kick = null;
      contraction = null;
    }
    const start = new Date(requestedDay + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const results = cached?.base.results || await Promise.all([
      api.apiRequest('/wellness?date=' + encodeURIComponent(day)),
      api.apiRequest('/health-logs?types=kick_session&from=' + encodeURIComponent(start.toISOString()) + '&to=' + encodeURIComponent(end.toISOString()) + '&limit=1000'),
      api.apiRequest('/patient/home')
    ]);
    if (version !== loading || day !== requestedDay) return;
    if (results.some(result => !result)) {
      notice(text('Could not load entries. Connect and select Retry.', 'रिकॉर्ड लोड नहीं हुए। इंटरनेट जोड़ें और फिर कोशिश करें।'));
      return;
    }
    wellness = results[0];
    loaded = true;
    loadedDay = requestedDay;
    panel.querySelectorAll('form button, input[type="checkbox"], [data-action="water"]').forEach(el => { el.disabled = false; });
    get('water-count').textContent = wellness.water_glasses;
    get('iron').checked = wellness.supplements.iron === true;
    get('calcium').checked = wellness.supplements.calcium === true;
    get('meals').replaceChildren();
    wellness.nutrition.forEach(meal => row(get('meals'), meal.text, new Date(meal.logged_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})));
    listEmpty(get('meals'));
    get('kicks').replaceChildren();
    results[1].logs.forEach(log => row(get('kicks'), log.data.kicks + text(' movements recorded', ' हलचल दर्ज'), clock(log.data.duration_sec) + ' · ' + new Date(log.logged_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})));
    listEmpty(get('kicks'));
    get('contractions').replaceChildren();
    wellness.contractions.forEach(log => row(get('contractions'), clock(Math.round(log.duration_ms / 1000)), new Date(log.started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + (log.gap_ms != null ? ' · ' + text('Start-to-start ', 'शुरुआत से शुरुआत ') + clock(Math.round(log.gap_ms / 1000)) : '')));
    listEmpty(get('contractions'));
    // The server returns ordered entries for this day. A new day starts a new timing series.
    lastContraction = wellness.contractions.length ? Date.parse(wellness.contractions.at(-1).started_at) : null;
    get('symptoms').replaceChildren();
    results[2].journal.filter(entry => String(entry.entry_date).slice(0,10) === day && entry.note.startsWith('[Symptoms] ')).forEach(entry => row(get('symptoms'), entry.note.slice(11), text('Personal symptom note', 'निजी लक्षण नोट')));
    listEmpty(get('symptoms'));
    get('pregnancy').hidden = user.pregnancy_status !== 'pregnant';
    await window.DaiDaily?.render({user,day,results});
    notice(cached?text('Offline copy · queued entries are waiting to sync.','ऑफलाइन कॉपी · लंबित रिकॉर्ड सिंक होने बाकी हैं।'):text('Entries saved to your account. Self-reported.', 'रिकॉर्ड आपके खाते में सहेजे गए। आपके द्वारा दर्ज।'));
    updateTimers();
  }

  async function write(path, body, method = 'POST') {
    if (busy || !loaded) {
      notice(text('Connect to the internet to save. Your current input stays here.', 'सहेजने के लिए इंटरनेट जोड़ें। आपका लिखा यहाँ रहेगा।'));
      return false;
    }
    busy = true;
    panel.querySelectorAll('form button, input[type="checkbox"], [data-action="water"]').forEach(el => { el.disabled = true; });
    updateTimers();
    let result;
    try {
      let kind, data, at;
      if(path==='/wellness/water'){kind='water';data={};}
      if(path==='/wellness/supplements'){kind='supplement';data={supplement:body.supplement,taken:body.taken};}
      if(path==='/wellness/nutrition'){kind='meal';data={text:body.text};}
      if(path==='/patient/home/journal'){kind='symptom';const form=panel.querySelector('[data-form=symptom]');data={codes:[...form.querySelectorAll('[name=symptom]:checked')].map(i=>i.value),severity:form.elements.severity.value,note:body.note.replace(/^\[Symptoms\] /,'')};at=new Date(day+'T'+form.elements.time.value+':00+05:30').toISOString();}
      if(path==='/health-logs'){kind=body.log_type;data=body.data;at=body.logged_at;}
      result=kind?await window.DaiDaily.save(kind,data,body.date||day,at):await api.apiRequest(path,{method,body});
      if(result?.queued){notice(text('Encrypted on this device · waiting to sync. Your input stays here.','डिवाइस पर एन्क्रिप्ट किया · सिंक बाकी है। आपका लिखा यहाँ रहेगा।'));return body.log_type === 'kick_session' ? result : false;}

      notice(result ? text('Saved', 'सहेजा गया') : text('Not saved. Your entry is still here. Try again.', 'सहेजा नहीं गया। आपका रिकॉर्ड यहाँ है। फिर कोशिश करें।'));
      return !!result;
    } catch(error) {notice(error.message||text('Not saved. Your input is still here.','सहेजा नहीं गया। आपका लिखा यहाँ है।'));return false;} finally {
      busy = false;
      panel.querySelectorAll('form button, input[type="checkbox"], [data-action="water"]').forEach(el => { el.disabled = false; });
      updateTimers();
    }
  }

  async function handleAction(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || busy || startingFromHome || (event.currentTarget === home && home.hidden)) return;
    if (event.currentTarget === home && action === 'kick-start' && !kick) {
      startingFromHome = true;
      const startButton = homeField('kick-start');
      startButton.disabled = true;
      try {
        day = api.localDateStr();
        get('day').value = day;
        get('day').max = day;
        if (!loaded || get('pregnancy').hidden || loadedDay !== day) await load();
        if (home.hidden || get('pregnancy').hidden) return;
      } finally {
        startingFromHome = false;
        updateTimers();
      }
    }
    if (action === 'retry') return load();
    if (action === 'listen') {
      if (!window.speechSynthesis) return notice(text('Read-aloud is unavailable in this browser.', 'इस ब्राउज़र में पढ़कर सुनाना उपलब्ध नहीं है।'));
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(get('intro').textContent);
      utterance.lang = language() ? 'hi-IN' : 'en-IN';
      speechSynthesis.speak(utterance);
    }
    if (!loaded) return;
    if (action === 'water' && await write('/wellness/water', {date: day})) await load();
    if (action === 'kick-start' && !get('pregnancy').hidden && !kick && day === api.localDateStr()) {
      kick = {start: Date.now(), count: 0};
      notice('', true);
    }
    if (action === 'kick-tap' && kick && kick.count < 200) kick.count++;
    if (action === 'kick-discard') {
      kick = null;
      notice('', true);
    }
    if (action === 'kick-save' && kick) {
      if (seconds(kick.start) > 21600) return notice(text('This session exceeds six hours. Discard it and start a new one.', 'यह सत्र छह घंटे से लंबा है। हटाकर नया शुरू करें।'));
      const saved = await write('/health-logs', {log_type:'kick_session', data:{kicks:kick.count,duration_sec:seconds(kick.start)},logged_at:new Date(kick.start).toISOString()});
      if (saved) {
        kick = null;
        if (!saved.queued) {
          await load();
          notice(text('Movement session saved.', 'हलचल का सत्र सहेजा गया।'), true);
        }
      }
    }
    if (action === 'contraction-start') contraction = {start:Date.now(), gap:lastContraction == null ? null : Date.now() - lastContraction};
    if (action === 'contraction-discard') contraction = null;
    if (action === 'contraction-save' && contraction) {
      if (await write('/wellness/contractions', {date:localDay(contraction.start),started_at:new Date(contraction.start).toISOString(),duration_ms:Date.now()-contraction.start,gap_ms:contraction.gap})) {
        contraction = null;
        await load();
      }
    }
    updateTimers();
  }
  panel.addEventListener('click', handleAction);
  home?.addEventListener('click', handleAction);

  panel.addEventListener('change', async event => {
    if (event.target === get('day')) {
      day = event.target.value || api.localDateStr();
      if (day > api.localDateStr()) day = api.localDateStr();
      get('day').value = day;
      await load();
    }
    if (event.target.matches('[data-supplement]')) {
      const input = event.target;
      if (!loaded || busy) { input.checked = !input.checked; return; }
      const saved = await write('/wellness/supplements', {date:day,supplement:input.dataset.supplement,taken:input.checked}, 'PUT');
      if (!saved) input.checked = !input.checked;
    }
  });

  panel.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !loaded) return;
    const form = event.target;
    const field = form.querySelector('textarea');
    const value = field.value.trim();
    const symptoms = form.dataset.form === 'symptom';
    if (!value && !(symptoms && form.querySelector('[name=symptom]:checked'))) return field.focus();
    const saved = await write(symptoms ? '/patient/home/journal' : '/wellness/nutrition', symptoms ? {date:day,note:'[Symptoms] '+value} : {date:day,text:value});
    if (saved) {
      field.value = '';
      if(symptoms)form.querySelectorAll('[name=symptom]').forEach(i=>i.checked=false);
      await load();
    }
  });

  function translate() {
    document.querySelectorAll('#panel-daily [data-hi], #homeKickCounter [data-hi]').forEach(el => { el.textContent = language() ? el.dataset.hi : el.dataset.en; });
    const nav = document.querySelector('[data-panel="daily"] span');
    if (nav) nav.textContent = text('Daily tracking', 'दैनिक रिकॉर्ड');
    if (location.hash === '#daily') {
      const title = document.getElementById('pageTitle');
      if (title) title.textContent = text('Daily tracking', 'दैनिक रिकॉर्ड');
    }
  }
  function open() {
    if (location.hash !== '#daily') return;
    day = day || api.localDateStr();
    get('day').value = day;
    get('day').max = api.localDateStr();
    if (kick || contraction) { translate(); return; }
    translate();
    load();
  }
  window.addEventListener('dai:patient-panel', event => { if (event.detail.panel === 'daily') open(); });
  window.addEventListener('dai:lang', translate);
  window.addEventListener('dai:daily-refresh',()=>{if(location.hash==='#daily'&&!busy)load();});
  window.addEventListener('hashchange', open);
  window.addEventListener('beforeunload', event => {
    if (kick || contraction || busy) { event.preventDefault(); event.returnValue = ''; }
  });
  setInterval(() => { if (!document.hidden && (kick || contraction)) updateTimers(); }, 1000);
  translate();
  updateTimers();
  open();
})();
