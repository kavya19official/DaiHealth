'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const M=require('../frontend/js/patient-model'),Child=require('../shared/child-reference');
function view(){const timers=[];const roots=Object.fromEntries(['connectedAppointments','connectedRecords','connectedReportArea','reportsDocsList'].map(id=>[id,{innerHTML:'',hidden:false}])),events={};
 const records={profile:{full_name:'SYNTHETIC Mother <img>'},clinical:{visits:[],babies:[{local_child_id:12,birth_order:2,details:{birth_weight_g:2400,apgar_1min:8,apgar_5min:9}},{local_child_id:11,birth_order:1,details:{birth_weight_g:2100,apgar_1min:7,apgar_5min:8}}]}};
 const document={hidden:false,querySelector:()=>null,getElementById:id=>roots[id]||null,documentElement:{lang:'en'},addEventListener:(type,fn)=>events[type]=fn};
 const window={PatientAppointmentsModel:require('../frontend/js/patient-appointments-model'),PatientVisuals:require('../frontend/js/patient-visuals'),PatientModel:M,AnvayaChild:Child,DaiAPI:{apiRequest:async url=>url.includes('booking-options')?{doctors:[],facilities:[]}:url==='/documents'?{documents:[]}:records},PatientExperience:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/patient-connected.js'),'utf8'),{window,document,Date,Map,Set,console,navigator:{onLine:true},location:{hash:'#appointments'},setInterval:fn=>{timers.push(fn);return timers.length;}});
 return {window,roots,events,timers};
}
const state={user:{id:1,full_name:'SYNTHETIC Mother'},appointments:[{id:2,doctor_id:3,requested_date:'2030-01-01',reason:'<script>Appointment</script>',status:'pending'},{id:3,doctor_id:3,requested_date:'2026-01-01',reason:'Cancelled request',status:'cancelled'}],milestones:[],children:[{id:11,name:'Baby one',date_of_birth:'2026-06-01'},{id:12,name:'Baby two',date_of_birth:'2026-06-01'}],post:{}};
const click=(v,dataset)=>v.events.click({target:{closest:()=>({dataset,hasAttribute:()=>false})}});
test('connected screens render real appointment states and escaped text without fabricated queue positions',async()=>{
 const v=view();v.window.PatientConnected.update(state);await new Promise(setImmediate);
 assert.match(v.roots.connectedAppointments.innerHTML,/Requested/);assert.match(v.roots.connectedAppointments.innerHTML,/&lt;script&gt;/);assert.ok(!v.roots.connectedAppointments.innerHTML.includes('<script>'));assert.ok(!v.roots.connectedAppointments.innerHTML.includes('4 patients ahead'));
 await click(v,{connectedTab:'cancelled'});assert.match(v.roots.connectedAppointments.innerHTML,/Cancelled request/);
 await click(v,{recordTab:'emergency'});assert.match(v.roots.connectedRecords.innerHTML,/Not recorded/);assert.ok(!v.roots.connectedRecords.innerHTML.includes('None recorded'));
});
test('vault matches twins by durable child IDs rather than array order and keeps private report names hidden',async()=>{
 const v=view();v.window.PatientConnected.update(state);await new Promise(setImmediate);await click(v,{recordTab:'vault'});
 const h=v.roots.connectedRecords.innerHTML;assert.match(h,/Baby one[^]*2100 g[^]*7 \/ 8/);assert.match(h,/Baby two[^]*2400 g[^]*8 \/ 9/);
 v.window.PatientConnected.documents([{id:1,title:'Private screening report',original_filename:'Private file',is_sensitive:true,mime_type:'application/pdf',doc_type:'lab_report',uploaded_at:'2026-10-01'}]);
 assert.match(v.roots.reportsDocsList.innerHTML,/Private · hidden/);assert.match(v.roots.reportsDocsList.innerHTML,/Reveal report/);
});

test('baby selection keeps each sibling record separate and report chips filter actual metadata',async()=>{
 const v=view();v.window.PatientConnected.update(state);await new Promise(setImmediate);await click(v,{recordTab:'vault'});
 await click(v,{vaultBaby:'11'});assert.match(v.roots.connectedRecords.innerHTML,/data-record-child="11"/);assert.doesNotMatch(v.roots.connectedRecords.innerHTML,/data-record-child="12"/);
 await click(v,{vaultBaby:'all'});assert.match(v.roots.connectedRecords.innerHTML,/data-record-child="12"/);
 v.window.PatientConnected.documents([{id:4,title:'Blood result',report_category:'blood',doc_type:'lab_report',mime_type:'application/pdf',uploaded_at:'2026-10-01'},{id:5,title:'Scan image',doc_type:'scan_imaging',mime_type:'image/png',uploaded_at:'2026-10-02'}]);
 await click(v,{reportCategory:'blood'});assert.match(v.roots.reportsDocsList.innerHTML,/Blood result/);assert.doesNotMatch(v.roots.reportsDocsList.innerHTML,/Scan image/);
 await click(v,{reportCategory:'all'});assert.match(v.roots.reportsDocsList.innerHTML,/Scan image/);
});

test('appointment polling refreshes saved status and hospital requests remain a separate tab',async()=>{
 const v=view();v.window.PatientConnected.update(state);await new Promise(setImmediate);
 v.window.DaiAPI.apiRequest=async url=>url==='/appointments'?{appointments:state.appointments.map(a=>({...a,status:a.id===2?'confirmed':a.status}))}:{};
 v.window.PatientExperience.update=next=>v.window.PatientConnected.update({...state,...next});
 await v.timers[0]();assert.match(v.roots.connectedAppointments.innerHTML,/Clinic confirmed/);assert.doesNotMatch(v.roots.connectedAppointments.innerHTML,/Visit recorded · staff-confirmed<\/span>/);
 v.window.DaiPatientRequests={rows:[{id:'request-1',status:'accepted'}]};await click(v,{connectedTab:'requests'});assert.match(v.roots.connectedAppointments.innerHTML,/Requests · 1/);assert.match(v.roots.connectedAppointments.innerHTML,/connectedRequestSlot/);assert.doesNotMatch(v.roots.connectedAppointments.innerHTML,/data-appointment-id=/);
});
