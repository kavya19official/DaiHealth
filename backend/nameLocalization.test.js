'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),N=require('../shared/name-localization');
test('names display in Hindi and Marathi without semantic translation or changing identifiers',()=>{
 const original='SYNTHETIC Nivara Sethi 0000001';
 for(const code of ['hi','mr']){assert.equal(N.localize(original,code),'काल्पनिक निवारा सेठी 0000001');assert.equal(N.localize('Hemangini Batra',code),'हेमांगिनी बत्रा');assert.equal(N.localize('Rose Thomas',code),'रोज़ थॉमस');assert.equal(N.localize('DAI-SYN-MOTHER-SYN-0000001 ABHA BP 140/90 test@example.com',code),'DAI-SYN-MOTHER-SYN-0000001 ABHA BP 140/90 test@example.com');assert.equal(N.localize('निवारा सेठी',code),'निवारा सेठी');}
 assert.equal(N.localize(original,'en'),original);assert.equal(N.localize('Patil Hospital','hi'),'पाटिल अस्पताल');assert.equal(N.localize('Patil Hospital','mr'),'पाटील रुग्णालय');assert.equal(N.localize('HB','hi',{initials:true}),'एचबी');assert.equal(N.localize('HB','hi'),'HB');assert.equal(N.looksLikeName('Take iron after food'),false);
});
test('original and display spellings both search the same authorised roster without mutation',()=>{
 const patients=[{id:1,name:'Nivara Sethi',stage:{week:28},uhid:'DAI-SYN-0001'},{id:2,name:'Rupali Patil',stage:{week:20}}],snapshot=JSON.stringify(patients),data={date:'2026-11-24',patients,appointments:[],worklist:[]};
 const pages=require('../frontend/js/doctor-pages-model'),workspace=require('../frontend/js/doctor-workspace-model'),care=require('../shared/care-workbench');
 for(const query of ['Nivara','निवारा','सेठी']){assert.deepEqual(pages.rows(data,'maternal',{search:query}).map(p=>p.id),[1]);assert.deepEqual(workspace.roster(data,{query}).map(p=>p.id),[1]);assert.deepEqual(care.registry(data,{query}).map(p=>p.id),[1]);}
 assert.ok(N.matches('Rupali Patil','पाटिल'));assert.ok(N.matches('Rupali Patil','पाटील'));assert.equal(JSON.stringify(patients),snapshot);
});
