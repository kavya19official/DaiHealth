/* ==========================================================================
   Golden Hour — emergency pre-alert rules (PROTOTYPE, synthetic demo data only).

   What this file decides, with fixed rules and no language model:
     1. whether a danger-sign check "trips"   -> uses shared/emergency-triage.js
     2. what a receiving facility must have    -> REQUIREMENTS table below
     3. which facility is the nearest CAPABLE  -> pickFacility()
     4. a rough, labelled-as-estimate ETA      -> estimateEta()
     5. the SBAR handover text                 -> buildSBAR()

   Conservative by design:
     - A facility is only eligible if every required capability / service is listed
       as available. A nearer facility that lacks one is skipped, and the skip is
       shown (never silently hidden).
     - Missing data is printed as "Not recorded", never guessed.
     - The text always says: this is a pre-alert, not a diagnosis, not a bed
       reservation, and the patient has been told to call 112 / 108.
   Clinicians review and decide everything clinical. Prototype; not a medical device.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./emergency-triage'));
  else root.GoldenHour = factory(root.AnvayaEmergency);
})(typeof self !== 'undefined' ? self : this, function (EM) {
  'use strict';

  var VERSION = 'golden-hour-rules-v1';
  var NOT_RECORDED = 'Not recorded';
  var PROTOTYPE_LABEL = 'PROTOTYPE — synthetic demonstration. No real hospital, ambulance or clinician is contacted.';

  /* The four signs the one-tap check leads with. Everything else is under "other danger signs". */
  var HERO_CODES = ['heavy_bleeding', 'severe_headache_vision', 'reduced_movement', 'seizure'];
  var HERO_PLAIN = {
    heavy_bleeding: 'Heavy bleeding',
    severe_headache_vision: 'Severe headache or blurred vision',
    reduced_movement: 'Baby moving much less',
    seizure: 'Fit / seizure'
  };

  /* Alerts are only sent when the shared triage says 'emergency' or 'urgent'.
     'unsure' never sends an alert; the person is told to see a doctor today if worried. */
  var ALERTABLE = { emergency: 'emergency', urgent: 'urgent' };

  /* --------------------------------------------------------------------
     REQUIREMENTS: what the receiving facility must have, per danger sign.
       caps      every one required (facility_capabilities, available)
       capsAny   at least one of the group required
       svcs      every one required (facility_services category, available)
       prefer    nice-to-have; never excludes a facility, only noted
     Union across all ticked signs: ALL caps, ALL svcs, and EACH capsAny group.
     Codes not listed fall back to DEFAULT_EMERGENCY / DEFAULT_URGENT.
     -------------------------------------------------------------------- */
  var BASE_EMERGENCY = { caps: ['emergency_maternity'], capsAny: [], svcs: [] };
  var REQUIREMENTS = {
    heavy_bleeding: { caps: ['emergency_maternity', 'blood_transfusion'], capsAny: [], svcs: [], prefer: ['c_section_24x7'], why: 'Heavy bleeding can need blood transfusion and emergency obstetric care.' },
    seizure: { caps: ['emergency_maternity', 'high_risk_pregnancy'], capsAny: [], svcs: [], prefer: ['icu_mother'], why: 'A fit in pregnancy or after birth needs 24x7 emergency maternity and high-risk care.' },
    severe_headache_vision: { caps: ['emergency_maternity'], capsAny: [], svcs: [], prefer: ['high_risk_pregnancy'], why: 'Severe headache or blurred vision can be a sign of very high blood pressure and needs emergency maternity care.' },
    chest_breath: { caps: ['emergency_maternity'], capsAny: [], svcs: [], prefer: ['icu_mother'], why: 'Chest pain or breathing difficulty needs emergency care with intensive support.' },
    fainting: { caps: ['emergency_maternity'], capsAny: [], svcs: [], prefer: ['blood_transfusion'], why: 'Fainting or confusion needs emergency assessment.' },
    severe_abdominal_pain: { caps: ['emergency_maternity'], capsAny: [], svcs: [], prefer: ['c_section_24x7'], why: 'Severe belly pain needs emergency obstetric assessment.' },
    reduced_movement: { caps: [], capsAny: [['high_risk_pregnancy', 'emergency_maternity']], svcs: ['obstetrics', 'ultrasound'], prefer: [], why: 'Reduced baby movement needs obstetric cover and a scan or monitoring.' },
    bleeding_any: { caps: [], capsAny: [['high_risk_pregnancy', 'emergency_maternity']], svcs: ['obstetrics'], prefer: ['blood_transfusion'], why: 'Any bleeding in pregnancy needs obstetric assessment.' },
    waters_break: { caps: [], capsAny: [['emergency_maternity', 'high_risk_pregnancy']], svcs: ['obstetrics'], prefer: [], why: 'Waters breaking needs a facility that can manage labour.', preferSvc: ['nicu'] },
    contractions: { caps: [], capsAny: [['emergency_maternity', 'high_risk_pregnancy']], svcs: ['obstetrics'], prefer: [], why: 'Regular tightenings need a facility that can manage labour.', preferSvc: ['nicu'] },
    swelling_sudden: { caps: [], capsAny: [['high_risk_pregnancy', 'emergency_maternity']], svcs: ['obstetrics'], prefer: [], why: 'Sudden swelling with other signs can go with high blood pressure.' },
    fever: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], preferSvc: ['lab_tests'], why: 'Fever in pregnancy or after birth needs obstetric review.' },
    vomiting_cannot_drink: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], why: 'Vomiting that will not stop needs obstetric review.' },
    pp_calf: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], why: 'A painful swollen leg after birth needs same-day review.' },
    pp_wound: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], why: 'A wound problem after birth needs same-day review.' },
    pp_foul_discharge: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], why: 'Foul discharge after birth needs same-day review.' },
    pp_breast: { caps: [], capsAny: [], svcs: ['obstetrics'], prefer: [], why: 'A hot painful breast with fever needs same-day review.' }
  };
  /* Never shared in a hospital pre-alert automatically; the person is pointed to 112 / Tele-MANAS instead. */
  var NOT_SHARED_CODES = ['pp_self_harm'];

  var CAP_PLAIN = {
    emergency_maternity: '24x7 emergency maternity', high_risk_pregnancy: 'high-risk pregnancy care', c_section_24x7: '24x7 caesarean',
    blood_transfusion: 'blood transfusion', icu_mother: 'maternal intensive care', neonatal_surgery: 'neonatal surgery'
  };
  var SVC_PLAIN = { obstetrics: 'obstetric care', ultrasound: 'ultrasound', lab_tests: 'laboratory tests', nicu: 'newborn intensive care', blood_bank: 'blood bank', emergency: 'emergency department' };

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /** Union of what the ticked signs need. Pure. */
  function requirementsFor(codes, opts) {
    opts = opts || {};
    var caps = [], svcs = [], groups = [], prefer = [], preferSvc = [], reasons = [];
    var usable = (codes || []).filter(function (c) { return NOT_SHARED_CODES.indexOf(c) < 0; });
    usable.forEach(function (code) {
      var r = REQUIREMENTS[code] || (EM.SYMPTOMS.filter(function (s) { return s.code === code && s.level === 'emergency'; }).length ? Object.assign({ why: 'Emergency danger sign.' }, BASE_EMERGENCY) : { caps: [], capsAny: [], svcs: ['obstetrics'], why: 'Needs obstetric review.' });
      caps = caps.concat(r.caps || []);
      svcs = svcs.concat(r.svcs || []);
      (r.capsAny || []).forEach(function (g) { groups.push(g.slice()); });
      prefer = prefer.concat(r.prefer || []);
      preferSvc = preferSvc.concat(r.preferSvc || []);
      reasons.push({ code: code, why: r.why });
    });
    // Preterm labour / waters: newborn intensive care becomes a stated preference, never a gate.
    if (Number.isFinite(opts.gestWeeks) && opts.gestWeeks < 37 && usable.some(function (c) { return c === 'waters_break' || c === 'contractions'; })) preferSvc.push('nicu');
    caps = uniq(caps); svcs = uniq(svcs);
    // A capsAny group already satisfied by a required cap adds nothing.
    groups = groups.filter(function (g) { return !g.some(function (c) { return caps.indexOf(c) >= 0; }); });
    var seen = {}; groups = groups.filter(function (g) { var k = g.slice().sort().join('|'); if (seen[k]) return false; seen[k] = 1; return true; });
    return { caps: caps, capsAny: groups, svcs: svcs, prefer: uniq(prefer).filter(function (c) { return caps.indexOf(c) < 0; }), preferSvc: uniq(preferSvc), reasons: reasons, version: VERSION };
  }

  function lowerList(rows, key) { return (rows || []).filter(function (r) { return r && r.available !== false; }).map(function (r) { return String(r[key] || '').toLowerCase(); }); }

  /** What is missing at this facility for these requirements. [] = eligible. */
  function missingFor(facility, req) {
    var caps = lowerList(facility.capabilities, 'name').concat(lowerList(facility.capabilities, 'capability'));
    var svcs = lowerList(facility.services, 'category').concat(lowerList(facility.services, 'name'));
    var missing = [];
    req.caps.forEach(function (c) { if (caps.indexOf(c) < 0) missing.push(CAP_PLAIN[c] || c); });
    req.capsAny.forEach(function (g) { if (!g.some(function (c) { return caps.indexOf(c) >= 0; })) missing.push(g.map(function (c) { return CAP_PLAIN[c] || c; }).join(' or ')); });
    req.svcs.forEach(function (s) { if (svcs.indexOf(s) < 0) missing.push(SVC_PLAIN[s] || s); });
    return missing;
  }

  function toRad(d) { return d * Math.PI / 180; }
  function haversineKm(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* ETA assumptions are constants, shown to the user as assumptions. */
  var ETA = { roadFactor: 1.35, speedKmh: 28, dispatchMinutes: 6, minMinutes: 8 };
  function estimateEta(straightKm) {
    var road = straightKm * ETA.roadFactor;
    return { road_km: Math.round(road * 10) / 10, minutes: Math.max(ETA.minMinutes, Math.round(ETA.dispatchMinutes + (road / ETA.speedKmh) * 60)), assumptions: 'Straight-line distance x ' + ETA.roadFactor + ' for roads, ' + ETA.speedKmh + ' km/h average, ' + ETA.dispatchMinutes + ' min to dispatch. A simulated estimate, not live traffic.' };
  }

  /**
   * Nearest CAPABLE facility. Pure and deterministic (ties break by facility code).
   * facilities: [{id, code, name, latitude, longitude, active, capabilities:[{name,available}], services:[{category,available}]}]
   * origin: {latitude, longitude}
   */
  function pickFacility(facilities, origin, req) {
    var ranked = (facilities || []).filter(function (f) { return f && f.active !== false && Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude)); }).map(function (f) {
      var km = haversineKm(origin.latitude, origin.longitude, Number(f.latitude), Number(f.longitude));
      var missing = missingFor(f, req);
      var eta = estimateEta(km);
      var prefMet = req.prefer.filter(function (c) { return lowerList(f.capabilities, 'name').concat(lowerList(f.capabilities, 'capability')).indexOf(c) >= 0; }).map(function (c) { return CAP_PLAIN[c] || c; });
      return { facility: f, distance_km: Math.round(km * 10) / 10, straight_km: km, eta: eta, eligible: missing.length === 0, missing: missing, preferred_met: prefMet };
    }).sort(function (a, b) { return a.straight_km - b.straight_km || String(a.facility.code || a.facility.id).localeCompare(String(b.facility.code || b.facility.id)); });
    var eligible = ranked.filter(function (r) { return r.eligible; });
    var chosen = eligible[0] || null;
    var skipped = chosen ? ranked.filter(function (r) { return !r.eligible && r.straight_km < chosen.straight_km; }) : [];
    return { chosen: chosen, ranked: ranked, eligible: eligible, skipped_nearer: skipped, rule_version: VERSION };
  }

  /* ---------------- SBAR ---------------- */
  function val(v) { return v == null || v === '' ? NOT_RECORDED : String(v); }
  function bpBand(b) {
    if (!b || !Number.isFinite(b.systolic) || !Number.isFinite(b.diastolic)) return '';
    if (b.systolic >= 160 || b.diastolic >= 110) return ' — severe range by app thresholds (160/110)';
    if (b.systolic >= 140 || b.diastolic >= 90) return ' — raised by app thresholds (140/90)';
    return '';
  }

  var READINESS = {
    blood_transfusion: 'Blood bank: check stock and cross-match readiness. Blood group in the background section is patient-recorded and unverified.',
    emergency_maternity: 'Emergency maternity team and bed: confirm availability before arrival.',
    c_section_24x7: 'Theatre and anaesthesia team: confirm availability in case surgery is needed.',
    high_risk_pregnancy: 'High-risk obstetric lead: ask to be informed of the incoming patient.',
    icu_mother: 'Maternal intensive care: confirm whether a bed is available.'
  };
  var READINESS_SVC = { ultrasound: 'Ultrasound / monitoring: confirm someone is available on arrival.', nicu: 'Newborn intensive care: be aware in case of early birth.', obstetrics: 'Obstetric review on arrival.' };

  /**
   * input: {
   *   patient:{name, age}, context, gestWeeks, edd, daysPostpartum, deliveryType,
   *   triage:{level, matched:[{label}]}, symptomLabels:[], note,
   *   bpReadings:[{systolic,diastolic,at}], bloodGroup, allergies, medications, conditions,
   *   gravida, parity, previousComplications, riskLevel, contact:{name,phone},
   *   requirements, facility:{name}, eta:{minutes}, preeclampsiaWarning, triggeredBy:'mother'|'family'
   * }
   */
  function buildSBAR(input, nowMs) {
    nowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    var p = input.patient || {}, tri = input.triage || {}, isPP = input.context === 'postpartum';
    tri = Object.assign({}, tri, { matched: (tri.matched || []).filter(function (m) { return NOT_SHARED_CODES.indexOf(m.code) < 0; }) });
    var ago = function (iso) { var a = iso ? EM.agoText(iso, nowMs) : null; return a ? ' (logged ' + a + ')' : ''; };
    var bps = (input.bpReadings || []).slice(0, 3);
    var latestBp = bps[0];
    var signs = (input.symptomLabels && input.symptomLabels.length ? input.symptomLabels : (tri.matched || []).map(function (m) { return m.label; }));

    var S = [
      { label: 'Patient', value: (p.name || 'Patient') + (Number.isFinite(p.age) ? ', ' + p.age + ' y' : '') },
      { label: 'Situation', value: isPP ? 'After childbirth' + (Number.isFinite(input.daysPostpartum) ? ', day ' + input.daysPostpartum : '') + (input.deliveryType && input.deliveryType !== 'unknown' ? ' (' + input.deliveryType + ')' : '') : 'Pregnant, ' + (Number.isFinite(input.gestWeeks) ? 'about ' + input.gestWeeks + ' weeks' : 'gestation ' + NOT_RECORDED.toLowerCase()) + (input.edd ? ', due ' + input.edd : '') },
      { label: 'Danger signs reported', value: signs.length ? signs.join('; ') : NOT_RECORDED },
      { label: 'App triage', value: String(tri.level || 'unsure').toUpperCase() + ' (fixed rules)' },
      { label: 'Her note', value: val(input.note) },
      { label: 'Arrival', value: (input.eta && Number.isFinite(input.eta.minutes) ? 'ETA about ' + input.eta.minutes + ' min (simulated estimate)' : 'ETA not available') + '; ambulance requested by ' + (input.triggeredBy === 'family' ? 'a family member' : 'the patient') + ' — NOT confirmed by any service' }
    ];
    var B = [
      { label: 'Blood group', value: val(input.bloodGroup) + (input.bloodGroup ? ' (patient-recorded, unverified)' : '') },
      { label: 'Allergies', value: val(input.allergies) },
      { label: 'Current medicines', value: val(input.medications) },
      { label: 'Known conditions', value: val(input.conditions) },
      { label: 'Pregnancies / births', value: (input.gravida != null || input.parity != null) ? 'G' + val(input.gravida) + ' P' + val(input.parity) : NOT_RECORDED },
      { label: 'Previous complications', value: val(input.previousComplications) },
      { label: 'Emergency contact', value: input.contact && (input.contact.name || input.contact.phone) ? [input.contact.name, input.contact.phone].filter(Boolean).join(' · ') : NOT_RECORDED }
    ];
    var A = [
      { label: 'Last blood pressure readings', value: bps.length ? bps.map(function (b) { return b.systolic + '/' + b.diastolic + ' mmHg' + ago(b.at) + bpBand(b); }).join('; ') : NOT_RECORDED },
      { label: 'Rule flags', value: tri.matched && tri.matched.length ? tri.matched.map(function (m) { return m.label; }).join('; ') : NOT_RECORDED }
    ];
    if (input.preeclampsiaWarning) A.push({ label: 'Warning', value: 'Pattern that can go with pre-eclampsia (severe headache / vision change and/or high BP). A rule flag to check urgently, not a diagnosis.' });
    if (input.riskLevel) A.push({ label: 'App risk screen', value: input.riskLevel + ' — a screening aid, not a diagnosis' });

    var req = input.requirements || { caps: [], capsAny: [], svcs: [], prefer: [], preferSvc: [] };
    var checklist = [];
    uniq(req.caps.concat(req.prefer || [])).forEach(function (c) { if (READINESS[c]) checklist.push(READINESS[c]); });
    req.capsAny.forEach(function (g) { var c = g[0]; if (READINESS[c] && checklist.indexOf(READINESS[c]) < 0) checklist.push(READINESS[c]); });
    uniq((req.svcs || []).concat(req.preferSvc || [])).forEach(function (s) { if (READINESS_SVC[s]) checklist.push(READINESS_SVC[s]); });
    var R = [
      { label: 'Request', value: 'Pre-alert only. Please confirm whether you can receive her, and prepare for emergency obstetric assessment on arrival. Clinical decisions rest with your team.' },
      { label: 'Suggested readiness checks', value: checklist.length ? checklist.join(' ') : 'Obstetric review on arrival.' },
      { label: 'Patient was told', value: 'To call 112 / 108 now, not to travel alone, and that this alert is not a confirmed bed.' }
    ];

    var sections = [{ key: 'S', title: 'Situation', rows: S }, { key: 'B', title: 'Background', rows: B }, { key: 'A', title: 'Assessment (rule-based)', rows: A }, { key: 'R', title: 'Recommendation / request', rows: R }];
    var lines = ['GOLDEN HOUR PRE-ALERT (SBAR) — ' + (input.facility && input.facility.name ? 'for ' + input.facility.name : ''), PROTOTYPE_LABEL, ''];
    sections.forEach(function (s) { lines.push(s.key + ' — ' + s.title.toUpperCase()); s.rows.forEach(function (r) { lines.push('• ' + r.label + ': ' + r.value); }); lines.push(''); });
    lines.push('Prepared from the patient\'s own app records. Values may be out of date or incomplete; confirm with her. This is not a diagnosis and not a bed reservation.');
    return { sections: sections, text: lines.join('\n'), readiness_checklist: checklist, latest_bp: latestBp ? { systolic: latestBp.systolic, diastolic: latestBp.diastolic, at: latestBp.at || null } : null, generated_at: new Date(nowMs).toISOString(), rule_version: VERSION, label: PROTOTYPE_LABEL };
  }

  /** Is this triage result one that sends an alert? */
  function alertPriority(level) { return ALERTABLE[level] || null; }

  return {
    VERSION: VERSION, PROTOTYPE_LABEL: PROTOTYPE_LABEL, HERO_CODES: HERO_CODES, HERO_PLAIN: HERO_PLAIN, NOT_SHARED_CODES: NOT_SHARED_CODES, REQUIREMENTS: REQUIREMENTS,
    requirementsFor: requirementsFor, missingFor: missingFor, pickFacility: pickFacility, estimateEta: estimateEta, haversineKm: haversineKm,
    buildSBAR: buildSBAR, alertPriority: alertPriority, ETA: ETA, CAP_PLAIN: CAP_PLAIN, SVC_PLAIN: SVC_PLAIN
  };
});
