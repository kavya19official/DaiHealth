'use strict';
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(root+'/frontend/dashboard.html','utf8'),{url:'https://dai.test/dashboard.html#birth-plan',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
let plan={preferences:{},version:0,updated_at:null},entries=[],calls=[],fail=false;
w.confirm=()=>true;w.DaiAPI={API_BASE:'/api',toast:()=>{},apiRequest:async(path,options)=>{calls.push({path,options});if(options&&fail)return null;
if(path==='/patient/birth-plan'){if(options){plan={preferences:options.body.preferences,version:plan.version+1,updated_at:new Date().toISOString()};}return {plan:structuredClone(plan)};}
if(path==='/documents')return {documents:[{id:4,title:'Synthetic original <img onerror="bad()">',child_id:7,is_sensitive:false}]};
if(path.startsWith('/patient/report-timeline'))return {entries:structuredClone(entries)};
if(path.endsWith('/patient-preview'))return {candidates:{report_date:'2026-11-01',observations:[{label:'Hb',value:'11.2',unit:'g/dL',reference_range:'10-14'}]},source_sha256:'a'.repeat(64),warnings:['Check original']};
if(path.endsWith('/patient-confirm')){entries=[{id:'id',document_id:4,title:'<img onerror="bad()">',child_id:7,report_date:options.body.report_date,observations:options.body.observations}];return {entry:entries[0],message:'Saved'};}
throw Error(path);}};
const tick=()=>new Promise(r=>setTimeout(r,20));
const submit=form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
(async()=>{w.eval(fs.readFileSync(root+'/frontend/js/patient-report-birth.js','utf8'));await tick();
const form=d.getElementById('birthPlanForm');assert.ok(form);assert.equal(d.getElementById('birthPlanPrint').disabled,true);
form.elements.facility.value='My chosen centre';form.elements.emergency_phone.value='1234567890';form.dispatchEvent(new w.Event('input',{bubbles:true}));submit(form);await tick();assert.equal(plan.preferences.facility,'My chosen centre');assert.equal(d.getElementById('birthPlanPrint').disabled,true);
d.getElementById('birthPlanShareConsent').checked=true;d.getElementById('birthPlanShareConsent').dispatchEvent(new w.Event('change'));assert.equal(d.getElementById('birthPlanPrint').disabled,false);
form.elements.facility.value='Unsaved edits';form.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.getElementById('birthPlanPrint').disabled,true);fail=true;submit(form);await tick();assert.equal(form.elements.facility.value,'Unsaved edits');assert.match(d.getElementById('birthPlanStatus').textContent,/Not saved/);fail=false;
w.dispatchEvent(new w.CustomEvent('dai:patient-panel',{detail:{panel:'records'}}));await tick();d.getElementById('patientLabSelect').value='4';d.querySelector('[data-lab-preview]').click();await tick();assert.equal(entries.length,0);let dialog=d.querySelector('.prb-dialog');assert.ok(dialog);assert.equal(dialog.querySelector('input[name=confirmSource]').checked,false);assert.equal(dialog.querySelector('[data-confirm]').checked,false);dialog.querySelector('[data-cancel]').click();assert.equal(entries.length,0);
d.querySelector('[data-lab-preview]').click();await tick();dialog=d.querySelector('.prb-dialog');dialog.querySelector('[data-confirm]').checked=true;dialog.querySelector('[name=confirmSource]').checked=true;fail=true;submit(dialog.querySelector('form'));await tick();assert.ok(d.querySelector('.prb-dialog'));assert.match(dialog.querySelector('[data-status]').textContent,/Not saved/);fail=false;submit(dialog.querySelector('form'));await tick();assert.equal(d.querySelector('.prb-dialog'),null);assert.equal(entries.length,1);assert.equal(d.getElementById('patientLabTimeline').querySelector('img'),null);assert.match(d.getElementById('patientLabTimeline').textContent,/Child record #7/);assert.match(d.getElementById('patientLabTimeline').textContent,/interval from 10 to 14/);assert.equal(calls.filter(x=>x.path.endsWith('/patient-confirm')&&!x.options.body.confirm_source).length,0);
const ids=[...d.querySelectorAll('[id]')].map(n=>n.id);assert.equal(ids.length,new Set(ids).size);console.log('PASS: birth-plan save/share consent, unsaved and failed-save preservation, preview discard, explicit confirmation, source labels, child separation and XSS escaping.');dom.window.close();})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
