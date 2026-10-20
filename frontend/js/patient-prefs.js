/**
 * Notification preferences + privacy controls.
 * Dual-write: localStorage for instant UX; PATCH /api/me/preferences when logged in
 * so values survive refresh and re-login.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'dai_patient_prefs';
  var DEFAULTS = {
    lang: 'en',
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
    if (!window.DaiAPI || typeof window.DaiAPI.apiRequest !== 'function') return null;
    try {
      var res = await window.DaiAPI.apiRequest('/me/preferences');
      if (res && res.preferences) return Object.assign({}, DEFAULTS, res.preferences);
    } catch (e) {}
    return null;
  }

  async function saveToServer(prefs) {
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

  async function getPrefs() {
    var server = await loadFromServer();
    if (server) {
      writeLocal(server);
      return server;
    }
    return readLocal();
  }

  async function setPrefs(partial) {
    var next = Object.assign({}, readLocal(), partial);
    writeLocal(next);
    if (next.lang && window.DaiI18n) window.DaiI18n.setLang(next.lang === 'hi' ? 'hi' : 'en');
    await saveToServer(next);
    try {
      window.dispatchEvent(new CustomEvent('dai:prefs', { detail: next }));
    } catch (e) {}
    return next;
  }

  function bindSettingsForm(form) {
    if (!form) return;
    getPrefs().then(function (prefs) {
      var langEl = form.querySelector('#setLang') || form.querySelector('[name="lang"]');
      if (langEl) langEl.value = prefs.lang === 'hi' ? 'hi' : 'en';
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k === 'lang') return;
        var el = form.querySelector('[name="' + k + '"]') || form.querySelector('#' + k);
        if (el && el.type === 'checkbox') el.checked = !!prefs[k];
      });
      if (window.DaiI18n) window.DaiI18n.setLang(prefs.lang === 'hi' ? 'hi' : 'en');
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var partial = {};
      var langEl = form.querySelector('#setLang') || form.querySelector('[name="lang"]');
      if (langEl) partial.lang = langEl.value === 'hi' ? 'hi' : 'en';
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k === 'lang') return;
        var el = form.querySelector('[name="' + k + '"]') || form.querySelector('#' + k);
        if (el && el.type === 'checkbox') partial[k] = el.checked;
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
    getPrefs: getPrefs,
    setPrefs: setPrefs,
    bindSettingsForm: bindSettingsForm,
    DEFAULTS: DEFAULTS,
    readLocal: readLocal
  };
})(typeof window !== 'undefined' ? window : this);
