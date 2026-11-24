'use strict';

const assert = require('node:assert/strict');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { once } = require('node:events');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const express = require('express');
const { createCanvas } = require('@napi-rs/canvas');
const { createLocalPool } = require('./localPool');
const register = require('./pregnancyLibrary');

test('week calculations use calendar boundaries and keep overdue dates in week 40', () => {
  assert.equal(register.weekOf('2026-01-01','2026-01-01'),1);
  assert.equal(register.weekOf('2026-01-07','2026-01-01'),1);
  assert.equal(register.weekOf('2026-01-08','2026-01-01'),2);
  assert.equal(register.weekOf('2027-01-01','2026-01-01'),40);
});

test('library keeps private entries, owner-only media, safe timelines and atomic edits through restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'dai-library-'));
  let db = createLocalPool(dir);
  let server;
  try {
    await db.query(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, closed_at TIMESTAMP);
      INSERT INTO users VALUES (1,'mother',NULL),(2,'mother',NULL),(3,'doctor',NULL),(4,'hospital',NULL);
      CREATE TABLE mother_profiles(user_id INTEGER, pregnancy_status TEXT, lmp_date DATE, edd_date DATE);
      INSERT INTO mother_profiles VALUES
        (1,'pregnant',CURRENT_DATE-145,CURRENT_DATE+135),
        (2,'pregnant',NULL,CURRENT_DATE+258);
      CREATE TABLE postpartum_profile(mother_id INTEGER,delivery_date DATE);
      CREATE TABLE appointments(mother_id INTEGER,child_id INTEGER,requested_date DATE,status TEXT);
      INSERT INTO appointments VALUES (1,NULL,CURRENT_DATE,'confirmed'),(1,2,CURRENT_DATE,'confirmed'),
        (2,NULL,CURRENT_DATE,'pending'),(1,NULL,CURRENT_DATE,'cancelled');
      CREATE TABLE care_milestones(mother_id INTEGER,title TEXT,due_date DATE,category TEXT,
        completed_at TIMESTAMP,completion_verification TEXT);
      INSERT INTO care_milestones VALUES (1,'Own confirmed result',CURRENT_DATE,'pregnancy',NOW(),'verified'),
        (1,'Own plan',CURRENT_DATE,'pregnancy',NOW(),'self_reported'),(2,'Other mother',CURRENT_DATE,'pregnancy',NULL,NULL);`);
    await db.query(await readFile(path.join(__dirname,'db/pregnancy_library.sql'),'utf8'));
    const app = express();
    app.use(express.json());
    register(app,{
      pool:{ query:(...args) => db.query(...args),connect:() => db.connect() },
      authenticateToken(req,res,next) {
        const id = Number(req.get('x-fixture-id'));
        if (![1,2,3,4].includes(id)) return res.sendStatus(401);
        req.user = {id,role:id <= 2 ? 'mother' : id === 3 ? 'doctor' : 'hospital'};
        next();
      },
      authorizeRole:roles => (req,res,next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
    });
    server = app.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base = 'http://127.0.0.1:' + server.address().port + '/api/patient/pregnancy-library';
    function request(suffix = '', {owner = 1, method = 'GET', body, headers = {}} = {}) {
      return fetch(base + suffix,{method,body,headers:{'x-fixture-id':String(owner),'x-dai-library':'write',...headers}});
    }
    function json(suffix,method,data,owner) {
      return request(suffix,{owner,method,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    }
    function multipart(entry, media = []) {
      const form = new FormData();
      form.set('entry',JSON.stringify(entry));
      for (const file of media) form.append('media',file);
      return form;
    }
    const list = async (suffix = '', opts) => (await request(suffix,opts)).json();
    assert.equal((await request('',{owner:0})).status,401);
    assert.equal((await request('',{owner:3})).status,403);
    assert.equal((await request('',{owner:4})).status,403);
    assert.equal((await request('',{headers:{origin:'https://other.vercel.app'}})).status,403);
    const before = await list();
    assert.equal(before.journey.id,'current');
    assert.equal(before.journey.week,21);
    assert.deepEqual(before.entries,[]);
    assert.deepEqual(before.visits.map(x => x.status),['confirmed']);
    assert.deepEqual(before.care.map(x=>[x.title,x.verified]),[['Own confirmed result',true],['Own plan',false]]);
    assert.deepEqual(before.moments,[]);
    assert.equal((await list('',{owner:2})).journey.week,4);

    const photo = new File([createCanvas(44,32).toBuffer('image/png')],'first.png',{type:'image/png'});
    const movieBytes = await readFile(path.join(__dirname,'test-fixtures/pregnancy-library.mp4'));
    const video = new File([movieBytes],'clip.mp4',{type:'video/mp4'});
    const bogus = new File(['plain text'],'claimed.png',{type:'image/png'});
    const entry = {id:randomUUID(),kind:'memory',title:'My first ultrasound',body:'Private text',
      entry_date:before.today,week:9,tags:['First Ultrasound']};
    const call = (body,opts = {}) => request('/entries',{method:'POST',body,...opts});
    assert.equal((await call(multipart(entry,[photo,bogus]))).status,422);
    const brokenVideo = new File([movieBytes.subarray(0,50)],'broken.mp4',{type:'video/mp4'});
    assert.equal((await call(multipart(entry,[brokenVideo]))).status,422);
    assert.deepEqual((await list()).entries,[]);
    assert.equal((await call(multipart(entry,[photo,photo,video]))).status,201);
    assert.equal((await call(multipart(entry,[photo]))).status,201);
    const saved = await list();
    assert.equal(saved.entries.length,1);
    assert.equal(saved.journey.memories,1);
    assert.equal(saved.entries[0].week,9);
    assert.deepEqual(saved.moments,[], 'attaching an ultrasound must not complete a milestone');
    const record = saved.entries[0];
    assert.deepEqual(record.media.map(file=>file.mime_type),['image/webp','image/webp','video/mp4']);
    const photoPath = '/media/' + record.media[0].id;
    const videoPath = '/media/' + record.media[2].id;
    assert.equal((await request(photoPath,{owner:2})).status,404);
    assert.equal((await request(videoPath,{owner:3,headers:{range:'bytes=0-11'}})).status,403);
    assert.equal((await request(videoPath,{owner:4})).status,403);
    assert.equal((await request('?journey=' + saved.journey.id,{owner:2})).status,404);
    const part = await request(videoPath,{headers:{range:'bytes=0-11'}});
    assert.equal(part.status,206);
    assert.equal(part.headers.get('content-range'),'bytes 0-11/' + movieBytes.length);
    assert.equal(part.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()),movieBytes.subarray(0,12));
    assert.equal((await request(videoPath,{headers:{range:'bytes=100000-'}})).status,416);

    const patch = (fields, owner = 1) => request('/entries/' + entry.id,{owner,method:'PATCH',body:multipart(fields)});
    const edited = {...entry,revision:1,title:'Revised memory',retain:[record.media[1].id,record.media[2].id]};
    assert.equal((await patch(edited,2)).status,404);
    assert.equal((await patch({...edited,retain:[randomUUID()]})).status,422);
    assert.equal((await patch(edited)).status,200);
    assert.equal((await patch(edited)).status,409);
    assert.equal((await request(photoPath)).status,404);
    for (const kind of ['diary','letter']) {
      assert.equal((await call(multipart({...entry,id:randomUUID(),kind,title:'Private ' + kind, tags:[]}))).status,201);
    }
    assert.equal((await json('/moments/kick','PUT',{journey:saved.journey.id,recorded_on:before.today},2)).status,404);
    assert.equal((await json('/moments/kick','PUT',{journey:saved.journey.id,recorded_on:before.today})).status,200);
    await db.end();
    db = createLocalPool(dir);
    const after = await list();
    assert.equal(after.entries.length,3);
    assert.equal(after.moments[0].code,'kick');
    assert.equal(after.entries.find(item=>item.id===entry.id).title,'Revised memory');
    assert.deepEqual((await list('',{owner:2})).entries,[]);
    assert.equal((await json('/entries/' + entry.id,'DELETE',{revision:2},2)).status,404);
    assert.equal((await json('/entries/' + entry.id,'DELETE',{revision:1})).status,409);
    assert.equal((await json('/entries/' + entry.id,'DELETE',{revision:2})).status,204);
    assert.equal((await request(videoPath)).status,404);
    assert.equal((await list('/summary')).journey.memories,0);

    await db.query("UPDATE mother_profiles SET lmp_date=CURRENT_DATE-3, edd_date=CURRENT_DATE+277 WHERE user_id=1");
    const newPregnancy = await list();
    assert.equal(newPregnancy.journey.id,'current');
    assert.deepEqual(newPregnancy.entries,[]);
    assert.equal(newPregnancy.journeys.length,2);
    assert.equal((await list('?journey=' + saved.journey.id)).entries.length,2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.end();
    await rm(dir,{recursive:true,force:true});
  }
});
