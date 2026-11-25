'use strict';

const DEMO_FACILITY_PREFIX = require('./seed-delhi-demo.cjs').PREFIX;

module.exports = async function seedInstantConsultationDemo(db) {
  // Only the launcher-managed cohort establishes this recorded affiliation.
  if (process.env.DAI_LOCAL !== 'true') return;
  await db.query(`INSERT INTO doctor_facilities
      (doctor_id,facility_id,role,specialization,languages,qualification_verified,verification_details,accepts_new_patients,active)
    SELECT clinician.id,facility.id,'consultant',dp.specialization,'["Hindi","English"]'::jsonb,
      TRUE,'{"synthetic":true,"scope":"local Doctor Connect demonstration"}'::jsonb,TRUE,TRUE
    FROM users clinician
    JOIN dai_local_source_link src ON src.target_id=clinician.id AND src.entity='doctor'
    JOIN doctor_profiles dp ON dp.user_id=clinician.id
    CROSS JOIN LATERAL (
      SELECT f.id FROM facilities f WHERE f.facility_code LIKE $1 AND f.active ORDER BY f.id LIMIT 1
    ) facility
    WHERE clinician.email='doctor@dai-synthetic.invalid' AND clinician.role='doctor' AND clinician.closed_at IS NULL
    ON CONFLICT(doctor_id,facility_id) DO NOTHING`, [DEMO_FACILITY_PREFIX + '%']);
};
