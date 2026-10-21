'use strict';

/**
 * Runs a maternal risk assessment for one mother from her stored profile and
 * latest logged vitals, saves the result on mother_profiles (latest snapshot)
 * AND appends it to risk_assessments (history for the trend view).
 *
 * Shared by POST /api/risk/assess (manual) and by the health-log hook that
 * re-screens automatically when a new blood pressure or glucose reading is
 * logged. Returns { status, body } so callers can pass it straight to res.
 */
const riskAssessment = require('./riskAssessment');

const numOr = (v, min, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const ageFrom = (dobValue) => {
  const dob = new Date(dobValue);
  const now = new Date();
  let a = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) a -= 1;
  return a;
};

async function runRiskAssessment(pool, userId, b = {}, trigger = 'manual') {
  const profile = await pool.query(
    `SELECT date_of_birth, gravida, previous_complications, medical_conditions, risk_level
       FROM mother_profiles WHERE user_id = $1`,
    [userId]
  );
  if (!profile.rows.length) return { status: 404, body: { error: 'Profile not found' } };
  const p = profile.rows[0];
  if (!p.date_of_birth) {
    return { status: 400, body: { error: 'Add your date of birth in your profile before running a risk assessment' } };
  }

  let systolic = numOr(b.systolic, 60, 260);
  let diastolic = numOr(b.diastolic, 30, 160);
  let bloodSugar = numOr(b.blood_sugar, 1, 40); // mmol/L

  if (systolic == null || diastolic == null) {
    const bp = await pool.query(
      `SELECT data FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_pressure' ORDER BY logged_at DESC LIMIT 1`,
      [userId]
    );
    if (bp.rows.length) {
      systolic = systolic == null ? Number(bp.rows[0].data.systolic) : systolic;
      diastolic = diastolic == null ? Number(bp.rows[0].data.diastolic) : diastolic;
    }
  }
  if (systolic == null || diastolic == null) {
    return { status: 400, body: { error: 'Log a blood pressure reading first, then reassess risk' } };
  }
  if (bloodSugar == null) {
    const gl = await pool.query(
      `SELECT data FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_glucose' ORDER BY logged_at DESC LIMIT 1`,
      [userId]
    );
    // health_logs stores blood glucose in mg/dL; riskAssessment.js works in mmol/L.
    if (gl.rows.length) bloodSugar = Number(gl.rows[0].data.mg_dl) / 18.0182;
  }

  const bodyTemp = numOr(b.body_temp, 90, 110);
  const heartRate = numOr(b.heart_rate, 30, 220);

  const assessment = riskAssessment.assessRisk({
    age: ageFrom(p.date_of_birth), systolic, diastolic,
    blood_sugar: bloodSugar == null ? undefined : bloodSugar,
    body_temp: bodyTemp == null ? undefined : bodyTemp,
    heart_rate: heartRate == null ? undefined : heartRate,
    previous_complications: !!p.previous_complications,
    preexisting_diabetes: /diabetes/i.test(p.medical_conditions || ''),
    medical_conditions: p.medical_conditions,
    gravida: p.gravida,
  });
  if (assessment.error) return { status: 400, body: { error: assessment.error } };

  await pool.query(
    'UPDATE mother_profiles SET risk_level = $2, risk_factors = $3, risk_assessed_at = CURRENT_TIMESTAMP WHERE user_id = $1',
    [userId, assessment.risk_level, JSON.stringify(assessment.factors)]
  );
  // History is best-effort: if the v4 migration has not been applied yet, the
  // assessment itself must still succeed.
  try {
    await pool.query(
      `INSERT INTO risk_assessments (mother_id, risk_level, knn_level, factors, inputs, explanation, trigger)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, assessment.risk_level, assessment.knn_level, JSON.stringify(assessment.factors),
        JSON.stringify(assessment.inputs_used), JSON.stringify(assessment.explanation), trigger]
    );
  } catch (e) {
    console.error('Risk history insert failed (is db/care_extensions_v4.sql applied?):', e.message);
  }

  return {
    status: 200,
    body: { message: 'Risk assessment updated', assessment, previous_level: p.risk_level || null }
  };
}

module.exports = { runRiskAssessment, ageFrom };
