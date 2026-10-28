'use strict';
const access=require('./accessControl'),{verifiedDoctor}=require('./clinicalDashboard');
module.exports=function(app,{pool,authenticateToken}){
 const prefix='/api/demo/care-messages';
 const fail=(res)=>res.status(503).json({error:'Care messages are unavailable. Please try again.'});
 async function gate(req,res,next){
  if(process.env.DAI_LOCAL!=='true'||process.env.DAI_DEMO!=='true')return res.status(404).json({error:'Local synthetic demo only.'});
  if(!['mother','doctor'].includes(req.user.role))return res.sendStatus(403);
  try{const u=(await pool.query('SELECT email FROM users WHERE id=$1',[req.user.id])).rows[0];
   if(!u?.email.endsWith('@dai-synthetic.invalid'))return res.sendStatus(403);
   if(req.user.role==='doctor'&&!await verifiedDoctor(pool,req.user.id))return res.status(403).json({error:'Verified doctor required.'});
   res.set('Cache-Control','private, no-store');next();
  }catch{fail(res);}
 }
 async function allowed(db,mother,doctor){
  return await verifiedDoctor(db,doctor)&&!!(await db.query(`SELECT 1 FROM users u WHERE u.id=$1 AND u.email LIKE '%@dai-synthetic.invalid' AND EXISTS(SELECT 1 FROM users du WHERE du.id=$2 AND du.email LIKE '%@dai-synthetic.invalid') AND ${access.activeRelationshipSql('u.id','$2::int')} AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=u.id),TRUE)`,[mother,doctor])).rows.length;
 }
 app.get(prefix+'/contacts',authenticateToken,gate,async(req,res)=>{try{
  let contacts;
  if(req.user.role==='doctor')contacts=(await pool.query(`SELECT mp.user_id AS id,mp.full_name AS name FROM mother_profiles mp JOIN users u ON u.id=mp.user_id WHERE u.email LIKE '%@dai-synthetic.invalid' AND ${access.activeRelationshipSql('mp.user_id','$1::int')} AND COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=mp.user_id),TRUE) ORDER BY mp.full_name`,[req.user.id])).rows;
  else {const candidates=(await pool.query(`SELECT DISTINCT dp.user_id AS id,dp.full_name AS name FROM doctor_profiles dp JOIN users u ON u.id=dp.user_id WHERE u.email LIKE '%@dai-synthetic.invalid' AND ${access.activeRelationshipSql('$1::int','dp.user_id')} ORDER BY dp.full_name`,[req.user.id])).rows;contacts=[];for(const c of candidates)if(await allowed(pool,req.user.id,c.id))contacts.push(c);}
  res.json({contacts,role:req.user.role,label:'Local synthetic messages · no SMS, email or external AI delivery'});
 }catch{fail(res);}});
 function pair(req,id){return req.user.role==='doctor'?{mother:id,doctor:req.user.id}:{mother:req.user.id,doctor:id};}
 app.get(prefix+'/thread',authenticateToken,gate,async(req,res)=>{let c;try{
  const id=Number(req.query.peer_id);if(Object.keys(req.query).length!==1||!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Choose a valid contact.'});
  c=await pool.connect();await c.query('BEGIN');await c.query('LOCK TABLE patient_access_controls,doctor_profiles,patient_preferences IN SHARE MODE');
  const p=pair(req,id);if(!await allowed(c,p.mother,p.doctor)){await c.query('ROLLBACK');return res.status(403).json({error:'This care connection is not available or sharing has changed.'});}
  const rows=(await c.query('SELECT id,sender_id,body,created_at FROM demo_care_messages WHERE mother_id=$1 AND doctor_id=$2 ORDER BY id DESC LIMIT 100',[p.mother,p.doctor])).rows.reverse();
  await c.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'demo_message_thread_read',jsonb_build_object('actor_id',$2::int,'doctor_id',$3::int))",[p.mother,req.user.id,p.doctor]);
  await c.query('COMMIT');res.json({messages:rows.map(r=>({...r,mine:r.sender_id===req.user.id,sender_id:undefined})),limit:100});
 }catch{if(c)await c.query('ROLLBACK').catch(()=>{});fail(res);}finally{c?.release();}});
 app.post(prefix+'/thread',authenticateToken,gate,async(req,res)=>{
  const b=req.body||{},id=Number(b.peer_id);if(Object.keys(b).some(k=>!['peer_id','text','client_id'].includes(k))||!Number.isSafeInteger(id)||id<1||typeof b.text!=='string'||!b.text.trim()||b.text.length>2000||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.client_id||''))return res.status(400).json({error:'Choose a contact and enter a message of 1–2,000 characters.'});
  const p=pair(req,id);let c;try{
   c=await pool.connect();
   await c.query('BEGIN');await c.query('LOCK TABLE patient_access_controls,doctor_profiles,patient_preferences IN SHARE MODE');
   if(!await allowed(c,p.mother,p.doctor)){await c.query('ROLLBACK');return res.status(403).json({error:'This care connection is not available or sharing has changed.'});}
   const old=(await c.query('SELECT id,mother_id,doctor_id,body FROM demo_care_messages WHERE sender_id=$1 AND client_id=$2',[req.user.id,b.client_id])).rows[0];
   if(old){await c.query('ROLLBACK');return old.mother_id===p.mother&&old.doctor_id===p.doctor&&old.body===b.text.trim()?res.json({saved:true,id:old.id}):res.status(409).json({error:'Message identifier already used. Refresh before sending.'});}
   const m=(await c.query('INSERT INTO demo_care_messages(mother_id,doctor_id,sender_id,client_id,body) VALUES($1,$2,$3,$4,$5) RETURNING id',[p.mother,p.doctor,req.user.id,b.client_id,b.text.trim()])).rows[0];
   await c.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'demo_message_sent',jsonb_build_object('actor_id',$2::int,'doctor_id',$3::int,'message_id',$4::text))",[p.mother,req.user.id,p.doctor,String(m.id)]);
   await c.query('COMMIT');res.status(201).json({saved:true,id:m.id});
  }catch{if(c)await c.query('ROLLBACK').catch(()=>{});fail(res);}finally{c?.release();}
 });
};
