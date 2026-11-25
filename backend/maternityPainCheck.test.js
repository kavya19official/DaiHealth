'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),P=require('../shared/maternity-pain-check'),EM=require('../shared/emergency-triage');
test('pain descriptions preserve uncertainty and never diagnose psychological or harmless pain',()=>{
 assert.deepEqual(P.summarize({}).codes,[]);assert.equal(P.summarize({severity:'invalid',location:'invalid'}).answered,0);
 const mild=P.summarize({location:'belly',severity:'mild',rest:'yes'});assert.equal(mild.safe,undefined);assert.equal(mild.diagnosis,undefined);
});
test('severe pain and preterm tightenings escalate without completing the questionnaire',()=>{
 for(const input of [{location:'belly',severity:'severe'},{location:'ribs',severity:'severe'},{location:'chest'}])assert.equal(EM.triage(P.summarize(input).codes,{context:'pregnant',gestWeeks:28}).level,'emergency');
 assert.equal(EM.triage(P.summarize({location:'belly',feeling:'tightening'}).codes,{context:'pregnant',gestWeeks:28}).level,'emergency');
 for(const input of [{location:'leg'},{location:'back',rest:'no'}])assert.equal(EM.triage(P.summarize(input).codes,{context:'pregnant'}).level,'urgent');
 assert.equal(EM.triage(['urinary_pain'],{context:'pregnant'}).level,'urgent');
});
