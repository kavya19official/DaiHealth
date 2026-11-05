'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validDate,buildJourney,buildActivities}=require('../frontend/js/patient-home-reference');
const status=m=>require('../frontend/js/patient-model').status(m,'2026-11-05');
test('journey never invents completion from a delivered flag or child presence',()=>{
 const empty=buildJourney({milestones:[],children:[{id:1}]},{delivered:true},status);
 assert.equal(empty[0].state,'unrecorded');assert.equal(empty[1].state,'unrecorded');assert.equal(empty[2].state,'unrecorded');assert.equal(empty[3].state,'available');
 const data={milestones:[{title:'ANC visit',due_date:'2026-03-01',completed_at:'2026-03-01'},{title:'ANC test',due_date:'2026-04-01'}],post:{delivery:{date:'2026-07-01'},schedule:[{title:'Postnatal follow-up',window_end:'2026-08-01',status:'pending'}]}};
 const phases=buildJourney(data,{delivered:true},status);assert.equal(phases[0].state,'attention');assert.equal(phases[1].state,'recorded');assert.equal(phases[2].state,'attention');
 assert.equal(buildJourney({milestones:[{title:'ANC',status:'completed',completion_verification:'pending'}]}, {delivered:false},status)[0].state,'review');
 data.post.schedule[0].status='done';assert.equal(buildJourney(data,{delivered:true},status)[2].state,'done');
});
test('activity feed uses recorded dates, preserves child identity and bounds/merges events',()=>{
 const d={appointments:[{id:1,requested_date:'2026-11-08',reason:'SYNTHETIC follow-up',status:'confirmed'},{id:2,requested_date:'2026-11-07',status:'cancelled'},{id:3,requested_date:'bad',reason:'Must not appear'}],milestones:[{id:1,title:'SYNTHETIC visit',status:'completed',completed_at:'2026-11-01'}],children:[{id:10,name:'SYNTHETIC Baby A',vaccinations:[{vaccine_code:'bcg',given_on:'2026-11-03'}]},{id:11,name:'SYNTHETIC Baby B',vaccinations:[{vaccine_code:'bcg',given_on:'2026-11-02'}]}]};
 const rows=buildActivities(d,'2026-11-05');assert.equal(rows.length,3);assert.equal(rows[0].id,'appointment-1');assert.equal(rows[1].detail,'SYNTHETIC Baby A');assert.equal(rows[2].detail,'SYNTHETIC Baby B');assert.ok(!rows.some(r=>r.id==='appointment-2'));assert.deepEqual(buildActivities({},'2026-11-05'),[]);assert.deepEqual(buildActivities({milestones:[{id:9,title:'Unverified',status:'completed',completed_at:'2026-11-04',completion_verification:'pending'}]},'2026-11-05'),[]);
});
test('display dates reject malformed and impossible calendar values',()=>{assert.equal(validDate('2026-02-30'),null);assert.equal(validDate('invalid'),null);assert.equal(validDate('2026-11-05T12:00:00Z'),'2026-11-05');});
