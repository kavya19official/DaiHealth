'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createLocalPool}=require('./localPool');
const {migrations}=require('../scripts/seed-local.cjs');

test('fresh local schema supports real registration, login, roles and persisted patient timelines',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dai-local-auth-'));
 const pool=createLocalPool(directory);
 for(const name of migrations) await pool.query(await fs.readFile(path.join(__dirname,'db',name),'utf8'));
 await pool.end();
 let child;
 const start=()=>new Promise((resolve,reject)=>{
  child=spawn(process.execPath,[path.join(__dirname,'server.js')],{cwd:__dirname,env:{...process.env,DAI_LOCAL:'true',DAI_LOCAL_DB_DIR:directory,DATABASE_URL:'',NODE_ENV:'development',JWT_SECRET:'synthetic-test-secret-with-at-least-32-characters',PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';const timer=setTimeout(()=>reject(new Error('Auth test server did not start: '+output)),30000);
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/DAI backend server running on port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
  child.stderr.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error(output));});
 });
 const stop=()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill('SIGTERM');});
 const send=async(base,url,body,cookie)=>{
  const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 try {
  let base=await start();
  const password='Synthetic-Registration-Test!';
  const mother=await send(base,'/api/auth/register/mother',{email:'registration-mother@dai-synthetic.invalid',password,full_name:'SYNTHETIC Registration Mother'});
  assert.equal(mother.status,201,JSON.stringify(mother.body));assert.equal(mother.body.user.role,'mother');
  const doctor=await send(base,'/api/auth/register/doctor',{email:'registration-doctor@dai-synthetic.invalid',password,full_name:'SYNTHETIC Registration Doctor',specialization:'Obstetrics',medical_license_number:'NMC-FAKE-REGISTRATION'});
  assert.equal(doctor.status,201,JSON.stringify(doctor.body));
  assert.equal((await send(base,'/api/auth/me',null,mother.cookie)).body.user.role,'mother');
  assert.equal((await send(base,'/api/doctor/patients',null,mother.cookie)).status,403);
  assert.equal((await send(base,'/api/auth/me',null,'token=invalid')).status,401);
  const timeline=await send(base,'/api/timeline',null,mother.cookie);assert.equal(timeline.status,200);assert.equal(timeline.body.milestones.length,17);
  await stop();base=await start();
  const login=await send(base,'/api/auth/login',{email:' REGISTRATION-MOTHER@DAI-SYNTHETIC.INVALID ',password});assert.equal(login.status,200);
  assert.equal((await send(base,'/api/timeline',null,login.cookie)).body.milestones.length,17);
  assert.equal((await send(base,'/api/auth/login',{email:'registration-doctor@dai-synthetic.invalid',password:'wrong'})).status,401);
 } finally {await stop();await fs.rm(directory,{recursive:true,force:true});}
});
