'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { normalize, rangeFor, MiB } = require('./pregnancyLibraryMedia');

const BASE = '/api/patient/pregnancy-library';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['memory', 'diary', 'letter']);
const TAGS = ['First Ultrasound', 'First Kick', 'Baby Bump', 'Doctor Visit', 'Family Moments',
  'Special Memories', 'Emotional Moments', 'Pregnancy Milestones'];
const MOMENTS = new Set(['ultrasound', 'heartbeat', 'kick', 'shower', 'birth']);
const DAY = 86400000;
const ENTRY_LIMIT = 300;
const MEDIA_LIMIT = 8;
const STORAGE_LIMIT = 120 * MiB;
const WRITE_LIMIT = 32 * MiB;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata' });
const today = () => dateFormat.format(new Date());
const diff = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
const add = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const weekOf = (date, start) => Math.min(40, Math.max(1, Math.floor(diff(date, start) / 7) + 1));
const first = async (db, sql, values) => (await db.query(sql, values)).rows[0];

function fail(message, status = 422) {
  throw Object.assign(new Error(message), { status });
}

function key(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('This item could not be found.', 404);
  return value.toLowerCase();
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' && Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString().slice(0, 10) === value;
}

const journeyFields = 'id, start_date::text, due_date::text, birth_date::text, demo_seeded';

async function journeys(db, mother, selection, create = false) {
  const rows = (await db.query(`SELECT ${journeyFields} FROM pregnancy_library_journeys
    WHERE mother_id=$1 ORDER BY start_date DESC, created_at DESC`, [mother])).rows;
  const profile = await first(db, `SELECT p.pregnancy_status, p.lmp_date::text, p.edd_date::text,
    r.delivery_date::text FROM mother_profiles p LEFT JOIN postpartum_profile r ON r.mother_id=p.user_id
    WHERE p.user_id=$1`, [mother]);
  const due = profile?.edd_date;
  const start = profile?.lmp_date || (due && add(due, -280));
  const live = start && ['pregnant', 'delivered'].includes(profile.pregnancy_status);
  const date = today();
  const birth = live && profile.pregnancy_status === 'delivered' &&
    profile.delivery_date <= date && diff(profile.delivery_date, start) >= 0 &&
    diff(profile.delivery_date, start) <= 315 ? profile.delivery_date : null;

  // A close dating correction updates the same keepsake. A recorded birth
  // closes that episode before a later active pregnancy can match it.
  const matched = live && rows.find(row => Math.abs(diff(row.start_date, start)) <= 42 &&
    (profile.pregnancy_status === 'delivered' || !row.birth_date));
  let current = live ? {
    ...matched, id:matched?.id || 'current', start_date:start, due_date:due || add(start, 280),
    birth_date:birth || matched?.birth_date || null, active:profile.pregnancy_status === 'pregnant',
  } : rows[0];
  let selected = selection === 'current' || selection === undefined
    ? current : rows.find(row => row.id === key(selection));
  if (selection !== 'current' && selection !== undefined && !selected) fail('Journey not found.', 404);
  if (selected && current && selected.id === current.id) selected = current;
  if (selected && create) {
    if (selected.id === 'current') {
      selected = { ...selected, id:randomUUID() };
      await db.query(`INSERT INTO pregnancy_library_journeys (id,mother_id,start_date,due_date,birth_date)
        VALUES ($1,$2,$3,$4,$5)`, [selected.id,mother,selected.start_date,selected.due_date,selected.birth_date]);
    } else if (selected === current && live) {
      await db.query(`UPDATE pregnancy_library_journeys SET start_date=$1,due_date=$2,birth_date=$3
        WHERE id=$4 AND mother_id=$5`, [selected.start_date,selected.due_date,selected.birth_date,selected.id,mother]);
    }
  }
  return { selected, choices:current ? [current, ...rows.filter(row => row.id !== current.id)] : rows };
}

