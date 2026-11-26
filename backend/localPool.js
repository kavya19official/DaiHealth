'use strict';
const path = require('node:path');

// Local synthetic preview only. Production still uses node-postgres + PostgreSQL.
function createLocalPool(directory = path.join(__dirname, '../.local/patient-db')) {
  const socket = process.env.DAI_PATIENT_PG_SOCKET;
  if (process.env.DAI_HOSTED_DEMO === 'true' && process.env.DAI_LOW_MEMORY === 'true' && socket) {
    const { Pool } = require('pg');
    return new Pool({ host: socket, port: 5432, database: 'postgres', user: 'postgres', max: 1 });
  }
  // Hold the single PGlite connection for the whole transaction.
  const { PGlite } = require('@electric-sql/pglite');
  const ready = PGlite.create(directory);
  let tail = Promise.resolve();
  let closed = false;
  async function connect() {
    if (closed) throw new Error('Local database is closed');
    let unlock;
    const before = tail;
    tail = new Promise(resolve => { unlock = resolve; });
    await before;
    let db;
    try { db = await ready; } catch (error) { unlock(); throw error; }
    let released = false;
    return {
      async query(sql, values) {
        if (released) throw new Error('Database lease already released');
        const result = values === undefined ? (await db.exec(sql)).at(-1) : await db.query(sql, values);
        return { ...result, rows: result?.rows || [], rowCount: result?.rows?.length || result?.affectedRows || 0 };
      },
      release() { if (!released) { released = true; unlock(); } }
    };
  }
  function query(sql, values, callback) {
    if (typeof values === 'function') { callback = values; values = undefined; }
    const promise = (async()=>{const client=await connect();try {return await client.query(sql,values);} finally {client.release();}})();
    if (callback) {promise.then(result=>callback(null,result),error=>callback(error));return;}
    return promise;
  }
  return {connect,query,async end(){closed=true;await tail;await(await ready).close();}};
}
module.exports = {createLocalPool};
