'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const M=require('../frontend/js/patient-model'),Ref=require('../shared/child-reference');
function view(){const root={innerHTML:'',classList:{toggle(){}}},events={};const document={getElementById:id=>id==='timelineList'?root:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,fn)=>events[type]=fn,documentElement:{lang:'en'}};const window={PatientModel:M,AnvayaChild:Ref};const context={window,document,AnvayaChild:Ref,Map,Set,Date,console};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-journey.js'),'utf8'),context);return {window,root,events};}
const data={user:{lmp_date:'2026-04-24'},milestones:[{id:1,title:'First antenatal visit',category:'pregnancy',due_date:'2026-05-01',status:'completed'},{id:2,title:'<script>OGTT</script>',category:'pregnancy',due_date:'2026-10-25',status:'upcoming'},{id:3,title:'Birth plan & facility readiness',category:'pregnancy',due_date:'2027-01-01',status:'upcoming'}],appointments:[],children:[{id:1,name:'SYNTHETIC Baby A',date_of_birth:'2026-10-01',vaccinations:[{vaccine_code:'bcg',given_on:'2026-10-01'}]},{id:2,name:'SYNTHETIC Baby B',date_of_birth:'2026-10-01',vaccinations:[]}],post:{},overview:{}};
test('journey preserves recorded dates, sections and honest completion without inventing result verification',()=>{const v=view();v.window.PatientJourney.update(data,{});const h=v.root.innerHTML;assert.match(h,/journey-zone-t1/);assert.match(h,/journey-zone-t2/);assert.match(h,/journey-zone-t3/);assert.match(h,/Your sugar test|&lt;script&gt;/);assert.ok(!h.includes('<script>'));assert.match(h,/Completion recorded; result verification is not implied/);assert.ok(!h.includes('Verified by'));assert.match(h,/winding-river/);assert.match(h,/journeyWeek/);});
test('baby lanes use each child’s individual vaccine records and filters are functional',()=>{const v=view();v.window.PatientJourney.update(data,{});const click=dataset=>v.events.click({target:{closest:()=>({dataset,hasAttribute:()=>false})}});click({journeyLane:'baby'});assert.match(v.root.innerHTML,/journey-zone-baby/);assert.match(v.root.innerHTML,/stop-completed/);click({journeyBaby:'2'});assert.ok(!v.root.innerHTML.includes('stop-completed'));click({journeyFilter:'nutrition'});assert.match(v.root.innerHTML,/No recorded items match/);});
test('postpartum next action comes from recovery rather than an old antenatal gap',()=>{
 const v=view();v.window.PatientJourney.update({...data,post:{active:true,delivery:{date:'2026-10-01'},schedule:[{code:'pnc7',title:'Recovery visit',window_end:'2026-10-08',status:'overdue',why:'Review recovery with your care team.'}]}},{});
 const h=v.root.innerHTML;
 assert.match(h,/id="journey-stop-post-pnc7" class="journey-stop stop-overdue stop-current"/);
 assert.ok(!/id="journey-stop-2" class="[^"]*stop-current/.test(h));
 assert.match(h,/data-stop-expand="journey-stop-post-pnc7" open/);
 assert.match(h,/class="chapter-now"[^]*You are here/);
 assert.match(h,/journey-week-ruler" hidden/);
});
test('only the next step opens initially and manually opened history survives refresh',()=>{
 const v=view();v.window.PatientJourney.update(data,{});
 assert.equal((v.root.innerHTML.match(/data-stop-expand="[^"]+" open/g)||[]).length,1);
 v.events.toggle({target:{dataset:{stopExpand:'journey-stop-1'},open:true}});
 v.window.PatientJourney.update(data,{});
 assert.match(v.root.innerHTML,/data-stop-expand="journey-stop-1" open/);
 assert.match(v.root.innerHTML,/data-journey-chapter="t2"/);
 assert.match(v.root.innerHTML,/data-route="records"/);
});

test('timeline header contains no decorative image',()=>{const v=view();v.window.PatientJourney.update(data,{});assert.ok(!v.root.innerHTML.includes('<img'));assert.ok(!v.root.innerHTML.includes('journey-hero-art'));});
