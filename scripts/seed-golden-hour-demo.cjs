'use strict';
/* Golden Hour demo data (synthetic only). Idempotent and non-destructive:
 *  - fills the demo mother's EMPTY profile fields (blood group, allergies, medicines, contact) so the SBAR is not blank;
 *  - adds three blood-pressure readings only if she has none;
 *  - creates family@dai-synthetic.invalid with an "emergency_alert" grant, only if that account does not exist.
 * Nothing the person already entered is overwritten. */
const crypto = require('node:crypto');
const bcrypt = require('../backend/node_modules/bcrypt');

async function seedGoldenHourDemo(client) {
  const mother = (await client.query("SELECT id FROM users WHERE email IN ('mother@dai-synthetic.invalid','nivara@dai-synthetic.invalid') AND role = 'mother'")).rows[0];
  if (!mother) return;
  await client.query(
    `UPDATE mother_profiles SET
       blood_group = COALESCE(NULLIF(blood_group, ''), 'B+'),
       allergies = COALESCE(NULLIF(allergies, ''), 'Penicillin (rash)'),
       current_medications = COALESCE(NULLIF(current_medications, ''), 'Iron and folic acid daily; calcium'),
       gravida = COALESCE(gravida, 2), parity = COALESCE(parity, 1),
       emergency_contact_name = COALESCE(NULLIF(emergency_contact_name, ''), 'SYNTHETIC Ravi (husband)'),
       emergency_contact_phone = COALESCE(NULLIF(emergency_contact_phone, ''), '9000000001')
     WHERE user_id = $1`, [mother.id]);
  const has = await client.query("SELECT 1 FROM health_logs WHERE mother_id = $1 AND log_type = 'blood_pressure' LIMIT 1", [mother.id]);
  if (!has.rows.length) {
    for (const [hoursAgo, systolic, diastolic] of [[72, 126, 80], [26, 134, 86], [3, 148, 96]]) {
      await client.query("INSERT INTO health_logs (mother_id, log_type, data, logged_at) VALUES ($1, 'blood_pressure', $2, NOW() - ($3 || ' hours')::interval)", [mother.id, JSON.stringify({ systolic, diastolic }), String(hoursAgo)]);
    }
  }
  const email = 'family@dai-synthetic.invalid';
  if (!(await client.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length) {
    const hash = await bcrypt.hash(process.env.DAI_DEMO_PASSWORD, 10);
    const family = (await client.query("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'caregiver') RETURNING id", [email, hash])).rows[0];
    await client.query(
      `INSERT INTO family_access_grants (id, mother_id, grantee_id, recipient_email, scopes, expires_at, relationship)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '365 days', 'partner')`,
      [crypto.randomUUID(), mother.id, family.id, email, JSON.stringify(['appointments', 'urgent_help', 'emergency_alert'])]);
  }
}
module.exports = { seedGoldenHourDemo };