function summary(journey, totals) {
  if (!journey) return null;
  const week = journey.active ? weekOf(today(), journey.start_date) : null;
  return {
    id:journey.id, start_date:journey.start_date, due_date:journey.due_date, birth_date:journey.birth_date,
    week, trimester:week == null ? null : week <= 12 ? 1 : week <= 27 ? 2 : 3,
    memories:totals?.memories ?? 0, updated_at:totals?.updated_at ?? null, demo:!!journey.demo_seeded,
  };
}

async function totals(db, owner, journey) {
  if (!journey || journey.id === 'current') return null;
  return first(db, `SELECT COUNT(*) FILTER (WHERE kind='memory')::int AS memories,
    (SELECT updated_at FROM pregnancy_library_journeys WHERE mother_id=$1 AND id=$2) AS updated_at
    FROM pregnancy_library_entries WHERE mother_id=$1 AND journey_id=$2`, [owner, journey.id]);
}

function readEntry(fields, journey, date) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('Provide entry details.');
  const { title, body, kind, entry_date, tags = [], retain = [] } = fields;
  if (!KINDS.has(kind) || typeof title !== 'string' || !title.trim() || title.trim().length > 120 ||
      typeof body !== 'string' || body.length > 8000 || (kind !== 'memory' && !body.trim())) {
    fail('Add a title and, for a diary entry or letter, write a message.');
  }
  if (!validDate(entry_date) || entry_date > date) fail('Choose a valid date up to today.');
  const week = fields.week ?? (journey.birth_date && entry_date >= journey.birth_date
    ? 41 : weekOf(entry_date, journey.start_date));
  if (!Number.isInteger(week) || week < 1 || week > 41) fail('Choose a pregnancy week or Delivery and birth.');
  if (!Array.isArray(tags) || tags.length > TAGS.length || tags.some(tag => !TAGS.includes(tag))) {
    fail('Choose tags from the available options.');
  }
  if (!Array.isArray(retain) || retain.length > MEDIA_LIMIT || retain.some(id => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(retain).size !== retain.length) fail('One or more retained attachments are invalid.');
  return { title:title.trim(), body:body.trim(), kind, entry_date, week, tags:[...new Set(tags)], retain };
}

async function form(req) {
  if (!req.is('multipart/form-data') || !Buffer.isBuffer(req.body)) fail('Submit the library form.', 415);
  let data;
  let fields;
  try {
    data = await new Request('http://localhost', {
      method:'POST', headers:{ 'Content-Type':req.get('Content-Type') }, body:req.body,
    }).formData();
    if (data.getAll('entry').length !== 1 || typeof data.get('entry') !== 'string' ||
        data.get('entry').length > 16000) fail('Invalid entry.');
    fields = JSON.parse(data.get('entry'));
  } catch {
    fail('The entry or attachments could not be read.');
  }
  const files = data.getAll('media');
  if (files.length > MEDIA_LIMIT || files.some(file => typeof file === 'string')) fail('Choose up to eight files.');
  if (files.length && fields?.kind !== 'memory') fail('Attachments belong to memories.');
  const media = [];
  for (const file of files) {
    try { media.push(await normalize(file)); }
    catch (error) { fail(error.message); }
  }
  return { fields, media };
}

const metadata = 'id, kind, title, body, entry_date::text, week, tags, revision, updated_at';

