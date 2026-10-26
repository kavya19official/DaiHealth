/**
 * Anvaya care extensions (mother dashboard)
 *   1. Predictive risk monitoring — trend charts, signals, "Why this level?"
 *   2. Postpartum pathway         — daily check-in, red flags, postnatal schedule
 *   3. Smart emergency response   — situation → actions → summary → coordination
 *   4. Emergency plan editor      — her own facility / transport / donor details
 *
 * Needs: window.DaiAPI, window.AnvayaEmergency (/shared/emergency-triage.js),
 *        window.AnvayaPostpartum (/shared/postpartum-rules.js).
 * dashboard.html calls CareExt.init({guest, user}) once it knows who is signed in.
 *
 * The SOS flow computes guidance locally with the same shared code the server
 * runs, so it still works if the network is slow or the save fails. Nothing
 * here claims a hospital was notified, accepted her, or has a bed.
 */
(function () {
  'use strict';

  var api = window.DaiAPI;
  var EM = window.AnvayaEmergency;
  var PP = window.AnvayaPostpartum;
  var state = { guest: false, user: null, trendDays: 90, trend: null, pp: null, emCtx: null, plan: null };

  /* ---------- helpers ---------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function telHref(n) { return 'tel:' + String(n).replace(/[^\d+]/g, ''); }
  function fmtShort(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  var LEVEL_STYLE = {
    emergency: { bg: '#fff1f2', bd: '#fda4af', fg: '#be123c', label: 'Emergency' },
    urgent: { bg: '#fffbeb', bd: '#fcd34d', fg: '#b45309', label: 'Urgent' },
    watch: { bg: '#eff6ff', bd: '#bfdbfe', fg: '#1d4ed8', label: 'Keep an eye on' },
    info: { bg: '#f5f3ff', bd: '#ddd6fe', fg: '#5b21b6', label: 'Note' },
    ok: { bg: '#ecfdf5', bd: '#a7f3d0', fg: '#047857', label: 'OK' },
    unsure: { bg: '#f5f3ff', bd: '#ddd6fe', fg: '#5b21b6', label: 'Not sure' }
  };
  function chip(level, text) {
    var s = LEVEL_STYLE[level] || LEVEL_STYLE.info;
    return '<span style="display:inline-block;padding:.12rem .55rem;border-radius:999px;font-size:.72rem;font-weight:700;background:' + s.bg + ';border:1px solid ' + s.bd + ';color:' + s.fg + '">' + esc(text || s.label) + '</span>';
  }
  function callBtn(num, label, strong) {
    return '<a class="cx-call' + (strong ? ' cx-call--strong' : '') + '" href="' + telHref(num) + '"><svg width="16" height="16" aria-hidden="true"><use href="#i-phone"/></svg> ' + esc(label || num) + '</a>';
  }

  /* ---------- styles ----------------------------------------------------- */
  function injectStyles() {
    if ($('cx-styles')) return;
    var css = [
      '.cx-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);padding:1.1rem 1.25rem;margin-bottom:1rem}',
      '.cx-h{font-family:var(--display);font-weight:700;font-size:1.02rem;margin:0 0 .35rem}',
      '.cx-sub{font-size:.82rem;color:var(--ink-muted);margin:0 0 .6rem}',
      '.cx-sig{border-radius:12px;padding:.6rem .8rem;margin:.4rem 0;border:1px solid;font-size:.86rem}',
      '.cx-sig strong{display:block;margin-bottom:.1rem}',
      '.cx-chart{width:100%;height:auto;display:block}',
      '.cx-legend{display:flex;gap:1rem;flex-wrap:wrap;font-size:.75rem;color:var(--ink-muted);margin:.25rem 0 .5rem}',
      '.cx-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:.3rem;vertical-align:-1px}',
      '.cx-seg button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:.2rem .7rem;font-size:.75rem;font-weight:600;color:var(--ink-2)}',
      '.cx-seg button.is-on{background:var(--brand);color:#fff;border-color:var(--brand)}',
      '.cx-bar{height:8px;border-radius:99px;background:var(--brand-soft);overflow:hidden}.cx-bar>i{display:block;height:100%;background:var(--brand)}',
      '.cx-details summary{cursor:pointer;font-weight:600;font-size:.88rem;color:var(--brand-strong);padding:.3rem 0}',
      '.cx-details ul{margin:.3rem 0 .3rem 1.1rem;padding:0;font-size:.85rem;color:var(--ink-2)}',
      '.cx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem}',
      '.cx-grid label,.cx-field label{display:block;font-size:.78rem;font-weight:600;color:var(--ink-2);margin-bottom:.2rem}',
      '.cx-grid input,.cx-grid select,.cx-field input,.cx-field select,.cx-field textarea{width:100%;padding:.5rem .6rem;border:1px solid var(--line);border-radius:10px;background:#fff}',
      '.cx-check{display:flex;gap:.55rem;align-items:flex-start;padding:.5rem .6rem;border:1px solid var(--line);border-radius:12px;margin:.3rem 0;font-size:.86rem;background:#fff;cursor:pointer}',
      '.cx-check input{margin-top:.2rem;width:18px;height:18px;flex-shrink:0}',
      '.cx-check.is-em{border-color:#fecdd3;background:#fff7f8}',
      '.cx-row{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.55rem 0;border-top:1px solid var(--line-soft)}',
      '.cx-row:first-child{border-top:0}',
      '.cx-call{display:inline-flex;align-items:center;gap:.4rem;min-height:44px;padding:.5rem 1rem;border-radius:999px;background:#fff;border:1.5px solid var(--rose);color:#be123c;font-weight:700;font-size:.9rem;text-decoration:none}',
      '.cx-call--strong{background:var(--rose);color:#fff}',
      '.cx-overlay{position:fixed;inset:0;background:rgba(30,27,75,.55);z-index:300;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:1rem}',
      '.cx-modal{background:#fff;border-radius:20px;max-width:640px;width:100%;margin:auto;box-shadow:0 30px 60px -20px rgba(0,0,0,.4);outline:0}',
      '.cx-modal__head{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.9rem 1.2rem;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff;border-radius:20px 20px 0 0;z-index:1}',
      '.cx-modal__body{padding:1rem 1.2rem 1.4rem}',
      '.cx-x{border:0;background:var(--brand-soft);width:40px;height:40px;border-radius:50%;font-size:1.2rem;color:var(--brand-strong)}',
      '.cx-steps{display:flex;gap:.35rem;margin:.1rem 0 .9rem}',
      '.cx-steps button{flex:1;border:0;border-bottom:3px solid var(--line);background:none;padding:.4rem .1rem;font-size:.74rem;font-weight:600;color:var(--ink-3)}',
      '.cx-steps button.is-on{border-color:var(--rose);color:#be123c}',
      '.cx-banner{border-radius:14px;padding:.8rem 1rem;margin:.5rem 0;border:1px solid}',
      '.cx-sum h4{margin:.8rem 0 .2rem;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-muted)}',
      '.cx-sum dl{margin:0;display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:.2rem .8rem;font-size:.85rem}',
      '.cx-sum dt{color:var(--ink-muted)}.cx-sum dd{margin:0;word-break:break-word}',
      '.cx-sum .nr{color:var(--ink-3);font-style:italic}',
      '.cx-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.7rem 0}',
      '.cx-fab{position:fixed;bottom:1.25rem;left:calc(var(--sidebar-w) + 1rem);z-index:250;min-height:48px;padding:.5rem 1.1rem;border:0;border-radius:999px;background:var(--rose);color:#fff;font-weight:800;font-size:.9rem;box-shadow:0 10px 24px -8px rgba(244,63,94,.65);display:inline-flex;align-items:center;gap:.4rem}',
      '@media(max-width:860px){.cx-fab{left:1rem}}',
      '@media(max-width:520px){.cx-sum dl{grid-template-columns:1fr}.cx-overlay{padding:0}.cx-modal{border-radius:0;min-height:100%}.cx-modal__head{border-radius:0}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'cx-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ======================================================================
     1. PREDICTIVE RISK MONITORING
     ====================================================================== */
  function lineChart(points, opts) {
    // points: [{t, y1, y2?}]; opts: {w,h,lines:[{key,color}],refs:[{y,label}],min,max}
    var W = opts.w || 560, H = opts.h || 170, P = { l: 34, r: 10, t: 10, b: 22 };
    if (!points.length) return '';
    var t0 = points[0].t, t1 = points[points.length - 1].t;
    if (t1 === t0) { t0 -= 86400000; t1 += 86400000; }
    var x = function (t) { return P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r); };
    var y = function (v) { return P.t + (1 - (v - opts.min) / (opts.max - opts.min)) * (H - P.t - P.b); };
    var out = ['<svg class="cx-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">'];
    (opts.refs || []).forEach(function (r) {
      out.push('<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(r.y) + '" y2="' + y(r.y) + '" stroke="#fda4af" stroke-dasharray="4 3"/>');
      out.push('<text x="' + (P.l - 4) + '" y="' + (y(r.y) + 3) + '" font-size="9" text-anchor="end" fill="#be123c">' + r.y + '</text>');
    });
    out.push('<text x="' + P.l + '" y="' + (H - 6) + '" font-size="9" fill="#6b7280">' + esc(fmtShort(t0)) + '</text>');
    out.push('<text x="' + (W - P.r) + '" y="' + (H - 6) + '" font-size="9" text-anchor="end" fill="#6b7280">' + esc(fmtShort(t1)) + '</text>');
    (opts.lines || []).forEach(function (ln) {
      var pts = points.filter(function (p) { return p[ln.key] != null; });
      if (pts.length > 1) out.push('<polyline fill="none" stroke="' + ln.color + '" stroke-width="2" points="' + pts.map(function (p) { return x(p.t) + ',' + y(p[ln.key]); }).join(' ') + '"/>');
      pts.forEach(function (p) {
        var bad = ln.bad && ln.bad(p);
        out.push('<circle cx="' + x(p.t) + '" cy="' + y(p[ln.key]) + '" r="' + (bad ? 4.5 : 3) + '" fill="' + (bad ? '#e11d48' : ln.color) + '"><title>' + esc(fmtShort(p.t) + ': ' + p[ln.key]) + '</title></circle>');
      });
    });
    out.push('</svg>');
    return out.join('');
  }

  function renderTrend() {
    var root = $('riskTrendRoot');
    if (!root) return;
    var d = state.trend;
    if (state.guest) { root.innerHTML = '<p class="cx-sub" style="margin-top:.8rem">Sign in to see your blood-pressure and sugar trends and why your risk level is what it is.</p>'; return; }
    if (!d) { root.innerHTML = '<p class="cx-sub" style="margin-top:.8rem">Loading trends…</p>'; return; }

    var html = ['<hr style="border:0;border-top:1px solid var(--line);margin:.9rem 0">'];

    html.push('<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem"><div class="cx-h" style="margin:0">Trends &amp; early warnings</div>' +
      '<div class="cx-seg" role="group" aria-label="Time window">' +
      [30, 90].map(function (n) { return '<button type="button" data-days="' + n + '" class="' + (state.trendDays === n ? 'is-on' : '') + '">' + n + ' days</button>'; }).join(' ') + '</div></div>');

    if(d.review_required)html.push('<p class="cx-sub">Risk escalation and clinical interpretation require human review. Open Care timeline → Clinician review requests. Recorded vital trends and safety notices remain available.</p>');
    // Signals
    if (d.signals.length) {
      d.signals.forEach(function (s) {
        var st = LEVEL_STYLE[s.level === 'urgent' ? 'urgent' : (s.level === 'watch' ? 'watch' : 'info')];
        html.push('<div class="cx-sig" style="background:' + st.bg + ';border-color:' + st.bd + ';color:' + st.fg + '" role="' + (s.level === 'urgent' ? 'alert' : 'note') + '"><strong>' + esc(s.title) + '</strong>' + esc(s.detail) + '</div>');
      });
      if (d.overall === 'urgent') html.push('<div class="cx-actions">' + callBtn('112', 'Call 112', true) + '<button type="button" class="btn btn--ghost btn--sm" id="cxOpenSosFromRisk">Open emergency help</button></div>');
    } else if (d.bp.count || d.glucose.count) {
      html.push('<div class="cx-sig" style="background:#ecfdf5;border-color:#a7f3d0;color:#047857">Nothing concerning in your recent readings. Keep logging so this stays accurate.</div>');
    }

    // BP chart
    if (d.bp.count) {
      var bpPts = d.bp.points.map(function (p) { return { t: Date.parse(p.at), sys: p.systolic, dia: p.diastolic }; });
      html.push('<div class="cx-h" style="margin-top:.8rem;font-size:.92rem">Blood pressure</div>');
      html.push('<div class="cx-sub">' + esc(d.bp.trend.note) + (d.bp.trend.direction !== 'insufficient' ? ' (' + (d.bp.trend.systolic_per_week > 0 ? '+' : '') + d.bp.trend.systolic_per_week + ' mmHg/week top number)' : '') + '</div>');
      html.push(lineChart(bpPts, {
        label: 'Blood pressure over time', min: 50, max: 180, refs: [{ y: 140 }, { y: 90 }],
        lines: [{ key: 'sys', color: '#7c3aed', bad: function (p) { return p.sys >= 140; } }, { key: 'dia', color: '#3b82f6', bad: function (p) { return p.dia >= 90; } }]
      }));
      html.push('<div class="cx-legend"><span><i style="background:#7c3aed"></i>Top number</span><span><i style="background:#3b82f6"></i>Bottom number</span><span><i style="background:#e11d48"></i>At or above 140/90</span></div>');
    } else {
      html.push('<p class="cx-sub" style="margin-top:.6rem">Log your blood pressure in Records to start seeing a trend.</p>');
    }

    // Glucose chart
    if (d.glucose.count) {
      var gPts = d.glucose.points.map(function (p) { return { t: Date.parse(p.at), g: p.mg_dl, bad: p.above_target }; });
      html.push('<div class="cx-h" style="margin-top:.8rem;font-size:.92rem">Blood sugar</div>');
      html.push(lineChart(gPts, { label: 'Blood sugar over time', min: 40, max: Math.max(200, Math.max.apply(null, gPts.map(function (p) { return p.g; })) + 10), refs: [{ y: 95 }], lines: [{ key: 'g', color: '#10b981', bad: function (p) { return p.bad; } }] }));
      html.push('<div class="cx-legend"><span><i style="background:#10b981"></i>Reading</span><span><i style="background:#e11d48"></i>At or above the usual target for when it was taken</span></div>');
    }

    // Risk level history
    if (d.assessments.count > 1) {
      var steps = d.assessments.points.slice(-8).map(function (p) {
        var col = p.risk_level === 'high risk' ? 'var(--rose)' : (p.risk_level === 'mid risk' ? 'var(--amber)' : 'var(--green)');
        return '<span title="' + esc(p.risk_level) + '" style="display:inline-flex;flex-direction:column;align-items:center;font-size:.68rem;color:var(--ink-muted)"><i style="width:14px;height:' + (10 + p.rank * 10) + 'px;background:' + col + ';border-radius:4px;display:block"></i>' + esc(fmtShort(p.at)) + '</span>';
      }).join('');
      html.push('<div class="cx-h" style="margin-top:.8rem;font-size:.92rem">Risk level over time</div><div style="display:flex;gap:.6rem;align-items:flex-end;margin:.3rem 0">' + steps + '</div>');
    }

    // Why this level?
    var la = d.latest_assessment, ex = la && la.explanation;
    if (ex) {
      html.push('<details class="cx-details" id="cxWhy"><summary>Why this level?</summary>');
      html.push('<ul>' + ex.summary.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>');
      if (ex.drivers && ex.drivers.length) {
        var maxSd = Math.max.apply(null, ex.drivers.map(function (x) { return Math.abs(x.diff_sd); })) || 1;
        html.push('<div style="margin:.4rem 0 .2rem;font-size:.78rem;color:var(--ink-muted)">What stands out most (gap from typical low-risk readings):</div>');
        ex.drivers.forEach(function (dr) {
          html.push('<div style="display:flex;align-items:center;gap:.6rem;font-size:.82rem;margin:.25rem 0"><span style="width:44%">' + esc(dr.label) + ' <b>' + esc(dr.value) + '</b> ' + esc(dr.unit) + '</span><span class="cx-bar" style="flex:1"><i style="width:' + Math.round(Math.abs(dr.diff_sd) / maxSd * 100) + '%"></i></span></div>');
        });
      }
      if (la.factors && la.factors.length) {
        html.push('<div style="margin-top:.5rem;font-size:.78rem;color:var(--ink-muted)">Clinical rules that applied:</div><ul>' + la.factors.map(function (f) { return '<li>' + esc(f.label || f.code) + '</li>'; }).join('') + '</ul>');
      }
      if (ex.data_gaps && ex.data_gaps.length) html.push('<div style="margin-top:.5rem;font-size:.78rem;color:var(--ink-muted)">To make this more accurate:</div><ul>' + ex.data_gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>');
      html.push('<p class="cx-sub" style="margin-top:.6rem">' + esc(ex.caveat) + '</p></details>');
    }

    root.innerHTML = html.join('');
    Array.prototype.forEach.call(root.querySelectorAll('.cx-seg button'), function (b) {
      b.addEventListener('click', function () { state.trendDays = Number(b.getAttribute('data-days')); loadTrend(); });
    });
    var sosLink = $('cxOpenSosFromRisk');
    if (sosLink) sosLink.addEventListener('click', openSOS);
  }

  async function loadTrend() {
    if(state.educationOnly)return;
    if (state.guest) { renderTrend(); return; }
    var d = await api.apiRequest('/risk/trend?days=' + state.trendDays);
    if (d) { state.trend = d; renderTrend(); }
  }

  /* ======================================================================
     2. POSTPARTUM PATHWAY
     ====================================================================== */
  var PP_SYMPTOMS = [
    ['headache_severe', 'Severe headache that will not go away'],
    ['vision_changes', 'Blurred vision or flashing lights'],
    ['chest_or_breath', 'Chest pain or trouble breathing'],
    ['fits_or_faint', 'A fit, fainting or collapse'],
    ['calf_pain', 'One leg painful, swollen, red or warm'],
    ['large_clots', 'Passing clots the size of an egg or bigger'],
    ['foul_discharge', 'Foul-smelling vaginal discharge'],
    ['wound_problem', 'Stitches / C-section wound opened, leaking or very red'],
    ['breast_problem', 'Painful, red or hard breast'],
    ['baby_concern', 'I am worried about my baby']
  ];
  var PHQ_OPTS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];

  function renderPostpartum() {
    var root = $('ppRoot');
    if (!root) return;
    var d = state.pp;
    if (state.guest) { root.innerHTML = '<div class="cx-card"><div class="cx-h">Postpartum pathway</div><p class="cx-sub">Sign in to add your delivery date and get a daily recovery check-in, warning signs and your postnatal visit schedule.</p></div>'; return; }
    if (!d) { root.innerHTML = '<div class="cx-card"><p class="cx-sub">Loading…</p></div>'; return; }

    if (!d.active) {
      root.innerHTML = '<div class="cx-card"><div class="cx-h">Postpartum pathway</div>' +
        '<p class="cx-sub">' + (d.reason === 'delivery_in_future' ? 'The delivery date on file is in the future. Please correct it.' : 'Recovery after birth is part of your care too. Add your delivery date to unlock a daily check-in, warning signs to watch for, and your postnatal visit schedule.') + '</p>' +
        deliveryFormHtml(null) + '</div>';
      wireDeliveryForm();
      return;
    }

    var ph = d.phase;
    var h = [];
    h.push('<div class="cx-card" style="border-left:4px solid var(--brand)"><div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap"><div>' +
      '<div class="cx-sub" style="margin:0">Day ' + d.days_postpartum + ' after delivery · week ' + d.week + '</div>' +
      '<div class="cx-h" style="font-size:1.15rem">' + esc(ph ? ph.title : 'Recovery') + '</div></div>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' + callBtn('112', 'Call 112', true) + '<button type="button" class="btn--sos" id="ppSos">Emergency help</button></div></div>' +
      (ph ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;margin-top:.4rem">' +
        '<div><div class="cx-sub" style="margin-bottom:.15rem"><b>What is common now</b></div><ul style="margin:0 0 0 1.1rem;padding:0;font-size:.85rem;color:var(--ink-2)">' + ph.expect.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' +
        '<div><div class="cx-sub" style="margin-bottom:.15rem"><b>Focus this stage</b></div><ul style="margin:0 0 0 1.1rem;padding:0;font-size:.85rem;color:var(--ink-2)">' + ph.focus.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>' : '') +
      '</div>');

    // Today's check-in
    h.push('<div class="cx-card" id="ppCheckinCard"><div class="cx-h">Today\'s check-in</div>');
    if (!d.checkins_open) {
      h.push('<p class="cx-sub">Daily check-ins cover the first 14 weeks after birth. If anything worries you, speak to your doctor.</p>');
    } else {
      if (d.today_checkin) {
        h.push(resultHtml({ level: d.today_checkin.level, headline: headlineFor(d.today_checkin.level), flags: d.today_checkin.flags || [] }, 'Saved today'));
        h.push('<button type="button" class="btn btn--ghost btn--sm" id="ppAgain">Add another check-in</button>');
      } else {
        h.push(checkinFormHtml());
      }
    }
    h.push('<div id="ppResult" aria-live="polite"></div></div>');

    // Schedule
    h.push('<div class="cx-card"><div class="cx-h">Your postnatal visits</div><p class="cx-sub">Recommended contacts after birth. Tick one off when it has happened — the app cannot know on its own.</p>');
    d.schedule.forEach(function (c) {
      var lvl = c.status === 'done' ? 'ok' : (c.status === 'overdue' ? 'urgent' : (c.status === 'open' ? 'watch' : 'info'));
      var txt = { done: 'Done', overdue: 'Not marked done', open: 'Due now', upcoming: 'Coming up' }[c.status];
      h.push('<div class="cx-row"><div><div style="font-weight:600;font-size:.9rem">' + esc(c.title) + '</div><div class="cx-sub" style="margin:0">' + esc(c.why) + '<br>' + esc(fmtShort(c.window_start)) + ' – ' + esc(fmtShort(c.window_end)) + (c.done_on ? ' · done ' + esc(fmtShort(c.done_on)) : '') + (window.DaiDelay && c.status !== 'done' && DaiDelay.note('postpartum_contact', c.code) ? '<br><em>' + esc(DaiDelay.note('postpartum_contact', c.code)) + '</em>' : '') + '</div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem">' + chip(lvl, txt) +
        (c.status === 'done' ? '<button type="button" class="link-btn" data-undo="' + esc(c.code) + '">Undo</button>' : (c.status !== 'upcoming' ? '<button type="button" class="btn btn--ghost btn--sm" data-done="' + esc(c.code) + '">Mark done</button>' + (window.DaiDelay && c.status === 'overdue' ? '<button type="button" class="link-btn" data-delay="' + esc(c.code) + '" data-delay-title="' + esc(c.title) + '">Why delayed?</button>' : '') : '')) +
        '</div></div>');
    });
    h.push('</div>');

    // Recent check-ins
    if (d.recent_checkins && d.recent_checkins.length) {
      h.push('<div class="cx-card"><div class="cx-h">Recent check-ins</div>' + d.recent_checkins.slice(0, 7).map(function (c) {
        var top = (c.flags && c.flags[0]) ? c.flags[0].label : 'Nothing worrying';
        return '<div class="cx-row"><div><b style="font-size:.88rem">' + esc(fmtShort(c.checkin_date)) + '</b> <span class="cx-sub" style="margin:0">' + esc(top) + '</span></div>' + chip(c.level) + '</div>';
      }).join('') + '</div>');
    }

    // Baby danger signs + delivery details
    h.push('<div class="cx-card"><details class="cx-details"><summary>Warning signs in your baby — get help the same day</summary><ul>' +
      d.baby_danger_signs.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul><p class="cx-sub">See the <a href="child-dashboard.html" style="color:var(--brand);font-weight:600">Child section</a> for vaccines, growth and milestones.</p></details>' +
      '<details class="cx-details"><summary>Delivery details</summary>' + deliveryFormHtml(d.delivery) + '</details></div>');

    root.innerHTML = h.join('');
    wireDeliveryForm();
    wireCheckinForm();
    var ppSos = $('ppSos');
    if (ppSos) ppSos.addEventListener('click', openSOS);
    Array.prototype.forEach.call(root.querySelectorAll('[data-done]'), function (b) { b.addEventListener('click', function () { markContact(b.getAttribute('data-done'), true); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-delay]'), function (b) { b.addEventListener('click', function () { DaiDelay.open({ kind: 'postpartum_contact', code: b.getAttribute('data-delay'), title: b.getAttribute('data-delay-title'), onSaved: loadPostpartum }); }); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-undo]'), function (b) { b.addEventListener('click', function () { markContact(b.getAttribute('data-undo'), false); }); });
    var again = $('ppAgain');
    if (again) again.addEventListener('click', function () {
      again.parentNode.insertAdjacentHTML('afterend', checkinFormHtml());
      again.remove();
      wireCheckinForm();
    });
  }

  function headlineFor(level) {
    return { emergency: 'Get emergency help now', urgent: 'Please speak to a doctor or visit a facility today', watch: 'Worth keeping an eye on and mentioning to your doctor', ok: 'Nothing worrying in today\'s answers' }[level];
  }

  function deliveryFormHtml(cur) {
    var today = api.localDateStr();
    return '<form id="ppDeliveryForm" class="cx-grid" style="margin-top:.5rem;align-items:end">' +
      '<div><label for="ppDelDate">Delivery date</label><input id="ppDelDate" type="date" required max="' + today + '" value="' + esc(cur ? cur.date : '') + '"></div>' +
      '<div><label for="ppDelType">Type of delivery</label><select id="ppDelType">' +
      [['unknown', 'Not sure'], ['vaginal', 'Vaginal'], ['caesarean', 'Caesarean (C-section)'], ['assisted', 'Assisted (forceps / vacuum)']].map(function (o) { return '<option value="' + o[0] + '"' + (cur && cur.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div><div><button type="submit" class="btn btn--primary">' + (cur ? 'Update' : 'Save delivery date') + '</button></div></form>';
  }
  function wireDeliveryForm() {
    var f = $('ppDeliveryForm');
    if (!f) return;
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var r = await api.apiRequest('/postpartum/delivery', { method: 'PUT', body: { delivery_date: $('ppDelDate').value, delivery_type: $('ppDelType').value } });
      if (r) { api.toast('Delivery details saved'); state.pp = r.postpartum; renderPostpartum(); loadEmergencyContext(); }
    });
  }

  function checkinFormHtml() {
    return '<form id="ppForm" novalidate>' +
      '<p class="cx-sub">Takes about a minute. Only fill in what you know — if you have no thermometer or BP machine, leave those blank.</p>' +
      '<div class="cx-grid">' +
      '<div><label for="ppBleed">Bleeding today</label><select id="ppBleed"><option value="none">None</option><option value="light" selected>Light (spotting)</option><option value="moderate">Moderate (a pad every few hours)</option><option value="heavy">Heavy (a pad soaked in an hour or less)</option></select></div>' +
      '<div><label for="ppPain">Pain (0 none – 10 worst)</label><input id="ppPain" type="number" min="0" max="10" step="1" value="0" inputmode="numeric"></div>' +
      '<div><label for="ppTemp">Temperature (°F, optional)</label><input id="ppTemp" type="number" min="90" max="110" step="0.1" inputmode="decimal" placeholder="e.g. 98.6"></div>' +
      '<div><label for="ppSys">BP top number (optional)</label><input id="ppSys" type="number" min="60" max="260" inputmode="numeric" placeholder="e.g. 118"></div>' +
      '<div><label for="ppDia">BP bottom number</label><input id="ppDia" type="number" min="30" max="160" inputmode="numeric" placeholder="e.g. 76"></div></div>' +
      '<div style="margin-top:.7rem;font-size:.82rem;font-weight:600;color:var(--ink-2)">Do you have any of these?</div>' +
      PP_SYMPTOMS.map(function (s) { return '<label class="cx-check"><input type="checkbox" data-k="' + s[0] + '"><span>' + esc(s[1]) + '</span></label>'; }).join('') +
      '<details class="cx-details" style="margin-top:.6rem"><summary>How have you been feeling? (optional)</summary>' +
      '<p class="cx-sub">Over the last 2 weeks, how often have you been bothered by:</p>' +
      '<div class="cx-field"><label for="ppQ1">Little interest or pleasure in doing things</label><select id="ppQ1"><option value="">Skip</option>' + PHQ_OPTS.map(function (o, i) { return '<option value="' + i + '">' + o + '</option>'; }).join('') + '</select></div>' +
      '<div class="cx-field" style="margin-top:.5rem"><label for="ppQ2">Feeling down, depressed or hopeless</label><select id="ppQ2"><option value="">Skip</option>' + PHQ_OPTS.map(function (o, i) { return '<option value="' + i + '">' + o + '</option>'; }).join('') + '</select></div>' +
      '<label class="cx-check is-em" style="margin-top:.6rem"><input type="checkbox" data-k="self_harm"><span>I have had thoughts of harming myself or my baby</span></label></details>' +
      '<div style="margin-top:.9rem"><button type="submit" class="btn btn--primary">Check my recovery</button></div></form>';
  }
  function wireCheckinForm() {
    var f = $('ppForm');
    if (!f) return;
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var body = { date: api.localDateStr(), bleeding: $('ppBleed').value, pain: $('ppPain').value, temp_f: $('ppTemp').value, bp_systolic: $('ppSys').value, bp_diastolic: $('ppDia').value, phq2_interest: $('ppQ1').value, phq2_mood: $('ppQ2').value };
      Array.prototype.forEach.call(f.querySelectorAll('input[data-k]'), function (c) { body[c.getAttribute('data-k')] = c.checked; });
      // Same rules the server runs — instant feedback, and tells her about a bad entry before sending.
      var local = PP.sanitizeCheckin(body);
      if (local.error) { api.toast(local.error); return; }
      var r = await api.apiRequest('/postpartum/checkins', { method: 'POST', body: body });
      var box = $('ppResult');
      if (!r) {
        // Save failed — still give her the guidance computed on this device.
        var ev = PP.evaluateCheckin(local.answers, { daysPP: state.pp && state.pp.days_postpartum });
        box.innerHTML = '<p class="cx-sub" style="color:#b45309">We could not save this check-in, but here is what your answers suggest:</p>' + resultHtml(ev) + emergencyNumbersIfNeeded(ev.level);
        return;
      }
      box.innerHTML = resultHtml(r.evaluation, 'Saved') + ((r.numbers && r.numbers.length) ? '<div class="cx-actions">' + r.numbers.map(function (n) { return callBtn(n.number, n.number + ' · ' + n.label, n.key === 'national'); }).join('') + '</div>' : '');
      f.style.display = 'none';
      var again = document.createElement('button');
      again.type = 'button'; again.className = 'btn btn--ghost btn--sm'; again.textContent = 'Add another check-in';
      again.addEventListener('click', function () { f.style.display = ''; again.remove(); box.innerHTML = ''; });
      box.appendChild(again);
      var fresh = await api.apiRequest('/postpartum');
      if (fresh) state.pp = fresh;
      loadTrend();
    });
  }
  function emergencyNumbersIfNeeded(level) {
    if (level !== 'emergency') return '';
    return '<div class="cx-actions">' + callBtn('112', 'Call 112', true) + callBtn('108', 'Call 108') + '</div>';
  }

  function resultHtml(ev, savedNote) {
    var s = LEVEL_STYLE[ev.level] || LEVEL_STYLE.ok;
    var flags = (ev.flags || []).map(function (f) {
      var fs = LEVEL_STYLE[f.level] || LEVEL_STYLE.info;
      return '<div style="margin:.4rem 0;padding-left:.7rem;border-left:3px solid ' + fs.bd + '"><b style="font-size:.86rem">' + esc(f.label) + '</b><div style="font-size:.84rem;color:var(--ink-2)">' + esc(f.action) + '</div></div>';
    }).join('');
    return '<div class="cx-banner" role="' + (ev.level === 'emergency' ? 'alert' : 'status') + '" style="background:' + s.bg + ';border-color:' + s.bd + ';color:' + s.fg + '"><div style="display:flex;justify-content:space-between;gap:.5rem"><b>' + esc(ev.headline || headlineFor(ev.level)) + '</b>' + (savedNote ? '<span style="font-size:.74rem">' + esc(savedNote) + '</span>' : '') + '</div>' +
      '<div style="color:var(--ink);margin-top:.2rem">' + flags + '</div>' +
      '<div style="font-size:.74rem;margin-top:.5rem;color:var(--ink-muted)">This is guidance, not a diagnosis. If you feel something is wrong, trust that and get help.</div></div>';
  }

  async function markContact(code, done) {
    var r = await api.apiRequest('/postpartum/contacts/' + encodeURIComponent(code), { method: 'PUT', body: { done: done } });
    if (r) { var fresh = await api.apiRequest('/postpartum'); if (fresh) { state.pp = fresh; renderPostpartum(); } }
  }

  async function loadPostpartum() {
    if (window.DaiDelay && localStorage.getItem('dai_guest') !== '1') { try { await DaiDelay.load(); } catch (e) { /* reasons are optional */ } }
    if (state.guest) { renderPostpartum(); return; }
    var d = await api.apiRequest('/postpartum');
    if (d) { state.pp = d; renderPostpartum(); }
  }

  /* ======================================================================
     3. SMART EMERGENCY RESPONSE
     ====================================================================== */
  var sos = { el: null, step: 1, context: 'pregnant', codes: [], note: '', triage: null, summary: null, eventId: null, actions: [], saved: null, opener: null };

  async function loadEmergencyContext() {
    if (state.guest || state.offline) return null;
    var c = await api.apiRequest('/emergency/context');
    if (c) state.emCtx = c;
    return c;
  }

  function openSOS() {
    sos.opener = document.activeElement;
    sos.step = 1; sos.codes = []; sos.note = ''; sos.triage = null; sos.summary = null; sos.eventId = null; sos.actions = []; sos.saved = null;
    sos.context = (state.emCtx && state.emCtx.context) || (state.pp && state.pp.active ? 'postpartum' : 'pregnant');
    injectStyles();
    var ov = document.createElement('div');
    ov.className = 'cx-overlay';
    ov.innerHTML = '<div class="cx-modal" role="dialog" aria-modal="true" aria-labelledby="sosTitle" tabindex="-1"><div class="cx-modal__head"><div id="sosTitle" class="cx-h" style="margin:0;color:#be123c">Emergency help</div><button type="button" class="cx-x" aria-label="Close" id="sosClose">&times;</button></div><div class="cx-modal__body" id="sosBody"></div></div>';
    document.body.appendChild(ov);
    sos.el = ov;
    document.body.style.overflow = 'hidden';
    $('sosClose').addEventListener('click', closeSOS);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeSOS(); });
    document.addEventListener('keydown', onSosKey);
    renderSOS();
    ov.querySelector('.cx-modal').focus();
    // Refresh context in the background (symptom list is also available locally via the shared module).
    loadEmergencyContext().then(function (c) {
      if (c && sos.el && sos.step === 1 && !sos.codes.length) { sos.context = c.context; renderSOS(); }
    });
  }
  function onSosKey(e) { if (e.key === 'Escape') closeSOS(); }
  function closeSOS() {
    if (!sos.el) return;
    document.removeEventListener('keydown', onSosKey);
    sos.el.remove(); sos.el = null;
    document.body.style.overflow = '';
    if (sos.opener && sos.opener.focus) sos.opener.focus();
  }

  function stepsNav() {
    var names = ['1 · Situation', '2 · What to do', '3 · Summary', '4 · Coordinate'];
    return '<div class="cx-steps" role="tablist">' + names.map(function (n, i) {
      var disabled = i > 0 && !sos.triage;
      return '<button type="button" role="tab" data-step="' + (i + 1) + '" class="' + (sos.step === i + 1 ? 'is-on' : '') + '"' + (disabled ? ' disabled style="opacity:.45"' : '') + '>' + n + '</button>';
    }).join('') + '</div>';
  }

  function renderSOS() {
    if (!sos.el) return;
    var body = $('sosBody');
    var inner = stepsNav();
    if (sos.step === 1) inner += stepSituation();
    else if (sos.step === 2) inner += stepActions();
    else if (sos.step === 3) inner += stepSummary();
    else inner += stepCoordinate();
    body.innerHTML = inner;
    Array.prototype.forEach.call(body.querySelectorAll('.cx-steps button'), function (b) {
      b.addEventListener('click', function () { sos.step = Number(b.getAttribute('data-step')); renderSOS(); });
    });
    wireStep();
  }

  function stepSituation() {
    var list = EM.symptomsFor(sos.context);
    var em = list.filter(function (s) { return s.level === 'emergency'; });
    var ur = list.filter(function (s) { return s.level !== 'emergency'; });
    function row(s) { return '<label class="cx-check' + (s.level === 'emergency' ? ' is-em' : '') + '"><input type="checkbox" data-sym="' + esc(s.code) + '"' + (sos.codes.indexOf(s.code) >= 0 ? ' checked' : '') + '><span>' + esc(s.label) + '</span></label>'; }
    var active = state.emCtx && state.emCtx.active_event_id;
    return '<div class="cx-banner" style="background:#fff1f2;border-color:#fda4af"><b style="color:#be123c">If this is an emergency, call now — you can fill in the rest on the way.</b><div class="cx-actions">' +
      callBtn('112', 'Call 112', true) + callBtn('108', 'Call 108') + '</div></div>' +
      (active ? '<div class="cx-banner" style="background:#fffbeb;border-color:#fcd34d"><b>You have an open emergency record from the last 24 hours.</b> <button type="button" class="btn btn--ghost btn--sm" id="sosResume">Open it</button></div>' : '') +
      '<div class="cx-seg" role="group" aria-label="Your situation" style="margin:.6rem 0">' +
      '<button type="button" data-ctx="pregnant" class="' + (sos.context === 'pregnant' ? 'is-on' : '') + '">I am pregnant</button> ' +
      '<button type="button" data-ctx="postpartum" class="' + (sos.context === 'postpartum' ? 'is-on' : '') + '">I have had my baby</button></div>' +
      '<div class="cx-sub" style="margin:.4rem 0 .1rem"><b>What is happening?</b> Tick everything that applies.</div>' +
      '<div class="cx-sub" style="margin:.5rem 0 0;color:#be123c"><b>Needs an ambulance</b></div>' + em.map(row).join('') +
      '<div class="cx-sub" style="margin:.7rem 0 0;color:#b45309"><b>Needs a doctor or facility today</b></div>' + ur.map(row).join('') +
      '<div class="cx-field" style="margin-top:.7rem"><label for="sosNote">Anything else to tell the doctor? (optional)</label><textarea id="sosNote" rows="2" maxlength="500">' + esc(sos.note) + '</textarea></div>' +
      '<div style="margin-top:.9rem"><button type="button" class="btn btn--primary btn--full" id="sosGo" style="background:var(--rose);min-height:48px">Get help &amp; guidance</button></div>' +
      '<p class="cx-sub" style="margin-top:.5rem">Not sure? Tick nothing and press the button — if you are worried, treat it as urgent.</p>';
  }

  function stepActions() {
    var t = sos.triage;
    var s = LEVEL_STYLE[t.level] || LEVEL_STYLE.unsure;
    var h = '<div class="cx-banner" role="alert" style="background:' + s.bg + ';border-color:' + s.bd + '"><div style="font-size:1.05rem;font-weight:800;color:' + s.fg + '">' + esc(t.headline) + '</div></div>';
    h += '<div class="cx-actions">' + t.numbers.map(function (n) { return callBtn(n.number, n.number + ' · ' + n.label, n.key === 'national'); }).join('') + '</div>';
    if (t.matched.length) h += '<div class="cx-sub" style="margin-top:.4rem"><b>Why:</b></div><ul style="margin:0 0 .4rem 1.1rem;padding:0;font-size:.86rem">' + t.matched.map(function (m) { return '<li>' + esc(m.label) + ' ' + chip(m.level) + '<div class="cx-sub" style="margin:0">' + esc(m.why) + '</div></li>'; }).join('') + '</ul>';
    h += '<div class="cx-h" style="font-size:.95rem;margin-top:.7rem">Do this now</div><ol style="margin:.2rem 0 .5rem 1.2rem;padding:0;font-size:.9rem;line-height:1.5">' + t.steps.map(function (x) { return '<li style="margin:.3rem 0">' + esc(x) + '</li>'; }).join('') + '</ol>';
    if (t.firstAid.length) h += '<div class="cx-h" style="font-size:.95rem">While you wait for help</div><ul style="margin:.2rem 0 .5rem 1.1rem;padding:0;font-size:.88rem">' + t.firstAid.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    h += '<p class="cx-sub">' + esc(t.disclaimer) + '</p>';
    h += '<div class="cx-actions"><button type="button" class="btn btn--primary" id="sosToSummary">Next: emergency summary</button><button type="button" class="btn btn--ghost" id="sosBack">Change what I selected</button></div>';
    return h;
  }

  function summaryHtml(sum) {
    return '<div class="cx-sum">' + sum.sections.map(function (sec) {
      return '<h4>' + esc(sec.title) + '</h4><dl>' + sec.rows.map(function (r) {
        return '<dt>' + esc(r.label) + '</dt><dd' + (r.value === 'Not recorded' ? ' class="nr"' : '') + '>' + esc(r.value) + '</dd>';
      }).join('') + '</dl>';
    }).join('') + '</div>';
  }

  function stepSummary() {
    var sum = sos.summary;
    var h = '<div class="cx-h" style="font-size:.95rem">Emergency summary</div><p class="cx-sub">A one-page summary for the person helping you, the ambulance crew or the facility. You choose who gets it — nothing is sent automatically.</p>';
    if (sos.saved === false) h += '<div class="cx-banner" style="background:#fffbeb;border-color:#fcd34d;font-size:.84rem"><b>We could not save this to your record</b> (or you are in guest mode), so the summary only has what is on this screen. Your guidance above is still correct.</div>';
    if (!sum) return h + '<p class="cx-sub">Preparing…</p>';
    h += summaryHtml(sum);
    h += '<p class="cx-sub" style="margin-top:.6rem">' + esc(sum.disclaimer) + '</p>';
    h += '<div class="cx-actions"><button type="button" class="btn btn--primary" id="sosCopy">Copy summary</button>' +
      '<button type="button" class="btn btn--ghost" id="sosShare">Share…</button>' +
      '<a class="btn btn--ghost" id="sosWa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(sum.text) + '">WhatsApp</a>' +
      '<a class="btn btn--ghost" id="sosSms" href="sms:?&body=' + encodeURIComponent(sum.text) + '">SMS</a></div>' +
      '<div class="cx-actions"><button type="button" class="btn btn--ghost" id="sosToCoord">Next: coordinate</button></div>';
    return h;
  }

  var ACTION_LABELS = {
    called_ambulance: 'Called an ambulance', called_contact: 'Called my emergency contact', called_facility: 'Called the facility',
    shared_summary: 'Shared the summary', left_for_facility: 'Left for the facility', reached_facility: 'Reached the facility'
  };
  function done(a) { return sos.actions.indexOf(a) >= 0; }

  function stepCoordinate() {
    var c = (state.emCtx && state.emCtx.contact) || {};
    var plan = (state.emCtx && state.emCtx.plan) || state.plan || {};
    function line(label, name, phone, action, strong) {
      if (!phone) return '<div class="cx-row"><div><b style="font-size:.88rem">' + esc(label) + '</b><div class="cx-sub" style="margin:0">' + (name ? esc(name) + ' — ' : '') + 'no phone number saved</div></div></div>';
      return '<div class="cx-row"><div><b style="font-size:.88rem">' + esc(label) + '</b><div class="cx-sub" style="margin:0">' + esc([name, phone].filter(Boolean).join(' · ')) + '</div></div>' +
        '<div style="display:flex;gap:.4rem;align-items:center">' + (done(action) ? chip('ok', 'You marked this') : '') + '<a class="cx-call' + (strong ? ' cx-call--strong' : '') + '" data-act="' + action + '" href="' + telHref(phone) + '">Call</a></div></div>';
    }
    var h = '<div class="cx-h" style="font-size:.95rem">Coordinate</div>' +
      '<div class="cx-banner" style="background:#f5f3ff;border-color:#ddd6fe;font-size:.84rem"><b>Anvaya does not contact hospitals for you, and it cannot see bed availability.</b> Please call the facility yourself so they can prepare — and do not assume a place is ready until they tell you.</div>';
    h += '<div class="cx-row"><div><b style="font-size:.88rem">Ambulance</b><div class="cx-sub" style="margin:0">112 works everywhere in India; 108 in many states</div></div><div style="display:flex;gap:.4rem;align-items:center">' + (done('called_ambulance') ? chip('ok', 'You marked this') : '') + '<a class="cx-call cx-call--strong" data-act="called_ambulance" href="tel:112">112</a></div></div>';
    h += line('Emergency contact', c.name, c.phone, 'called_contact', false);
    h += line('Planned facility', plan.facility_name, plan.facility_phone, 'called_facility', false);
    if (plan.backup_facility_phone) h += line('Backup facility', plan.backup_facility_name, plan.backup_facility_phone, 'called_facility', false);
    if (plan.blood_donor_phone) h += line('Blood donor', plan.blood_donor_name, plan.blood_donor_phone, 'called_contact', false);
    if (plan.transport_note) h += '<div class="cx-row"><div><b style="font-size:.88rem">Your transport plan</b><div class="cx-sub" style="margin:0">' + esc(plan.transport_note) + '</div></div></div>';
    if (!plan.facility_name && !plan.facility_phone) h += '<p class="cx-sub" style="margin-top:.5rem">You have not saved a planned facility yet. Add one in <b>Profile → Emergency plan</b> when you are well, so it is ready next time.</p>';

    h += '<div class="cx-h" style="font-size:.95rem;margin-top:.9rem">Tick off what you have done</div>' +
      ['shared_summary', 'left_for_facility', 'reached_facility'].map(function (a) { return '<label class="cx-check"><input type="checkbox" data-mark="' + a + '"' + (done(a) ? ' checked' : '') + '><span>' + esc(ACTION_LABELS[a]) + '</span></label>'; }).join('') +
      '<p class="cx-sub">These ticks are your own notes — they are not confirmed by anyone else.</p>';

    h += '<div class="cx-field" style="margin-top:.8rem"><label for="sosOutcome">When it is over, how did it end?</label><select id="sosOutcome"><option value="">Choose…</option><option value="reached_facility">I reached a facility and was seen</option><option value="treated_at_home">I got advice and stayed at home</option><option value="false_alarm">It was a false alarm</option><option value="other">Something else</option></select></div>' +
      '<div class="cx-actions"><button type="button" class="btn btn--ghost" id="sosResolve">Close this emergency record</button></div>';
    return h;
  }

  async function recordAction(action) {
    if (!sos.eventId || done(action)) { if (!done(action)) sos.actions.push(action); return; }
    sos.actions.push(action);
    api.apiRequest('/emergency/events/' + sos.eventId + '/actions', { method: 'POST', body: { action: action } });
  }

  function wireStep() {
    var body = $('sosBody');
    if (sos.step === 1) {
      Array.prototype.forEach.call(body.querySelectorAll('[data-ctx]'), function (b) {
        b.addEventListener('click', function () { sos.note = $('sosNote').value; sos.context = b.getAttribute('data-ctx'); sos.codes = []; renderSOS(); });
      });
      Array.prototype.forEach.call(body.querySelectorAll('[data-sym]'), function (c) {
        c.addEventListener('change', function () {
          var code = c.getAttribute('data-sym');
          sos.codes = sos.codes.filter(function (x) { return x !== code; });
          if (c.checked) sos.codes.push(code);
        });
      });
      var go = $('sosGo');
      if (go) go.addEventListener('click', submitSituation);
      var res = $('sosResume');
      if (res) res.addEventListener('click', resumeEvent);
    } else if (sos.step === 2) {
      $('sosToSummary').addEventListener('click', function () { sos.step = 3; renderSOS(); });
      $('sosBack').addEventListener('click', function () { sos.step = 1; renderSOS(); });
    } else if (sos.step === 3) {
      var copy = $('sosCopy'), share = $('sosShare');
      if (sos.summary) {
        copy.addEventListener('click', async function () {
          try { await navigator.clipboard.writeText(sos.summary.text); api.toast('Summary copied'); recordAction('shared_summary'); }
          catch (e) { api.toast('Could not copy — use Share instead'); }
        });
        if (navigator.share) share.addEventListener('click', function () { navigator.share({ title: 'Emergency summary', text: sos.summary.text }).then(function () { recordAction('shared_summary'); }).catch(function () {}); });
        else share.style.display = 'none';
        ['sosWa', 'sosSms'].forEach(function (id) { var a = $(id); if (a) a.addEventListener('click', function () { recordAction('shared_summary'); }); });
      }
      $('sosToCoord').addEventListener('click', function () { sos.step = 4; renderSOS(); });
    } else {
      Array.prototype.forEach.call(body.querySelectorAll('[data-act]'), function (a) {
        a.addEventListener('click', function () { recordAction(a.getAttribute('data-act')); setTimeout(renderSOS, 300); });
      });
      Array.prototype.forEach.call(body.querySelectorAll('[data-mark]'), function (c) {
        c.addEventListener('change', function () { if (c.checked) recordAction(c.getAttribute('data-mark')); });
      });
      $('sosResolve').addEventListener('click', async function () {
        var o = $('sosOutcome').value;
        if (!o) { api.toast('Choose how it ended first'); return; }
        if (sos.eventId) {
          var r = await api.apiRequest('/emergency/events/' + sos.eventId + '/resolve', { method: 'PATCH', body: { outcome: o } });
          if (!r) return;
        }
        api.toast('Emergency record closed. Take care of yourself.');
        if (state.emCtx) state.emCtx.active_event_id = null;
        closeSOS();
      });
    }
  }

  async function submitSituation() {
    sos.note = $('sosNote') ? $('sosNote').value.trim() : sos.note;
    var ctxObj = { context: sos.context, gestWeeks: state.emCtx && state.emCtx.gest_weeks != null && sos.context === 'pregnant' ? state.emCtx.gest_weeks : undefined };
    // 1) Instant, on-device guidance (works offline). Recent BP is added by the server copy below.
    sos.triage = EM.triage(sos.codes, ctxObj);
    var cx = (state.emCtx && state.emCtx.contact) || {};
    sos.summary = EM.buildSummary({ name: state.user && state.user.full_name, context: sos.context, gestWeeks: ctxObj.gestWeeks, symptoms: sos.codes, note: sos.note, contact: cx, plan: state.emCtx && state.emCtx.plan });
    sos.saved = state.guest ? false : null;
    sos.step = 2;
    renderSOS();
    if (state.guest) return;
    // 2) Save to her record; the server re-runs triage and builds the full summary from her profile + logs.
    var r = await api.apiRequest('/emergency/events', { method: 'POST', body: { symptoms: sos.codes, note: sos.note, context: sos.context } });
    if (!sos.el) return;
    if (r) {
      sos.eventId = r.event.id; sos.saved = true;
      sos.triage = r.triage; sos.summary = r.summary;
      if (state.emCtx) state.emCtx.active_event_id = r.event.id;
      // Server may know about a fresh severe BP the device did not — show the higher level if so.
      if (sos.step === 2) renderSOS();
      sos.actions.forEach(function (a) { api.apiRequest('/emergency/events/' + r.event.id + '/actions', { method: 'POST', body: { action: a } }); });
    } else {
      sos.saved = false;
      if (sos.step === 3) renderSOS();
    }
  }

  async function resumeEvent() {
    var id = state.emCtx && state.emCtx.active_event_id;
    if (!id) return;
    var r = await api.apiRequest('/emergency/events/' + id);
    if (!r || !sos.el) return;
    var e = r.event;
    sos.eventId = e.id; sos.context = e.context; sos.codes = e.symptoms || []; sos.note = e.note || '';
    sos.actions = (e.actions || []).map(function (a) { return a.action; });
    sos.summary = e.summary; sos.saved = true;
    sos.triage = EM.triage(sos.codes, { context: e.context });
    sos.step = 2; renderSOS();
  }

  /* ======================================================================
     4. EMERGENCY PLAN EDITOR (Profile panel)
     ====================================================================== */
  function renderPlan() {
    var root = $('emergencyPlanRoot');
    if (!root) return;
    if (state.guest) { root.innerHTML = '<div class="cx-card" style="max-width:560px"><div class="cx-h">Emergency plan</div><p class="cx-sub">Sign in to save your planned facility, transport and blood-donor contacts.</p></div>'; return; }
    var p = state.plan || {};
    function f(id, label, val, type, ph) { return '<div class="cx-field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '"></div>'; }
    root.innerHTML = '<div class="cx-card" style="max-width:560px"><div class="cx-h">Emergency plan</div>' +
      '<p class="cx-sub">Decide this while you are well. It appears in the emergency flow and the emergency summary exactly as you write it. Anvaya does not check availability with these places — call them to confirm.</p>' +
      '<form id="planForm" class="cx-grid" style="grid-template-columns:1fr 1fr;gap:.7rem">' +
      f('plFac', 'Planned facility', p.facility_name, 'text', 'Hospital / health centre') + f('plFacPh', 'Facility phone', p.facility_phone, 'tel') +
      f('plBak', 'Backup facility', p.backup_facility_name) + f('plBakPh', 'Backup phone', p.backup_facility_phone, 'tel') +
      f('plDon', 'Blood donor (if arranged)', p.blood_donor_name) + f('plDonPh', 'Donor phone', p.blood_donor_phone, 'tel') +
      '<div class="cx-field" style="grid-column:1/-1"><label for="plTr">How will you get there? Who will take you?</label><textarea id="plTr" rows="2" maxlength="300">' + esc(p.transport_note || '') + '</textarea></div>' +
      '<div style="grid-column:1/-1"><button type="submit" class="btn btn--primary">Save plan</button> <span class="cx-sub" id="plMsg"></span></div></form></div>';
    $('planForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var r = await api.apiRequest('/emergency/plan', { method: 'PUT', body: {
        facility_name: $('plFac').value, facility_phone: $('plFacPh').value, backup_facility_name: $('plBak').value, backup_facility_phone: $('plBakPh').value,
        blood_donor_name: $('plDon').value, blood_donor_phone: $('plDonPh').value, transport_note: $('plTr').value } });
      if (r) { state.plan = r.plan; if (state.emCtx) state.emCtx.plan = r.plan; api.toast('Emergency plan saved'); }
    });
  }
  async function loadPlan() {
    if (state.guest) { renderPlan(); return; }
    var r = await api.apiRequest('/emergency/plan');
    if (r) { state.plan = r.plan; }
    renderPlan();
  }

  /* ======================================================================
     Public API
     ====================================================================== */
  var started = false;
  function init(opts) {
    if (started) return;
    started = true;
    state.educationOnly = !!(opts && opts.educationOnly);
    state.guest = !!(opts && opts.guest);
    state.user = (opts && opts.user) || null;
    injectStyles();
    state.offline=!!(opts&&opts.offline);
    if(state.offline){state.pp=opts.cachedPost||null;renderPostpartum();renderPlan();return;}
    if (!$('cxFab')) {
      var fab = document.createElement('button');
      fab.id = 'cxFab'; fab.type = 'button'; fab.className = 'cx-fab'; fab.setAttribute('aria-label', 'Emergency help');
      fab.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#i-phone"/></svg> Emergency';
      fab.addEventListener('click', openSOS);
      document.body.appendChild(fab);
    }
    if(!state.educationOnly)renderTrend(); renderPlan();
    loadTrend(); loadPostpartum(); loadPlan(); loadEmergencyContext();
  }

  // Called by dashboard.html after a BP/glucose log; shows a toast if the screen changed.
  function afterHealthLog(res) {
    if(state.educationOnly)return;
    if (res && res.risk_update && res.risk_update.changed) {
      api.toast('Risk screen updated: ' + res.risk_update.previous_level + ' → ' + res.risk_update.risk_level);
    }
    loadTrend();
  }

  // Rendering helpers reused by the doctor portal (js/doctor-safety.js).
  var helpers = { esc: esc, chip: chip, fmtShort: fmtShort, lineChart: lineChart, injectStyles: injectStyles, LEVEL_STYLE: LEVEL_STYLE, telHref: telHref };

  window.CareExt = { helpers: helpers, init: init, openSOS: openSOS, refreshRisk: loadTrend, afterHealthLog: afterHealthLog, refreshPostpartum: loadPostpartum };
})();
