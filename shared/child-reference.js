/* ==========================================================================
   Anvaya — child reference data + rules, shared by the browser and Node.

   One copy of the vaccination schedule, developmental milestones and growth
   reference, so the mother's Child dashboard and the doctor's view of the same
   child can never disagree. Loaded with a <script> tag in dashboard.html
   (window.AnvayaChild) and require()d by backend/childDashboard.js.

   Every date calculation works on 'YYYY-MM-DD' strings (UTC arithmetic), never
   on Date objects in the viewer's zone, so a birth date can't shift by a day.

   Sources (paraphrased; have a paediatrician review before real-world use):
     • Vaccines   — India's Universal Immunisation Programme (UIP) schedule.
     • Milestones — CDC "Learn the Signs. Act Early." checklists.
     • Growth     — WHO Child Growth Standards (2006), weight / length-height /
                    head circumference for age, birth–60 months, via the LMS
                    tables in shared/who-growth-standards.js.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./who-growth-standards.js'));
  else root.AnvayaChild = factory(root.AnvayaWho);
})(typeof self !== 'undefined' ? self : this, function (WHO) {
  'use strict';

  /* ---- Dates ------------------------------------------------------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function toISO(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function daysBetween(fromISO, toISOStr) { return Math.round((parseISO(toISOStr) - parseISO(fromISO)) / 86400000); }
  function addDaysISO(iso, n) { return toISO(parseISO(iso) + n * 86400000); }

  // Calendar age { years, months, days, totalDays } between two ISO dates.
  function ageParts(dobISO, todayISO) {
    var a = new Date(parseISO(dobISO)), b = new Date(parseISO(todayISO));
    var total = daysBetween(dobISO, todayISO);
    if (!isFinite(total) || total < 0) return { years: 0, months: 0, days: 0, totalDays: Math.max(0, total || 0) };
    var months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) months--;
    var anchor = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, a.getUTCDate()));
    var days = Math.round((b.getTime() - anchor.getTime()) / 86400000);
    return { years: Math.floor(months / 12), months: months % 12, days: days, totalMonths: months, totalDays: total };
  }

  // Human age: "9 days", "5 weeks", "7 months 2 weeks", "2 years 3 months".
  function ageText(dobISO, todayISO) {
    var p = ageParts(dobISO, todayISO), plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
    if (p.totalDays < 14) return plural(p.totalDays, 'day');
    if (p.totalMonths < 2 && p.totalDays < 60) return plural(Math.floor(p.totalDays / 7), 'week');
    if (p.totalMonths < 24) {
      var wk = Math.floor(p.days / 7);
      return plural(p.totalMonths, 'month') + (wk ? ' ' + plural(wk, 'week') : '');
    }
    return plural(p.years, 'year') + (p.months ? ' ' + plural(p.months, 'month') : '');
  }

  // Age in months (fractional) used to read growth charts. Babies born before
  // 37 weeks are plotted on CORRECTED age until they are two.
  function chartAgeMonths(dobISO, onISO, bornAtWeeks) {
    var days = daysBetween(dobISO, onISO);
    var early = bornAtWeeks && bornAtWeeks < 37 ? (40 - bornAtWeeks) * 7 : 0;
    var chrono = days / 30.4375;
    if (early && chrono < 24) return Math.max(0, (days - early) / 30.4375);
    return chrono;
  }

  /* ---- Vaccination schedule (India UIP) -------------------------------------
     at        day of life the dose falls due
     overdueAt day of life after which it counts as overdue (a late dose can
               usually still be given — the nudge is "ask your health worker")
     ------------------------------------------------------------------------- */
  var VACCINES = [
    { code: 'bcg',    name: 'BCG',                        stage: 'Birth',     at: 0,    overdueAt: 15,   protects: 'Tuberculosis', dose: 1 },
    { code: 'opv0',   name: 'OPV-0 (oral polio)',         stage: 'Birth',     at: 0,    overdueAt: 15,   protects: 'Polio', dose: 0 },
    { code: 'hepb0',  name: 'Hepatitis B — birth dose',   stage: 'Birth',     at: 0,    overdueAt: 15,   protects: 'Hepatitis B', note: 'Ideally within 24 hours of birth.', dose: 1 },

    { code: 'opv1',   name: 'OPV-1',                      stage: '6 weeks',   at: 42,   overdueAt: 70,   protects: 'Polio', dose: 1 },
    { code: 'penta1', name: 'Pentavalent-1',              stage: '6 weeks',   at: 42,   overdueAt: 70,   protects: 'Diphtheria, tetanus, whooping cough, hepatitis B, Hib', dose: 1 },
    { code: 'rota1',  name: 'Rotavirus-1',                stage: '6 weeks',   at: 42,   overdueAt: 70,   protects: 'Severe diarrhoea', dose: 1 },
    { code: 'fipv1',  name: 'fIPV-1 (injectable polio)',  stage: '6 weeks',   at: 42,   overdueAt: 70,   protects: 'Polio', dose: 1 },
    { code: 'pcv1',   name: 'PCV-1',                      stage: '6 weeks',   at: 42,   overdueAt: 70,   protects: 'Pneumonia and meningitis', note: 'Where PCV is offered in your state.', conditional: true, dose: 1 },

    { code: 'opv2',   name: 'OPV-2',                      stage: '10 weeks',  at: 70,   overdueAt: 98,   protects: 'Polio', dose: 2 },
    { code: 'penta2', name: 'Pentavalent-2',              stage: '10 weeks',  at: 70,   overdueAt: 98,   protects: 'Diphtheria, tetanus, whooping cough, hepatitis B, Hib', dose: 2 },
    { code: 'rota2',  name: 'Rotavirus-2',                stage: '10 weeks',  at: 70,   overdueAt: 98,   protects: 'Severe diarrhoea', dose: 2 },

    { code: 'opv3',   name: 'OPV-3',                      stage: '14 weeks',  at: 98,   overdueAt: 126,  protects: 'Polio', dose: 3 },
    { code: 'penta3', name: 'Pentavalent-3',              stage: '14 weeks',  at: 98,   overdueAt: 126,  protects: 'Diphtheria, tetanus, whooping cough, hepatitis B, Hib', dose: 3 },
    { code: 'rota3',  name: 'Rotavirus-3',                stage: '14 weeks',  at: 98,   overdueAt: 126,  protects: 'Severe diarrhoea', dose: 3 },
    { code: 'fipv2',  name: 'fIPV-2 (injectable polio)',  stage: '14 weeks',  at: 98,   overdueAt: 126,  protects: 'Polio', dose: 2 },
    { code: 'pcv2',   name: 'PCV-2',                      stage: '14 weeks',  at: 98,   overdueAt: 126,  protects: 'Pneumonia and meningitis', note: 'Where PCV is offered in your state.', conditional: true, dose: 2 },

    { code: 'mr1',    name: 'Measles-Rubella-1 (MR-1)',   stage: '9 months',  at: 270,  overdueAt: 365,  protects: 'Measles and rubella', dose: 1 },
    { code: 'je1',    name: 'Japanese encephalitis-1',    stage: '9 months',  at: 270,  overdueAt: 365,  protects: 'Japanese encephalitis', note: 'Given in districts where JE is common.', conditional: true, dose: 1 },
    { code: 'pcvb',   name: 'PCV booster',                stage: '9 months',  at: 270,  overdueAt: 365,  protects: 'Pneumonia and meningitis', note: 'Where PCV is offered in your state.', conditional: true, dose: null },
    { code: 'vita1',  name: 'Vitamin A (first dose)',     stage: '9 months',  at: 270,  overdueAt: 365,  protects: 'Vitamin A deficiency', dose: 1 },

    { code: 'mr2',    name: 'Measles-Rubella-2 (MR-2)',   stage: '16–24 months', at: 487, overdueAt: 730, protects: 'Measles and rubella', dose: 2 },
    { code: 'je2',    name: 'Japanese encephalitis-2',    stage: '16–24 months', at: 487, overdueAt: 730, protects: 'Japanese encephalitis', note: 'Given in districts where JE is common.', conditional: true, dose: 2 },
    { code: 'dptb1',  name: 'DPT booster-1',              stage: '16–24 months', at: 487, overdueAt: 730, protects: 'Diphtheria, tetanus, whooping cough', dose: null },
    { code: 'opvb',   name: 'OPV booster',                stage: '16–24 months', at: 487, overdueAt: 730, protects: 'Polio', dose: null },
    { code: 'vita2',  name: 'Vitamin A (second dose)',    stage: '16–24 months', at: 487, overdueAt: 730, protects: 'Vitamin A deficiency', note: 'Repeated every 6 months until age 5.', dose: 2 },

    { code: 'dptb2',  name: 'DPT booster-2',              stage: '5–6 years',  at: 1826, overdueAt: 2190, protects: 'Diphtheria, tetanus, whooping cough', dose: null },
    { code: 'td10',   name: 'Td (tetanus & diphtheria)',  stage: '10 years',   at: 3652, overdueAt: 4017, protects: 'Tetanus and diphtheria', dose: 1 },
    { code: 'td16',   name: 'Td (tetanus & diphtheria)',  stage: '16 years',   at: 5844, overdueAt: 6209, protects: 'Tetanus and diphtheria', dose: 2 }
  ];
  var VACCINE_BY_CODE = {};
  VACCINES.forEach(function (v) { VACCINE_BY_CODE[v.code] = v; });
  var DUE_SOON_DAYS = 7;
  // Reminders start this many days before a dose falls due ("coming up" at 14 days, "due" at 7).
  var REMINDER_LEAD_DAYS = 14;
  var SCHEDULE_SOURCE = {
    name: 'India\u2019s Universal Immunisation Programme (National Immunization Schedule, Ministry of Health & Family Welfare)',
    disclaimer: 'Due dates are worked out from the date of birth. A late dose can usually still be given \u2014 ask your ASHA worker, health centre or paediatrician. Your doctor may follow a different schedule (for example the IAP schedule) or add vaccines, so confirm before acting on a reminder.'
  };

  // 'completed' | 'optional' (a conditional vaccine not given: offered only in
  // some states/districts, so it is never flagged as missed) | 'missed' | 'due'
  // (due now or within a week) | 'upcoming'
  function vaccineStatus(dobISO, v, givenOn, todayISO) {
    if (givenOn) return 'completed';
    if (v.conditional) return 'optional';
    var day = daysBetween(dobISO, todayISO);
    if (day > v.overdueAt) return 'missed';
    if (day >= v.at - DUE_SOON_DAYS) return 'due';
    return 'upcoming';
  }

  // The full schedule for one child.
  // givenMap: { code: 'YYYY-MM-DD' (or { given_on }) }  ->  [{ ...vaccine, dueDate, status, givenOn, daysUntil }]
  function vaccineSchedule(dobISO, givenMap, todayISO) {
    givenMap = givenMap || {};
    return VACCINES.map(function (v) {
      var g = givenMap[v.code], givenOn = g && typeof g === 'object' ? g.given_on : g;
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = v[k]; });
      out.dueDate = addDaysISO(dobISO, v.at);
      out.givenOn = givenOn || null;
      out.status = vaccineStatus(dobISO, v, givenOn, todayISO);
      out.daysUntil = daysBetween(todayISO, out.dueDate);
      return out;
    });
  }

  // Roll a schedule up into the numbers the dashboards show. Conditional
  // vaccines that were not given are left out of the totals.
  function summarizeSchedule(schedule) {
    var counted = schedule.filter(function (v) { return v.status !== 'optional'; });
    var pick = function (st) { return counted.filter(function (v) { return v.status === st; }); };
    var upcoming = pick('upcoming').sort(function (a, b) { return a.at - b.at; });
    var due = pick('due').sort(function (a, b) { return a.at - b.at; });
    return {
      total: counted.length,
      completed: pick('completed').length,
      missed: pick('missed'),
      due: due,
      next: (due.concat(upcoming))[0] || null
    };
  }

  // Doses not yet given that are due within `withinDays` (default: the reminder window) or already
  // overdue, soonest first. Optional (state-dependent) vaccines are never included.
  function upcomingVaccines(schedule, withinDays) {
    var lead = withinDays == null ? REMINDER_LEAD_DAYS : withinDays;
    return schedule.filter(function (v) {
      return v.status !== 'completed' && v.status !== 'optional' && v.daysUntil <= lead;
    }).sort(function (a, b) { return a.at - b.at; });
  }

  /* ---- Developmental milestones (CDC checklists, paraphrased) ---------------- */
  var MILESTONES = [
    { months: 2, items: [
      ['m2_calm',   'social',   'Calms down when spoken to or picked up'],
      ['m2_smile',  'social',   'Smiles when you talk or smile at them'],
      ['m2_head',   'movement', 'Holds head up briefly when on their tummy'],
      ['m2_limbs',  'movement', 'Moves both arms and both legs']] },
    { months: 4, items: [
      ['m4_smile',  'social',   'Smiles on their own to get your attention'],
      ['m4_chuckle','language', 'Chuckles or makes sounds when you play with them'],
      ['m4_head',   'movement', 'Holds head steady without support'],
      ['m4_hands',  'movement', 'Brings hands to mouth and holds a toy placed in the hand']] },
    { months: 6, items: [
      ['m6_faces',  'social',   'Knows familiar people and enjoys looking at themselves in a mirror'],
      ['m6_turns',  'language', 'Takes turns making sounds with you; blows raspberries'],
      ['m6_reach',  'cognitive','Reaches to grab a toy and puts things in their mouth'],
      ['m6_roll',   'movement', 'Rolls from tummy to back']] },
    { months: 9, items: [
      ['m9_shy',    'social',   'Is shy, clingy or fearful around strangers'],
      ['m9_babble', 'language', 'Makes different sounds like \u201Cmamama\u201D and \u201Cbababa\u201D'],
      ['m9_search', 'cognitive','Looks for things that have dropped out of sight'],
      ['m9_sit',    'movement', 'Sits without support']] },
    { months: 12, items: [
      ['m12_wave',  'social',   'Plays games like pat-a-cake and waves \u201Cbye-bye\u201D'],
      ['m12_words', 'language', 'Calls a parent \u201Cmama\u201D or \u201Cdada\u201D and understands \u201Cno\u201D'],
      ['m12_pincer','cognitive','Picks up small things with thumb and pointer finger'],
      ['m12_stand', 'movement', 'Pulls up to stand and walks holding on to furniture']] },
    { months: 15, items: [
      ['m15_clap',  'social',   'Shows you affection and claps when excited'],
      ['m15_words', 'language', 'Tries to say one or two words besides mama or dada'],
      ['m15_point', 'cognitive','Points to ask for something or to get help'],
      ['m15_walk',  'movement', 'Takes a few steps on their own']] },
    { months: 18, items: [
      ['m18_show',  'social',   'Points to show you something interesting'],
      ['m18_words', 'language', 'Tries to say three or more words besides mama or dada'],
      ['m18_follow','cognitive','Follows one-step directions without gestures'],
      ['m18_walk',  'movement', 'Walks without holding on to anyone or anything']] },
    { months: 24, items: [
      ['m24_upset', 'social',   'Notices when others are hurt or upset'],
      ['m24_two',   'language', 'Says at least two words together'],
      ['m24_body',  'cognitive','Points to at least two body parts when you ask'],
      ['m24_run',   'movement', 'Runs and tries to kick a ball']] },
    { months: 30, items: [
      ['m30_play',  'social',   'Plays next to other children and sometimes plays with them'],
      ['m30_words', 'language', 'Says about 50 words and puts two words together with an action, like \u201Cdoggie run\u201D'],
      ['m30_pretend','cognitive','Uses things to pretend, like feeding a block to a doll as if it were food'],
      ['m30_jump',  'movement', 'Jumps off the ground with both feet']] },
    { months: 36, items: [
      ['m36_calm',  'social',   'Calms down within 10 minutes after you leave them, like at a childcare drop-off'],
      ['m36_talk',  'language', 'Holds a conversation with at least two back-and-forth exchanges'],
      ['m36_circle','cognitive','Draws a circle after you show them how'],
      ['m36_beads', 'movement', 'Strings items together, like large beads or macaroni']] },
    { months: 48, items: [
      ['m48_pretend','social',  'Pretends to be something else during play, like a teacher or superhero'],
      ['m48_story', 'language', 'Says sentences of four or more words and talks about something that happened in their day'],
      ['m48_colors','cognitive','Names a few colours of items'],
      ['m48_catch', 'movement', 'Catches a large ball most of the time']] },
    { months: 60, items: [
      ['m60_rules', 'social',   'Follows rules or takes turns when playing games with other children'],
      ['m60_tell',  'language', 'Tells a story with at least two events, like a toy getting lost and then found'],
      ['m60_count', 'cognitive','Counts to 10'],
      ['m60_hop',   'movement', 'Hops on one foot']] }
  ].map(function (c) {
    return { months: c.months, label: c.months < 24 ? c.months + ' months' : (c.months % 12 === 0 ? (c.months / 12) + ' years' : c.months + ' months'), items: c.items.map(function (i) { return { code: i[0], domain: i[1], text: i[2] }; }) };
  });
  var MILESTONE_CODES = {};
  MILESTONES.forEach(function (c) { c.items.forEach(function (i) { MILESTONE_CODES[i.code] = c.months; }); });

  // Where a child is against one checkpoint. ageMonths should be the CORRECTED age for babies
  // born early (see chartAgeMonths). CDC milestones are skills most children have by that age,
  // so a gap is a prompt to mention it to the doctor, never a diagnosis.
  //   complete    every skill marked
  //   upcoming    the child hasn't reached the checkpoint age yet
  //   in_progress at the checkpoint age (or within the grace window) with skills still to mark
  //   discuss     past the grace window with skills still unmarked
  var MILESTONE_GRACE_MONTHS = 2;
  function milestoneCheckpointStatus(ageMonths, checkpoint, achievedMap) {
    achievedMap = achievedMap || {};
    var done = checkpoint.items.filter(function (i) { return !!achievedMap[i.code]; }).length;
    var total = checkpoint.items.length, status;
    if (done === total) status = 'complete';
    else if (ageMonths < checkpoint.months) status = 'upcoming';
    else if (ageMonths < checkpoint.months + MILESTONE_GRACE_MONTHS) status = 'in_progress';
    else status = 'discuss';
    return { months: checkpoint.months, status: status, done: done, total: total };
  }

  /* ---- WHO growth standards (LMS), birth–60 months -------------------------------
     indicator: 'wfa' weight-for-age (kg) | 'lhfa' length/height-for-age (cm) |
                'hcfa' head-circumference-for-age (cm)
     The WHO standards are published for boys and girls only, so a child whose sex is
     'other' has no reference (every function returns null rather than guessing).
     Ages are in months — pass chartAgeMonths() so early-born babies use corrected age.
     ------------------------------------------------------------------------------- */
  var GROWTH_MAX_MONTHS = WHO.MAX_MONTHS;
  var WFA_MAX_MONTHS = GROWTH_MAX_MONTHS;
  var GROWTH_INDICATORS = {
    wfa:  { key: 'weight_kg', label: 'Weight', unit: 'kg' },
    lhfa: { key: 'height_cm', label: 'Height', unit: 'cm' },
    hcfa: { key: 'head_cm',   label: 'Head circumference', unit: 'cm' }
  };

  function lmsTable(indicator, sex) { return WHO.LMS[indicator + '_' + sex] || null; }

  // [L, M, S] at a (fractional) age, linearly interpolated between the monthly rows.
  function lmsAt(indicator, sex, months) {
    var t = lmsTable(indicator, sex);
    if (!t || !isFinite(months) || months < 0 || months > GROWTH_MAX_MONTHS) return null;
    var i = Math.min(Math.floor(months), t.length - 2), f = months - i;
    return [0, 1, 2].map(function (k) { return t[i][k] + (t[i + 1][k] - t[i][k]) * f; });
  }

  function growthZ(indicator, sex, months, value) {
    var p = lmsAt(indicator, sex, months);
    if (!p || !isFinite(value) || value <= 0) return null;
    var L = p[0], M = p[1], S = p[2];
    return L === 0 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
  }

  function growthValueAtZ(indicator, sex, months, z) {
    var p = lmsAt(indicator, sex, months);
    if (!p) return null;
    var L = p[0], M = p[1], S = p[2];
    return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  }

  // Standard normal CDF (Abramowitz & Stegun 7.1.26), as a percentile 0..100.
  function zToPercentile(z) {
    var a = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * a);
    var erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return 100 * 0.5 * (1 + (z < 0 ? -erf : erf));
  }

  // 'severe' (z < -3) | 'low' (< -2) | 'high' (> +2; > +3 for length/height, where tall is rarely a concern)
  // | 'ok' | null when there is no reference.
  function growthStatus(indicator, z) {
    if (z == null || !isFinite(z)) return null;
    if (z < -3) return 'severe';
    if (z < -2) return 'low';
    if (z > (indicator === 'lhfa' ? 3 : 2)) return 'high';
    return 'ok';
  }

  // One reading, fully interpreted: { z, percentile, status } or null.
  function growthAssess(indicator, sex, months, value) {
    var z = growthZ(indicator, sex, months, value);
    if (z == null) return null;
    return { z: z, percentile: zToPercentile(z), status: growthStatus(indicator, z) };
  }

  // Reference lines for a chart: { '-3': [{m, v}...], '-2': ..., '0': ..., '2': ..., '3': ... }
  var CURVE_ZS = [-3, -2, 0, 2, 3];
  function growthCurves(indicator, sex, fromMonth, toMonth, step) {
    if (!lmsTable(indicator, sex)) return null;
    var lo = Math.max(0, fromMonth), hi = Math.min(GROWTH_MAX_MONTHS, toMonth), out = {};
    step = step || 1;
    CURVE_ZS.forEach(function (z) {
      out[z] = [];
      for (var m = lo; m <= hi + 1e-9; m += step) out[z].push({ m: m, v: growthValueAtZ(indicator, sex, m, z) });
    });
    return out;
  }

  // Back-compatible weight helpers (the notification centre and the doctor's summary use these).
  function weightReference(sex, months) {
    if (!lmsAt('wfa', sex, months)) return null;
    return { median: growthValueAtZ('wfa', sex, months, 0), minus2: growthValueAtZ('wfa', sex, months, -2), minus3: growthValueAtZ('wfa', sex, months, -3) };
  }
  // 'severe' (< -3 SD) | 'low' (< -2 SD) | 'ok' | null when there is no reference
  function weightStatus(sex, months, kg) {
    var s = growthStatus('wfa', growthZ('wfa', sex, months, kg));
    return s === 'high' ? 'ok' : s;
  }

  /* ---- Paediatric health events (the medical-history log) ------------------- */
  var HEALTH_EVENT_TYPES = [
    ['checkup', 'Check-up'], ['illness', 'Illness'], ['injury', 'Injury'],
    ['hospitalisation', 'Hospital stay'], ['surgery', 'Surgery / procedure'],
    ['allergy', 'Allergy / reaction'], ['medication', 'Medication'], ['note', 'Note']
  ];
  var HEALTH_EVENT_CODES = {};
  HEALTH_EVENT_TYPES.forEach(function (t) { HEALTH_EVENT_CODES[t[0]] = t[1]; });

  /* ---- Health timeline -------------------------------------------------------
     Merges everything recorded for one child into a single newest-first list.
       input: { child, vaccinations: [{vaccine_code, given_on, facility}], growth: [...],
                milestones: [{milestone_code, achieved_on}], events: [{id, event_type, title,
                details, event_date, doctor_name, facility}], appointments: [{id, requested_date,
                status, reason, doctor_name, doctor_notes}] }
       -> [{ type, date, title, detail, upcoming, refId }]
       type: birth | vaccine | growth | milestone | health | appointment
     Appointments dated after `todayISO` are marked upcoming and cancelled ones are left out.
     ------------------------------------------------------------------------- */
  var MILESTONE_TEXT = {};
  MILESTONES.forEach(function (c) { c.items.forEach(function (i) { MILESTONE_TEXT[i.code] = i.text; }); });
  var TYPE_ORDER = { appointment: 0, health: 1, vaccine: 2, growth: 3, milestone: 4, birth: 5 };

  function buildTimeline(input, todayISO) {
    var child = input.child, out = [];
    var join = function (parts) { return parts.filter(Boolean).join(' · '); };

    var birth = [];
    if (child.born_at_weeks) birth.push('born at ' + child.born_at_weeks + ' weeks');
    if (child.birth_weight_kg != null) birth.push(child.birth_weight_kg + ' kg');
    if (child.birth_length_cm != null) birth.push(child.birth_length_cm + ' cm');
    out.push({ type: 'birth', date: child.date_of_birth, title: child.name + ' was born', detail: join(birth), upcoming: false, refId: null });

    (input.vaccinations || []).forEach(function (v) {
      var def = VACCINE_BY_CODE[v.vaccine_code];
      out.push({ type: 'vaccine', date: v.given_on, title: (def ? def.name : v.vaccine_code) + ' given',
        detail: join([def && def.stage, v.facility || v.hospital_or_doctor]), upcoming: false, refId: v.vaccine_code });
    });

    (input.growth || []).forEach(function (g) {
      var parts = [];
      if (g.weight_kg != null) parts.push(g.weight_kg + ' kg');
      if (g.height_cm != null) parts.push(g.height_cm + ' cm');
      if (g.head_cm != null) parts.push('head ' + g.head_cm + ' cm');
      out.push({ type: 'growth', date: g.measured_on, title: 'Growth measured', detail: parts.join(' · '), upcoming: false, refId: g.id });
    });

    (input.milestones || []).forEach(function (m) {
      out.push({ type: 'milestone', date: m.achieved_on, title: 'Milestone reached', detail: MILESTONE_TEXT[m.milestone_code] || m.milestone_code, upcoming: false, refId: m.milestone_code });
    });

    (input.events || []).forEach(function (e) {
      out.push({ type: 'health', date: e.event_date, title: e.title, detail: join([HEALTH_EVENT_CODES[e.event_type], e.doctor_name, e.facility, e.details]),
        upcoming: false, refId: e.id, eventType: e.event_type });
    });

    (input.appointments || []).forEach(function (a) {
      if (a.status === 'cancelled') return;
      var upcoming = a.requested_date >= todayISO && a.status !== 'completed';
      out.push({ type: 'appointment', date: a.requested_date,
        title: (upcoming ? 'Appointment' : 'Visit') + (a.doctor_name ? ' with Dr. ' + a.doctor_name : ''),
        detail: join([a.reason, a.status === 'pending' ? 'awaiting confirmation' : a.status === 'completed' ? 'completed' : '', a.doctor_notes ? 'Doctor’s note: ' + a.doctor_notes : '']),
        upcoming: upcoming, refId: a.id, status: a.status });
    });

    return out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    });
  }

  var CHILD_DANGER_SIGNS = [
    'Cannot drink or breastfeed, or vomits everything',
    'Fits (convulsions)',
    'Very sleepy, limp or hard to wake',
    'Fast or difficult breathing, or the chest pulling in',
    'Fever in a baby under 3 months, or a high fever that does not come down',
    'Sunken eyes, no tears or very few wet nappies (signs of dehydration)',
    'Blood in the stool, or diarrhoea that goes on for days'
  ];

  return {
    parseISO: parseISO, toISO: toISO, daysBetween: daysBetween, addDaysISO: addDaysISO,
    ageParts: ageParts, ageText: ageText, chartAgeMonths: chartAgeMonths,
    VACCINES: VACCINES, VACCINE_BY_CODE: VACCINE_BY_CODE, DUE_SOON_DAYS: DUE_SOON_DAYS,
    REMINDER_LEAD_DAYS: REMINDER_LEAD_DAYS, SCHEDULE_SOURCE: SCHEDULE_SOURCE,
    vaccineStatus: vaccineStatus, vaccineSchedule: vaccineSchedule, summarizeSchedule: summarizeSchedule,
    upcomingVaccines: upcomingVaccines,
    MILESTONES: MILESTONES, MILESTONE_CODES: MILESTONE_CODES, MILESTONE_GRACE_MONTHS: MILESTONE_GRACE_MONTHS,
    milestoneCheckpointStatus: milestoneCheckpointStatus,
    GROWTH_MAX_MONTHS: GROWTH_MAX_MONTHS, WFA_MAX_MONTHS: WFA_MAX_MONTHS, GROWTH_INDICATORS: GROWTH_INDICATORS,
    growthZ: growthZ, growthValueAtZ: growthValueAtZ, zToPercentile: zToPercentile, growthStatus: growthStatus,
    growthAssess: growthAssess, growthCurves: growthCurves,
    weightReference: weightReference, weightStatus: weightStatus,
    HEALTH_EVENT_TYPES: HEALTH_EVENT_TYPES, HEALTH_EVENT_CODES: HEALTH_EVENT_CODES, buildTimeline: buildTimeline,
    CHILD_DANGER_SIGNS: CHILD_DANGER_SIGNS
  };
});
