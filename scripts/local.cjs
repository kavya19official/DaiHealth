'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('DAI requires Node.js 22.13 or later. Install Node 22 LTS, then run npm start again.');
  process.exit(1);
}
for (const python of [process.env.DAI_PYTHON, 'python3.11', 'python3', 'python'].filter(Boolean)) {
  const check = spawnSync(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)']);
  if (check.status === 0) {
    const result = spawnSync(python, [path.join(__dirname, 'local.py'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    process.exit(result.status ?? 1);
  }
}
console.error('Install Python 3.11 or later (including venv), then run npm start again.');
process.exit(1);
