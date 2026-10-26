'use strict';
const {requestReview}=require('./clinicalReview');
const ageFrom=dobValue=>{const d=new Date(dobValue),n=new Date();return n.getUTCFullYear()-d.getUTCFullYear()-(n.getUTCMonth()<d.getUTCMonth()||n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()?1:0);};
async function runRiskAssessment(pool,userId,b={},trigger='manual'){
 if(Object.keys(b).length)return {status:400,body:{error:'Save measurements in Health logs first, then request clinician review. Full histories are not accepted by this action.'}};
 if(!(await pool.query('SELECT user_id FROM mother_profiles WHERE user_id=$1',[userId])).rows.length)return {status:404,body:{error:'Profile not found'}};
 // Vitals stay in their original health logs. No classifier, external model or copied history.
 const db=await pool.connect();try{await db.query('BEGIN');
 const request=await requestReview(db,userId,'pregnancy_risk',trigger==='auto_log'?'Care-team review requested after a recorded health log. Check the original measurements.':'Patient requested a pregnancy risk review. Review the relevant original records.',null,trigger==='auto_log');
 await db.query('COMMIT');return {status:202,body:{review_required:true,request_id:request.id,message:'Pending clinician review. No automated risk level was assigned. For urgent concerns contact your care team or emergency services directly.'}};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
module.exports={runRiskAssessment,ageFrom};
