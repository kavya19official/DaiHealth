'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');

test('patient boot initializes birth readiness with the correct guest mode',()=>{
  const html=fs.readFileSync(path.join(root,'frontend/dashboard.html'),'utf8');
  assert.match(html,/BirthReadiness\.init\(\{ guest: true \}\)/);
  assert.match(html,/BirthReadiness\.init\(\{ guest: false \}\)/);
});

test('sharing copy names the birth-preparation checklist and its read-only doctor access',()=>{
  const script=fs.readFileSync(path.join(root,'frontend/js/clinical-dashboard.js'),'utf8');
  assert.match(script,/birth-preparation checklist/i);
  assert.match(script,/checklist remains read-only/i);
});

test('doctor readiness UI distinguishes inactive, shared and unshared checklists',()=>{
  const script=fs.readFileSync(path.join(root,'frontend/js/doctor-workspace.js'),'utf8');
  assert.match(script,/Available from week/);
  assert.match(script,/checklist available from week/);
  assert.match(script,/checklist not shared/);
  assert.match(script,/readiness:\{eligible:false,week:24,starts_at_week:28,completed:0/);

  const experience=fs.readFileSync(path.join(root,'frontend/js/doctor-readiness-experience.js'),'utf8');
  assert.match(experience,/r&&r\.eligible!==false/);
  assert.match(experience,/Available from week/);
  assert.match(experience,/No incomplete steps are counted/);
  assert.match(experience,/activeLists\.filter/);
});
