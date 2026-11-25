'use strict';
const day=v=>v instanceof Date?v.toISOString().slice(0,10):v?String(v).slice(0,10):null;
async function readHousehold(pool,motherId){
 const row=(await pool.query('SELECT record,updated_at FROM family_circle_profiles WHERE mother_id=$1',[motherId])).rows[0];
 if(!row)return null;
 const record=row.record||{};
 const child=(await pool.query('SELECT id,name,date_of_birth,sex,birth_weight_kg FROM children WHERE id=$1 AND mother_id=$2',[record.child_id,motherId])).rows[0];
 if(!child)return null;
 const [growth,vaccines,appointments,profile,reviewer]=await Promise.all([
  pool.query('SELECT id,measured_on,weight_kg,height_cm FROM child_growth_logs WHERE child_id=$1 ORDER BY measured_on DESC,id DESC',[child.id]),
  pool.query('SELECT vaccine_code,given_on FROM child_vaccinations WHERE child_id=$1 ORDER BY given_on',[child.id]),
  pool.query("SELECT id,requested_date,requested_time,status,reason FROM appointments WHERE mother_id=$1 AND child_id=$2 AND requested_date>=CURRENT_DATE AND ($3::date IS NULL OR requested_date=$3::date) AND status NOT IN ('cancelled','rejected') ORDER BY requested_date,requested_time LIMIT 1",[motherId,child.id,record.routine_review_date||null]),
  pool.query('SELECT pregnancy_status,lmp_date,edd_date FROM mother_profiles WHERE user_id=$1',[motherId]),
  record.growth_review?.doctor_id?pool.query('SELECT full_name FROM doctor_profiles WHERE user_id=$1',[record.growth_review.doctor_id]):Promise.resolve({rows:[]})
 ]);
 return {synthetic:record.synthetic===true,child:{...child,date_of_birth:day(child.date_of_birth),
  growth:growth.rows.map(g=>({...g,measured_on:day(g.measured_on)})),vaccinations:vaccines.rows.map(v=>({...v,given_on:day(v.given_on)})),
  next_review:appointments.rows[0]?{...appointments.rows[0],requested_date:day(appointments.rows[0].requested_date)}:null,
  growth_review:record.growth_review?{...record.growth_review,doctor_name:reviewer.rows[0]?.full_name||null}:null},
  people:record.people||[],previous_birth:record.previous_birth||null,
  current_journey:{...profile.rows[0],lmp_date:day(profile.rows[0]?.lmp_date),edd_date:day(profile.rows[0]?.edd_date)},updated_at:row.updated_at};
}
function register(app,{pool,authenticateToken,authorizeRole}){
 app.get('/api/patient/family-circle-profile',authenticateToken,authorizeRole(['mother']),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{res.json({household:await readHousehold(pool,req.user.id)});}
  catch{res.status(503).json({error:'The household summary is temporarily unavailable.'});}
 });
}
module.exports={register,readHousehold};
