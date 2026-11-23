'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedCareChatDemo}=require('../scripts/seed-care-chat-demo.cjs');
test('Nivara and Hemangini demo dialogue is local-only, linked, additive and repeatable without duplicates',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dai-chat-seed-')),pool=createLocalPool(dir);let c;
 try{
  for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));
  await pool.query('CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB);CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,portal_uuid TEXT,target_id INTEGER)');
  const mother=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('mother@dai-synthetic.invalid','unused','mother') RETURNING id")).rows[0].id;
  const doctor=(await pool.query("INSERT INTO users(email,password_hash,role) VALUES('doctor@dai-synthetic.invalid','unused','doctor') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO mother_profiles(user_id,full_name,care_start_date) VALUES($1,'SYNTHETIC Nivara Sethi 0000001',CURRENT_DATE)",[mother]);
  await pool.query("INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number) VALUES($1,'Dr SYNTHETIC Hemangini Batra 00008','OBG','fixture')",[doctor]);
  await pool.query("INSERT INTO dai_local_source_link VALUES('mother','MOTHER-SYN-0000001','mother-uuid',$1),('doctor','doctor-source','doctor-uuid',$2)",[mother,doctor]);
  c=await pool.connect();
  assert.deepEqual(await seedCareChatDemo(c,{local:false,demo:true}),{disabled:true});
  assert.deepEqual(await seedCareChatDemo(c,{local:true,demo:false}),{disabled:true});
  assert.deepEqual(await seedCareChatDemo(c,{local:true,demo:true}),{skipped:true});
  assert.equal(Number((await c.query('SELECT COUNT(*) n FROM appointments')).rows[0].n),0);
  await c.query("INSERT INTO appointments(mother_id,doctor_id,requested_date,status) VALUES($1,$2,CURRENT_DATE,'confirmed')",[mother,doctor]);
  await c.query("INSERT INTO patient_access_controls(mother_id,grantee_type,grantee_ref,state) VALUES($1,'doctor',$2,'revoked')",[mother,String(doctor)]);
  assert.deepEqual(await seedCareChatDemo(c,{local:true,demo:true}),{skipped:true});
  await c.query('DELETE FROM patient_access_controls WHERE mother_id=$1',[mother]);
  const result=await seedCareChatDemo(c,{local:true,demo:true,now:new Date('2026-11-23T11:00:00Z')});assert.equal(result.messages,6);
  const rows=(await c.query('SELECT * FROM demo_care_messages ORDER BY id')).rows;
  assert.ok(rows.every(r=>r.mother_id===mother&&r.doctor_id===doctor));assert.deepEqual(rows.map(r=>r.sender_id),[mother,doctor,mother,doctor,mother,doctor]);assert.match(rows[0].body,/Dr. Hemangini/);
  await c.query("UPDATE demo_care_messages SET body='User edited this existing demo message' WHERE id=$1",[rows[0].id]);
  assert.deepEqual(await seedCareChatDemo(c,{local:true,demo:true}),{alreadySeeded:true});
  assert.equal(Number((await c.query('SELECT COUNT(*) n FROM demo_care_messages')).rows[0].n),6);assert.equal((await c.query('SELECT body FROM demo_care_messages WHERE id=$1',[rows[0].id])).rows[0].body,'User edited this existing demo message');
 }finally{c?.release();await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});
