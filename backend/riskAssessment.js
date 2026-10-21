'use strict';

/**
 * Maternal high-risk assessment powered by the UCI/Kaggle
 * "Maternal Health Risk Data Set" (Age, SystolicBP, DiastolicBP, BS,
 * BodyTemp, HeartRate → RiskLevel).
 *
 * Strategy: k-nearest neighbours (k=7) in z-scored feature space using the
 * reference CSV shipped under backend/data/. Factors that raise risk are
 * also listed with clinical thresholds for transparency on the dashboard.
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, 'data', 'maternal_health_risk.csv');

let REF = null; // { rows: [{features, label}], means, stds }

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = parts[idx] && parts[idx].trim(); });
    const age = Number(obj.Age);
    const sbp = Number(obj.SystolicBP);
    const dbp = Number(obj.DiastolicBP);
    const bs = Number(obj.BS);
    const temp = Number(obj.BodyTemp);
    const hr = Number(obj.HeartRate);
    const label = String(obj.RiskLevel || '').toLowerCase();
    if (![age, sbp, dbp, bs, temp, hr].every(Number.isFinite)) continue;
    if (!label) continue;
    rows.push({ features: [age, sbp, dbp, bs, temp, hr], label });
  }
  return rows;
}

function loadReference() {
  if (REF) return REF;
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(text);
  const dim = 6;
  const means = Array(dim).fill(0);
  const stds = Array(dim).fill(1);
  rows.forEach((r) => r.features.forEach((v, i) => { means[i] += v; }));
  means.forEach((_, i) => { means[i] /= rows.length; });
  rows.forEach((r) => r.features.forEach((v, i) => { stds[i] += (v - means[i]) ** 2; }));
  stds.forEach((_, i) => { stds[i] = Math.sqrt(stds[i] / rows.length) || 1; });
  REF = { rows, means, stds };
  return REF;
}

function zscore(features, means, stds) {
  return features.map((v, i) => (v - means[i]) / stds[i]);
}

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function knnLabel(features, k = 7) {
  const ref = loadReference();
  const z = zscore(features, ref.means, ref.stds);
  const scored = ref.rows.map((r) => ({
    d: dist(z, zscore(r.features, ref.means, ref.stds)),
    label: r.label
  }));
  scored.sort((a, b) => a.d - b.d);
  const top = scored.slice(0, k);
  const votes = { 'high risk': 0, 'mid risk': 0, 'low risk': 0 };
  top.forEach((t) => { if (votes[t.label] != null) votes[t.label] += 1; });
  let best = 'low risk';
  let bestN = -1;
  Object.keys(votes).forEach((lab) => {
    if (votes[lab] > bestN) { bestN = votes[lab]; best = lab; }
  });
  return { label: best, votes, neighbours: top.length };
}

function clinicalFactors(input) {
  const factors = [];
  const { age, systolic, diastolic, blood_sugar, body_temp, heart_rate } = input;
  if (age != null && (age < 18 || age > 35)) {
    factors.push({ code: 'age', label: age < 18 ? 'Adolescent pregnancy (<18)' : 'Advanced maternal age (>35)', severity: age < 16 || age > 40 ? 'high' : 'mid' });
  }
  if (systolic != null && systolic >= 140) {
    factors.push({ code: 'sbp', label: 'Elevated systolic BP (≥140 mmHg)', severity: systolic >= 160 ? 'high' : 'mid' });
  }
  if (diastolic != null && diastolic >= 90) {
    factors.push({ code: 'dbp', label: 'Elevated diastolic BP (≥90 mmHg)', severity: diastolic >= 100 ? 'high' : 'mid' });
  }
  if (blood_sugar != null && blood_sugar >= 8) {
    factors.push({ code: 'bs', label: 'Elevated blood sugar (≥8 mmol/L)', severity: blood_sugar >= 11 ? 'high' : 'mid' });
  }
  if (body_temp != null && body_temp >= 100) {
    factors.push({ code: 'temp', label: 'Elevated body temperature (≥100°F)', severity: body_temp >= 101 ? 'high' : 'mid' });
  }
  if (heart_rate != null && (heart_rate < 60 || heart_rate > 100)) {
    factors.push({ code: 'hr', label: heart_rate > 100 ? 'Tachycardia (>100 bpm)' : 'Bradycardia (<60 bpm)', severity: 'mid' });
  }
  if (input.previous_complications) {
    factors.push({ code: 'prev', label: 'Previous pregnancy complications reported', severity: 'mid' });
  }
  if (input.preexisting_diabetes || (input.medical_conditions || '').toLowerCase().includes('diabetes')) {
    factors.push({ code: 'dm', label: 'Diabetes / metabolic history', severity: 'high' });
  }
  if (input.gravida != null && input.gravida >= 5) {
    factors.push({ code: 'grand_multipara', label: 'Grand multiparity (gravida ≥5)', severity: 'mid' });
  }
  return factors;
}

// ---------------------------------------------------------------------------
// Explainability. The kNN vote on its own is a black box ("mid risk"), so this
// answers "why?" in three plain-language layers:
//   1. what the 7 most similar reference records said,
//   2. which of the person's readings stand out against typical LOW-risk
//      records (largest gaps first),
//   3. whether clinical rules overrode the model, and which inputs were guesses.
// It describes the screen; it does not add to or change the risk level.
// ---------------------------------------------------------------------------
const FEATURES = [
  { code: 'age',   label: 'Age',                          unit: 'years' },
  { code: 'sbp',   label: 'Top blood-pressure number',    unit: 'mmHg' },
  { code: 'dbp',   label: 'Bottom blood-pressure number', unit: 'mmHg' },
  { code: 'bs',    label: 'Blood sugar',                  unit: 'mmol/L' },
  { code: 'temp',  label: 'Body temperature',             unit: '°F' },
  { code: 'hr',    label: 'Heart rate',                   unit: 'bpm' }
];

let LOW_MEANS = null;
function lowRiskMeans() {
  if (LOW_MEANS) return LOW_MEANS;
  const ref = loadReference();
  const low = ref.rows.filter((r) => r.label === 'low risk');
  const rows = low.length ? low : ref.rows;
  LOW_MEANS = FEATURES.map((_, i) => rows.reduce((a, r) => a + r.features[i], 0) / rows.length);
  return LOW_MEANS;
}

const round1 = (n) => Math.round(n * 10) / 10;

function featureDrivers(features) {
  const ref = loadReference();
  const means = lowRiskMeans();
  return features.map((v, i) => {
    const diffSd = (v - means[i]) / ref.stds[i];
    return {
      code: FEATURES[i].code, label: FEATURES[i].label, unit: FEATURES[i].unit,
      value: round1(v), typical_low_risk: round1(means[i]),
      diff_sd: round1(diffSd), direction: diffSd >= 0 ? 'above' : 'below'
    };
  })
    .filter((d) => Math.abs(d.diff_sd) >= 0.5)
    .sort((a, b) => Math.abs(b.diff_sd) - Math.abs(a.diff_sd))
    .slice(0, 3);
}

function explainAssessment({ features, knn, factors, finalLevel, defaulted }) {
  const lines = [];
  lines.push(`${knn.votes[knn.label]} of the ${knn.neighbours} most similar records in the reference data were "${knn.label}".`);

  const drivers = featureDrivers(features);
  drivers.forEach((d) => {
    const strength = Math.abs(d.diff_sd) >= 1.5 ? 'well' : 'somewhat';
    lines.push(`${d.label} (${d.value} ${d.unit}) is ${strength} ${d.direction} where most low-risk records sit (about ${d.typical_low_risk} ${d.unit}).`);
  });
  if (!drivers.length) lines.push('None of the readings stand out from typical low-risk records.');

  const escalated = finalLevel !== knn.label;
  const highFactors = factors.filter((f) => f.severity === 'high').map((f) => f.label);
  if (escalated) {
    lines.push(`Clinical rules raised the level from "${knn.label}" to "${finalLevel}"${highFactors.length ? ' because of: ' + highFactors.join('; ') : ''}.`);
  }

  const data_gaps = [];
  if (defaulted.blood_sugar) data_gaps.push('Blood sugar was not logged, so a typical value was assumed. Logging it makes this screen more accurate.');
  if (defaulted.body_temp) data_gaps.push('Temperature was not entered, so 98.6 °F was assumed.');
  if (defaulted.heart_rate) data_gaps.push('Heart rate was not entered, so 76 bpm was assumed.');

  return {
    summary: lines,
    drivers,
    votes: knn.votes,
    knn_level: knn.label,
    escalated,
    escalation_reasons: escalated ? highFactors : [],
    data_gaps,
    caveat: 'This is a screening aid built from a small public dataset, not a diagnosis. It can miss problems and can flag people who are fine. Your doctor\'s assessment always comes first.'
  };
}

/**
 * @param {object} input numeric vitals + optional history flags
 * @returns {{ risk_level, factors, model, inputs_used }}
 */
