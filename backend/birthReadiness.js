'use strict';

const M = require('../frontend/js/patient-model');
const access = require('./accessControl');
const { verifiedDoctor } = require('./clinicalDashboard');

const START_WEEK = 28;
const CATALOGUE = Object.freeze([
  { key:'facility_selected', label:'Delivery facility selected', detail:'Choose where you plan to deliver and confirm directions and contact details.', panel:'facilities', action:'Review delivery facility' },
  { key:'transport_arranged', label:'Transport arranged', detail:'Record how you will travel and who can accompany you.', panel:'family', action:'Update transport plan' },
  { key:'emergency_contact', label:'Emergency contact added', detail:'Keep one trusted person’s current phone number ready.', panel:'family', action:'Update emergency contact' },
  { key:'blood_support', label:'Blood-support plan discussed', detail:'Ask your care team whether any blood-support planning is needed for you.', panel:'messages', action:'Talk to my care team' },
  { key:'documents_ready', label:'Essential documents ready', detail:'Keep the records and identification requested by your chosen facility together.', panel:'records', action:'Review my documents' },
  { key:'danger_signs_understood', label:'Urgent warning signs reviewed', detail:'Know when to seek urgent help rather than waiting for a routine visit.', panel:'birth-readiness', action:'Review warning signs' },
  { key:'benefits_started', label:'Benefits application started', detail:'Check relevant schemes and use only their official application channels.', panel:'schemes', action:'Explore benefits' }
]);
const KEYS = new Set(CATALOGUE.map(item => item.key));
const iso = value => value instanceof Date ? value.toISOString().slice(0,10) : value ? String(value).slice(0,10) : null;

function buildReadiness(profile={}, saved=[], date=M.today()) {
  const clean = { ...profile };
  for (const key of ['care_start_date','lmp_date','edd_date']) clean[key] = iso(clean[key]);
  const stage = M.stage(clean, {}, [], date);
  const values = new Map(saved.map(row => [row.item_key, !!row.completed]));
  const items = CATALOGUE.map(item => ({ ...item, complete:values.get(item.key) || false, confirmable:true, can_confirm:true }));
  const completed = items.filter(item => item.complete).length;
  const eligible = !stage.delivered && Number.isInteger(stage.week) && stage.week >= START_WEEK;
  const nextAction=items.find(item => !item.complete) || null;
  return {
    eligible,
    week:stage.week,
    starts_at_week:START_WEEK,
    starts_in_weeks:stage.week === null ? null : Math.max(0, START_WEEK-stage.week),
    completed,
    total:items.length,
    percent:Math.round(completed/items.length*100),
    items,
    next_action:nextAction,
    next:nextAction?.label || null,
    caution:'Preparation checklist only. It does not predict delivery outcomes or replace medical advice.',
    methodology:'Progress uses only steps you marked complete. It is not a clinical score and does not infer safety or service availability.'
  };
}

async function readinessForMother(pool, motherId, date=M.today()) {
  const [profile, saved] = await Promise.all([
    pool.query('SELECT care_start_date,lmp_date,edd_date,pregnancy_status FROM mother_profiles WHERE user_id=$1',[motherId]),
    pool.query('SELECT item_key,completed FROM birth_readiness_items WHERE mother_id=$1',[motherId])
  ]);
  if (!profile.rows[0]) return null;
  return buildReadiness(profile.rows[0], saved.rows, date);
}

async function hasConsent(pool, motherId, doctorId) {
  return (await pool.query(`SELECT 1 FROM clinical_dashboard_consent c
    WHERE c.mother_id=$1 AND c.doctor_id=$2 AND c.revoked_at IS NULL AND c.expires_at>NOW()
      AND NOT ${access.revokedSql('c.mother_id','c.doctor_id')}`,[motherId,doctorId])).rows.length > 0;
}

