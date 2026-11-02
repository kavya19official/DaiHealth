'use strict';
// Guards against a migration being written but never applied by the local launcher.
// (clinician_report_uploads.sql was once missing from seed-local.cjs, which made every
// report upload fail with "Failed to upload document" because patient_documents had no
// uploaded_by column.) Pure file checks, no database needed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const listed = (file) => {
  const src = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
  const block = [...src.matchAll(/const (?:migrations|directories) = \[(.*?)\];/gs)].map((m) => m[1]).join(',');
  return new Set([...block.matchAll(/'([^']+\.sql)'/g)].map((m) => m[1]));
};

for (const file of ['seed-local.cjs', 'check-local.cjs']) {
  test(`${file} applies every SQL file in backend/db`, () => {
    const applied = listed(file);
    const onDisk = fs.readdirSync(path.join(root, 'backend/db')).filter((f) => f.endsWith('.sql'));
    const missing = onDisk.filter((f) => !applied.has(f));
    assert.deepStrictEqual(missing, [], `Not applied by scripts/${file}: ${missing.join(', ')}`);
  });
}
