'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createLocalPool}=require('./localPool'),{migrations}=require('../scripts/seed-local.cjs'),{seedVideoDemo}=require('../scripts/seed-video-demo.cjs');
test('video availability is opt-in, visibly synthetic, facility-level and does not overwrite saved edits',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'video-slots-')),pool=createLocalPool(dir),old={DAI_LOCAL:process.env.DAI_LOCAL,DAI_VIDEO_DEMO:process.env.DAI_VIDEO_DEMO};let c;
 try{for(const f of migrations)await pool.query(await fs.readFile(path.join(__dirname,'db',f),'utf8'));await pool.query('CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB)');
 const f=(await pool.query("INSERT INTO facilities(facility_code,name,facility_type,address,city,district,state,pincode,verification_source) VALUES('VIDEO-ONLY','SYNTHETIC Fixture','clinic','Fictional','Delhi','Delhi','Delhi','110017','synthetic_delhi_focused_v1') RETURNING id")).rows[0];
 await pool.query("INSERT INTO facility_services(facility_id,service_name,service_category,available) VALUES($1,'Synthetic ANC','obstetrics',true)",[f.id]);
 c=await pool.connect();process.env.DAI_LOCAL='true';process.env.DAI_VIDEO_DEMO='false';assert.deepEqual(await seedVideoDemo(c),{disabled:true});process.env.DAI_VIDEO_DEMO='true';assert.equal((await seedVideoDemo(c)).slots,1);
 let row=(await c.query('SELECT * FROM facility_service_slots')).rows[0];assert.equal(row.doctor_id,null);assert.match(row.source,/SYNTHETIC/);await c.query('UPDATE facility_service_slots SET available_places=0 WHERE id=$1',[row.id]);
 assert.deepEqual(await seedVideoDemo(c),{alreadySeeded:true});row=(await c.query('SELECT * FROM facility_service_slots')).rows[0];assert.equal(row.available_places,0);
 }finally{c?.release();await pool.end();await fs.rm(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
