/**
 * DaiHealth shared API client
 * - Uses existing JWT cookie auth (credentials: 'include')
 * - Same origin /api when served by backend; falls back to production host
 */
(function (global) {
  'use strict';

  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var isBackendOrigin = isLocal && location.port === '3001';
  var isRenderOrigin = /\.onrender\.com$/.test(location.hostname);
  var API_BASE = global.DAI_API_BASE || (
    isBackendOrigin || isRenderOrigin
      ? '/api'
      : isLocal
        ? location.protocol + '//' + location.hostname + ':3001/api'
        : 'https://daihealth.onrender.com/api'
  );

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.style.cssText =
        'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(120%);' +
        'background:#1e1b4b;color:#fff;padding:.7rem 1.2rem;border-radius:999px;font-size:.88rem;' +
        'z-index:200;transition:transform .25s;font-family:Inter,system-ui,sans-serif';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.transform = 'translateX(-50%) translateY(120%)';
    }, 2600);
  }

  async function apiRequest(path, options) {
    options = options || {};
    var opts = Object.assign({ credentials: 'include' }, options);
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    var response;
    try {
      response = await fetch(API_BASE + path, opts);
    } catch (err) {
      console.error('Network error', err);
      toast('Network error — please try again');
      return null;
    }
    if (response.status === 401) {
      if (!localStorage.getItem('dai_guest')) {
        window.location.href = 'auth.html';
      }
      return null;
    }
    var data = null;
    try {
      data = await response.json();
    } catch (e) {
      data = {};
    }
    if (!response.ok) {
      toast((data && data.error) || 'Something went wrong');
      return null;
    }
    return data;
  }

  async function fetchCurrentUser() {
    var data = await apiRequest('/auth/me');
    return data ? data.user : null;
  }

  function localDateStr(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function initials(name) {
    return (name || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(function (n) {
        return n[0];
      })
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function gestationalWeeks(careStartDate) {
    if (!careStartDate) return null;
    var start = new Date(careStartDate);
    if (isNaN(start.getTime())) return null;
    var days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
    return Math.min(42, Math.floor(days / 7));
  }

  function trimesterLabel(weeks) {
    if (weeks == null) return 'Pregnancy';
    if (weeks < 13) return 'First trimester';
    if (weeks < 27) return 'Second trimester';
    if (weeks <= 40) return 'Third trimester';
    return 'Postpartum';
  }

  function eddFromCareStart(careStartDate) {
    if (!careStartDate) return null;
    var start = new Date(careStartDate);
    if (isNaN(start.getTime())) return null;
    return new Date(start.getTime() + 280 * 86400000);
  }

  global.DaiAPI = {
    API_BASE: API_BASE,
    apiRequest: apiRequest,
    fetchCurrentUser: fetchCurrentUser,
    toast: toast,
    localDateStr: localDateStr,
    fmtDate: fmtDate,
    initials: initials,
    gestationalWeeks: gestationalWeeks,
    trimesterLabel: trimesterLabel,
    eddFromCareStart: eddFromCareStart
  };
})(typeof window !== 'undefined' ? window : this);
