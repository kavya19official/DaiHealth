/* ==========================================================================
   Anvaya — postpartum pathway rules, shared by browser and Node.

   The pregnancy half of the care timeline is seeded from a template, but after
   delivery the mother previously had one line of text. This file is the
   postpartum equivalent: what contacts should happen and when, what to expect
   in each phase, and how a daily check-in is turned into a red-flag level.

   Same pattern as shared/child-reference.js: day arithmetic on 'YYYY-MM-DD'
   strings (UTC) so a delivery date can never shift by a day with the viewer's
   time zone, and the server re-evaluates every check-in itself.

   Sources (paraphrased; clinician review needed before real-world use):
     • Contact schedule — WHO postnatal care recommendations (first 24 h, day 3,
       days 7–14, week 6) plus an early blood-pressure check, since high blood
       pressure can first appear or worsen in the first days after birth.
     • Warning signs    — CDC "Hear Her" urgent maternal warning signs.
     • Mood screen      — PHQ-2 (public domain). A positive screen is a prompt to
       talk to a clinician, not a diagnosis.
     • Baby danger signs — WHO IMNCI signs for young infants.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnvayaPostpartum = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- Dates ------------------------------------------------------------- */
  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function daysBetween(fromISO, toISO) {
    var a = parseISO(fromISO), b = parseISO(toISO);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : NaN;
  }
  function addDaysISO(iso, n) {
    var t = parseISO(iso);
    return Number.isFinite(t) ? new Date(t + n * 86400000).toISOString().slice(0, 10) : null;
  }

  /* ---- Contact schedule -------------------------------------------------- */
  /* from/to are days since delivery. "overdue" means the window has closed and
     nobody recorded it — the app can't know whether it happened. */
  var CONTACTS = [
    { code: 'pnc_24h',  title: 'Check in the first 24 hours', from: 0,  to: 1,  why: 'Bleeding, blood pressure, feeding and baby are checked before or soon after going home.' },
    { code: 'pnc_day3', title: 'Postnatal visit — day 3',      from: 2,  to: 4,  why: 'Early problems with bleeding, wounds, feeding and infection tend to show up now.' },
    { code: 'bp_check', title: 'Blood pressure check',          from: 3,  to: 10, why: 'High blood pressure can first appear, or get worse, in the first week or two after birth — even if it was normal in pregnancy.' },
    { code: 'pnc_week2', title: 'Postnatal visit — week 1–2',   from: 7,  to: 14, why: 'Checks recovery, wound healing, feeding and how you are coping.' },
    { code: 'pnc_week6', title: 'Six-week postnatal visit',     from: 42, to: 56, why: 'Full recovery check including mood, contraception, anaemia and a plan for any long-term conditions.' }
  ];

  function contactStatus(contact, daysPP, doneOn) {
    if (doneOn) return 'done';
    if (!Number.isFinite(daysPP) || daysPP < contact.from) return 'upcoming';
    if (daysPP <= contact.to) return 'open';
    return 'overdue';
  }

  function schedule(deliveryISO, todayISO, doneMap) {
    var daysPP = daysBetween(deliveryISO, todayISO);
    doneMap = doneMap || {};
    return CONTACTS.map(function (c) {
      return {
        code: c.code, title: c.title, why: c.why,
        window_start: addDaysISO(deliveryISO, c.from), window_end: addDaysISO(deliveryISO, c.to),
        status: contactStatus(c, daysPP, doneMap[c.code] || null), done_on: doneMap[c.code] || null
      };
    });
  }

  /* ---- Phases ------------------------------------------------------------ */
  var PHASES = [
    { code: 'first_24h', from: 0, to: 1, title: 'The first day',
      expect: ['Bleeding is heaviest now and slowly eases.', 'Afterpains (cramps) are common, especially while feeding.'],
      focus: ['Start breastfeeding early and keep the baby close, skin to skin.', 'Tell the nurse or doctor if you soak a pad in an hour or feel faint.', 'Pass urine and keep drinking fluids.'] },
    { code: 'first_week', from: 2, to: 7, title: 'The first week',
      expect: ['Bleeding stays red and then slowly lightens.', 'Tiredness, sore breasts and mood swings are common.'],
      focus: ['Get your blood pressure checked this week.', 'Keep stitches or the C-section wound clean and dry.', 'Rest whenever the baby sleeps, and eat and drink regularly.'] },
    { code: 'early_weeks', from: 8, to: 42, title: 'Weeks 2 to 6',
      expect: ['Bleeding turns pink/brown and then stops over several weeks.', 'Feeling low or tearful in the first two weeks is common.'],
      focus: ['Low mood that lasts beyond two weeks, or feels heavy, deserves a conversation with your doctor.', 'Ask about iron and calcium supplements.', 'Plan the six-week visit and ask about contraception.'] },
    { code: 'fourth_trimester', from: 43, to: 84, title: 'Weeks 7 to 12',
      expect: ['Energy slowly returns; sleep is still broken.', 'Periods may come back, especially if you are not exclusively breastfeeding.'],
      focus: ['Finish any pending tests or follow-ups from the six-week visit.', 'Keep the baby\'s vaccines on schedule — see the Child section.'] },
    { code: 'beyond', from: 85, to: 100000, title: 'Beyond 12 weeks',
      expect: ['Recovery continues; some changes take months.'],
      focus: ['Mood, pain or bleeding that still worries you is worth a visit at any time.'] }
  ];
  function phaseFor(daysPP) {
    if (!Number.isFinite(daysPP) || daysPP < 0) return null;
    for (var i = 0; i < PHASES.length; i++) if (daysPP >= PHASES[i].from && daysPP <= PHASES[i].to) return PHASES[i];
    return null;
  }

  /* Postpartum health is relevant for 12 weeks in the dashboard; check-ins stay open a little longer. */
  var CHECKIN_MAX_DAYS = 100;

  var BABY_DANGER_SIGNS = [
    'Not feeding well or has stopped feeding',
    'Fits (convulsions)',
    'Fast breathing (60 or more breaths a minute) or the chest pulling in hard',
    'Fever (37.5°C / 99.5°F or above) or feels very cold (below 35.5°C / 96°F)',
    'Moves only when touched, or does not move at all',
    'Yellow skin on the first day of life, or yellow palms and soles at any age'
  ];

  /* ---- Check-in ---------------------------------------------------------- */
  var BLEEDING = ['none', 'light', 'moderate', 'heavy'];
  var BOOLS = ['large_clots', 'headache_severe', 'vision_changes', 'chest_or_breath', 'calf_pain', 'fits_or_faint',
    'wound_problem', 'foul_discharge', 'breast_problem', 'baby_concern', 'self_harm'];

  function intOrNull(v, min, max) {
    if (v === undefined || v === null || v === '') return { v: null };
    var n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) return { error: true };
    return { v: n };
  }
  function numOrNull(v, min, max) {
    if (v === undefined || v === null || v === '') return { v: null };
    var n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return { error: true };
    return { v: Math.round(n * 10) / 10 };
  }

  /* Returns { answers } holding only whitelisted keys, or { error }. */
  function sanitizeCheckin(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var a = {};
    var bleeding = raw.bleeding == null ? 'none' : raw.bleeding;
    if (BLEEDING.indexOf(bleeding) < 0) return { error: 'Choose how much you are bleeding' };
    a.bleeding = bleeding;

    var pain = intOrNull(raw.pain, 0, 10);
    if (pain.error) return { error: 'Pain must be a whole number from 0 to 10' };
    a.pain = pain.v == null ? 0 : pain.v;

    var t = numOrNull(raw.temp_f, 90, 110);
    if (t.error) return { error: 'Temperature must be between 90 and 110 °F' };
    a.temp_f = t.v;

    var sys = intOrNull(raw.bp_systolic, 60, 260), dia = intOrNull(raw.bp_diastolic, 30, 160);
    if (sys.error || dia.error) return { error: 'Blood pressure: systolic 60–260 and diastolic 30–160' };
    if ((sys.v == null) !== (dia.v == null)) return { error: 'Enter both blood pressure numbers, or neither' };
    if (sys.v != null && sys.v <= dia.v) return { error: 'The top blood-pressure number must be higher than the bottom one' };
    a.bp_systolic = sys.v; a.bp_diastolic = dia.v;

    var p1 = intOrNull(raw.phq2_interest, 0, 3), p2 = intOrNull(raw.phq2_mood, 0, 3);
    if (p1.error || p2.error) return { error: 'Mood questions must be answered 0–3' };
    if ((p1.v == null) !== (p2.v == null)) return { error: 'Answer both mood questions, or neither' };
    a.phq2_interest = p1.v; a.phq2_mood = p2.v;

    BOOLS.forEach(function (k) { a[k] = raw[k] === true || raw[k] === 'true' || raw[k] === 1; });
    return { answers: a };
  }

  var LEVEL_ORDER = { ok: 0, watch: 1, urgent: 2, emergency: 3 };

  /**
   * @param {object} a    sanitized answers
   * @param {object} ctx  { daysPP }
   * @returns {{level, flags: [{code,label,level,action}], headline}}
   */
  function evaluateCheckin(a, ctx) {
    ctx = ctx || {};
    var flags = [];
    function add(code, label, level, action) { flags.push({ code: code, label: label, level: level, action: action }); }

    var bpHigh = a.bp_systolic != null && (a.bp_systolic >= 140 || a.bp_diastolic >= 90);
    var bpSevere = a.bp_systolic != null && (a.bp_systolic >= 160 || a.bp_diastolic >= 110);

    if (a.self_harm) add('self_harm', 'Thoughts of harming yourself or your baby', 'emergency', 'Please do not stay alone. Tell someone with you now and call 112 or Tele-MANAS 14416. Make sure the baby is safe with another adult.');
    if (a.fits_or_faint) add('fits_or_faint', 'Fit, fainting or collapse', 'emergency', 'Call 112 now. Do not travel alone.');
    if (a.chest_or_breath) add('chest_or_breath', 'Chest pain or trouble breathing', 'emergency', 'Call 112 now. Sit upright and do not walk.');
    if (a.bleeding === 'heavy') add('heavy_bleeding', 'Heavy bleeding (a pad soaked in an hour or less)', 'emergency', 'Call 112 now. Lie down with your legs raised.');
    if (bpSevere) add('bp_severe', 'Blood pressure ' + a.bp_systolic + '/' + a.bp_diastolic + ' is in the severe range', 'emergency', 'Call 112 now. Do not wait to recheck.');
    if (a.headache_severe && (a.vision_changes || bpHigh)) add('headache_bp_vision', 'Severe headache with ' + (a.vision_changes ? 'vision changes' : 'high blood pressure'), 'emergency', 'Call 112 now — this can be a sign of dangerously high blood pressure.');

    if (bpHigh && !bpSevere) add('bp_high', 'Blood pressure ' + a.bp_systolic + '/' + a.bp_diastolic + ' is high', 'urgent', 'Speak to your doctor or go to a facility today. Recheck after resting 5 minutes. If you get a headache or vision changes, call 112.');
    if (a.headache_severe && !(a.vision_changes || bpHigh)) add('headache', 'Severe headache', 'urgent', 'Speak to your doctor today and check your blood pressure.');
    if (a.vision_changes && !a.headache_severe) add('vision', 'Changes in vision', 'urgent', 'Speak to your doctor today and check your blood pressure.');
    if (a.temp_f != null && a.temp_f >= 100.4) add('fever', 'Fever (' + a.temp_f + '°F)', 'urgent', 'Speak to your doctor today — fever after birth can mean an infection.');
    if (a.calf_pain) add('calf_pain', 'One leg painful, swollen or warm', 'urgent', 'Go to a facility today. Rest the leg and do not massage it.');
    if (a.wound_problem) add('wound', 'Wound problem (opening, pus or spreading redness)', 'urgent', 'Have the wound checked today.');
    if (a.foul_discharge) add('foul_discharge', 'Foul-smelling discharge', 'urgent', 'Speak to your doctor today.');
    if (a.large_clots && a.bleeding !== 'heavy') add('clots', 'Passing large clots (egg-sized or bigger)', 'urgent', 'Speak to your doctor today.');
    if (a.pain >= 8) add('pain_severe', 'Severe pain (' + a.pain + '/10)', 'urgent', 'Speak to your doctor today if pain relief is not working.');
    if (a.breast_problem) add('breast', 'Painful, red or hard breast', a.temp_f != null && a.temp_f >= 100.4 ? 'urgent' : 'watch', 'Keep feeding or expressing, and have it checked soon — today if you have a fever.');
    if (a.baby_concern) add('baby', 'Worried about your baby', 'urgent', 'Take the baby to a doctor today. Check the baby warning signs below.');

    if (a.bp_systolic != null && !bpHigh && (a.bp_systolic >= 130 || a.bp_diastolic >= 80)) add('bp_borderline', 'Blood pressure ' + a.bp_systolic + '/' + a.bp_diastolic + ' is a little higher than ideal', 'watch', 'Rest, then recheck later today and mention it at your next visit.');
    if (a.pain >= 6 && a.pain < 8) add('pain_moderate', 'Pain ' + a.pain + '/10', 'watch', 'Ask your doctor about safe pain relief.');
    if (a.bleeding === 'moderate' && ctx.daysPP > 14) add('bleeding_late', 'Bleeding is heavier than expected at this stage', 'watch', 'Mention it to your doctor this week.');
    if (a.phq2_interest != null && a.phq2_interest + a.phq2_mood >= 3) add('mood', 'Your mood answers suggest it may help to talk to someone', 'watch', 'Many new mothers feel this way, and it is treatable. Talk to your doctor this week. Tele-MANAS 14416 is free if you want to talk now.');

    var level = 'ok';
    flags.forEach(function (f) { if (LEVEL_ORDER[f.level] > LEVEL_ORDER[level]) level = f.level; });
    flags.sort(function (x, y) { return LEVEL_ORDER[y.level] - LEVEL_ORDER[x.level]; });

    var headline = {
      emergency: 'Get emergency help now',
      urgent: 'Please speak to a doctor or visit a facility today',
      watch: 'Worth keeping an eye on and mentioning to your doctor',
      ok: 'Nothing worrying in today\'s answers'
    }[level];
    return { level: level, flags: flags, headline: headline };
  }

  return {
    CONTACTS: CONTACTS, PHASES: PHASES, BABY_DANGER_SIGNS: BABY_DANGER_SIGNS, CHECKIN_MAX_DAYS: CHECKIN_MAX_DAYS,
    daysBetween: daysBetween, addDaysISO: addDaysISO,
    contactStatus: contactStatus, schedule: schedule, phaseFor: phaseFor,
    sanitizeCheckin: sanitizeCheckin, evaluateCheckin: evaluateCheckin, LEVEL_ORDER: LEVEL_ORDER
  };
});
