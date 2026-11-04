'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../frontend/js/patient-home-open'),M=require('../frontend/js/patient-model');
test('home groups every old outstanding record and limits journey nodes without changing care data',()=>{
 const rows=[...Array.from({length:9},(_,i)=>({id:'old-'+i,due_date:'2026-01-0'+(i+1),status:'pending'})),...Array.from({length:8},(_,i)=>({id:'next-'+i,due_date:'2026-12-0'+(i+1),status:'pending'})),{id:'done',due_date:'2026-10-01',status:'completed'}];
 const before=JSON.stringify(rows),view=L.journey(rows,m=>M.status(m,'2026-11-04'));
 assert.equal(view.overdue.length,9);assert.equal(view.upcoming.length,8);assert.equal(view.done.length,1);
 assert(view.nodes.length+1<=6);assert.equal(view.nodes[0].id,'next-0');assert.equal(JSON.stringify(rows),before);
 assert.equal(new Set(view.overdue.map(r=>r.id)).size,9);
});
test('queued completion stays unconfirmed and missing dates are never invented',()=>{
 const input=[{id:1,queued:true},{id:2,status:'completed'},{id:3}];const v=L.journey(input,M.status);
 assert.deepEqual(v.done.map(r=>r.id),[2]);assert.equal(v.upcoming.length,2);assert.equal(v.overdue.length,0);assert(v.nodes.some(r=>r.queued));assert(v.nodes.every(r=>r.due_date===undefined));
});
test('vaccine illustrations distinguish oral, injected and combined doses without changing schedule or status',()=>{
 assert.equal(L.vaccineIcon('opv0'),'drop');assert.equal(L.vaccineIcon('rota3'),'drop');assert.equal(L.vaccineIcon('bcg'),'syringe');assert.equal(L.vaccineIcon('fipv2'),'syringe');assert.equal(L.vaccineIcon('pcv1'),'shield');
});
test('missing, invalid and future birth dates stay missing',()=>{
 for(const d of [null,undefined,'','invalid','2026-02-30','2026-11-05'])assert.equal(L.validBirthDate({date_of_birth:d},'2026-11-04'),false);
 assert.equal(L.validBirthDate({date_of_birth:'2026-11-04'},'2026-11-04'),true);
});
test('map rejects unknown coordinates and never turns a missing location into zero kilometres',()=>{
 assert.equal(L.validPoint({lat:null,lng:77}),false);assert.equal(L.validPoint({lat:'',lng:77}),false);assert.equal(L.validPoint({lat:91,lng:77}),false);
 assert.equal(L.distance({lat:null,lng:77},{lat:28,lng:77}),null);assert.equal(L.validPoint({lat:0,lng:0}),true);
 const a={lat:28.6,lng:77.2},b={lat:28.61,lng:77.21};assert(L.distance(a,b)>1&&L.distance(a,b)<2);assert.equal(L.distance(a,a),0);
});
