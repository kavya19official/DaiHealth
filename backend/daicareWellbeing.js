'use strict';

const { randomUUID } = require('node:crypto');
const access = require('./accessControl');
const { items, scoreEPDS, priority, optionalReview } = require('./daicareEpds');
const { logEvent, requireId, failure, endpoint, inTransaction, activeDoctor } = require('./daicareCommon');

const indiaToday = "(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date";
const path = '/api/daicare/wellbeing';
const clinicianPath = '/api/daicare/mental-health/referrals';
const scoreResult = row => ({ id:row.id,score:row.score,priority:priority(row.score,row.item_ten),ai_status:row.ai_status,created_at:row.created_at });

async function assignReferral(db, screenId, motherId) {
  const { rows } = await db.query(`SELECT oc.id,oc.doctor_id FROM daicare_on_call oc
    JOIN daicare_directory d ON d.doctor_id=oc.doctor_id JOIN doctor_profiles dp ON dp.user_id=d.doctor_id
    JOIN users du ON du.id=d.doctor_id AND du.role='doctor' AND du.closed_at IS NULL
    WHERE oc.starts_at<=clock_timestamp() AND oc.ends_at>clock_timestamp()
      AND d.suspended_at IS NULL AND d.mental_health AND dp.credential_verified
      AND lower(dp.medical_license_number)=lower(d.registration_number)
      AND NOT ${access.revokedSql('$1::int','oc.doctor_id')}
    ORDER BY (SELECT count(*) FROM daicare_referrals r WHERE r.doctor_id=oc.doctor_id AND r.status IN ('assigned','acknowledged')),
      oc.ends_at DESC,oc.doctor_id LIMIT 1`,[motherId]);
  const candidate = rows[0];
  await db.query(`UPDATE daicare_referrals SET status=$2,doctor_id=$3,shift_id=$4,
    assigned_at=CASE WHEN $3::int IS NULL THEN NULL ELSE clock_timestamp() END,acknowledged_at=NULL WHERE screen_id=$1`,
  [screenId,candidate?'assigned':'waiting',candidate?.doctor_id||null,candidate?.id||null]);
  if (candidate) await logEvent(db,motherId,'daicare_wellbeing_assigned',{screen_id:screenId,doctor_id:candidate.doctor_id});
  return candidate?'assigned':'waiting';
}

async function dispatchWaiting(pool) {
  await inTransaction(pool,async db => {
    const { rows } = await db.query(`SELECT r.screen_id,e.mother_id FROM daicare_referrals r
      JOIN daicare_epds e ON e.id=r.screen_id JOIN users mu ON mu.id=e.mother_id AND mu.closed_at IS NULL
      LEFT JOIN daicare_on_call s ON s.id=r.shift_id LEFT JOIN daicare_directory d ON d.doctor_id=r.doctor_id
      LEFT JOIN doctor_profiles dp ON dp.user_id=r.doctor_id LEFT JOIN users du ON du.id=r.doctor_id
      WHERE r.revoked_at IS NULL AND (r.status='waiting' OR (r.status IN ('assigned','acknowledged') AND
        ((r.status='assigned' AND s.ends_at<=clock_timestamp()) OR d.suspended_at IS NOT NULL OR dp.credential_verified IS NOT TRUE OR du.closed_at IS NOT NULL
         OR lower(dp.medical_license_number)<>lower(d.registration_number) OR ${access.revokedSql('e.mother_id','r.doctor_id')})))
      ORDER BY r.consent_at LIMIT 50 FOR UPDATE OF r SKIP LOCKED`);
    for (const row of rows) await assignReferral(db,row.screen_id,row.mother_id);
  });
}

