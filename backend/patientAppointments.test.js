'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../frontend/js/patient-appointments-model');
test('appointment lists do not duplicate the hero or infer a completed visit from a past date',()=>{
 const rows=[{id:1,status:'pending',requested_date:'2026-11-07'},{id:2,status:'confirmed',requested_date:'2026-11-08'},{id:3,status:'confirmed',requested_date:'2026-11-01'},{id:4,status:'cancelled',requested_date:'2026-11-09'},{id:5,status:'completed',requested_date:'2026-11-02'}];const p=A.partition(rows,'2026-11-06');assert.equal(p.next.id,1);assert.deepEqual(p.upcoming.map(x=>x.id),[2]);assert.deepEqual(p.past.map(x=>x.id),[3,5]);assert.equal(A.status(p.past[0]),'Clinic confirmed');assert.equal(p.cancelled[0].id,4);
});
test('clinic states stay distinct; patient reporting never advances clinician completion',()=>{
 for(const [status,idx] of [['pending',0],['confirmed',1],['completed',2]]){const a={status,patient_reported_done:true};assert.equal(A.tracker(a).findIndex(s=>s.state==='current'),idx);assert.equal(A.tracker(a)[3].state,'unrecorded');}assert.ok(A.tracker({status:'cancelled'}).every(x=>x.state==='unknown'));assert.equal(A.status({status:'accepted'}),'Status not recorded');
});
test('titles use visit types while twin subjects use explicit identifiers only',()=>{
 assert.equal(A.title({reason:'Synthetic daily demonstration booking · Child follow-up',visit_type:'paediatric'}),'Child follow-up');assert.equal(A.title({reason:'Synthetic daily demonstration booking · Check-up'}),'Check-up');const children=[{id:7,name:'Baby A'},{id:8,name:'Baby B'}];assert.deepEqual(A.subjects({child_id:8},children),[{id:8,name:'Baby B'}]);assert.equal(A.subjects({child_id:7},children).length,1);assert.equal(A.subjects({child_ids:[7,8]},children).length,2);assert.equal(A.subjects({},children)[0].id,'mother');
});
test('countdown uses the recorded India appointment time, never a live arrival estimate',()=>{
 const a={requested_date:'2026-11-06',requested_time:'11:30:00'};assert.equal(A.countdown(a,new Date('2026-11-06T05:00:00Z')),'In 1h');assert.equal(A.countdown(a,new Date('2026-11-06T07:00:00Z')),null);assert.equal(A.countdown({...a,requested_time:null}),null);assert.equal(A.countdown(a,new Date('2026-11-01T05:00:00Z')),null);
});
test('voice fills the requested baby and visit type but never submits or creates appointment data',()=>{
 const c=[{id:41,name:'Baby A'},{id:77,name:'Baby B'}];assert.deepEqual(A.voice('book a visit for Baby 2',c),{subject:'77',visit_type:'paediatric'});assert.deepEqual(A.voice('बेबी 2 का टीका',c),{subject:'77',visit_type:'baby_vaccine'});assert.equal(A.voice('Baby 9',c).subject,'');
});
test('lazy QR bundle matches installed qrcode matrix and contains only an appointment reference',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/vendor/appointments/qrcode-svg.js'),'utf8'),{window,TextEncoder,Uint8Array,Uint16Array,Uint32Array});const a={id:55,mother_id:3,reason:'Private record'},reference=A.reference(a);assert.equal(reference,'DAI-APPT-55');const actual=window.DaiAppointmentQR.svg(reference),QR=require('qrcode/lib/core/qrcode'),render=require('qrcode/lib/renderer/svg-tag');assert.equal(actual,render.render(QR.create(reference,{errorCorrectionLevel:'M'}),{margin:4,width:112}));assert.doesNotMatch(actual,/Private record/);
});

test('missing or impossible dates remain missing instead of turning into calendar entries',()=>{assert.equal(A.day({}), '');assert.equal(A.day({requested_date:'2026-02-30'}),'');assert.equal(A.day({requested_date:'2026-11-06T00:00:00Z'}),'2026-11-06');});
