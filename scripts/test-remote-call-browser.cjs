'use strict';
// Development only: NODE_PATH=/path/to/playwright-core/node_modules node scripts/test-remote-call-browser.cjs
// Uses synthetic browser media, isolated test records and temporary storage. Never opens real devices.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const express=require('../backend/node_modules/express'),cookieParser=require('../backend/node_modules/cookie-parser'),jwt=require('../backend/node_modules/jsonwebtoken');
const {chromium}=require('playwright-core'),{createLocalPool}=require('../backend/localPool'),{migrations}=require('./seed-local.cjs');
const ROOT=path.join(__dirname,'..'),EXE=process.env.DAI_TEST_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-call-browser-')),pool=createLocalPool(path.join(dir,'db'));let server,browser;
try{
 for(const file of migrations)await pool.query(await fs.readFile(path.join(ROOT,'backend/db',file),'utf8'));
 await pool.query("INSERT INTO users(email,password_hash,role) VALUES('parent@synthetic.invalid','test-only','mother'),('doctor@synthetic.invalid','test-only','doctor')");
 await pool.query("INSERT INTO mother_profiles(user_id,full_name) VALUES(1,'Synthetic Call Patient')");
 await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES(2,'Synthetic Call Doctor','Obstetrics','TEST-ONLY',TRUE)");
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());const id=(await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status,reason) VALUES(1,2,$1,'confirmed','Synthetic connectivity check') RETURNING id",[today])).rows[0].id;
 const app=express();app.use(express.json(),cookieParser());const secret='isolated-browser-test-only';
 const opts={pool,async authenticateToken(req,res,next){try{const claim=jwt.verify(req.cookies.token,secret),user=(await pool.query('SELECT id,role FROM users WHERE id=$1 AND closed_at IS NULL',[claim.id])).rows[0];if(!user)return res.sendStatus(401);req.user=user;next();}catch{res.sendStatus(401);}},authorizeRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)};
 require('../backend/clinicalContinuity')(app,opts);
 app.get('/remote-followup.js',(req,res)=>res.sendFile(path.join(ROOT,'frontend/js/remote-followup.js')));app.get('/connected-care.css',(req,res)=>res.sendFile(path.join(ROOT,'frontend/connected-care.css')));
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic DAI call test</title><link rel="stylesheet" href="/connected-care.css"></head><body><section id="panel-appointments"></section><script>window.DaiAPI={API_BASE:"/api",toast:()=>{},apiRequest:async(p,o={})=>{const r=await fetch("/api"+p,{credentials:"include",method:o.method||"GET",headers:{"Content-Type":"application/json"},body:o.body?JSON.stringify(o.body):undefined});return r.ok?r.json():null;}};</script><script src="/remote-followup.js"></script></body></html>';
 app.get(['/doctor.html','/dashboard.html'],(req,res)=>res.send(html));app.get('/favicon.ico',(req,res)=>res.sendStatus(204));
 server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:EXE,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const parentContext=await browser.newContext({permissions:['camera','microphone'],viewport:{width:1024,height:768}}),doctorContext=await browser.newContext({permissions:['camera','microphone'],viewport:{width:1024,height:768}});
 for(const [context,user]of [[parentContext,1],[doctorContext,2]])await context.addCookies([{name:'token',value:jwt.sign({id:user},secret),url:origin,httpOnly:true,sameSite:'Lax'}]);
 const parent=await parentContext.newPage(),doctor=await doctorContext.newPage(),pageErrors=[],serverErrors=[];
 for(const page of [parent,doctor]){page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{if(r.status()>=500)serverErrors.push(r.url()+':'+r.status());});}
 await Promise.all([parent.goto(origin+'/dashboard.html'),doctor.goto(origin+'/doctor.html')]);
 for(const page of [parent,doctor]){await page.locator('[data-remote-refresh]').click();await page.locator('[data-remote-id="'+id+'"]').click();}
 await parent.locator('[data-consent] [name=mode]').selectOption('video');await parent.locator('[data-consent] [name=consent]').check();await parent.locator('[data-consent] button').click();await parent.locator('[data-call-status]').filter({hasText:'Consent choice saved'}).waitFor();
 await parent.locator('[data-join]').click();await doctor.locator('[data-join]').click();
 for(const page of [parent,doctor])await page.waitForFunction(()=>{const v=document.querySelector('[data-remote]');return v?.srcObject&&v.videoWidth>0&&v.readyState>=2;},{},{timeout:30000});
 assert.equal(await parent.locator('[data-local]').evaluate(v=>v.srcObject.getVideoTracks().length),1);
 assert.equal(await doctor.locator('[data-local]').evaluate(v=>v.srcObject.getAudioTracks().length),1);
 await doctor.locator('[data-notes] textarea').fill('Synthetic clinician follow-up note; no medication advice.');
 await doctor.locator('[data-notes] [type=submit]').click();
 await doctor.locator('[data-call-status]').filter({hasText:'Private draft note saved'}).waitFor();
 assert.equal((await (await parent.request.get(origin+'/api/remote-visits/'+id)).json()).visit.notes,null);
 await doctor.locator('[data-notes] [name=release]').check();
 await doctor.locator('[data-notes] [type=submit]').click();
 await doctor.locator('[data-call-status]').filter({hasText:'Visit note released'}).waitFor();
 assert.equal((await (await parent.request.get(origin+'/api/remote-visits/'+id)).json()).visit.notes,'Synthetic clinician follow-up note; no medication advice.');
 assert.equal((await pool.query('SELECT status FROM appointments WHERE id=$1',[id])).rows[0].status,'confirmed');

 await parent.locator('[data-consent] [name=consent]').uncheck();await parent.locator('[data-consent] button').click();
 for(const page of [parent,doctor])await page.waitForFunction(()=>{const v=document.querySelector('[data-local]');return v?.srcObject?.getTracks().every(t=>t.readyState==='ended');},{},{timeout:10000});
 const state=(await pool.query('SELECT revoked_at FROM remote_visits WHERE appointment_id=$1',[id])).rows[0];assert.ok(state.revoked_at);assert.deepEqual(pageErrors,[]);assert.deepEqual(serverErrors,[]);
 console.log('PASS: two isolated browsers exchanged synthetic video/audio; both stopped their media after patient consent withdrawal; drafts remained private until clinician release; no page errors or API 5xx responses.');
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