module.exports = function wellbeing(app, {pool,mother,doctor,env=process.env,fetchImpl=fetch,startScheduler=false}) {
  app.get(path + '/instrument', ...mother, endpoint(async (_req,res) => {
    res.json({items,ai_available:env.DAICARE_AI_ENABLED==='true' && Boolean(env.GEMINI_API_KEY && /^gemini-[\w.-]+$/.test(env.DAICARE_AI_MODEL||''))});
  }));

  app.get(path, ...mother, endpoint(async (req,res) => {
    const history = await pool.query(`SELECT e.id,e.score,e.item_ten,e.ai_status,e.created_at,
      r.status AS referral_status,r.acknowledged_at,r.clinician_note,dp.full_name AS clinician
      FROM daicare_epds e LEFT JOIN daicare_referrals r ON r.screen_id=e.id
      LEFT JOIN doctor_profiles dp ON dp.user_id=r.doctor_id WHERE e.mother_id=$1 ORDER BY e.created_at DESC LIMIT 30`,[req.user.id]);
    const checkIns = await pool.query(`SELECT logged_on::text,mood FROM daicare_mood
      WHERE mother_id=$1 ORDER BY logged_on DESC LIMIT 12`,[req.user.id]);
    const due = (await pool.query(`SELECT (COALESCE(max(logged_on)+7,${indiaToday}))::text AS next_check_in,
      COALESCE(max(logged_on)+7,${indiaToday}) <= ${indiaToday} AS due FROM daicare_mood WHERE mother_id=$1`,[req.user.id])).rows[0];
    res.json({ screens:history.rows.map(row=>({...scoreResult(row),referral_status:row.referral_status,
      clinician:row.clinician,acknowledged_at:row.acknowledged_at,clinician_note:row.clinician_note})), check_ins:checkIns.rows,...due });
  }));

  app.post(path + '/mood', ...mother, endpoint(async (req,res) => {
    const mood = req.body?.mood;
    if (!Number.isInteger(mood) || mood<1 || mood>5) failure(400,'Choose a mood from the five options.');
    const { rows } = await pool.query(`INSERT INTO daicare_mood(mother_id,logged_on,mood) VALUES($1,${indiaToday},$2)
      ON CONFLICT(mother_id,logged_on) DO UPDATE SET mood=EXCLUDED.mood RETURNING logged_on::text,mood`,[req.user.id,mood]);
    res.status(201).json({check_in:rows[0]});
  }));

  app.post(path + '/epds', ...mother, endpoint(async (req,res) => {
    const b = req.body || {};
    const result = scoreEPDS(b.answers);
    if (!result || b.postpartum!==true) failure(400,'Confirm this is a postpartum screen and answer all ten items.');
    const record = await inTransaction(pool,async db=>{
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      const count = (await db.query(`SELECT count(*)::int AS total FROM daicare_epds
        WHERE mother_id=$1 AND created_at>clock_timestamp()-interval '24 hours'`,[req.user.id])).rows[0].total;
      if (count>=10) failure(429,'Daily questionnaire limit reached. You can still contact a clinician.');
      return (await db.query(`INSERT INTO daicare_epds(id,mother_id,answers,score,item_ten)
        VALUES($1,$2,$3::jsonb,$4,$5) RETURNING id,score,item_ten,ai_status,created_at`,
      [randomUUID(),req.user.id,JSON.stringify(b.answers),result.score,result.itemTen])).rows[0];
    });
    res.status(201).json({screen:scoreResult(record)});
  }));

  app.post(path + '/epds/:id/ai-review', ...mother, endpoint(async (req,res) => {
    const id = requireId(req.params.id);
    if (req.body?.consent!==true) failure(400,'Please confirm you want to send aggregate scores for AI review.');
    if (env.DAICARE_AI_ENABLED!=='true' || !env.GEMINI_API_KEY) failure(503,'Optional AI review is unavailable.');
    const summary = await inTransaction(pool,async db=>{
      const { rows } = await db.query(`UPDATE daicare_epds SET ai_status='pending' WHERE id=$1 AND mother_id=$2
        AND ai_status='not_requested' AND item_ten=0 RETURNING score,created_at`,[id,req.user.id]);
      if (!rows.length) failure(409,'This screen is unavailable for optional AI review.');
      const prior = (await db.query(`SELECT score FROM daicare_epds WHERE mother_id=$1 AND created_at<$2
        ORDER BY created_at DESC LIMIT 1`,[req.user.id,rows[0].created_at])).rows[0];
      const mood = (await db.query(`SELECT count(*)::int AS check_ins,count(*) FILTER(WHERE mood<=2)::int AS low_check_ins
        FROM daicare_mood WHERE mother_id=$1 AND logged_on>=${indiaToday}-14`,[req.user.id])).rows[0];
      await logEvent(db,req.user.id,'daicare_ai_review_consent',{screen_id:id});
      return { score:rows[0].score,previous_score:prior?.score??null,...mood };
    });
    const outcome = await optionalReview(env,summary,fetchImpl);
    await pool.query("UPDATE daicare_epds SET ai_status=$2 WHERE id=$1 AND ai_status='pending'",[id,outcome]);
    res.json({ai_status:outcome});
  }));

  app.post(path + '/epds/:id/referral', ...mother, endpoint(async (req,res) => {
    const id = requireId(req.params.id);
    if (req.body?.consent!==true) failure(400,'Confirm sharing your name and screening summary with the on-call clinician.');
    const status = await inTransaction(pool,async db=>{
      if (!(await db.query('SELECT id FROM daicare_epds WHERE id=$1 AND mother_id=$2 FOR UPDATE',[id,req.user.id])).rowCount) failure(404,'Screen not found.');
      const previous = (await db.query('SELECT status FROM daicare_referrals WHERE screen_id=$1 FOR UPDATE',[id])).rows[0];
      if (previous && previous.status!=='waiting') return previous.status;
      if (!previous) {
        await db.query("INSERT INTO daicare_referrals(screen_id,status,follow_up_due_at) VALUES($1,'waiting',NOW()+INTERVAL '1 day')",[id]);
        await logEvent(db,req.user.id,'daicare_wellbeing_consent',{screen_id:id});
      }
      return assignReferral(db,id,req.user.id);
    });
    res.status(202).json({status});
  }));

  app.delete(path + '/epds/:id/referral', ...mother, endpoint(async (req,res) => {
    const id = requireId(req.params.id);
    await inTransaction(pool,async db=>{
      const {rows} = await db.query(`UPDATE daicare_referrals r SET status='withdrawn',revoked_at=clock_timestamp()
        FROM daicare_epds e WHERE e.id=r.screen_id AND e.id=$1 AND e.mother_id=$2 AND r.revoked_at IS NULL
        RETURNING r.doctor_id`,[id,req.user.id]);
      if (!rows.length) failure(404,'Active sharing not found.');
      await logEvent(db,req.user.id,'daicare_wellbeing_revoked',{screen_id:id,doctor_id:rows[0].doctor_id,actor_id:req.user.id});
    });
    res.status(204).end();
  }));

  app.get(clinicianPath, ...doctor, endpoint(async (req,res) => {
    const profile = await activeDoctor(pool,req.user.id);
    if (!profile.mental_health) failure(403,'Mental health listing approval is required.');
    const { rows } = await pool.query(`SELECT e.id,e.mother_id,e.score,e.item_ten,e.ai_status,e.created_at,mp.full_name,
        r.status,r.clinician_note,r.acknowledged_at,r.follow_up_due_at FROM daicare_referrals r JOIN daicare_epds e ON e.id=r.screen_id
      JOIN daicare_on_call s ON s.id=r.shift_id JOIN mother_profiles mp ON mp.user_id=e.mother_id
      WHERE r.doctor_id=$1 AND r.revoked_at IS NULL AND r.status IN ('assigned','acknowledged','resolved')
        AND (r.status<>'assigned' OR s.ends_at>clock_timestamp())
        AND NOT ${access.revokedSql('e.mother_id','r.doctor_id')}
      ORDER BY (e.item_ten>0) DESC,(e.score>=13) DESC,(e.ai_status='review') DESC,r.consent_at LIMIT 60`,[req.user.id]);
    for (const row of rows) await access.logAccess(pool,row.mother_id,req.user.id,'daicare_wellbeing_summary',true);
    res.json({referrals:rows.map(row=>({...scoreResult(row),patient_name:row.full_name,status:row.status,
      clinician_note:row.clinician_note,acknowledged_at:row.acknowledged_at,follow_up_due_at:row.follow_up_due_at,review_prompt:'Check in on rest and support; assess the recorded questionnaire clinically.'}))});
  }));

  app.patch(clinicianPath + '/:id', ...doctor, endpoint(async (req,res) => {
    const id = requireId(req.params.id), { action,note } = req.body || {};
    if (!['acknowledge','resolve'].includes(action) || (action==='resolve' &&
      (typeof note!=='string' || !note.trim() || note.length>800))) failure(400,'Choose a valid action and include a brief follow-up message when resolving.');
    const status = await inTransaction(pool,async db=>{
      if (!(await activeDoctor(db,req.user.id)).mental_health) failure(403,'Mental health listing approval is required.');
      const previous = action==='acknowledge'?'assigned':'acknowledged';
      const next = action==='acknowledge'?'acknowledged':'resolved';
      const { rows } = await db.query(`UPDATE daicare_referrals r SET status=$4,
        acknowledged_at=CASE WHEN $4='acknowledged' THEN clock_timestamp() ELSE r.acknowledged_at END,
        clinician_note=COALESCE($5,r.clinician_note)
        FROM daicare_epds e,daicare_on_call s WHERE e.id=r.screen_id AND s.id=r.shift_id
        AND e.id=$1 AND r.doctor_id=$2 AND r.status=$3 AND r.revoked_at IS NULL
        AND ($3<>'assigned' OR s.ends_at>clock_timestamp()) AND NOT ${access.revokedSql('e.mother_id','r.doctor_id')}
        RETURNING e.mother_id`,[id,req.user.id,previous,next,action==='resolve'?note.trim():null]);
      if (!rows.length) failure(404,'Shared referral is no longer available for that action.');
      await logEvent(db,rows[0].mother_id,'daicare_wellbeing_'+next,{screen_id:id,doctor_id:req.user.id,actor_id:req.user.id});
      return next;
    });
    res.json({status});
  }));

  if (startScheduler) {
    const timer = setInterval(()=>dispatchWaiting(pool).catch(error=>console.error('DaiCare referral dispatch failed',error.code||error.name)),30000);
    timer.unref();
  }
};
module.exports.dispatchWaiting = dispatchWaiting;