async function write(pool, owner, work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize per-account quota and revision checks with concurrent edits and closure.
    if (!await first(db, "SELECT id FROM users WHERE id=$1 AND role='mother' AND closed_at IS NULL FOR UPDATE", [owner])) {
      fail('Sign in to your account.', 401);
    }
    const value = await work(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

function touchJourney(db, owner, id) {
  return db.query('UPDATE pregnancy_library_journeys SET updated_at=now() WHERE mother_id=$1 AND id=$2', [owner,id]);
}

async function saveEntry(db, owner, editing, id, fields, media) {
  const previous = await first(db, `SELECT ${metadata}, journey_id FROM pregnancy_library_entries
    WHERE mother_id=$1 AND id=$2`, [owner,id]);
  if (editing && !previous) fail('Entry not found.', 404);
  if (!editing && previous) {
    // Idempotent result when save succeeded but the originating client lost the response.
    return { id, journey_id:previous.journey_id, revision:previous.revision };
  }
  if (editing && previous.revision !== fields?.revision) fail('This entry changed. Refresh the page and reopen it.', 409);
  const { selected:journey } = await journeys(db, owner, previous?.journey_id ?? fields?.journey, true);
  if (!journey) fail('Add pregnancy dates in your profile before starting a journey.', 409);
  const entry = readEntry(fields, journey, today());
  if (previous && previous.kind !== entry.kind) fail('Entry type cannot be changed.');
  const saved = previous ? (await db.query(`SELECT id, size_bytes FROM pregnancy_library_media
    WHERE mother_id=$1 AND entry_id=$2`, [owner,id])).rows : [];
  const retained = entry.retain.map(mediaId => saved.find(item => item.id === mediaId));
  if (retained.some(item => !item) || retained.length + media.length > MEDIA_LIMIT ||
      (entry.kind !== 'memory' && (retained.length || media.length))) fail('Choose up to eight valid attachments.');
  if (media.length) {
    const quota = await first(db, `SELECT COALESCE(SUM(size_bytes),0)::int AS bytes
      FROM pregnancy_library_media WHERE mother_id=$1 AND entry_id<>$2`, [owner,id]);
    const bytes = [...retained.map(item => item.size_bytes), ...media.map(item => item.bytes.length)];
    if (quota.bytes + bytes.reduce((sum, size) => sum + size, 0) > STORAGE_LIMIT) {
      fail('Your library storage is full. Remove an attachment before adding another.', 409);
    }
  }
  if (!previous) {
    const count = await first(db, 'SELECT COUNT(*)::int AS total FROM pregnancy_library_entries WHERE mother_id=$1', [owner]);
    if (count.total >= ENTRY_LIMIT) fail('Your library is full. Remove an entry to make space.', 409);
    await db.query(`INSERT INTO pregnancy_library_entries
      (id,mother_id,journey_id,kind,title,body,entry_date,week,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id,owner,journey.id,entry.kind,entry.title,entry.body,entry.entry_date,entry.week,entry.tags]);
  } else {
    await db.query(`UPDATE pregnancy_library_entries SET title=$3,body=$4,entry_date=$5,week=$6,tags=$7,
      revision=revision+1,updated_at=now() WHERE id=$1 AND mother_id=$2`,
    [id,owner,entry.title,entry.body,entry.entry_date,entry.week,entry.tags]);
    await db.query(`DELETE FROM pregnancy_library_media WHERE entry_id=$1 AND mother_id=$2
      AND id<>ALL($3::uuid[])`, [id,owner,entry.retain]);
    for (const [position, item] of retained.entries()) {
      await db.query('UPDATE pregnancy_library_media SET position=$3 WHERE id=$1 AND mother_id=$2',
        [item.id,owner,position]);
    }
  }
  for (const [position, item] of media.entries()) {
    await db.query(`INSERT INTO pregnancy_library_media (id,mother_id,entry_id,mime_type,position,data)
      VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(),owner,id,item.type,retained.length + position,item.bytes]);
  }
  await touchJourney(db,owner,journey.id);
  return { id, journey_id:journey.id, revision:(previous?.revision || 0) + 1 };
}

module.exports = function register(app, {pool, authenticateToken, authorizeRole}) {
  let uploads = 0;
  const raw = express.raw({type:'multipart/form-data', limit:WRITE_LIMIT, inflate:false});
  const privacy = (req, res, next) => {
    res.set({ 'Cache-Control':'private, no-store', 'Cross-Origin-Resource-Policy':'same-origin',
      'X-Content-Type-Options':'nosniff' });
    const origin = req.get('origin');
    let foreign = false;
    if (origin) {
      try { foreign = new URL(origin).host !== req.get('host'); }
      catch { foreign = true; }
    }
    if (foreign || ['cross-site', 'same-site'].includes(req.get('sec-fetch-site'))) {
      return res.status(403).json({error:'Open this library from your DaiHealth dashboard.'});
    }
    next();
  };
  const own = [privacy, authenticateToken, authorizeRole(['mother'])];
  const handle = fn => async (req,res) => {
    try { await fn(req,res,req.user.id); }
    catch (error) {
      if (!error.status) console.error('Pregnancy library request failed', error.code || error.name);
      if (!res.headersSent) res.status(error.status || 503)
        .json({error:error.status ? error.message : 'Your library is temporarily unavailable. Try again.'});
    }
  };
  const mutate = (req,res,next) => req.get('x-dai-library') === 'write'
    ? next() : res.status(403).json({error:'Use the signed-in library to make changes.'});

  app.get(BASE + '/summary', ...own, handle(async (_req,res,owner) => {
    const { selected } = await journeys(pool,owner);
    res.json({ journey:summary(selected, await totals(pool,owner,selected)) });
  }));

  app.get(BASE, ...own, handle(async (req,res,owner) => {
    const { selected, choices } = await journeys(pool,owner,req.query.journey);
    const result = { today:today(), tags:TAGS, journeys:choices.map(item => summary(item)),
      journey:summary(selected, await totals(pool,owner,selected)), entries:[], moments:[], visits:[], care:[] };
    if (selected) {
      const params = [owner, selected.start_date, selected.birth_date || add(selected.due_date, 21)];
      const [visits, care] = await Promise.all([
        pool.query(`SELECT requested_date::text AS date,status FROM appointments
          WHERE mother_id=$1 AND child_id IS NULL AND status IN ('pending','confirmed','completed')
            AND requested_date BETWEEN $2 AND $3 ORDER BY requested_date`, params),
        pool.query(`SELECT title, event_date::text AS date, verified FROM (
          SELECT title, CASE WHEN completion_verification='verified' THEN COALESCE(completed_at::date,due_date)
            ELSE due_date END AS event_date,
            (completed_at IS NOT NULL AND completion_verification='verified') AS verified
          FROM care_milestones WHERE mother_id=$1 AND category='pregnancy'
          ) plan WHERE event_date BETWEEN $2 AND $3 ORDER BY event_date,title`, params),
      ]);
      result.visits = visits.rows;
      result.care = care.rows;
    }
    if (selected && selected.id !== 'current') {
      const params = [owner,selected.id];
      const [entries,media,moments] = await Promise.all([
        pool.query(`SELECT ${metadata} FROM pregnancy_library_entries WHERE mother_id=$1 AND journey_id=$2
          ORDER BY entry_date DESC,updated_at DESC,id`, params),
        pool.query(`SELECT m.id,m.entry_id,m.mime_type,m.size_bytes FROM pregnancy_library_media m
          JOIN pregnancy_library_entries e ON e.id=m.entry_id AND e.mother_id=m.mother_id
          WHERE e.mother_id=$1 AND e.journey_id=$2 ORDER BY m.position,m.id`, params),
        pool.query(`SELECT code,recorded_on::text FROM pregnancy_library_moments
          WHERE mother_id=$1 AND journey_id=$2`, params),
      ]);
      const grouped = new Map(entries.rows.map(entry => [entry.id, { ...entry, media:[] }]));
      for (const {entry_id,...attachment} of media.rows) grouped.get(entry_id)?.media.push(attachment);
      result.entries = [...grouped.values()];
      result.moments = moments.rows;
    }
    res.json(result);
  }));

  function submit(editing) {
    return handle(async (req,res,owner) => {
      if (uploads >= 3) fail('The library is handling other uploads. Try again shortly.', 503);
      uploads++;
      try {
        await new Promise((resolve,reject) => raw(req,res,error => error ? reject(Object.assign(
          new Error(error.status === 413 ? 'Attachments exceed 32 MB per save.' : 'The upload was interrupted.'),
          { status:error.status || 400 })) : resolve()));
        const { fields, media } = await form(req);
        const id = key(editing ? req.params.id : fields?.id);
        const saved = await write(pool,owner,db => saveEntry(db,owner,editing,id,fields,media));
        res.status(editing ? 200 : 201).json(saved);
      } finally { uploads--; }
    });
  }

  app.post(BASE + '/entries', ...own, mutate, submit(false));
  app.patch(BASE + '/entries/:id', ...own, mutate, submit(true));
  app.delete(BASE + '/entries/:id', ...own, mutate, handle(async (req,res,owner) => {
    const id = key(req.params.id);
    await write(pool,owner,async db => {
      const entry = await first(db,`SELECT journey_id,revision FROM pregnancy_library_entries
        WHERE id=$1 AND mother_id=$2`, [id,owner]);
      if (!entry) fail('Entry not found.', 404);
      if (entry.revision !== req.body?.revision) fail('This entry changed. Refresh the page before deleting it.', 409);
      await db.query('DELETE FROM pregnancy_library_entries WHERE id=$1 AND mother_id=$2', [id,owner]);
      await touchJourney(db,owner,entry.journey_id);
    });
    res.sendStatus(204);
  }));

  app.put(BASE + '/moments/:code', ...own, mutate, handle(async (req,res,owner) => {
    const code = req.params.code;
    const recorded = req.body?.recorded_on;
    if (!MOMENTS.has(code) || recorded !== null && (!validDate(recorded) || recorded > today())) fail('Choose a valid milestone date.');
    const journeyId = await write(pool,owner,async db => {
      const { selected } = await journeys(db,owner,req.body?.journey,recorded !== null);
      if (!selected || recorded && recorded < selected.start_date) fail('Choose a date during this journey.');
      if (selected.id === 'current') return selected.id;
      if (recorded === null) {
        await db.query('DELETE FROM pregnancy_library_moments WHERE mother_id=$1 AND journey_id=$2 AND code=$3',
          [owner,selected.id,code]);
      } else {
        await db.query(`INSERT INTO pregnancy_library_moments (mother_id,journey_id,code,recorded_on)
          VALUES ($1,$2,$3,$4) ON CONFLICT (journey_id,code) DO UPDATE
          SET recorded_on=EXCLUDED.recorded_on, updated_at=now()`, [owner,selected.id,code,recorded]);
      }
      await touchJourney(db,owner,selected.id);
      return selected.id;
    });
    res.json({ journey_id:journeyId });
  }));

  app.get(BASE + '/media/:id', ...own, handle(async (req,res,owner) => {
    const params = [key(req.params.id), owner];
    const attachment = await first(pool,`SELECT mime_type,size_bytes FROM pregnancy_library_media
      WHERE id=$1 AND mother_id=$2`,params);
    if (!attachment) fail('Attachment not found.',404);
    const range = req.get('range');
    const part = rangeFor(range,attachment.size_bytes);
    res.set('Accept-Ranges','bytes');
    if (!part) return res.status(416).set('Content-Range', `bytes */${attachment.size_bytes}`).end();
    const length = part.end - part.start + 1;
    const content = req.method === 'HEAD' ? null : await first(pool,`SELECT substring(data FROM $3::int FOR $4::int) AS bytes
      FROM pregnancy_library_media WHERE id=$1 AND mother_id=$2`, [...params,part.start + 1,length]);
    if (req.method !== 'HEAD' && !content) fail('Attachment not found.',404);
    res.set({ 'Content-Type':attachment.mime_type, 'Content-Length':String(length),
      'Content-Disposition':req.query.download === '1' ? `attachment; filename="pregnancy-memory.${attachment.mime_type === 'video/mp4' ? 'mp4' : 'webp'}"` : 'inline' });
    if (range) res.status(206).set('Content-Range', `bytes ${part.start}-${part.end}/${attachment.size_bytes}`);
    res.end(content ? Buffer.from(content.bytes) : undefined);
  }));
};

module.exports.weekOf = weekOf;
module.exports.addDays = add;
