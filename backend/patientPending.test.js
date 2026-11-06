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
function view(){const root={innerHTML:'',classList:{add(){}}},events={};const document={getElementById:id=>id==='allCareGaps'?root:null,documentElement:{lang:'en'},addEventListener:(type,fn)=>events[type]=fn};const window={PatientPendingModel:P,PatientModel:M};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-pending.js'),'utf8'),{window,document,Map,Date,console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});return {root,events,window};}
test('pending view escapes patient content and filters do not invent verification or booked progress',()=>{
 const v=view();v.window.PatientPending.update({...state,milestones:[{id:9,title:'<script>untrusted</script>',due_date:'2026-10-01',guidance:'<b>unsafe HTML</b>',status:'upcoming'},{id:10,title:'Check',due_date:'2026-09-01',status:'completed'}]});
 assert.match(v.root.innerHTML,/&lt;script&gt;/);assert.ok(!v.root.innerHTML.includes('<script>'));assert.match(v.root.innerHTML,/START HERE/);assert.ok(!v.root.innerHTML.includes('Verified by'));
 assert.match(v.root.innerHTML,/Waiting for review/);assert.match(v.root.innerHTML,/Clinician confirmation|clinician confirms/);
 const click=dataset=>v.events.click({target:{closest:()=>({dataset,hasAttribute:()=>false})}});
 click({pcSubject:'11'});assert.match(v.root.innerHTML,/Baby B/);assert.ok(!v.root.innerHTML.includes('id="pending-child-10-'));

});

test('presentation groups preserve self-report, evidence and confirmation and booking cannot close care',()=>{const ms=[{id:1,key:'a',completed_at:'2026-10-01',source:'milestone'},{id:2,key:'b',result_id:5,source:'milestone'},{id:3,key:'c',completion_verification:'verified',source:'milestone'},{id:4,key:'d',appointment_id:8,due_date:'2026-10-01',source:'milestone'}];const g=P.groups(ms,'2026-10-20');assert.equal(g.review.length,2);assert.equal(g.completed.length,1);assert.equal(g.arrange.length,1);assert.equal(P.workflow(ms[0]),'patient_reported');assert.equal(P.workflow(ms[1]),'awaiting_review');});
test('clinician priority comes first and optional ranking cannot cross priority categories',()=>{const ms=[{key:'a',due_date:'2026-10-01'},{key:'b',due_date:'2026-10-22',clinician_priority:'important'},{key:'c',due_date:'2026-10-04',clinician_priority:'urgent'}];assert.deepEqual(P.ranked(ms,r=>r.slice().reverse(),'2026-10-20').map(m=>m.key),['c','b','a']);});
