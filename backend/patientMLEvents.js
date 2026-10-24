'use strict';
// Record successful canonical mutations only; never infer completion from a click.
module.exports=pool=>(req,res,next)=>{
 res.on('finish',()=>{
  if(res.statusCode<200||res.statusCode>=300||!req.user)return;
  let type,sql,values;
  const a=req.path.match(/^\/api\/appointments\/(\d+)\/status$/)||req.path.match(/^\/api\/doctor\/queue\/(\d+)$/),t=req.path.match(/^\/api\/timeline\/(\d+)\/complete$/);
  if(a&&['PATCH','PUT','POST'].includes(req.method)&&(req.body?.status==='completed'||req.body?.state==='done')&&req.user.role==='doctor'){type='appointment_kept';sql='SELECT mother_id FROM appointments WHERE id=$1 AND doctor_id=$2';values=[Number(a[1]),req.user.id];}
  if(t&&['PATCH','PUT','POST'].includes(req.method)&&req.user.role==='mother'){type='action_completed';sql='SELECT mother_id FROM care_milestones WHERE id=$1 AND mother_id=$2 AND completed_at IS NOT NULL';values=[Number(t[1]),req.user.id];}
  if(!type)return;
  (async()=>{const owner=(await pool.query(sql,values)).rows[0]?.mother_id;if(!owner)return;await pool.query("INSERT INTO events(patient_id,event_type,channel,entity_id) SELECT $1,$2,'app',$3 WHERE EXISTS(SELECT 1 FROM patient_ml_settings WHERE patient_id=$1 AND events=TRUE) ON CONFLICT DO NOTHING",[owner,type,'record-'+(a?.[1]||t?.[1])]);})().catch(()=>{});
 });next();
};
