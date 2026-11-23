'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const {createLocalPool} = require('./localPool');
const register = require('./ultrasoundWorkspace');

test('ultrasound gateway binds authenticated ownership, doctor selection and facility revocations', async t => {
  const pool = createLocalPool('memory://');
  await pool.query(`
    CREATE TABLE users(id integer PRIMARY KEY, role text, closed_at timestamptz);
    INSERT INTO users VALUES (101,'mother',NULL),(102,'mother',NULL),(42,'doctor',NULL),(43,'doctor',NULL);
    CREATE TABLE appointments(mother_id integer, doctor_id integer, facility_uuid uuid, requested_date date, status text);
    INSERT INTO appointments VALUES (101,42,'11111111-1111-1111-1111-111111111111',current_date,'confirmed'),
      (101,42,'22222222-2222-2222-2222-222222222222',current_date-1,'completed'),
      (102,42,NULL,current_date,'cancelled'), (101,43,NULL,current_date,'confirmed');
    CREATE TABLE patient_access_controls(mother_id integer,grantee_type text,grantee_ref text,state text);
    CREATE TABLE patient_record_access_log(mother_id integer,doctor_id integer,resource text,allowed boolean,created_at timestamptz);
    CREATE TABLE doctor_profiles(user_id integer,full_name text);
    INSERT INTO doctor_profiles VALUES (42,'Verified fixture'),(43,'Unverified fixture');
    CREATE TABLE mother_profiles(user_id integer,full_name text,pregnancy_status text,
      lmp_date date, edd_date date, pregnancy_confirmed_at timestamp);
    INSERT INTO mother_profiles VALUES (101,'Patient fixture','pregnant','2026-06-01','2027-03-08',NULL),
      (102,'Other fixture','pregnant','2026-06-02','2027-03-09',NULL);
  `);
  const app = express();
  app.use(express.json());
  const signing = 'synthetic-workspace-route-fixture-signing-key';
  const requests = [];
  register(app,{
    pool, env:{DAI_ULTRASOUND_ENABLED:'true',DAI_ULTRASOUND_GATEWAY_TOKEN:signing},
    authenticateToken(req,res,next) {
      if (!req.get('x-test-account')) return res.sendStatus(401);
      req.user={id:Number(req.get('x-test-account')), role:req.get('x-test-role')};
      next();
    },
    authorizeRole(roles) {
      return (req,res,next)=>roles.includes(req.user.role) ? next() : res.sendStatus(403);
    },
    verifyDoctor:async (_,doctor)=>doctor===42,
    fetcher: async (url,options)=>{
      const grant=jwt.verify(options.headers['x-dai-ultrasound-workspace'],signing,{
        algorithms:['HS256'],issuer:'dai-workspace',audience:'dai-ultrasound-workspace',
      });
      assert.equal(grant.path,url.pathname);
      assert.equal(grant.method,options.method);
      assert.equal(grant.sha256,createHash('sha256').update(options.body || '').digest('hex'));
      requests.push(grant);
      return url.pathname.endsWith('/image') ?
        new Response(Buffer.from([137,80,78,71]),{headers:{'Content-Type':'image/png'}}) :
        Response.json({items:[]});
    },
  });
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  const base = 'http://127.0.0.1:'+server.address().port;
  const scan = '/api/patient/ultrasound';
  const doctorScan = '/api/doctor/patients/101/ultrasound';
  const mother = {'x-test-account':'101','x-test-role':'mother'};
  const doctor = {'x-test-account':'42','x-test-role':'doctor'};
  const upload = {...mother,'x-dai-ultrasound':'upload','content-type':'image/png'};
  assert.equal((await fetch(base+scan)).status,401);
  assert.equal((await fetch(base+doctorScan,{headers:mother})).status,403);
  assert.equal((await fetch(base+'/api/doctor/patients/102/ultrasound',{headers:doctor})).status,403);
  assert.deepEqual((await (await fetch(base+scan+'/options',{headers:mother})).json()).doctors.map(row=>row.id),[42]);
  assert.equal((await fetch(base+scan+'?doctor=42',{method:'POST',headers:upload,body:'fixture'})).status,422);
  const ok = await fetch(base+scan+'?doctor=42',{method:'POST',
    headers:{...upload,'x-dai-ultrasound-consent':'yes'},body:'fixture'});
  assert.equal(ok.status,200,await ok.text());
  assert.equal(requests.at(-1).patient,101);
  assert.equal(requests.at(-1).facility,'11111111-1111-1111-1111-111111111111');
  await pool.query(`INSERT INTO patient_access_controls VALUES
    (101,'facility','11111111-1111-1111-1111-111111111111','revoked')`);
  assert.equal((await fetch(base+doctorScan,{headers:doctor})).status,200);
  assert.deepEqual(requests.at(-1).facilities,['22222222-2222-2222-2222-222222222222']);
  await pool.query("INSERT INTO patient_access_controls VALUES (101,'doctor','42','revoked')");
  assert.equal((await fetch(base+doctorScan,{headers:doctor})).status,403);
  const preview = await fetch(base+scan+'/11111111-1111-1111-1111-111111111111/image',{headers:mother});
  assert.equal(preview.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()),Buffer.from([137,80,78,71]));
});
