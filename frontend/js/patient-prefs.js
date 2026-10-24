/**
 * Notification preferences + privacy controls.
 * Dual-write: localStorage for instant UX; PATCH /api/me/preferences when logged in
 * so values survive refresh and re-login.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'dai_patient_prefs';
  var DEFAULTS = {
    lang: 'en', theme:'light', text_size:'standard', read_aloud:true, offline_enabled:false, quiet_hours_enabled:true, quiet_start:'21:00', quiet_end:'07:00', notif_whatsapp:false,
    notif_appt: true,
    notif_vax: true,
    notif_growth: true,
    notif_care: true,
    notif_sms: true,
    privacy_share_doctors: true,
    privacy_analytics: false
  };

  function readLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function writeLocal(prefs) {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  }

  async function loadFromServer() {
    if(!navigator.onLine || localStorage.getItem('dai_guest')==='1')return null;
    if (!window.DaiAPI || typeof window.DaiAPI.apiRequest !== 'function') return null;
    try {
      var res = await window.DaiAPI.apiRequest('/me/preferences');
      if (res && res.preferences) return Object.assign({}, DEFAULTS, res.preferences);
    } catch (e) {}
    return null;
  }

  async function saveToServer(prefs) {
    if(!navigator.onLine || localStorage.getItem('dai_guest')==='1')return false;
    if (!window.DaiAPI || typeof window.DaiAPI.apiRequest !== 'function') return false;
    try {
      var res = await window.DaiAPI.apiRequest('/me/preferences', {
        method: 'PATCH',
        body: { preferences: prefs }
      });
      return !!(res && res.preferences);
    } catch (e) {
      return false;
    }
  }

  function applyAppearance(prefs) {
    var body = document.body;
    if (!body) return;
    body.dataset.homeTheme = prefs.theme === 'dark' ? 'dark' : 'light';
    body.style.colorScheme = body.dataset.homeTheme;
    body.style.setProperty('--patient-scale', ({standard:1,large:1.15,'extra-large':1.3})[prefs.text_size] || 1);
  }

  async function getPrefs() {
    var server = await loadFromServer();
    if (server) {
      writeLocal(server);
      applyAppearance(server);
      return server;
    }
    var local = readLocal();
    applyAppearance(local);
    return local;
  }

  async function setPrefs(partial) {
    var next = Object.assign({}, readLocal(), partial);
    writeLocal(next);
    if (next.lang && window.DaiI18n) window.DaiI18n.setLang(next.lang);
    applyAppearance(next);
    try {
      window.dispatchEvent(new CustomEvent('dai:prefs', { detail: next }));
    } catch (e) {}
    await saveToServer(next);
    return next;
  }

  function bindSettingsForm(form) {
    if (!form) return;
    getPrefs().then(function (prefs) {
      var langEl = form.querySelector('#setLang') || form.querySelector('[name="lang"]');
      if (langEl) langEl.value = prefs.lang;
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k === 'lang') return;
        var el = form.querySelector('[name="' + k + '"]') || form.querySelector('#' + k);
        if (el) { if(el.type === 'checkbox') el.checked = !!prefs[k]; else el.value = prefs[k]; }
      });
      if (window.DaiI18n) window.DaiI18n.setLang(prefs.lang);
    });

    form.addEventListener('change', function (ev) {
      var name = ev.target.name;
      if (name !== 'theme' && name !== 'text_size') return;
      var partial = {}; partial[name] = ev.target.value;
      setPrefs(partial);
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var partial = {};
      var langEl = form.querySelector('#setLang') || form.querySelector('[name="lang"]');
      if (langEl) partial.lang = langEl.value;
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k === 'lang') return;
        var el = form.querySelector('[name="' + k + '"]') || form.querySelector('#' + k);
        if (el) partial[k] = el.type === 'checkbox' ? el.checked : el.value;
      });
      await setPrefs(partial);
      var status = form.querySelector('[data-prefs-status]');
      if (status) {
        status.textContent = (window.DaiI18n && window.DaiI18n.t('settings.saved')) || 'Settings saved';
        status.hidden = false;
      }
      if (window.DaiAPI && window.DaiAPI.toast) {
        window.DaiAPI.toast((window.DaiI18n && window.DaiI18n.t('settings.saved')) || 'Settings saved');
      }
    });
  }

  global.DaiPrefs = {
    applyAppearance: applyAppearance,
    getPrefs: getPrefs,
    setPrefs: setPrefs,
    bindSettingsForm: bindSettingsForm,
    DEFAULTS: DEFAULTS,
    readLocal: readLocal
  };
})(typeof window !== 'undefined' ? window : this);
