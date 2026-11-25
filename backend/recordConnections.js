'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const access=require('./accessControl'),{verifiedDoctor}=require('./clinicalDashboard'),{dateValid}=require('./patientContinuity');
const FIXTURES=require('../scripts/fixtures/record-connection-demo.cjs');
const PROVIDERS=['abdm','digilocker'],CATEGORIES=['lab_report','scan_imaging','discharge_summary','prescription','medical_report'];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const state=c=>c.revoked_at||c.state==='revoked'?'revoked':new Date(c.expires_at)<=new Date()?'expired':c.state;
function createService(pool,{env=process.env,fixtures=FIXTURES,fixtureDir=path.join(__dirname,'../scripts/fixtures/connected-records')}={}){
 let encryptionKey;
 function key(){
  if(encryptionKey)return encryptionKey;
  let value=env.DAI_RECORD_CONNECTIONS_KEY;
  if(!value&&env.DAI_LOCAL==='true'){
   const file=path.join(path.resolve(env.DAI_LOCAL_DB_DIR||path.join(__dirname,'../.local/patient-db')),'../record-connections.key');
   fs.mkdirSync(path.dirname(file),{recursive:true});
   try{fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
   value=fs.readFileSync(file,'utf8').trim();
  }
  if(!/^[a-f0-9]{64}$/i.test(value||''))fail('Private record storage is not configured.',503);
  return encryptionKey=Buffer.from(value,'hex');
 }
 function seal(bytes,aad){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(aad));const data=Buffer.concat([c.update(bytes),c.final()]);return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};}
 function open(value,aad){const d=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(value.iv,'base64'));d.setAAD(Buffer.from(aad));d.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([d.update(Buffer.from(value.data,'base64')),d.final()]);}
 const event=(db,mother,actor,type,ref=null,provider=null)=>db.query('INSERT INTO record_connection_events(mother_id,actor_id,event_type,reference_id,provider) VALUES($1,$2,$3,$4,$5)',[mother,actor,type,ref,provider]);
 async function demoAllowed(mother){
  if(env.DAI_LOCAL!=='true'||env.DAI_DEMO!=='true')return false;
  if(!(await pool.query("SELECT to_regclass('public.dai_local_source_link') AS found")).rows[0]?.found)return false;
  return !!(await pool.query("SELECT 1 FROM users u JOIN dai_local_source_link l ON l.target_id=u.id AND l.entity='mother' WHERE u.id=$1 AND u.email='nivara@dai-synthetic.invalid' AND l.source_id='MOTHER-SYN-0000001' AND u.closed_at IS NULL",[mother])).rows.length;
 }
 async function doctorAllowed(db,mother,doctor){
  if(!Number.isSafeInteger(mother)||mother<1||!await verifiedDoctor(db,doctor)||!await access.hasDoctorAccess(db,doctor,mother))fail('A verified clinician and an active care relationship are required.',403);
  const pref=(await db.query('SELECT preferences FROM patient_preferences WHERE user_id=$1',[mother])).rows[0]?.preferences;
  if(pref?.privacy_share_doctors===false)fail('The patient has paused doctor sharing.',403);
 }
 const identityView=row=>row?{kind:row.kind,status:row.kind==='demo'?'demo_only':'unverified',masked_number:row.kind==='demo'?'Demo identity':row.number_last4?'••-••••-••••-'+row.number_last4:null,has_details:true,updated_at:row.updated_at}:{status:'not_added',has_details:false};
 const meta=r=>({id:'ext_'+r.id,record_id:r.id,title:r.title,doc_type:r.doc_type,report_category:r.doc_type==='lab_report'?(/urine/i.test(r.title)?'urine':'blood'):r.doc_type,report_date:day(r.report_date),facility_name:r.issuer,issuer:r.issuer,source:'demo_'+r.provider,external_provider:r.provider,external_reference:r.provider_record_id,demo:true,verification_status:'pending',uploaded_at:r.imported_at,child_id:null,is_sensitive:false,original_filename:r.provider_record_id+'.pdf'});
 async function connections(db,mother){return (await db.query('SELECT provider,mode,selected_records,connected_at,disconnected_at FROM record_connections WHERE mother_id=$1',[mother])).rows;}
 async function validConsents(db,mother,doctor){return (await db.query("SELECT * FROM record_connection_consents WHERE mother_id=$1 AND doctor_id=$2 AND state='granted' AND revoked_at IS NULL AND expires_at>NOW()",[mother,doctor])).rows;}
 function covers(c,r){return state(c)==='granted'&&c.providers.includes(r.provider)&&c.categories.includes(r.doc_type)&&day(r.report_date)>=day(c.from_date)&&day(r.report_date)<=day(c.to_date);}
 function selected(sources,r){return sources.some(s=>s.provider===r.provider&&!s.disconnected_at&&s.selected_records.includes(r.provider_record_id));}
 async function rowsFor(db,mother){return (await db.query('SELECT id,mother_id,provider,provider_record_id,title,doc_type,report_date,issuer,mime_type,imported_at FROM connected_records WHERE mother_id=$1 ORDER BY report_date DESC,id',[mother])).rows;}
 function consentView(c){return {...c,from_date:day(c.from_date),to_date:day(c.to_date),status:state(c)};}
 async function getState(mother,doctor=null){
  if(doctor!==null)await doctorAllowed(pool,mother,doctor);
  const [ids,sources,consents,rows]=await Promise.all([
   pool.query('SELECT kind,number_last4,updated_at FROM record_connection_identities WHERE mother_id=$1',[mother]),connections(pool,mother),
   pool.query(`SELECT c.*,dp.full_name AS doctor_name FROM record_connection_consents c JOIN doctor_profiles dp ON dp.user_id=c.doctor_id WHERE c.mother_id=$1 ${doctor!==null?'AND c.doctor_id=$2':''} ORDER BY c.created_at DESC`,doctor!==null?[mother,doctor]:[mother]),rowsFor(pool,mother)
  ]);
  const allowed=consents.rows.filter(c=>state(c)==='granted');
  const result={mother_id:mother,mode:'demo',live_connected:false,
   identity:doctor===null?identityView(ids.rows[0]):{has_details:!!ids.rows.length,status:allowed.length?identityView(ids.rows[0]).status:'not_shared'},
   providers:PROVIDERS.map(provider=>{const s=sources.find(s=>s.provider===provider);return {provider,status:s&&!s.disconnected_at?'demo_connected':'not_connected',live_available:false,selected_records:doctor===null?s?.selected_records||[]:undefined};}),
   consents:consents.rows.map(consentView),records:rows.filter(r=>doctor===null||selected(sources,r)&&allowed.some(c=>covers(c,r))).map(meta)};
  if(doctor===null){
   result.demo_available=await demoAllowed(mother);
   result.demo_catalog=result.demo_available?fixtures.map(({lines,file,...f})=>f):[];
   const candidates=(await pool.query(`SELECT DISTINCT dp.user_id AS id,dp.full_name AS name FROM doctor_profiles dp WHERE ${access.activeRelationshipSql('$1::int','dp.user_id')}`,[mother])).rows;
   result.doctors=[];for(const d of candidates)if(await verifiedDoctor(pool,d.id))result.doctors.push(d);
   result.recent_access=(await pool.query('SELECT e.event_type,e.provider,e.created_at,dp.full_name AS doctor_name FROM record_connection_events e LEFT JOIN doctor_profiles dp ON dp.user_id=e.actor_id WHERE e.mother_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 8',[mother])).rows;
  }else await event(pool,mother,doctor,'doctor_records_list');
  return result;
 }
 async function saveIdentity(mother,b){
  if(b.confirmed!==true)fail('Confirm before saving optional ABHA details.');
  let identity,kind,last4=null;
  if(b.demo===true){if(!await demoAllowed(mother))fail('The fictional demo identity is unavailable for this account.',403);identity={demo:true,abha_address:'nivara.demo@sbx',abha_number:null};kind='demo';}
  else{
   if(typeof(b.abha_number||'')!=='string'||typeof(b.abha_address||'')!=='string')fail('Enter an ABHA number or address.');
   const number=(b.abha_number||'').replace(/[ -]/g,''),address=(b.abha_address||'').trim().toLowerCase();
   if(number&&!/^\d{14}$/.test(number)||number&&/^(\d)\1{13}$/.test(number))fail('Enter the 14 digits printed on your ABHA card.');
   if(address&&!/^[a-z0-9][a-z0-9._-]{0,39}@(abdm|sbx)$/.test(address))fail('Enter an ABHA address ending in @abdm or @sbx.');
   if(!number&&!address)fail('Enter an ABHA number or address, or choose Later.');
   identity={abha_number:number||null,abha_address:address||null};kind='self_reported';last4=number?number.slice(-4):null;
  }
  const encrypted=seal(Buffer.from(JSON.stringify(identity)),mother+':identity');
  await pool.query('INSERT INTO record_connection_identities(mother_id,identity_cipher,number_last4,kind) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT(mother_id) DO UPDATE SET identity_cipher=EXCLUDED.identity_cipher,number_last4=EXCLUDED.number_last4,kind=EXCLUDED.kind,updated_at=NOW()',[mother,JSON.stringify(encrypted),last4,kind]);
  await event(pool,mother,mother,'identity_saved');return {saved:true,status:kind==='demo'?'demo_only':'unverified'};
 }
 async function connect(mother,provider,b){
  if(!PROVIDERS.includes(provider))fail('Choose ABHA / ABDM or DigiLocker.');
  if(b.confirmed_demo!==true||!await demoAllowed(mother))fail('This is a local fictional connection demonstration only.',403);
  if(!Array.isArray(b.record_ids)||!b.record_ids.length||b.record_ids.some(id=>!fixtures.some(f=>f.provider===provider&&f.provider_record_id===id)))fail('Choose the demo documents you want to connect.');
  await pool.query("INSERT INTO record_connections(mother_id,provider,selected_records) VALUES($1,$2,$3::jsonb) ON CONFLICT(mother_id,provider) DO UPDATE SET selected_records=EXCLUDED.selected_records,connected_at=NOW(),disconnected_at=NULL",[mother,provider,JSON.stringify([...new Set(b.record_ids)])]);
  await event(pool,mother,mother,'demo_provider_authorized',null,provider);return {connected:true,mode:'demo',live_connected:false};
 }
 async function disconnect(mother,provider){
  if(!PROVIDERS.includes(provider))fail('Unknown connection.');
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('UPDATE record_connections SET disconnected_at=clock_timestamp() WHERE mother_id=$1 AND provider=$2',[mother,provider]);await db.query("UPDATE record_connection_consents SET state='revoked',revoked_at=clock_timestamp() WHERE mother_id=$1 AND state IN ('requested','granted') AND providers @> $2::jsonb",[mother,JSON.stringify([provider])]);await event(db,mother,mother,'provider_disconnected',null,provider);await db.query('COMMIT');return {disconnected:true};}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 function scope(b){
  const unique=(v,allowed)=>Array.isArray(v)&&v.length&&v.length<=allowed.length&&v.every(x=>allowed.includes(x))?[...new Set(v)]:null;
  const providers=unique(b.providers,PROVIDERS),categories=unique(b.categories,CATEGORIES);
  if(!providers||!categories||!dateValid(b.from_date)||!dateValid(b.to_date)||b.from_date>b.to_date||b.to_date>today()||b.from_date<'1900-01-01'||![1,7,30].includes(b.days)||typeof b.purpose!=='string'||!b.purpose.trim()||b.purpose.length>500)fail('Choose sources, record types, a valid date range, purpose and 1, 7 or 30 days.');
  return {providers,categories,from_date:b.from_date,to_date:b.to_date,purpose:b.purpose.trim(),days:b.days};
 }
 async function connectedSources(db,mother,providers){const sources=await connections(db,mother);if(providers.some(p=>!sources.some(s=>s.provider===p&&!s.disconnected_at)))fail('Connect the selected demo sources before approving access.');}
 async function consent(mother,actor,doctor,b,requested=false){
  if(!Number.isSafeInteger(doctor)||doctor<1)fail('Choose a connected clinician.');
  if(!requested&&b.confirmed!==true)fail('Explicit approval is required.');
  const chosen=scope(b),id=crypto.randomUUID(),expires=new Date(Date.now()+chosen.days*86400000).toISOString(),db=await pool.connect();
  try{await db.query('BEGIN');await doctorAllowed(db,mother,doctor);if(!requested){await connectedSources(db,mother,chosen.providers);await db.query("UPDATE record_connection_consents SET state='revoked',revoked_at=clock_timestamp() WHERE mother_id=$1 AND doctor_id=$2 AND state='granted'",[mother,doctor]);}
   await db.query(`INSERT INTO record_connection_consents(id,mother_id,doctor_id,providers,categories,from_date,to_date,purpose,days,state,expires_at,granted_at,created_by) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,${requested?'NULL':'NOW()'},$12)`,[id,mother,doctor,JSON.stringify(chosen.providers),JSON.stringify(chosen.categories),chosen.from_date,chosen.to_date,chosen.purpose,chosen.days,requested?'requested':'granted',expires,actor]);
   await event(db,mother,actor,requested?'consent_requested':'consent_granted',id);await db.query('COMMIT');return {id,status:requested?'requested':'granted'};
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 async function approve(mother,id,b){
  if(!uuid(id)||b.confirmed!==true)fail('Confirm the consent request.');
  const db=await pool.connect();try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM record_connection_consents WHERE id=$1 AND mother_id=$2 FOR UPDATE',[id,mother])).rows[0];if(!row)fail('Consent request not found.',404);if(state(row)!=='requested')fail('This request is no longer awaiting approval.',409);
   const s=scope({...row,...b,from_date:b.from_date||day(row.from_date),to_date:b.to_date||day(row.to_date)});
   if(s.providers.some(p=>!row.providers.includes(p))||s.categories.some(c=>!row.categories.includes(c))||s.from_date<day(row.from_date)||s.to_date>day(row.to_date)||s.days>row.days)fail('Approval may narrow this request; it cannot expand it.');
   await doctorAllowed(db,mother,row.doctor_id);await connectedSources(db,mother,s.providers);
   await db.query("UPDATE record_connection_consents SET state='revoked',revoked_at=clock_timestamp() WHERE mother_id=$1 AND doctor_id=$2 AND state='granted'",[mother,row.doctor_id]);
   await db.query("UPDATE record_connection_consents SET providers=$2::jsonb,categories=$3::jsonb,from_date=$4,to_date=$5,days=$6,state='granted',granted_at=NOW(),expires_at=$7,revoked_at=NULL WHERE id=$1",[id,JSON.stringify(s.providers),JSON.stringify(s.categories),s.from_date,s.to_date,s.days,new Date(Date.now()+s.days*86400000).toISOString()]);
   await event(db,mother,mother,'consent_granted',id);await db.query('COMMIT');return {granted:true};
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 async function revoke(mother,id){if(!uuid(id))fail('Consent not found.',404);const r=await pool.query("UPDATE record_connection_consents SET state='revoked',revoked_at=clock_timestamp() WHERE id=$1 AND mother_id=$2 RETURNING id",[id,mother]);if(!r.rows.length)fail('Consent not found.',404);await event(pool,mother,mother,'consent_revoked',id);return {revoked:true};}
 async function sync(mother,actor,provider=null){
  if(!await demoAllowed(mother))fail('Live government retrieval is not connected. This demo is restricted to Nivara’s fictional account.',409);
  if(provider!==null&&!PROVIDERS.includes(provider))fail('Unknown provider.');
  const db=await pool.connect();try{await db.query('BEGIN');if(actor!==mother)await doctorAllowed(db,mother,actor);
   const sources=await connections(db,mother),grants=actor===mother?null:await validConsents(db,mother,actor);
   if(grants&&!grants.length)fail('Patient approval is required before retrieving connected reports.',403);
   const chosen=fixtures.filter(f=>(!provider||f.provider===provider)&&selected(sources,f)&&(!grants||grants.some(c=>covers(c,f))));
   if(!chosen.length)fail('No connected documents match the approved sources and date range.',409);
   let imported=0;for(const f of chosen){
    if((await db.query('SELECT id FROM connected_records WHERE mother_id=$1 AND provider=$2 AND provider_record_id=$3',[mother,f.provider,f.provider_record_id])).rows.length)continue;
    const id=crypto.randomUUID(),bytes=fs.readFileSync(path.join(fixtureDir,f.file));
    if(bytes.length>5242880||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))fail('A demo fixture could not be imported.',503);
    await db.query('INSERT INTO connected_records(id,mother_id,provider,provider_record_id,title,doc_type,report_date,issuer,payload_cipher,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[id,mother,f.provider,f.provider_record_id,f.title,f.doc_type,f.report_date,f.issuer,JSON.stringify(seal(bytes,mother+':record:'+id)),crypto.createHash('sha256').update(bytes).digest('hex')]);imported++;
   }
   await event(db,mother,actor,'demo_records_retrieved',null,provider);await db.query('COMMIT');return {imported,matched:chosen.length,mode:'demo',live_connected:false};
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 async function download(mother,actor,id){
  if(!uuid(id))fail('Report not found.',404);
  const db=await pool.connect();try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM connected_records WHERE id=$1 AND mother_id=$2',[id,mother])).rows[0];if(!row)fail('Report not found.',404);
   if(actor!==mother){await doctorAllowed(db,mother,actor);const [sources,grants]=await Promise.all([connections(db,mother),validConsents(db,mother,actor)]);if(!selected(sources,row)||!grants.some(c=>covers(c,row)))fail('This report is not currently shared with this clinician.',403);}
   const bytes=open(row.payload_cipher,mother+':record:'+id);await event(db,mother,actor,'original_report_opened',id,row.provider);await db.query('COMMIT');return {bytes,title:row.title};
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 return {getState,saveIdentity,connect,disconnect,consent,approve,revoke,sync,download,doctorAllowed,seal,open};
}
function register(app,{pool,authenticateToken,authorizeRole,env=process.env,...options}){
 const S=createService(pool,{env,...options}),mother=[authenticateToken,authorizeRole(['mother'])],doctor=[authenticateToken,authorizeRole(['doctor'])];
 const route=fn=>async(req,res)=>{res.set('Cache-Control','private, no-store');try{const out=await fn(req,res);if(!res.headersSent)res.json(out);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Connected records are temporarily unavailable.'});}};
 const own='/api/patient/record-connections',other='/api/doctor/patients/:motherId/record-connections';
 const mid=req=>Number(req.params.motherId);
 app.get(own,...mother,route(req=>S.getState(req.user.id)));
 app.put(own+'/identity',...mother,route(req=>S.saveIdentity(req.user.id,req.body||{})));
 app.post(own+'/:provider/demo-link',...mother,route(req=>S.connect(req.user.id,req.params.provider,req.body||{})));
 app.delete(own+'/:provider',...mother,route(req=>S.disconnect(req.user.id,req.params.provider)));
 app.post(own+'/:provider/sync',...mother,route(req=>S.sync(req.user.id,req.user.id,req.params.provider)));
 app.post(own+'/consents',...mother,route(req=>S.consent(req.user.id,req.user.id,Number(req.body?.doctor_id),req.body||{})));
 app.post(own+'/consents/:id/approve',...mother,route(req=>S.approve(req.user.id,req.params.id,req.body||{})));
 app.delete(own+'/consents/:id',...mother,route(req=>S.revoke(req.user.id,req.params.id)));
 const file=(req,res,result)=>{res.set({'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="dai-connected-demo-report.pdf"','Content-Security-Policy':"sandbox"});res.send(result.bytes);};
 app.get(own+'/records/:id/original',...mother,route(async(req,res)=>file(req,res,await S.download(req.user.id,req.user.id,req.params.id))));
 app.get(other,...doctor,route(req=>S.getState(mid(req),req.user.id)));
 app.post(other+'/consent-requests',...doctor,route(req=>S.consent(mid(req),req.user.id,req.user.id,req.body||{},true)));
 app.post(other+'/sync',...doctor,route(req=>S.sync(mid(req),req.user.id)));
 app.get(other+'/records/:id/original',...doctor,route(async(req,res)=>file(req,res,await S.download(mid(req),req.user.id,req.params.id))));
 return S;
}
module.exports={register,createService,PROVIDERS,CATEGORIES};