function register(app,{pool,authenticateToken,authorizeRole}) {
  const mother=[authenticateToken,authorizeRole(['mother'])], doctor=[authenticateToken,authorizeRole(['doctor'])];
  const audit=(motherId,actorId,eventType,details={})=>pool.query(
    'INSERT INTO birth_readiness_events(mother_id,actor_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)',
    [motherId,actorId,eventType,JSON.stringify(details)]);

  app.get('/api/patient/birth-readiness',...mother,async(req,res)=>{try{
    const readiness=await readinessForMother(pool,req.user.id);
    if(!readiness)return res.status(404).json({error:'Patient profile not found'});
    await audit(req.user.id,req.user.id,'self_view');
    res.set('Cache-Control','no-store').json({readiness});
  }catch(error){console.error('Birth readiness:',error.message);res.status(500).json({error:'Could not load birth readiness'});}});

  app.put('/api/patient/birth-readiness/items/:key',...mother,async(req,res)=>{
    const key=req.params.key;
    if(!KEYS.has(key)||typeof req.body?.complete!=='boolean')return res.status(400).json({error:'Choose a valid checklist step and completion state'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const profile=(await client.query('SELECT care_start_date,lmp_date,edd_date,pregnancy_status FROM mother_profiles WHERE user_id=$1 FOR UPDATE',[req.user.id])).rows[0];
      if(!profile){await client.query('ROLLBACK');return res.status(404).json({error:'Patient profile not found'});}
      const current=(await client.query('SELECT completed FROM birth_readiness_items WHERE mother_id=$1 AND item_key=$2 FOR UPDATE',[req.user.id,key])).rows[0];
      const readiness=buildReadiness(profile,[],M.today());
      if(!readiness.eligible){await client.query('ROLLBACK');return res.status(409).json({error:'Birth readiness is available from pregnancy week 28'});}
      await client.query(`INSERT INTO birth_readiness_items(mother_id,item_key,completed,updated_by)
        VALUES($1,$2,$3,$1) ON CONFLICT(mother_id,item_key) DO UPDATE SET completed=EXCLUDED.completed,
        updated_by=EXCLUDED.updated_by,updated_at=NOW(),version=birth_readiness_items.version+1`,[req.user.id,key,req.body.complete]);
      await client.query(`INSERT INTO birth_readiness_events(mother_id,actor_id,event_type,item_key,previous_completed,completed,details)
        VALUES($1,$1,'item_updated',$2,$3,$4,'{}'::jsonb)`,[req.user.id,key,current?.completed??false,req.body.complete]);
      const saved=(await client.query('SELECT item_key,completed FROM birth_readiness_items WHERE mother_id=$1',[req.user.id])).rows;
      const updated=buildReadiness(profile,saved,M.today());
      await client.query('COMMIT');
      res.set('Cache-Control','no-store').json({readiness:updated});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Birth readiness update:',error.message);res.status(500).json({error:'Could not save this checklist step'});
    }finally{client.release();}
  });

  app.get('/api/doctor/patients/:motherId/birth-readiness',...doctor,async(req,res)=>{try{
    const motherId=Number(req.params.motherId);
    if(!Number.isInteger(motherId)||motherId<1)return res.status(400).json({error:'Invalid patient id'});
    const allowed=await verifiedDoctor(pool,req.user.id)&&await access.hasDoctorAccess(pool,req.user.id,motherId)&&await hasConsent(pool,motherId,req.user.id);
    await access.logAccess(pool,motherId,req.user.id,'birth_readiness',allowed);
    await audit(motherId,req.user.id,allowed?'doctor_view':'doctor_view_blocked',{reason:allowed?'consented_read_only_view':'verification_relationship_or_consent_missing'}).catch(()=>{});
    if(!allowed)return res.status(403).json({error:'This checklist has not been shared with this verified care-team clinician',not_shared:true});
    const readiness=await readinessForMother(pool,motherId);
    if(!readiness)return res.status(404).json({error:'Patient profile not found'});
    res.set('Cache-Control','no-store').json({readiness,read_only:true});
  }catch(error){console.error('Shared birth readiness:',error.message);res.status(500).json({error:'Could not load shared birth readiness'});}});
}

module.exports={register,buildReadiness,readinessForMother,hasConsent,CATALOGUE};
