'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLocalPool}=require('./localPool');
const {seedPatientRecords}=require('../scripts/seed-patient-records.cjs');
test('Nivara PDF seed persists six private files once and preserves deletion and existing records',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dai-pdf-seed-')),pool=createLocalPool(path.join(dir,'db')),client=await pool.connect();
 try {
 await client.query(`CREATE TABLE dai_local_seed(version TEXT PRIMARY KEY,source_sha256 TEXT,counts JSONB);
 CREATE TABLE dai_local_source_link(entity TEXT,source_id TEXT,target_id INTEGER);
 INSERT INTO dai_local_source_link VALUES('mother','MOTHER-SYN-0000001',7);
 CREATE TABLE patient_documents(id SERIAL PRIMARY KEY,mother_id INTEGER,title TEXT,doc_type TEXT,original_filename TEXT,mime_type TEXT,size_bytes INTEGER,storage_key TEXT,notes TEXT,report_date DATE,facility_name TEXT,report_category TEXT,deleted_at TIMESTAMPTZ);
 CREATE TABLE patient_document_events(document_id INTEGER,actor_id INTEGER,event_type TEXT,detail JSONB);`);
 assert.equal((await seedPatientRecords(client,{uploadDir:dir})).documents,6);
 const rows=(await client.query('SELECT * FROM patient_documents')).rows;
 assert.equal(rows.filter(r=>r.doc_type==='prescription').length,3);
 assert.equal(rows.filter(r=>r.doc_type==='lab_report').length,3);
 for(const row of rows){assert.equal(row.mother_id,7);const bytes=fs.readFileSync(path.join(dir,row.storage_key));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.length,row.size_bytes);}
 await client.query("UPDATE patient_documents SET deleted_at=now(),title='User edit' WHERE id=1");
 assert.equal((await seedPatientRecords(client,{uploadDir:dir})).alreadySeeded,true);
 assert.equal((await client.query('SELECT * FROM patient_documents')).rows.length,6);
 assert.equal((await client.query('SELECT title,deleted_at FROM patient_documents WHERE id=1')).rows[0].title,'User edit');
 assert.equal((await client.query('SELECT * FROM patient_document_events')).rows.length,6);
 } finally {client.release();await pool.end();fs.rmSync(dir,{recursive:true,force:true});}
});
