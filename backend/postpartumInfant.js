'use strict';

const { randomUUID } = require('node:crypto');
const { requestReview } = require('./clinicalReview');

function scoreScreen(answers) {
  if (!Array.isArray(answers) || answers.length !== 2 ||
      !answers.every(value => Number.isInteger(value) && value >= 0 && value <= 3)) return null;
  return answers[0] + answers[1];
}

module.exports = function registerPostpartumInfant(app, { pool, authenticateToken, authorizeRole }) {
  const own = [authenticateToken, authorizeRole(['mother'])];
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await fn(req, res); }
    catch (error) { res.status(503).json({ error: 'Could not save or load this entry. Please try again.' }); }
  };
  async function postpartum(mother) {
    const result = await pool.query("SELECT 1 FROM mother_profiles WHERE user_id=$1 AND pregnancy_status='delivered'", [mother]);
    return result.rows.length > 0;
  }
  app.get('/api/patient/wellbeing', ...own, handle(async (req, res) => {
    const eligible = await postpartum(req.user.id);
    const result = await pool.query('SELECT id,score,instrument,created_at,review_id,shared_at FROM postpartum_wellbeing_screens WHERE mother_id=$1 ORDER BY created_at DESC LIMIT 12', [req.user.id]);
    res.json({ eligible, screens: result.rows });
  }));
  app.post('/api/patient/wellbeing', ...own, handle(async (req, res) => {
    const score = scoreScreen(req.body?.answers);
    if (score === null) return res.status(400).json({ error: 'Answer both questions using the listed choices.' });
    if (!await postpartum(req.user.id)) return res.status(409).json({ error: 'This check is for your recorded postpartum stage.' });
    const result = await pool.query('INSERT INTO postpartum_wellbeing_screens(id,mother_id,answers,score) VALUES($1,$2,$3::jsonb,$4) RETURNING id,score,instrument,created_at,review_id,shared_at', [randomUUID(), req.user.id, JSON.stringify(req.body.answers), score]);
    res.status(201).json({ screen: result.rows[0] });
  }));
  app.post('/api/patient/wellbeing/:id/review', ...own, handle(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid screening reference.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Confirm sharing this summary with your authorised clinician.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM postpartum_wellbeing_screens WHERE id=$1 AND mother_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
      const screen = result.rows[0];
      if (!screen) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Screening not found.' });
      }
      if (!screen.review_id) {
        const request = await requestReview(client, req.user.id, 'postpartum_wellbeing',
          'Patient requests postpartum wellbeing follow-up. PHQ-2 score ' + screen.score + '/6, recorded ' + new Date(screen.created_at).toISOString().slice(0, 10) + '. Screening only. Discuss with the patient; no diagnosis generated.', null, false, true);
        await client.query('UPDATE postpartum_wellbeing_screens SET review_id=$2,shared_at=NOW() WHERE id=$1', [screen.id, request.id]);
        screen.review_id = request.id;
      }
      await client.query('COMMIT');
      res.json({ review_id: screen.review_id });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
  app.get('/api/patient/infant-logs', ...own, handle(async (req, res) => {
    const id = Number(req.query.child_id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Choose a child.' });
    const child = await pool.query('SELECT id,name,date_of_birth FROM children WHERE id=$1 AND mother_id=$2', [id, req.user.id]);
    if (!child.rows.length) return res.status(404).json({ error: 'Child not found.' });
    const logs = await pool.query("SELECT id,event_type,started_at,duration_min::float8 AS duration_min,feeding_type FROM patient_baby_logs WHERE child_id=$1 AND mother_id=$2 AND started_at>=NOW()-INTERVAL '7 days' ORDER BY started_at DESC LIMIT 1000", [id, req.user.id]);
    const growth = await pool.query("SELECT id,to_char(measured_on,'YYYY-MM-DD') AS measured_on,weight_kg::float8 AS weight_kg FROM child_growth_logs WHERE child_id=$1 AND weight_kg IS NOT NULL ORDER BY measured_on,id", [id]);
    res.json({ child: child.rows[0], logs: logs.rows, growth: growth.rows, truncated: logs.rows.length === 1000 });
  }));
  app.post('/api/patient/infant-logs', ...own, handle(async (req, res) => {
    const b = req.body || {};
    const time = new Date(b.started_at);
    const duration = b.duration_min ?? null;
    if (!Number.isSafeInteger(b.child_id) || b.child_id < 1 || !['feed', 'sleep', 'wet', 'dirty', 'mixed'].includes(b.event_type) ||
        typeof b.started_at !== 'string' || !Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 300000 ||
        (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 1440)) ||
        (['wet', 'dirty', 'mixed'].includes(b.event_type) && duration !== null) ||
        (b.feeding_type != null && (b.event_type !== 'feed' || !['breast', 'expressed', 'formula', 'other'].includes(b.feeding_type)))) {
      return res.status(400).json({ error: 'Check the child, time, type and duration.' });
    }
    const child = await pool.query("SELECT to_char(date_of_birth,'YYYY-MM-DD') AS born FROM children WHERE id=$1 AND mother_id=$2", [b.child_id, req.user.id]);
    if (!child.rows.length) return res.status(404).json({ error: 'Child not found.' });
    if (time.toISOString().slice(0, 10) < child.rows[0].born) return res.status(400).json({ error: 'Entry cannot be dated before birth.' });
    const result = await pool.query('INSERT INTO patient_baby_logs(mother_id,child_id,event_type,started_at,duration_min,feeding_type) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [req.user.id, b.child_id, b.event_type, time.toISOString(), duration, b.feeding_type || null]);
    res.status(201).json({ entry: result.rows[0] });
  }));
  app.delete('/api/patient/infant-logs/:id', ...own, handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid entry.' });
    const result = await pool.query('DELETE FROM patient_baby_logs WHERE id=$1 AND mother_id=$2 RETURNING id', [id, req.user.id]);
    res.status(result.rows.length ? 200 : 404).json({ deleted: result.rows.length > 0 });
  }));
};
module.exports.scoreScreen = scoreScreen;
