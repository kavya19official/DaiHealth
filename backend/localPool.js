'use strict';
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Local synthetic preview only. Production still uses node-postgres + PostgreSQL.
// PGlite has one connection: hold an exclusive lease through a whole transaction,
// so concurrent HTTP requests cannot read/write inside another request's transaction.
function createLocalPool(directory = path.join(__dirname, '../.local/patient-db')) {
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
