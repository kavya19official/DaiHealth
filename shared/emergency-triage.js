/* ==========================================================================
   Anvaya — emergency triage + emergency summary, shared by browser and Node.

   Why this lives in /shared and is plain JS with no dependencies: the SOS flow
   has to keep working when the network is slow or down, so the browser runs the
   same code the server does (window.AnvayaEmergency / require()). The server
   re-runs it when an event is saved, so what is stored never depends on what
   the client claims.

   What this does NOT do, on purpose:
     • It never diagnoses. Labels say "may be a sign of …", and the headline
       action is the same for everyone with the same symptoms.
     • It never states or implies that a hospital has been told, has accepted
       the patient, or has a bed. There is no source for that information in
       this app, and a wrong "accepted" is worse than no message.
     • It never invents values. Anything not recorded is printed as
       "Not recorded", and every logged value carries how old it is.

   Symptom wording follows the CDC "Hear Her" urgent maternal warning signs and
   WHO danger signs, paraphrased. Clinician review is needed before real-world
   use — the thresholds are in one table (SYMPTOMS) so they are easy to audit.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnvayaEmergency = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* India. 112 is the national number; 108 (emergency ambulance) is not
     available in every state, and 102 is mainly a patient-transport service for
     pregnant women and infants. Kept in one place so a deployment can override. */
  var NUMBERS = {
    national: { number: '112', label: 'National emergency number' },
    ambulance: { number: '108', label: 'Emergency ambulance (not in every state)' },
    maternal_transport: { number: '102', label: 'Free transport for pregnant women & infants (where available)' },
    mental_health: { number: '14416', label: 'Tele-MANAS mental health helpline' }
  };

  var LEVEL_ORDER = { unsure: 0, urgent: 1, emergency: 2 };

  /* context: 'pregnant' | 'postpartum' | 'both'. level: 'emergency' = call for an
     ambulance and do not travel alone; 'urgent' = speak to a doctor / go to a
     facility today, do not wait. */
  var SYMPTOMS = [
    // ---- both ----------------------------------------------------------------
    { code: 'heavy_bleeding', context: 'both', level: 'emergency',
      label: 'Heavy bleeding (soaking a pad in an hour or less)',
      why: 'Heavy bleeding can become dangerous quickly.',
      firstAid: ['Lie down and keep your legs slightly raised.', 'Do not put anything into the vagina.', 'Keep the soaked pads or cloths to show the doctor.'] },
    { code: 'seizure', context: 'both', level: 'emergency',
      label: 'Fit / seizure',
      why: 'A fit in pregnancy or after birth needs emergency care.',
      firstAid: ['Companion: move hard or sharp things away and lay her on her left side.', 'Do not put anything in her mouth and do not hold her down.', 'Note the time it started and stay with her.'] },
    { code: 'severe_headache_vision', context: 'both', level: 'emergency',
      label: 'Severe headache that will not go away, or blurred vision / flashing lights',
      why: 'Can be a sign of dangerously high blood pressure.',
      firstAid: ['Rest in a quiet place and do not take other medicines unless a doctor has told you to.'] },
    { code: 'chest_breath', context: 'both', level: 'emergency',
      label: 'Chest pain or difficulty breathing',
      why: 'Needs to be checked in an emergency setting.',
      firstAid: ['Sit upright and loosen tight clothing.', 'Do not walk or climb stairs.'] },
    { code: 'fainting', context: 'both', level: 'emergency',
      label: 'Fainted, cannot stay awake, or very confused',
      why: 'Can be a sign of blood loss or other serious problems.',
      firstAid: ['Lay her down on her left side with legs raised if she is pregnant.', 'Do not give food or drink if she is not fully awake.'] },
    { code: 'severe_abdominal_pain', context: 'both', level: 'emergency',
      label: 'Severe belly pain that does not ease',
      why: 'Severe, constant belly pain needs urgent assessment.',
      firstAid: ['Do not eat or drink until a doctor has seen her.'] },
    { code: 'fever', context: 'both', level: 'urgent',
      label: 'Fever of 100.4°F (38°C) or higher, or shaking chills',
      why: 'Fever can be a sign of infection that needs treatment.', firstAid: [] },
    // ---- pregnancy ------------------------------------------------------------
    { code: 'bleeding_any', context: 'pregnant', level: 'urgent',
      label: 'Any vaginal bleeding in pregnancy',
      why: 'Bleeding in pregnancy should always be checked the same day.', firstAid: ['Use a pad (not a tampon) so the amount can be seen.'] },
    { code: 'reduced_movement', context: 'pregnant', level: 'urgent',
      label: 'Baby moving much less than usual, or not at all',
      why: 'A change in baby\'s movements should be checked the same day, not the next morning.', firstAid: [] },
    { code: 'waters_break', context: 'pregnant', level: 'urgent', preterm: true,
      label: 'Waters broke or fluid is leaking',
      why: 'The facility should check this soon, especially if it is early or the fluid is green, brown or smells bad.', firstAid: ['Wear a clean pad and note the time and colour.'] },
    { code: 'contractions', context: 'pregnant', level: 'urgent', preterm: true,
      label: 'Regular painful tightenings (about every 5 minutes for an hour)',
      why: 'May be labour. Before 37 weeks this needs emergency care.', firstAid: [] },
    { code: 'swelling_sudden', context: 'pregnant', level: 'urgent',
      label: 'Sudden swelling of face or hands',
      why: 'Sudden swelling can go with high blood pressure.', firstAid: [] },
    { code: 'vomiting_cannot_drink', context: 'pregnant', level: 'urgent',
      label: 'Vomiting so much she cannot keep fluids down',
      why: 'Dehydration can build up fast in pregnancy.', firstAid: ['Take small sips of oral rehydration solution if she can.'] },
    // ---- after birth ----------------------------------------------------------
    { code: 'pp_self_harm', context: 'postpartum', level: 'emergency',
      label: 'Thoughts of harming myself or my baby',
      why: 'You are not alone, and help works. This needs support right now.',
      firstAid: ['Do not stay alone — tell someone near you right now.', 'Make sure the baby is somewhere safe with another adult.'] },
    { code: 'pp_calf', context: 'postpartum', level: 'urgent',
      label: 'One leg painful, swollen, red or warm',
      why: 'May be a blood clot, which needs a same-day check.', firstAid: ['Rest the leg and do not massage it.'] },
    { code: 'pp_wound', context: 'postpartum', level: 'urgent',
      label: 'Stitches / C-section wound opened, leaking pus, or spreading redness',
      why: 'May be a wound infection.', firstAid: [] },
    { code: 'pp_foul_discharge', context: 'postpartum', level: 'urgent',
      label: 'Foul-smelling vaginal discharge',
      why: 'May be an infection of the womb.', firstAid: [] },
    { code: 'pp_breast', context: 'postpartum', level: 'urgent',
      label: 'Red, hard, very painful breast with fever',
      why: 'May be a breast infection.', firstAid: [] }
  ];

  var BY_CODE = {};
  SYMPTOMS.forEach(function (s) { BY_CODE[s.code] = s; });

  function appliesTo(sym, context) { return sym.context === 'both' || sym.context === context; }

  function symptomsFor(context) {
    return SYMPTOMS.filter(function (s) { return appliesTo(s, context); }).map(function (s) {
      return { code: s.code, label: s.label, level: s.level };
    });
  }

  /* Effective level for a symptom given context. Early labour signs (before 37
     weeks) are emergencies; an unknown gestation does NOT downgrade them. */
  function levelFor(sym, ctx) {
    if (sym.preterm) {
      var w = ctx && Number.isFinite(ctx.gestWeeks) ? ctx.gestWeeks : null;
      if (w == null || w < 37) return 'emergency';
    }
    return sym.level;
  }

  /* A recently logged BP can raise the level on its own (≥160/110 is the
     severe range; ≥140/90 is high). Only counts if the reading is ≤24 h old —
     an old reading says nothing about right now. */
  function derivedFromVitals(ctx) {
    var out = [];
    var bp = ctx && ctx.latestBP;
    if (bp && Number.isFinite(bp.systolic) && Number.isFinite(bp.diastolic) && Number.isFinite(bp.hoursAgo) && bp.hoursAgo <= 24) {
      var ago = Math.max(0, Math.round(bp.hoursAgo)) + ' h ago';
      if (bp.systolic >= 160 || bp.diastolic >= 110) {
        out.push({ code: 'bp_severe', label: 'Your logged blood pressure (' + bp.systolic + '/' + bp.diastolic + ', ' + ago + ') is in the severe range', level: 'emergency',
          why: 'A reading this high needs emergency care.' });
      } else if (bp.systolic >= 140 || bp.diastolic >= 90) {
        out.push({ code: 'bp_high', label: 'Your logged blood pressure (' + bp.systolic + '/' + bp.diastolic + ', ' + ago + ') is high', level: 'urgent',
          why: 'High blood pressure with other symptoms can be serious.' });
      }
    }
    return out;
  }

  function nums(keys) { return keys.map(function (k) { return { key: k, number: NUMBERS[k].number, label: NUMBERS[k].label }; }); }

  /**
   * @param {string[]} codes   selected symptom codes (unknown codes are ignored)
   * @param {object}   ctx     { context: 'pregnant'|'postpartum', gestWeeks?, latestBP?: {systolic, diastolic, hoursAgo} }
   */
  function triage(codes, ctx) {
    ctx = ctx || {};
    var context = ctx.context === 'postpartum' ? 'postpartum' : 'pregnant';
    var seen = {};
    var matched = [];
    (Array.isArray(codes) ? codes : []).forEach(function (c) {
      var s = BY_CODE[c];
      if (!s || seen[c] || !appliesTo(s, context)) return;
      seen[c] = true;
      matched.push({ code: s.code, label: s.label, level: levelFor(s, ctx), why: s.why, firstAid: s.firstAid });
    });
    derivedFromVitals(ctx).forEach(function (d) { matched.push(d); });

    var level = 'unsure';
    matched.forEach(function (m) { if (LEVEL_ORDER[m.level] > LEVEL_ORDER[level]) level = m.level; });

    var headline, steps;
    if (level === 'emergency') {
      headline = 'This needs emergency care now';
      steps = [
        'Call 112 now (or 108 where it is available). Say "pregnant woman" or "new mother", and the main problem.',
        'Do not travel alone and do not drive yourself. Ask the person with you to stay.',
        'Share the emergency summary with the person helping you and take it with you.',
        'Take your health card, reports and phone charger if you can do so without delay.'
      ];
    } else if (level === 'urgent') {
      headline = 'Speak to a doctor or go to a health facility today — do not wait';
      steps = [
        'Call your doctor or the facility now and tell them the symptoms you selected.',
        'Go to the nearest facility today. Ask someone to come with you.',
        'If you get worse, feel faint, or anything on the emergency list appears, call 112 straight away.'
      ];
    } else {
      headline = 'Nothing selected — if you are worried, treat it as urgent';
      steps = [
        'If you feel something is wrong, call your doctor or the facility now. You do not need to be sure.',
        'If it gets worse or you feel faint, call 112.'
      ];
    }

    var firstAid = [];
    matched.forEach(function (m) { (m.firstAid || []).forEach(function (l) { if (firstAid.indexOf(l) < 0) firstAid.push(l); }); });

    var wantMental = matched.some(function (m) { return m.code === 'pp_self_harm'; });
    var numberKeys = level === 'emergency' ? ['national', 'ambulance'] : ['national', 'ambulance', 'maternal_transport'];
    if (wantMental) numberKeys.push('mental_health');

    return {
      level: level,
      headline: headline,
      matched: matched.map(function (m) { return { code: m.code, label: m.label, level: m.level, why: m.why }; }),
      steps: steps,
      firstAid: firstAid,
      numbers: nums(numberKeys),
      disclaimer: 'This is guidance, not a diagnosis. When in doubt, get help.'
    };
  }

  /* ---- Emergency summary ----------------------------------------------------- */

  var NOT_RECORDED = 'Not recorded';

  function agoText(iso, nowMs) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    var mins = Math.round((nowMs - t) / 60000);
    if (mins < 0) return 'just now';
    if (mins < 90) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + ' h ago';
    return Math.round(hrs / 24) + ' days ago';
  }

  function val(v) {
    if (v == null) return NOT_RECORDED;
    var s = String(v).trim();
    return s ? s : NOT_RECORDED;
  }

  /**
   * Builds a structured + plain-text summary for a companion, ambulance crew or
   * facility. `input` fields (all optional): name, age, context, gestWeeks, edd,
   * deliveryDate, daysPostpartum, deliveryType, bloodGroup, allergies,
   * conditions, medications, gravida, parity, previousComplications,
   * riskLevel, riskAssessedAt, latestBP {systolic, diastolic, at},
   * latestGlucose {mg_dl, context, at}, contact {name, phone},
   * plan {facility_name, facility_phone, ...}, symptoms [codes], note.
   */
  function buildSummary(input, nowMs) {
    input = input || {};
    nowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    var tri = triage(input.symptoms || [], { context: input.context, gestWeeks: input.gestWeeks, latestBP: bpWithHours(input.latestBP, nowMs) });
    var isPP = input.context === 'postpartum';

    function withAge(text, at) { var a = at ? agoText(at, nowMs) : null; return a ? text + ' (logged ' + a + ')' : text; }

    var situation = [];
    situation.push({ label: 'Situation', value: isPP ? 'After childbirth' : 'Pregnant' });
    if (isPP) {
      situation.push({ label: 'Days since delivery', value: val(input.daysPostpartum) });
      situation.push({ label: 'Delivery type', value: input.deliveryType && input.deliveryType !== 'unknown' ? input.deliveryType : NOT_RECORDED });
    } else {
      situation.push({ label: 'Gestation', value: Number.isFinite(input.gestWeeks) ? 'about ' + input.gestWeeks + ' weeks (from the dates she entered)' : NOT_RECORDED });
      situation.push({ label: 'Expected due date', value: val(input.edd) });
    }
    situation.push({ label: 'Reported symptoms', value: tri.matched.length ? tri.matched.map(function (m) { return m.label; }).join('; ') : NOT_RECORDED });
    situation.push({ label: 'Her note', value: val(input.note) });

    var history = [
      { label: 'Age', value: val(input.age) },
      { label: 'Blood group', value: val(input.bloodGroup) },
      { label: 'Allergies', value: val(input.allergies) },
      { label: 'Known conditions', value: val(input.conditions) },
      { label: 'Current medicines', value: val(input.medications) },
      { label: 'Pregnancies / births', value: (input.gravida != null || input.parity != null) ? 'G' + val(input.gravida) + ' P' + val(input.parity) : NOT_RECORDED },
      { label: 'Previous complications', value: val(input.previousComplications) }
    ];

    var bp = input.latestBP, gl = input.latestGlucose;
    var readings = [
      { label: 'Last blood pressure', value: bp && Number.isFinite(bp.systolic) ? withAge(bp.systolic + '/' + bp.diastolic + ' mmHg', bp.at) : NOT_RECORDED },
      { label: 'Last blood sugar', value: gl && Number.isFinite(gl.mg_dl) ? withAge(gl.mg_dl + ' mg/dL' + (gl.context ? ' (' + String(gl.context).replace(/_/g, ' ') + ')' : ''), gl.at) : NOT_RECORDED },
      { label: 'App risk screen', value: input.riskLevel ? withAge(input.riskLevel + ' — a screening aid, not a diagnosis', input.riskAssessedAt) : NOT_RECORDED }
    ];

    var plan = input.plan || {};
    var contacts = [
      { label: 'Emergency contact', value: input.contact && (input.contact.name || input.contact.phone) ? [input.contact.name, input.contact.phone].filter(Boolean).join(' · ') : NOT_RECORDED },
      { label: 'Planned facility (her own entry)', value: plan.facility_name ? [plan.facility_name, plan.facility_phone].filter(Boolean).join(' · ') : NOT_RECORDED },
      { label: 'Backup facility (her own entry)', value: plan.backup_facility_name ? [plan.backup_facility_name, plan.backup_facility_phone].filter(Boolean).join(' · ') : NOT_RECORDED }
    ];

    var sections = [
      { title: 'Situation', rows: situation },
      { title: 'Medical background', rows: history },
      { title: 'Recent readings', rows: readings },
      { title: 'People & places', rows: contacts }
    ];

    var disclaimer = 'Prepared from the patient\'s own app records. Values may be out of date or incomplete — please confirm with her. ' +
      'This message does not mean any facility has been informed, has accepted her, or has a bed.';

    var lines = ['EMERGENCY SUMMARY — ' + (input.name || 'Patient') + (Number.isFinite(input.age) ? ', ' + input.age + ' y' : ''),
      'Triage by app: ' + tri.level.toUpperCase() + ' — ' + tri.headline, ''];
    sections.forEach(function (s) {
      lines.push(s.title.toUpperCase());
      s.rows.forEach(function (r) { lines.push('• ' + r.label + ': ' + r.value); });
      lines.push('');
    });
    lines.push(disclaimer);

    return { triage_level: tri.level, name: input.name || null, sections: sections, text: lines.join('\n'), disclaimer: disclaimer, generated_at: new Date(nowMs).toISOString() };
  }

  function bpWithHours(bp, nowMs) {
    if (!bp || !bp.at) return null;
    var t = Date.parse(bp.at);
    if (!Number.isFinite(t)) return null;
    return { systolic: bp.systolic, diastolic: bp.diastolic, hoursAgo: (nowMs - t) / 3600000 };
  }

  /* Whitelist of what a client may tell the server about an event. */
  var EVENT_ACTIONS = ['called_ambulance', 'called_contact', 'called_facility', 'shared_summary', 'left_for_facility', 'reached_facility'];
  var EVENT_OUTCOMES = ['reached_facility', 'treated_at_home', 'false_alarm', 'other'];

  return {
    NUMBERS: NUMBERS, SYMPTOMS: SYMPTOMS, EVENT_ACTIONS: EVENT_ACTIONS, EVENT_OUTCOMES: EVENT_OUTCOMES,
    symptomsFor: symptomsFor, triage: triage, buildSummary: buildSummary, bpWithHours: bpWithHours, agoText: agoText
  };
});
