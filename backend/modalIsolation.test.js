'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const frontend=path.join(__dirname,'../frontend');
const read=f=>fs.readFileSync(path.join(frontend,f),'utf8');

test('feature styles cannot force closed facility dialogs open',()=>{
 const page=read('dashboard.html');
 for(const id of ['appointmentModal','facilityModal','referralModal']){
  const attrs=page.match(new RegExp('<div([^>]*id="'+id+'"[^>]*)>'))?.[1];
  assert.ok(attrs,id+' exists');assert.match(attrs,/\bhidden\b/);assert.doesNotMatch(attrs,/is-open|care-feature-modal/);
 }
 assert.match(page,/\.modal-overlay\s*\{[^}]*display:\s*none/s);
 assert.match(page,/\.modal-overlay\.is-open\s*\{\s*display:\s*flex/);
 for(const name of ['care-timeline-enhanced','missed-care-outreach','smart-referral-handoff']){
  const css=read('css/'+name+'.css').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(css,/(?:^|[},])\s*\.modal(?:-overlay|-header|-body|-close)?\b/,
   name+' must not style unrelated facility dialogs');
 }
});

test('facility dialogs open only by action, replace each other, and dismiss with close, backdrop or Escape',async()=>{
 const nodes=new Map(),listeners={};
 function node(id){if(!nodes.has(id)){const classes=new Set(id.endsWith('Modal')?['modal-overlay']:[]),events={};nodes.set(id,{id,value:'',innerHTML:'',hidden:false,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),dispatch:(name,event={})=>(events[name]||[]).forEach(fn=>fn(event)),focus(){}});}return nodes.get(id);}
 const overlays=['appointmentModal','facilityModal','referralModal'].map(node);
 const document={readyState:'complete',getElementById:node,querySelectorAll:()=>overlays,addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)};
 const window={DaiAPI:{apiRequest:async()=>({}),toast(){}},addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)};
 vm.runInNewContext(read('js/facility-discovery.js'),{window,document,console,Date,URLSearchParams,FormData,setTimeout,clearTimeout,navigator:{}});
 const open=()=>overlays.filter(n=>n.classList.contains('is-open')).map(n=>n.id);
 assert.deepEqual(open(),[]);assert.ok(overlays.every(n=>n.hidden));
 await window.FacilityDiscovery.bookAppointment(1);assert.deepEqual(open(),['appointmentModal']);assert.equal(node('appointmentModal').hidden,false);
 node('facilitiesList').dispatch('click',{target:{closest:()=>({getAttribute:key=>key==='data-action'?'refer':'2'})}});
 assert.deepEqual(open(),['referralModal']);
 node('closeReferralModal').dispatch('click');assert.deepEqual(open(),[]);assert.equal(node('referralModal').hidden,true);
 await window.FacilityDiscovery.bookAppointment(1);node('appointmentModal').dispatch('click',{target:node('appointmentModal')});assert.deepEqual(open(),[]);
 await window.FacilityDiscovery.bookAppointment(1);listeners.keydown.forEach(fn=>fn({key:'Escape'}));assert.deepEqual(open(),[]);
 await window.FacilityDiscovery.bookAppointment(1);listeners.pageshow.forEach(fn=>fn());assert.deepEqual(open(),[]);assert.ok(overlays.every(n=>n.hidden));
});

test('doctor timeline and referral panels are separate and retain the shared dashboard',()=>{
 const page=read('doctor.html');assert.equal((page.match(/id="panel-timeline"/g)||[]).length,1);
 assert.equal((page.match(/<\/head>/g)||[]).length,1);
 assert.match(page,/id="clinicalDashboardDoctor"/);assert.match(page,/src="js\/clinical-dashboard.js/);
 assert.match(page,/href="css\/smart-referral-handoff.css/);
 assert.ok(page.indexOf('id="panel-referrals"')<page.indexOf('id="panel-timeline"'));
});


test('DAI brand opens the shared sign-in page rather than a patient panel',()=>{
 const patient=read('dashboard.html').match(/<a[^>]*class="sidebar__brand patient-brand"[^>]*>[\s\S]*?<\/a>/)[0];
 const doctor=read('doctor.html').match(/<a[^>]*class="sidebar__brand patient-brand"[^>]*>[\s\S]*?<\/a>/)[0];
 assert.equal(doctor,patient);assert.doesNotMatch(doctor,/<img/);
 const brand=patient;
 assert.match(brand,/href="auth.html"/);assert.match(brand,/aria-label="DAI sign in"/);
 assert.doesNotMatch(brand,/data-go=|data-action=|#dashboard/);
 const auth=read('auth.html');
 for(const role of ['mother','doctor','hospital'])assert.ok(auth.includes('data-login-role="'+role+'"'));
});
