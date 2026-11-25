'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { once } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { createLocalPool } = require('./localPool');
const { migrations } = require('../scripts/seed-local.cjs');
const register = require('./instantConsultations');

test('Nearby Care matching prefers specialty, language, lower load and proximity', () => {
  const row = { facility_id:1, latitude:28.63, longitude:77.22, languages:['Hindi'], load:0 };
  const location = { latitude:28.63, longitude:77.22 };
  const choices = [
    {...row, doctor_id:1, specialization:'Orthopaedics'},
    {...row, doctor_id:2, specialization:'Obstetrics', load:1},
    {...row, doctor_id:3, specialization:'Obstetrics', longitude:77.30},
    {...row, doctor_id:4, specialization:'Obstetrics'},
    {...row, doctor_id:5, specialization:'Obstetrics', longitude:80},
    {...row, doctor_id:6, specialization:'Obstetrics', languages:['English']}
  ];
  assert.deepEqual(register.rankDoctors(choices,location,'pregnancy','hi').map(x=>x.doctor_id),[4,3,2,6,1]);
});

test('instant consultation dispatch, privacy, races, timeout, consent and released history', { timeout:50000 }, async t => {
  process.env.CONSENT_AUDIT_KEY = 'synthetic-instant-consultation-test-key';
  const tmp = await mkdtemp(path.join(os.tmpdir(),'dai-instant-'));
  const pool = createLocalPool(path.join(tmp,'db'));
  let server, stop;
  t.after(async () => {
    stop?.();
    if (server) { const closed = once(server,'close'); server.close(); server.closeAllConnections(); await closed; }
    await pool.end();
    await rm(tmp,{recursive:true,force:true});
  });
  for (const file of migrations) await pool.query(await readFile(path.join(__dirname,'db',file),'utf8'));

  const actors = [];
  async function account(name, role, verified = true) {
    const id = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'test',$2) RETURNING id",
      [name+'@example.invalid',role])).rows[0].id;
    if (role === 'doctor') {
      await pool.query(`INSERT INTO doctor_profiles(user_id,full_name,specialization,medical_license_number,credential_verified)
        VALUES($1,$2,'Obstetrics',$2,$3)`,[id,name,verified]);
    } else {
      await pool.query(`INSERT INTO mother_profiles(user_id,full_name,care_start_date,pregnancy_confirmed_at)
        VALUES($1,$2,CURRENT_DATE-70,NOW())`,[id,name]);
      await pool.query("INSERT INTO patient_locations(user_id,city,latitude,longitude) VALUES($1,'Delhi',28.63,77.22)",[id]);
    }
    const actor = { id, role };
    actors.push(actor);
    return actor;
  }
  const patient = await account('patient','mother');
  const other = await account('other','mother');
  const first = await account('first','doctor');
  const second = await account('second','doctor');
  const unknown = await account('unknown','doctor',false);
  const makeFacility = async (tag, longitude) => (await pool.query(`INSERT INTO facilities
    (facility_code,name,facility_type,address,city,district,state,pincode,latitude,longitude)
    VALUES($1,$1,'clinic','Synthetic','Delhi','Delhi','Delhi','110001',28.63,$2) RETURNING id`,[tag,longitude])).rows[0].id;
  const near = await makeFacility('synthetic-near',77.22);
  const far = await makeFacility('synthetic-more-distant',77.30);
  for (const [actor,facility] of [[first,near],[second,far],[unknown,near]]) {
    await pool.query(`INSERT INTO doctor_facilities(doctor_id,facility_id,role,qualification_verified,languages)
      VALUES($1,$2,'consultant',TRUE,'["Hindi","English"]')`, [actor.id,facility]);
  }

  const app = express();
  app.use(express.json());
  const authenticateToken = (req,res,next) => {
    req.user = actors.find(actor => actor.id === Number(req.get('x-test-user')));
    if (req.user) next(); else res.sendStatus(401);
  };
  const authorizeRole = roles => (req,res,next) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  stop = register(app,{pool,authenticateToken,authorizeRole,env:{DAI_INSTANT_OFFER_SECONDS:'5'}});
  server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  async function send(actor,url='',method='GET',body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/instant-consultations${url}`,{
      method,headers:{'x-test-user':String(actor?.id||0),'content-type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body)
    });
    return { status:res.status, body:await res.json().catch(()=>null), cache:res.headers.get('cache-control') };
  }
  async function expect(promise,status) {
    const result = await promise;
    assert.equal(result.status,status,JSON.stringify(result.body));
    return result.body;
  }
  const concern = {concern:'Synthetic test concern', category:'pregnancy', language:'hi', consent:true, emergency_warning:true};
  const availability = (doctor,status) => send(doctor,'/availability','PUT',{status});
  const respond = (doctor,id,action) => send(doctor,'/'+id+'/respond','POST',{action});
  const inbox = doctor => expect(send(doctor,'/inbox'),200);
  const mine = async (actor,id) => (await expect(send(actor,'/mine'),200)).items.find(item=>item.id===id);

  await expect(send(null,'','POST',concern),401);
  await expect(send(first,'','POST',concern),403);
  await expect(send(patient,'/inbox'),403);
  await expect(send(patient,'','POST',{...concern,consent:false}),400);
  await expect(availability(unknown,'available'),403);
  await expect(availability(first,'available'),200);
  await expect(availability(second,'available'),200);
  await expect(send(patient,'','POST',{...concern,language:'ta'}),400);
  const {id} = await expect(send(patient,'','POST',{...concern,language:'mr'}),202);
  assert.equal((await mine(patient,id)).language,'mr');
  assert.equal((await expect(send(patient,'','POST',concern),202)).id,id);
  const offered = await inbox(first);
  assert.equal(offered.offers[0].id,id);
  assert.ok(!('concern' in offered.offers[0]));
  assert.equal((await inbox(second)).offers.length,0);
  await expect(send(first,'/'+id+'/context'),404);
  await expect(respond(first,id,'decline'),200);
  assert.equal((await inbox(second)).offers[0].id,id);

  const accepted = await Promise.all([respond(first,id,'accept'),respond(second,id,'accept'),respond(second,id,'accept')]);
  assert.deepEqual(accepted.map(r=>r.status).sort(),[200,409,409]);
  assert.equal((await mine(patient,id)).status,'accepted');
  assert.equal((await mine(patient,id)).emergency_warning,true);
  assert.equal((await inbox(second)).effective_status,'busy');
  await expect(send(first,'/'+id+'/context'),404);
  await expect(send(other,'/'+id+'/signals'),404);
  await expect(send(other,'/'+id+'/cancel','POST'),404);
  const context = await expect(send(second,'/'+id+'/context'),200);
  assert.equal(context.patient_id,patient.id);
  assert.equal(context.gestational_week,null);
  assert.equal(context.existing_record_access,false);

  await pool.query(`INSERT INTO appointments(mother_id,doctor_id,requested_date,status)
    VALUES($1,$2,CURRENT_DATE,'confirmed')`, [patient.id,second.id]);
  assert.equal((await expect(send(second,'/'+id+'/context'),200)).gestational_week,10);
  assert.equal((await send(patient,'/mine')).cache,'private, no-store');
  await expect(send(second,'/'+id+'/signals','POST',{type:'offer',payload:{type:'offer',sdp:'synthetic'}}),200);
  assert.equal((await expect(send(patient,'/'+id+'/signals'),200)).signals[0].type,'offer');
  const note = {reason:concern.concern,observations:'Synthetic observation',guidance:'Synthetic guidance',outcome:'in_person',
    follow_up_on:'2026-12-02',facility_id:near};
  await expect(send(second,'/'+id+'/complete','POST',note),409);
  await expect(send(patient,'/'+id+'/connected','POST'),200);
  assert.equal((await mine(patient,id)).status,'accepted');
  await expect(send(second,'/'+id+'/connected','POST'),200);
  assert.equal((await mine(patient,id)).status,'in_progress');

  await expect(availability(first,'offline'),200);
  const {id: waiting} = await expect(send(other,'','POST',concern),202);
  assert.equal((await mine(other,waiting)).status,'searching');
  await expect(send(second,'/'+id+'/complete','POST',note),200);
  assert.equal((await mine(patient,id)).guidance,note.guidance);
  assert.equal((await mine(patient,id)).recommended_facility,'synthetic-near');
  assert.equal(await mine(other,id),undefined);
  assert.equal((await inbox(second)).effective_status,'available');
  assert.equal((await inbox(second)).offers[0].id,waiting);
  await expect(send(patient,'/'+id+'/signals'),404);

  await expect(availability(first,'available'),200);
  await pool.query("UPDATE instant_consultation_offers SET expires_at=clock_timestamp()-interval '1 second' WHERE consultation_id=$1", [waiting]);
  await expect(respond(second,waiting,'accept'),409);
  for (let attempts=0; attempts<25 && !(await inbox(first)).offers.length; attempts++) {
    await new Promise(resolve=>setTimeout(resolve,125));
  }
  assert.equal((await inbox(first)).offers[0].id,waiting);
  await expect(send(other,'/'+waiting+'/cancel','POST'),200);
  assert.equal((await mine(other,waiting)).status,'cancelled');
});
