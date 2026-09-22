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
     • Growth     — WHO Child Growth Standards, weight-for-age, birth–12 months.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnvayaChild = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
      ['m24_run',   'movement', 'Runs and tries to kick a ball']] }
  ].map(function (c) {
    return { months: c.months, label: c.months + ' months', items: c.items.map(function (i) { return { code: i[0], domain: i[1], text: i[2] }; }) };
  });
  var MILESTONE_CODES = {};
  MILESTONES.forEach(function (c) { c.items.forEach(function (i) { MILESTONE_CODES[i.code] = c.months; }); });

  /* ---- WHO weight-for-age, months 0..12 (kg) ------------------------------------
     minus3 / minus2 = the -3 SD and -2 SD lines, median = the 50th percentile.
     ------------------------------------------------------------------------------- */
  var WHO_WFA = {
    male: {
      median: [3.3, 4.5, 5.6, 6.4, 7.0, 7.5, 7.9, 8.3, 8.6, 8.9, 9.2, 9.4, 9.6],
      minus2: [2.5, 3.4, 4.3, 5.0, 5.6, 6.0, 6.4, 6.7, 6.9, 7.1, 7.4, 7.6, 7.7],
      minus3: [2.1, 2.9, 3.8, 4.4, 4.9, 5.3, 5.7, 5.9, 6.2, 6.4, 6.6, 6.8, 6.9]
    },
    female: {
      median: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.6, 7.9, 8.2, 8.5, 8.7, 8.9],
      minus2: [2.4, 3.2, 3.9, 4.5, 5.0, 5.4, 5.7, 6.0, 6.3, 6.5, 6.7, 6.9, 7.0],
      minus3: [2.0, 2.7, 3.3, 3.9, 4.4, 4.8, 5.1, 5.3, 5.6, 5.8, 5.9, 6.1, 6.2]
    }
  };
  var WFA_MAX_MONTHS = 12;

  function interp(arr, months) {
    var m = Math.min(Math.max(months, 0), arr.length - 1), i = Math.floor(m), f = m - i;
    return i >= arr.length - 1 ? arr[arr.length - 1] : arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  // Reference values at an age, or null outside 0-12 months / unknown sex.
  function weightReference(sex, months) {
    var t = WHO_WFA[sex];
    if (!t || !isFinite(months) || months < 0 || months > WFA_MAX_MONTHS) return null;
    return { median: interp(t.median, months), minus2: interp(t.minus2, months), minus3: interp(t.minus3, months) };
  }

  // 'severe' (< -3 SD) | 'low' (< -2 SD) | 'ok' | null when there is no reference
  function weightStatus(sex, months, kg) {
    var r = weightReference(sex, months);
    if (!r || !isFinite(kg)) return null;
    if (kg < r.minus3) return 'severe';
    if (kg < r.minus2) return 'low';
    return 'ok';
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
    vaccineStatus: vaccineStatus, vaccineSchedule: vaccineSchedule, summarizeSchedule: summarizeSchedule,
    MILESTONES: MILESTONES, MILESTONE_CODES: MILESTONE_CODES,
    WHO_WFA: WHO_WFA, WFA_MAX_MONTHS: WFA_MAX_MONTHS, weightReference: weightReference, weightStatus: weightStatus,
    CHILD_DANGER_SIGNS: CHILD_DANGER_SIGNS
  };
});
