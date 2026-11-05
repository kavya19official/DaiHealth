'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const M=require('../frontend/js/patient-model'),Ref=require('../shared/child-reference');
function view(){const page=fs.readFileSync(path.join(__dirname,'../frontend/dashboard.html'),'utf8'),mounted=/id="timelineList"/.test(page);const root={innerHTML:'',classList:{toggle(){},add(){}}},events={};const document={getElementById:id=>mounted&&id==='timelineList'?root:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,fn)=>events[type]=fn,documentElement:{lang:'en',dataset:{}}};const window={PatientModel:M,AnvayaChild:Ref};const context={window,document,AnvayaChild:Ref,Map,Set,Date,console};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-journey.js'),'utf8'),context);return {window,root,events};}
const data={user:{lmp_date:'2026-04-24'},milestones:[{id:1,title:'First antenatal visit',category:'pregnancy',due_date:'2026-05-01',status:'completed'},{id:2,title:'<script>OGTT</script>',category:'pregnancy',due_date:'2026-10-25',status:'upcoming'},{id:3,title:'Birth plan & facility readiness',category:'pregnancy',due_date:'2027-01-01',status:'upcoming'}],appointments:[],children:[{id:1,name:'SYNTHETIC Baby A',date_of_birth:'2026-10-01',vaccinations:[{vaccine_code:'bcg',given_on:'2026-10-01'}]},{id:2,name:'SYNTHETIC Baby B',date_of_birth:'2026-10-01',vaccinations:[]}],post:{},overview:{}};
test('journey keeps dates and safe recorded provenance in a compact chapter view',()=>{const v=view();v.window.PatientJourney.update(data,{});let h=v.root.innerHTML;assert.match(h,/ct-hero/);assert.match(h,/Current chapter/);assert.ok(!h.includes('<script>'));assert.match(h,/Clinician reviewed/i);assert.ok(!h.includes('Verified by'));v.events.click({target:{closest:()=>({dataset:{stepScope:'all'},hasAttribute:()=>false})}});h=v.root.innerHTML;assert.match(h,/Your sugar test|&lt;script&gt;/);assert.match(h,/1 May 2026|May 1, 2026/);assert.match(h,/data-step-help/);assert.match(h,/data-step-evidence/);});
test('baby lanes use each child’s individual vaccine records and filters are functional',()=>{const v=view();v.window.PatientJourney.update(data,{});const click=dataset=>v.events.click({target:{closest:()=>({dataset,hasAttribute:()=>false})}});click({journeyLane:'baby'});assert.match(v.root.innerHTML,/Baby’s journey|Baby’s care|Separate care/);assert.match(v.root.innerHTML,/stop-completed/);click({journeyBaby:'2'});assert.ok(!v.root.innerHTML.includes('stop-completed'));click({journeyFilter:'nutrition'});assert.match(v.root.innerHTML,/No steps in this view/);});
test('postpartum next action comes from recovery rather than an old antenatal gap',()=>{
 const v=view();v.window.PatientJourney.update({...data,post:{active:true,delivery:{date:'2026-10-01'},schedule:[{code:'pnc7',title:'Recovery visit',window_end:'2026-10-08',status:'overdue',why:'Review recovery with your care team.'}]}},{});
 const h=v.root.innerHTML;
 assert.match(h,/id="journey-stop-post-pnc7" class="journey-stop stop-overdue stop-current"/);
 assert.ok(!/id="journey-stop-2" class="[^"]*stop-current/.test(h));
 assert.match(h,/data-stop-expand="journey-stop-post-pnc7" open/);
 assert.match(h,/Your recovery/);
 assert.ok(!h.includes('journey-week-ruler'));
});
test('only the next step opens initially and manually opened history survives refresh',()=>{
 const v=view();v.window.PatientJourney.update(data,{});
 assert.equal((v.root.innerHTML.match(/data-stop-expand="[^"]+" open/g)||[]).length,1);
 v.events.click({target:{closest:()=>({dataset:{stepScope:'all'},hasAttribute:()=>false})}});
 v.events.toggle({target:{dataset:{stopExpand:'journey-stop-1'},open:true}});
 v.window.PatientJourney.update(data,{});
 assert.match(v.root.innerHTML,/data-stop-expand="journey-stop-1" open/);
 assert.match(v.root.innerHTML,/Earlier care/);
 assert.match(v.root.innerHTML,/data-route="records"/);
});

test('timeline header contains no decorative image',()=>{const v=view();v.window.PatientJourney.update(data,{});assert.ok(!v.root.innerHTML.includes('<img'));assert.ok(!v.root.innerHTML.includes('journey-hero-art'));});

// Catch markup/renderer disconnects: the original tests supplied a mock mount even
// when the actual page no longer contained it.
test('patient page mounts the journey before optional clinician details',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../frontend/dashboard.html'),'utf8');
 const panel=page.slice(page.indexOf('<!-- TIMELINE -->'),page.indexOf('<!-- OUTREACH QUEUE'));
 assert.equal((panel.match(/id="timelineList"/g)||[]).length,1);
 assert.ok(panel.indexOf('id="timelineList"')<panel.indexOf('id="timelineRecordDetails"'));
 assert.match(panel,/<details[^>]*id="timelineRecordDetails"/);
 assert.doesNotMatch(panel,/<img/);
});

test('self-report and uploaded evidence never render as clinician confirmation',()=>{const v=view();v.window.PatientJourney.update({...data,milestones:[{...data.milestones[1],completed_at:'2026-10-25',completion_verification:'self_reported',workflow_state:'patient_reported'}]},{});assert.match(v.root.innerHTML,/You reported done/);assert.doesNotMatch(v.root.innerHTML,/stop-completed/);assert.equal(M.status({status:'completed',completion_verification:'awaiting_verification'}),'review');});

test('overview chart reports actual states and keeps the review explanation collapsible',()=>{const v=view();v.window.PatientJourney.update({...data,milestones:[{...data.milestones[1],completed_at:'2026-10-25',completion_verification:'self_reported'},{...data.milestones[2],result_id:20,completion_verification:'awaiting_verification'}]},{});assert.match(v.root.innerHTML,/aria-label="Clinician reviewed: 0, Awaiting review: 1, Your updates: 1, Other recorded steps: 0"/);assert.match(v.root.innerHTML,/<details class="ct-proof-guide"><summary>/);assert.match(v.root.innerHTML,/class="path-node"[^]*<strong>/);});
