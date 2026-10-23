'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createLocalPool}=require('./localPool');

test('embedded local database serialises transactions, rolls back, supports callbacks and persists',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dai-local-pool-'));
 let pool=createLocalPool(directory);
 try {
  await pool.query('CREATE TABLE example(id SERIAL PRIMARY KEY, value JSONB NOT NULL);');
  const client=await pool.connect();
  await client.query('BEGIN');
  await client.query('INSERT INTO example(value) VALUES($1)',[JSON.stringify({synthetic:true})]);
  const pending=pool.query('SELECT * FROM example');
  await client.query('ROLLBACK');client.release();
  assert.equal((await pending).rowCount,0,'queued reader must not observe rolled-back transaction');
  await pool.query('INSERT INTO example(value) VALUES($1)',[JSON.stringify({persisted:true})]);
  await new Promise((resolve,reject)=>pool.query('SELECT * FROM example',(error,result)=>{if(error)return reject(error);assert.equal(result.rows[0].value.persisted,true);resolve();}));
  await pool.end();pool=createLocalPool(directory);
  assert.equal((await pool.query('SELECT * FROM example')).rowCount,1);
 } finally {await pool.end();await fs.rm(directory,{recursive:true,force:true});}
});
