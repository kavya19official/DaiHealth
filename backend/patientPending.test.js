'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const P=require('../frontend/js/patient-pending-model'),M=require('../frontend/js/patient-model');
const state={user:{id:1,lmp_date:'2026-05-01'},milestones:[{id:1,title:'Routine visit',due_date:'2026-10-01',status:'upcoming'},{id:2,title:'OGTT',due_date:'2026-10-15',status:'upcoming',clinician_priority:'high'},{id:3,title:'Hb',due_date:'2026-10-22',status:'upcoming'},{id:4,title:'Recorded visit',due_date:'2026-09-01',status:'completed',completed_at:'2026-09-01'},{id:5,title:'Visit later',due_date:'2026-11-01',status:'upcoming'}],post:{},children:[{id:10,name:'Baby A',date_of_birth:'2026-10-01',vaccinations:[{vaccine_code:'bcg',given_on:'2026-10-01'}]},{id:11,name:'Baby B',date_of_birth:'2026-10-01',vaccinations:[]}]};
test('pending care derives mutually exclusive counts and prioritises clinician importance within overdue care',()=>{
 const rows=P.rows(state,'mother',null,'2026-10-20');assert.deepEqual(rows.map(x=>x.id),[2,1,3,5,4]);
 const n=P.summary(rows,'2026-10-20');assert.deepEqual(n,{overdue:2,week:1,upcoming:1,completed:1,queued:0,total:5,attention:3,percent:20});
 assert.match(P.reason(rows[0],'2026-10-20'),/Priority recorded by your clinician · Due 5 days ago/);
 assert.equal(P.priority({priority:'high'}),0); // Unattributed priorities do not become clinician priorities.
});
test('twins use separate completion records and combined view contains only the selected baby',()=>{
 const a=P.rows(state,'baby',10,'2026-10-20'),b=P.rows(state,'baby',11,'2026-10-20');
 assert.ok(a.every(x=>x.child_id===10));assert.ok(b.every(x=>x.child_id===11));
 assert.equal(a.filter(x=>P.status(x,'2026-10-20')==='completed').length,1);
 assert.equal(b.filter(x=>P.status(x,'2026-10-20')==='completed').length,0);
 const together=P.rows(state,'together',11,'2026-10-20');assert.ok(together.some(x=>x.source==='milestone'));assert.ok(!together.some(x=>x.child_id===10));
});
test('postpartum care omits open antenatal gaps but retains recorded history and recovery followups',()=>{
 const rows=P.rows({...state,post:{active:true,delivery:{date:'2026-10-10'},schedule:[{code:'day7',title:'Recovery check-in',window_end:'2026-10-17',status:'overdue'}]}},'mother',null,'2026-10-20');
 assert.deepEqual(rows.map(x=>x.id),['post-day7',4]);assert.equal(P.category(rows[0]),'postpartum');
});
function view(){const root={innerHTML:'',classList:{add(){}}},events={};const document={getElementById:id=>id==='allCareGaps'?root:null,documentElement:{lang:'en'},addEventListener:(type,fn)=>events[type]=fn};const window={PatientPendingModel:P,PatientModel:M};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-pending.js'),'utf8'),{window,document,Map,Date,console});return {root,events,window};}
test('pending view escapes patient content and filters do not invent verification or booked progress',()=>{
 const v=view();v.window.PatientPending.update({...state,milestones:[{id:9,title:'<script>untrusted</script>',due_date:'2026-10-01',guidance:'<b>unsafe HTML</b>',status:'upcoming'},{id:10,title:'Check',due_date:'2026-09-01',status:'completed'}]});
 assert.match(v.root.innerHTML,/&lt;script&gt;/);assert.ok(!v.root.innerHTML.includes('<script>'));assert.match(v.root.innerHTML,/START HERE/);assert.ok(!v.root.innerHTML.includes('Verified by'));
 assert.match(v.root.innerHTML,/<span class="">Booked<\/span>/);assert.match(v.root.innerHTML,/Facility verification is not recorded/);
 const click=dataset=>v.events.click({target:{closest:()=>({dataset,hasAttribute:()=>false})}});
 click({pendingBucket:'completed'});assert.ok(!v.root.innerHTML.includes('START HERE'));assert.match(v.root.innerHTML,/pending-history" open/);
 click({pendingLane:'baby'});assert.match(v.root.innerHTML,/Baby A/);click({pendingBaby:'11'});assert.ok(!v.root.innerHTML.includes('id="pending-child-10-'));
});
