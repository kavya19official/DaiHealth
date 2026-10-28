'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express'),{randomUUID}=require('node:crypto');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs');
test('local in-app demo messages persist once, isolate connections, require verification and honour revoked sharing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'demo-messages-')),pool=createLocalPool(dir),before={DAI_LOCAL:process.env.DAI_LOCAL,DAI_DEMO:process.env.DAI_DEMO};let server;
 process.env.DAI_LOCAL='true';process.env.DAI_DEMO='true';
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  const ids=[];for(const role of ['mother','mother','doctor','doctor'])ids.push((await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'unused',$2) RETURNING id",[role+ids.length+'@dai-synthetic.invalid',role])).rows[0].id);
  const [mother,other,doctor,unverified]=ids;
  for(const id of [mother,other])await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date) VALUES($1,'Synthetic mother',CURRENT_DATE)",[id]);
  for(const id of [doctor,unverified])await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified) VALUES($1,'Synthetic doctor','OBG','Fixture',$2)",[id,id===doctor]);
  await pool.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed')",[mother,doctor]);
  const app=express();app.use(express.json());require('./demoCareMessages')(app,{pool,authenticateToken:(req,res,next)=>{const id=Number(req.headers['x-user']);if(!id)return res.sendStatus(401);req.user={id,role:[mother,other].includes(id)?'mother':'doctor'};next();}});
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port+'/api/demo/care-messages';
  const request=async(url,user,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};};
  assert.equal((await request('/contacts',0)).status,401);assert.equal((await request('/contacts',unverified)).status,403);
  assert.equal((await request('/contacts',doctor)).data.contacts[0].id,mother);assert.equal((await request('/contacts',other)).data.contacts.length,0);
  const b={peer_id:mother,text:'Synthetic appointment question <script>not executable</script>',client_id:randomUUID()};
  assert.equal((await request('/thread',doctor,b)).status,201);assert.equal((await request('/thread',doctor,b)).status,200);assert.equal((await request('/thread',doctor,{...b,text:'Different content'})).status,409);
  assert.equal((await request('/thread?peer_id='+doctor,mother)).data.messages[0].body,b.text);assert.equal((await request('/thread?peer_id='+doctor,other)).status,403);
  assert.equal((await request('/thread',mother,{peer_id:doctor,text:'Synthetic reply',client_id:randomUUID()})).status,201);
  const thread=(await request('/thread?peer_id='+mother,doctor)).data.messages;assert.equal(thread.length,2);assert.equal(thread[0].mine,true);assert.equal(thread[1].mine,false);assert.equal('sender_id' in thread[0],false);
  assert.equal((await request('/thread',doctor,{peer_id:mother,text:'',client_id:randomUUID()})).status,400);
  await pool.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')",[mother,String(doctor)]);
  assert.equal((await request('/contacts',doctor)).data.contacts.length,0);assert.equal((await request('/thread?peer_id='+mother,doctor)).status,403);assert.equal((await request('/thread',doctor,{...b,client_id:randomUUID()})).status,403);
  process.env.DAI_LOCAL='false';assert.equal((await request('/contacts',doctor)).status,404);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM demo_care_messages')).rows[0].n),2);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM patient_access_events WHERE event_type='demo_message_sent'")).rows[0].n),2);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await fs.rm(dir,{recursive:true,force:true});for(const [k,v]of Object.entries(before))v===undefined?delete process.env[k]:process.env[k]=v;}
});
