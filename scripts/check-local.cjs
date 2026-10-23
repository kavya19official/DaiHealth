'use strict';
// Read-only smoke checks apart from creating/revoking demo login sessions.
const assert = require('node:assert/strict');
const base = process.env.DAI_CHECK_URL || 'http://localhost:3001';
const password = 'Dai-Synthetic-2026!';
async function request(path,options={}) {
 const response=await fetch(base+path,options);
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {response,data};
}
async function check(){
 const status=await request('/api/local/status');assert.equal(status.response.status,200);assert.equal(status.data.local,true);
 assert.equal(status.data.counts.mothers,2000);
 const home=await request('/');for(const role of ['mother','doctor','hospital']) assert.ok(home.data.includes('data-login-role="'+role+'"'));assert.ok(!home.data.includes('class="workspace-choices"'));
 assert.equal((await request('/api/auth/me')).response.status,401);
 const identities={};
 for(const role of ['mother','doctor']){
  const login=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:role+'@dai-synthetic.invalid',password})});
  assert.equal(login.response.status,200,role+' login');assert.equal(login.data.user.role,role);
  const cookie=login.response.headers.get('set-cookie').split(';')[0];identities[role]={cookie,user:login.data.user};
  const me=await request('/api/auth/me',{headers:{cookie}});assert.equal(me.data.user.id,login.data.user.id);
 }
 const patients=await request('/api/doctor/patients',{headers:{cookie:identities.doctor.cookie}});
 assert.equal(patients.response.status,200);assert.ok(patients.data.patients.some(p=>p.id===identities.mother.user.id || p.user_id===identities.mother.user.id),'assigned synthetic mother appears in doctor roster');
 const timeline=await request('/api/timeline',{headers:{cookie:identities.mother.cookie}});assert.equal(timeline.response.status,200);assert.ok(timeline.data.milestones.length);
 const children=await request('/api/children',{headers:{cookie:identities.mother.cookie}});assert.equal(children.response.status,200);assert.ok(children.data.children.length>=2,'separate twin profiles');
 const denied=await request('/api/doctor/patients',{headers:{cookie:identities.mother.cookie}});assert.equal(denied.response.status,403);
 const headers={'content-type':'application/json','x-dai-client':'portal',origin:base};
 const login=await request('/hospital-admin/api/auth/login',{method:'POST',headers,body:JSON.stringify({email:'hospital_admin@dai-synthetic.invalid',password})});assert.equal(login.response.status,200);
 const otp=await request('/hospital-admin/api/auth/otp',{method:'POST',headers,body:JSON.stringify({challenge_id:login.data.challenge_id,code:login.data.demo_otp})});assert.equal(otp.response.status,200);
 const refresh=otp.response.headers.get('set-cookie');assert.match(refresh,/Path=\/hospital-admin\/api\/auth/);
 const auth={...headers,authorization:'Bearer '+otp.data.access_token};
 const registry=await request('/hospital-admin/api/patients?q=MOTHER-SYN-0000001',{headers:auth});assert.equal(registry.response.status,200);assert.equal(registry.data.total,1);assert.equal(registry.data.items[0].details.name,identities.mother.user.full_name);
 const forecast=await request('/hospital-admin/api/ml/forecast',{headers:auth});assert.equal(forecast.response.status,200);
 const renewed=await request('/hospital-admin/api/auth/refresh',{method:'POST',headers:{...headers,cookie:refresh.split(';')[0]}});assert.equal(renewed.response.status,200,'refresh through same-origin proxy');
 const logout=await request('/hospital-admin/api/auth/logout',{method:'POST',headers:{...headers,authorization:'Bearer '+renewed.data.access_token,cookie:renewed.response.headers.get('set-cookie').split(';')[0]}});assert.equal(logout.response.status,200);
 console.log('PASS: shared login with three-role toggle; patient/doctor authenticated sessions; doctor–mother assignment; separate twin records; patient timeline; role denial; hospital OTP, source cohort match, ML API and refresh/logout through the unified origin.');
 console.log(JSON.stringify(status.data.counts,null,2));
}
check().catch(error=>{console.error(error);process.exitCode=1;});
