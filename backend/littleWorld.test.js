'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const M=require('../frontend/js/little-world-model'),Ref=require('../shared/child-reference');
test('ages handle weeks, calendar months, missing dates and future birthdays without invented values',()=>{
 assert.equal(M.age('2026-10-01','2026-10-24'),'3 weeks, 2 days');
 assert.equal(M.age('2026-06-01','2026-10-24'),'4 months old');
 assert.equal(M.days('2026-02-30','2026-10-24'),null);assert.equal(M.days('2027-01-01','2026-10-24'),null);assert.equal(M.age(null,'2026-10-24'),'Age not recorded');
});
test('next-dose ring uses only this child’s recorded given dates and clamps overdue time',()=>{
 const v=[{name:'Later',dueDate:'2026-12-01',daysUntil:40},{name:'Done',givenOn:'2026-10-01',dueDate:'2026-10-01'},{name:'Next',dueDate:'2026-11-01',daysUntil:8}];
 assert.equal(M.nextDose(v).name,'Next');assert.ok(M.ring('2026-10-01','2026-10-24',v)<100);assert.equal(M.ring('2026-01-01','2026-10-24',[{dueDate:'2026-03-01'}]),100);assert.equal(M.ring(null,'2026-10-24',v),0);
});
test('map rejects unknown coordinates and filters emergency only by explicit directory flag',()=>{
 assert.equal(M.coordinates({latitude:null,longitude:null}),null);assert.equal(M.coordinates({latitude:91,longitude:20}),null);assert.deepEqual(M.coordinates({latitude:0,longitude:0}),[0,0]);
 const rows=[{id:1,facility_type:'phc',emergency_24x7:false},{id:2,facility_type:'hospital',emergency_24x7:true},{id:3,facility_type:'diagnostic_lab'}];
 assert.deepEqual(M.filterFacilities(rows,'emergency').map(r=>r.id),[2]);assert.deepEqual(M.filterFacilities(rows,'primary').map(r=>r.id),[1]);assert.equal(M.kind(rows[2]),'lab');
});
function screen(){const node=()=>({innerHTML:'',classList:{add(){},remove(){}},querySelectorAll:()=>[],dataset:{}}),roots=Object.fromEntries(['babyWorld','vaccinePassport','babyExtras','worldBabyLogs','babyMemoryList','worldFixedSos','worldDisplayControls','recoveryWorld'].map(id=>[id,node()]));const events={};const document={getElementById:id=>roots[id]||null,querySelectorAll:()=>[],body:{classList:{add(){}},dataset:{},style:{setProperty(){}}},addEventListener:(k,fn)=>events[k]=fn,documentElement:{lang:'en'}};
 const window={LittleWorldModel:M,AnvayaChild:Ref,DaiAPI:{API_BASE:'/api',fmtDate:d=>d},DaiPrefs:{readLocal:()=>({})}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/little-world.js'),'utf8'),{window,document,Intl,Date,Map,Set,console,matchMedia:()=>({matches:true})});return {window,roots,events};}
test('baby world switching never retains a sibling’s doses or memories and escapes names',()=>{
 const v=screen(),a={id:11,name:'Baby <A>',date_of_birth:'2026-06-01',vaccinations:[{vaccine_code:Ref.UIP_SCHEDULE?.[0]?.code||'bcg',given_on:'2026-06-01'}],health_events:[{event_type:'note',title:'Memory: A smile',event_date:'2026-07-01'}]},b={id:12,name:'Baby B',date_of_birth:'2026-06-01',vaccinations:[],health_events:[]};
 v.window.LittleWorld.childUpdate({child:a,children:[a,b]});assert.match(v.roots.babyWorld.innerHTML,/Baby &lt;A&gt;/);assert.match(v.roots.babyMemoryList.innerHTML,/A smile/);assert.match(v.roots.vaccinePassport.innerHTML,/1 recorded doses/);
 v.window.LittleWorld.childUpdate({child:b,children:[a,b]});assert.doesNotMatch(v.roots.babyWorld.innerHTML,/Baby &lt;A&gt;/);assert.doesNotMatch(v.roots.babyMemoryList.innerHTML,/A smile/);assert.match(v.roots.vaccinePassport.innerHTML,/0 recorded doses/);assert.match(v.roots.vaccinePassport.innerHTML,/first stamp/);
});
test('recovery ring remains a time marker after six weeks without claiming recovery is complete',()=>{
 const v=screen();v.window.LittleWorld.recoveryUpdate({user:{id:1},post:{active:true,days_postpartum:100,delivery:{date:'2026-07-01'},schedule:[]},children:[]});
 assert.match(v.roots.recoveryWorld.innerHTML,/not a recovery assessment/);assert.doesNotMatch(v.roots.recoveryWorld.innerHTML,/recovered|you are safe/i);assert.match(v.roots.recoveryWorld.innerHTML,/first six-week time marker/);
});
