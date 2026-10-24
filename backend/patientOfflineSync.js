'use strict';
const crypto=require('node:crypto');
module.exports=function(app,{pool,authenticateToken,authorizeRole}){
 app.post('/api/patient/offline-sync',authenticateToken,authorizeRole(['mother']),async(req,res)=>{
  res.set('Cache-Control','no-store');const b=req.body||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.mutation_id)||!Number.isSafeInteger(b.milestone_id)||!Object.hasOwn(b,'expected_completed_at')||!Object.hasOwn(b,'expected_verification'))return res.status(400).json({error:'Invalid queued update'});
  const hash=crypto.createHash('sha256').update(JSON.stringify([b.milestone_id,b.expected_completed_at,b.expected_verification])).digest('hex');const db=await pool.connect();
  try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM care_milestones WHERE id=$1 AND mother_id=$2 FOR UPDATE',[b.milestone_id,req.user.id])).rows[0];if(!row){await db.query('ROLLBACK');return res.status(404).json({error:'Care step not found'});}
   const prior=(await db.query('SELECT * FROM patient_offline_mutations WHERE user_id=$1 AND mutation_id=$2',[req.user.id,b.mutation_id])).rows[0];if(prior){await db.query('COMMIT');return res.status(prior.payload_hash===hash?200:409).json(prior.payload_hash===hash?prior.result:{error:'Update identifier already used'});}
   const stamp=v=>v?new Date(v).toISOString():null;
   if(row.completion_verification==='verified'||stamp(row.completed_at)!==stamp(b.expected_completed_at)||(row.completion_verification||null)!==(b.expected_verification||null)){await db.query('ROLLBACK');return res.status(409).json({error:'This care step changed online. Review it before trying again.'});}
   const milestone=(await db.query("UPDATE care_milestones SET completed_at=NOW(),completion_verification='self_reported' WHERE id=$1 AND mother_id=$2 RETURNING *",[row.id,req.user.id])).rows[0];const result={milestone,message:'Self-reported completion synchronised'};
   await db.query('INSERT INTO patient_offline_mutations(user_id,mutation_id,payload_hash,result) VALUES($1,$2,$3,$4)',[req.user.id,b.mutation_id,hash,JSON.stringify(result)]);await db.query('COMMIT');res.json(result);
  }catch(e){await db.query('ROLLBACK');res.status(500).json({error:'Update not synchronised'});}finally{db.release();}
 });
};
