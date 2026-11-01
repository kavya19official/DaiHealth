'use strict';
// Creates clearly labelled synthetic test records, then verifies saved cross-interface states.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const base=(process.env.DAI_CHECK_URL||'http://localhost:3001').replace(/\/$/,''),password=process.env.DAI_DEMO_PASSWORD||'Dai-Synthetic-2026!';
async function call(path,{cookie,token,method='GET',body,expect}={}){
 const r=await fetch(base+path,{method,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-dai-client':'portal',Origin:base,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw Error(path+' returned a non-JSON response ('+r.status+').');}
 assert.ok(expect?r.status===expect:r.ok,path+': '+r.status+' '+JSON.stringify(data).slice(0,250));return {data,response:r};
}
const nodeLogin=async role=>{const r=await call('/api/auth/login',{method:'POST',body:{email:role+'@dai-synthetic.invalid',password}});return {cookie:r.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),user:r.data.user};};
const staffLogin=async role=>{const q=(await call('/hospital-admin/api/auth/login',{method:'POST',body:{email:role+'@dai-synthetic.invalid',password}})).data;assert.ok(q.demo_otp,'Local demo OTP must be present');return (await call('/hospital-admin/api/auth/otp',{method:'POST',body:{challenge_id:q.challenge_id,code:q.demo_otp}})).data.access_token;};
const P='/api/facilities/demo-journey/',S='/hospital-admin/api/demo-coordination/staff';
async function main(){
 const status=(await call('/api/local/status')).data;assert.equal(status.local,true,'This mutating check is restricted to the local synthetic demo.');
 const patient=await nodeLogin('mother'),doctor=await nodeLogin('doctor');
 const timeline=(await call('/api/timeline',patient)).data;assert.ok(timeline.milestones.length);assert.ok((await call('/api/children',patient)).data.children.length>=2);
 const workspace=(await call('/api/doctor/workspace',doctor)).data;assert.ok(workspace.patients.some(p=>p.id===patient.user.id));
 const registration=await call('/api/auth/register/mother',{method:'POST',body:{email:'video-check-'+randomUUID()+'@dai-synthetic.invalid',password,full_name:'SYNTHETIC Registration Check',pregnancy_status:'pregnant',lmp_date:new Date(Date.now()-70*86400000).toISOString().slice(0,10)}});assert.ok(registration.data.user?.id||registration.data.userId||registration.data.user_id);
 const result=(await call(P+'search',{...patient,method:'POST',body:{location:{source:'manual_pin',pincode:'110017'},need:'antenatal',preferences:{language:'hindi'}}})).data;
 const f=result.facilities.find(f=>f.pincode==='110017');assert.ok(f,'South synthetic service must be present');assert.ok(f.ranking.reasons.length);
 const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10),note='Synthetic MVP verification; no real appointment or clinical advice.';
 let request=(await call(P+'requests',{...patient,method:'POST',body:{facility_id:Number(f.id),need:'antenatal',kind:'appointment',requested_date:date,patient_note:note,consent:true,request_key:randomUUID()}})).data.request;
 const admin=await staffLogin('hospital_admin');const affiliations=(await call('/hospital-admin/api/affiliations',{token:admin})).data.items;const south=affiliations.find(a=>a.facility_id===request.facility_id);assert.ok(south);
 await call('/hospital-admin/api/affiliations/'+south.id+'/switch',{token:admin,method:'POST'});
 let inbox=(await call(S+'/requests',{token:admin})).data;assert.ok(inbox.requests.some(r=>r.id===request.id));assert.ok(inbox.clinicians.length);const owner=(inbox.clinicians.find(c=>c.name===workspace.doctor.name)||inbox.clinicians[0]).id;
 if(request.status==='requested')request=(await call(S+'/requests/'+request.id,{token:admin,method:'POST',body:{version:request.version,status:'accepted',clinician_id:owner,public_note:'Synthetic request accepted and clinician assigned.'}})).data.request;
 if(request.status==='accepted')request=(await call(S+'/requests/'+request.id,{token:admin,method:'POST',body:{version:request.version,status:'scheduled',clinician_id:owner,scheduled_at:new Date(Date.now()+2*86400000).toISOString(),public_note:'Synthetic appointment time recorded for demo.'}})).data.request;
 assert.equal((await call(P+'requests',patient)).data.requests.find(r=>r.id===request.id).status,'scheduled');
 if(process.env.DAI_VIDEO_DEMO==='true'){const linked=(await call('/api/doctor/workspace',doctor)).data.coordination_requests.find(r=>r.id===request.id);assert.ok(linked,'Assigned receiving-facility request must reach the doctor workspace.');assert.equal(linked.status,'scheduled');}
 let task=(await call(S+'/followups',{token:admin,method:'POST',body:{request_id:request.id,title:'Synthetic video follow-up '+randomUUID().slice(0,8),due_date:date,assigned_to:owner,public_note:'Please confirm the synthetic appointment logistics.',request_key:randomUUID()}})).data.task;
 let mine=(await call(P+'followups',patient)).data.tasks.find(t=>t.id===task.id);assert.equal(mine.status,'open');
 mine=(await call(P+'followups/'+task.id+'/actions',{...patient,method:'POST',body:{version:mine.version,action:'acknowledge',public_note:'Synthetic patient acknowledged this coordination task.'}})).data.task;
 mine=(await call(P+'followups/'+task.id+'/actions',{...patient,method:'POST',body:{version:mine.version,action:'report_done',public_note:'Synthetic patient reports confirmation; staff review pending.'}})).data.task;
 task=(await call(S+'/followups/'+task.id+'/actions',{token:admin,method:'POST',body:{version:mine.version,action:'complete',public_note:'Synthetic coordination follow-up checked and closed.',evidence_ref:'SYNTHETIC-MVP-CHECK-NOT-CLINICAL'}})).data.task;
 assert.equal((await call(P+'followups',patient)).data.tasks.find(t=>t.id===task.id).status,'closed');assert.ok(task.history.length>=4);
 const consultant=await staffLogin('consultant');const ca=(await call('/hospital-admin/api/affiliations',{token:consultant})).data.items.find(a=>a.facility_id===request.facility_id);assert.ok(ca);await call('/hospital-admin/api/affiliations/'+ca.id+'/switch',{token:consultant,method:'POST'});
 let c=(await call(S+'/risk-cases',{token:consultant})).data.cases[0];c=(await call(S+'/risk-cases/'+c.id+'/review',{token:consultant,method:'POST',body:{version:c.version,review_reason:'Explicit synthetic simulation review for an MVP workflow test only.',evidence_ref:'SYNTHETIC-CASE-CHECK-NOT-CLINICAL-APPROVAL',simulation_acknowledged:true}})).data.case;
 const me=(await call('/hospital-admin/api/me',{token:consultant})).data;
 let flag=(await call(S+'/risk-flags',{token:consultant,method:'POST',body:{request_id:request.id,case_id:c.id,case_version:c.version,escalation_owner:me.id,reason:'Synthetic case requires the named owner to review the scripted escalation.',public_note:'Synthetic review escalation; not a medical prediction.'}})).data.flag;
 assert.ok((await call(P+'risk-flags',patient)).data.flags.some(f=>f.id===flag.id));assert.equal(flag.simulation_only,true);assert.equal(flag.clinical_approval_verified,false);
 flag=(await call(S+'/risk-flags/'+flag.id+'/actions',{token:consultant,method:'POST',body:{version:flag.version,action:'acknowledge',public_note:'Synthetic escalation owner acknowledges this scripted review.'}})).data.flag;
 await call(S+'/risk-flags/'+flag.id+'/actions',{token:consultant,method:'POST',body:{version:flag.version,action:'close',public_note:'Synthetic simulation disposition recorded; no clinical approval claimed.',evidence_ref:'SYNTHETIC-MVP-DISPOSITION'}});
 await call(S+'/requests/'+request.id,{token:admin,method:'POST',body:{version:request.version,status:'closed',clinician_id:owner,public_note:'Synthetic demo appointment coordination completed.'}});
 const docs=(await call('/api/doctor/documents',doctor)).data;assert.ok(Array.isArray(docs.documents));
 const messages=(await call('/api/demo/care-messages/contacts',doctor)).data;assert.ok(messages.contacts.some(c=>c.id===patient.user.id));const message='Synthetic MVP coordination check '+randomUUID();await call('/api/demo/care-messages/thread',{...doctor,method:'POST',body:{peer_id:patient.user.id,text:message,client_id:randomUUID()}});assert.ok((await call('/api/demo/care-messages/thread?peer_id='+doctor.user.id,patient)).data.messages.some(m=>m.body===message));
 const audit=(await call('/hospital-admin/api/audit',{token:admin})).data;assert.ok(audit.items?.length||Array.isArray(audit));
 console.log('PASS: registration; maternal/child records; assigned doctor; explainable discovery; patient request → facility staff → assigned clinician → scheduled state; patient/staff follow-up acknowledgement/report/closure; separately simulated risk review, named escalation owner and audit; scoped documents; saved in-app messages; administration audit.');
 console.log('All writes used local synthetic accounts. This check creates labelled test records; it does not prove clinical validation or real service availability.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
