'use strict';
const crypto=require('node:crypto');
module.exports=function register(app,{pool,authenticateToken,authorizeRole,intervalMs=2000}){
 const mother=[authenticateToken,authorizeRole(['mother'])];
 // A compact invalidation stream. Always refresh on connect/reconnect: missed events
 // cannot leave a stale screen. Server checks persisted state, including other processes.
 app.get('/api/patient/timeline/events',...mother,async(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
  let closed=false,busy=false,last=null;
  const send=(type,body,id)=>{if(!closed)res.write((id?'id: '+id+'\n':'')+'event: '+type+'\ndata: '+JSON.stringify(body)+'\n\n');};
  const tick=async()=>{if(closed||busy)return;busy=true;try{
   if(req.user.exp&&Date.now()>=req.user.exp*1000){send('session-ended',{});res.end();return;}
   const rows=(await pool.query('SELECT id,title,guidance,stage,category,due_date,completed_at,completion_verification,result_id,appointment_id,verified_facility_name FROM care_milestones WHERE mother_id=$1 ORDER BY id',[req.user.id])).rows;
   const revision=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
   if(last!==revision){send(last===null?'ready':'timeline-changed',{refresh:true},revision);last=revision;}
   else res.write(': heartbeat\n\n');
  }catch{send('unavailable',{fallback:'poll'});res.end();}finally{busy=false;}};
  res.write('retry: 4000\n\n');
  const timer=setInterval(tick,intervalMs),renew=setTimeout(()=>res.end(),120000);
  const cleanup=()=>{closed=true;clearInterval(timer);clearTimeout(renew);};res.on('close',cleanup);
  await tick();
 });
 app.post('/api/patient/timeline/:id/assist',...mother,async(req,res)=>{
  if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Choose a recorded care step'});
  try{
   const row=(await pool.query('SELECT * FROM care_milestones WHERE id=$1 AND mother_id=$2',[req.params.id,req.user.id])).rows[0];
   if(!row)return res.status(404).json({error:'Care step not found'});
   // Bounded, deterministic tool orchestration; no external LLM receives records.
   // Only services already named in the recorded step are matched, not inferred care.
   const words=String(row.title).toLowerCase().match(/[a-z]{3,}/g)||[];
   const services=(await pool.query(`SELECT f.id,f.name,f.address,f.verified_at,s.service_name
    FROM facilities f JOIN facility_services s ON s.facility_id=f.id
    WHERE f.active=TRUE AND s.available=TRUE ORDER BY f.verified_at DESC NULLS LAST,f.id,s.id LIMIT 500`)).rows;
   const seen=new Set();const facilities=services.filter(f=>words.some(w=>!['your','visit','first','check','care','with','week','during','test','blood'].includes(w)&&f.service_name.toLowerCase().includes(w))).filter(f=>{if(seen.has(f.id))return false;seen.add(f.id);return true;}).slice(0,3).map(f=>({...f,reason:'Lists '+f.service_name+'. '+(f.verified_at?'Confirmation date is available.':'Confirmation date is not recorded. Availability needs confirmation.')}));
   const questions=['What should I prepare for '+row.title+'?','Which previous reports should I bring?','Who should review the result and when?'];
   await pool.query('INSERT INTO care_step_assistance_log(mother_id,milestone_id,tools_used) VALUES($1,$2,$3::jsonb)',[req.user.id,row.id,JSON.stringify(['read_own_step','match_recorded_service','draft_questions','prepare_request'])]);
   res.set('Cache-Control','no-store').json({milestone_id:row.id,title:row.title,explanation:row.guidance||'Ask your care team to explain this recorded step.',workflow_state:require('./careStepMachine').stateOf(row),facilities,questions,draft:{reason:row.title,milestone_id:row.id},requires_confirmation:true,source:'rules',mode:'bounded-guided-agent',notice:'Draft only. You choose the centre and confirm the request. This does not book a visit or confirm clinical completion.'});
  }catch(e){res.status(503).json({error:'Guided help is unavailable. You can still upload a report or request a visit.'});}
 });
};