function assessRisk(input) {
  // Defaults only for features that the prototype may not have logged yet.
  // Documented: BodyTemp defaults to 98.6°F; HeartRate defaults to 76 bpm
  // (dataset median-ish) when no measurement exists.
  const age = Number(input.age);
  const systolic = Number(input.systolic);
  const diastolic = Number(input.diastolic);
  const blood_sugar = input.blood_sugar != null ? Number(input.blood_sugar) : 7.0; // mmol/L typical fasting-ish default when unknown
  const body_temp = input.body_temp != null ? Number(input.body_temp) : 98.6;
  const heart_rate = input.heart_rate != null ? Number(input.heart_rate) : 76;

  if (![age, systolic, diastolic].every(Number.isFinite)) {
    return { error: 'Age and blood pressure (systolic, diastolic) are required for risk assessment' };
  }

  const features = [age, systolic, diastolic, blood_sugar, body_temp, heart_rate];
  const knn = knnLabel(features, 7);
  const factors = clinicalFactors({
    age, systolic, diastolic, blood_sugar, body_temp, heart_rate,
    previous_complications: input.previous_complications,
    preexisting_diabetes: input.preexisting_diabetes,
    medical_conditions: input.medical_conditions,
    gravida: input.gravida
  });

  // Escalate if clinical high factors present even if kNN said low
  let risk_level = knn.label;
  if (factors.some((f) => f.severity === 'high') && risk_level === 'low risk') {
    risk_level = 'mid risk';
  }
  if (factors.filter((f) => f.severity === 'high').length >= 2) {
    risk_level = 'high risk';
  }

  const explanation = explainAssessment({
    features, knn, factors, finalLevel: risk_level,
    defaulted: { blood_sugar: input.blood_sugar == null, body_temp: input.body_temp == null, heart_rate: input.heart_rate == null }
  });

  return {
    risk_level,
    knn_level: knn.label,
    factors,
    explanation,
    model: {
      method: 'kNN (k=7) on Maternal Health Risk Data Set + clinical thresholds',
      votes: knn.votes,
      neighbours: knn.neighbours,
      reference_rows: loadReference().rows.length
    },
    inputs_used: {
      age, systolic, diastolic,
      blood_sugar, blood_sugar_defaulted: input.blood_sugar == null,
      body_temp, body_temp_defaulted: input.body_temp == null,
      heart_rate, heart_rate_defaulted: input.heart_rate == null
    }
  };
}

module.exports = { assessRisk, loadReference };
