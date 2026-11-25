'use strict';

const dateValue = value => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};
const timestampValue = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const numericValue = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const jsonValue = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

async function readClinicalRecords(pool, motherId, { visitLimit = 200, investigationLimit = 500, observationLimit = 300 } = {}) {
  const [profile, visits, investigations, observations] = await Promise.all([
    pool.query('SELECT data_label FROM mother_profiles WHERE user_id=$1', [motherId]),
    pool.query(`SELECT v.*,dp.full_name AS doctor_name,dp.qualifications,dp.facility_name,
      a.status AS appointment_status,a.requested_time
      FROM anc_visits v
      JOIN doctor_profiles dp ON dp.user_id=v.doctor_id
      LEFT JOIN appointments a ON a.id=v.appointment_id
      WHERE v.mother_id=$1
      ORDER BY v.visit_date DESC,v.id DESC
      LIMIT $2`, [motherId, visitLimit]),
    pool.query(`SELECT i.*,dp.full_name AS ordering_doctor_name,i.reviewed_by,
      reviewer.full_name AS reviewer_name
      FROM clinical_investigations i
      LEFT JOIN doctor_profiles dp ON dp.user_id=(
        SELECT a.doctor_id FROM appointments a WHERE a.id=i.appointment_id
      )
      LEFT JOIN doctor_profiles reviewer ON reviewer.user_id=i.reviewed_by
      WHERE i.mother_id=$1
      ORDER BY COALESCE(i.resulted_on,i.collected_on) DESC NULLS LAST,i.id DESC
      LIMIT $2`, [motherId, investigationLimit]),
    pool.query(`SELECT e.*,dp.full_name AS doctor_name,dp.qualifications,dp.facility_name
      FROM clinical_dashboard_entries e
      JOIN doctor_profiles dp ON dp.user_id=e.doctor_id
      WHERE e.mother_id=$1
      ORDER BY e.recorded_on DESC,e.id DESC
      LIMIT $2`, [motherId, observationLimit])
  ]);
  const motherLabel = profile.rows[0]?.data_label || null;
  const label = row => row.data_label || motherLabel;
  return {
    data_label: motherLabel,
    provenance: 'Structured clinical ledger linked to the recorded appointment and source record. Unknown values are not inferred.',
    anc_visits: visits.rows.map(row => ({
      ...row,
      visit_date: dateValue(row.visit_date),
      follow_up_date: dateValue(row.follow_up_date),
      requested_time: row.requested_time ? String(row.requested_time).slice(0, 5) : null,
      created_at: timestampValue(row.created_at),
      data_label: label(row)
    })),
    investigations: investigations.rows.map(row => ({
      ...row,
      value_numeric: numericValue(row.value_numeric),
      reference_low: numericValue(row.reference_low),
      reference_high: numericValue(row.reference_high),
      collected_on: dateValue(row.collected_on),
      resulted_on: dateValue(row.resulted_on),
      reviewed_at: timestampValue(row.reviewed_at),
      created_at: timestampValue(row.created_at),
      data_label: label(row)
    })),
    observations: observations.rows.map(row => ({
      id: row.id,
      appointment_id: row.appointment_id,
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name,
      qualifications: row.qualifications,
      facility_name: row.facility_name,
      recorded_on: dateValue(row.recorded_on),
      observed_at: timestampValue(row.observed_at),
      source_kind: row.source_kind,
      source_record_id: row.source_record_id,
      measurement_status: row.measurement_status,
      values: jsonValue(row.values_json),
      targets: jsonValue(row.targets_json),
      scan_note: row.scan_note,
      record_key: row.record_key,
      data_label: label(row)
    }))
  };
}

module.exports = { readClinicalRecords, dateValue, timestampValue, numericValue };
