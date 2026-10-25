'use strict';
// K. Checks that do not need a database: the SQL builders reject unsafe input, and a source scan
// makes sure no doctor path in the backend reads a mother's record through a raw appointment check
// that skips the mother's revocations.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const access = require('./accessControl');

test('SQL builders reject bare column names that would bind to the revocation table itself', () => {
  for (const bad of [['mother_id', 'doctor_id'], ['a.mother_id', 'doctor_id'], ['x.m', 'x.d', 'facility_uuid'], ['1; DROP TABLE users', 'a.d']])
    assert.throws(() => access.revokedSql(...bad), /unqualified column reference/);
  assert.doesNotThrow(() => access.revokedSql('a.mother_id', 'a.doctor_id', 'a.facility_uuid'));
  assert.doesNotThrow(() => access.activeRelationshipSql('mp.user_id', '$1::int'));
});

test('the relationship SQL needs an appointment AND no doctor or facility revocation', () => {
  const sql = access.activeRelationshipSql('m.id', '$1::int').replace(/\s+/g, ' ');
  assert.match(sql, /FROM appointments ra WHERE ra\.mother_id = m\.id AND ra\.doctor_id = \$1::int/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM patient_access_controls rc/);
  assert.match(sql, /rc\.state = 'revoked'/);
  assert.match(sql, /grantee_type = 'doctor'/); assert.match(sql, /grantee_type = 'facility'/);
  assert.equal(/state = 'granted'/.test(sql), false);                       // a "granted" row never widens access
  assert.doesNotMatch(access.revokedSql('d.mother_id', 's.doctor_id'), /facility/);   // non-appointment paths check the doctor only
});

test('no backend doctor path reads a mother through a raw appointment relationship check', () => {
  const allowed = new Set(['accessControl.js', 'patientContinuity.js', 'patientMLEvents.js', 'notifications.js', 'clinicalDashboard.js', 'smartReferralHandoff.js']);
  const offenders = [];
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !allowed.has(f))) {
    const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/FROM appointments\b/i.test(line) && /doctor_id\s*=\s*\$\d/.test(line) && !/revokedSql|activeRelationshipSql|hasDoctorAccess/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'These lines check a doctor-mother relationship without the revocation check: ' + offenders.join(', '));
});

test('every call to the SQL builders passes qualified columns or numbered parameters', () => {
  const bad = [];
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'accessControl.js')) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of src.matchAll(/(?:revokedSql|activeRelationshipSql)\(([^)]*)\)/g)) {
      const args = m[1].split(',').map((a) => a.trim().replace(/^['"`]|['"`]$/g, ''));
      for (const a of args) if (a && !/^(\$\d+(::int)?|\$\$\{[^}]+\}::int|[A-Za-z_]\w*\.[A-Za-z_]\w*)$/.test(a) && !/\$\{params\.length\}/.test(a)) bad.push(`${file}: ${a}`);
    }
  }
  assert.deepEqual(bad, []);
});
