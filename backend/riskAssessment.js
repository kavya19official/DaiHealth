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

  return {
    risk_level,
    factors,
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
