/* Opt-in device cache: timeline and stage only; no reports, tokens or passwords. */
(function(){'use strict';
function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('dai-patient-care',1);r.onupgradeneeded=()=>r.result.createObjectStore('care');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function access(mode,fn){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('care',mode),s=t.objectStore('care');let value;const r=fn(s);if(r)r.onsuccess=()=>value=r.result;t.oncomplete=()=>{d.close();resolve(value);};t.onerror=()=>{d.close();reject(t.error);};});}
window.PatientOffline={
 async save(state){if(!state.user||state.user.guest)return;const p={user:{id:state.user.id,full_name:state.user.full_name,lmp_date:state.user.lmp_date,care_start_date:state.user.care_start_date,edd_date:state.user.edd_date,pregnancy_status:state.user.pregnancy_status},milestones:state.milestones,post:{active:state.post.active,delivery:state.post.delivery,schedule:state.post.schedule},savedAt:new Date().toISOString()};await access('readwrite',s=>s.put(p,'snapshot'));},
 load:()=>access('readonly',s=>s.get('snapshot')),
 async queue(user,id){const q=await access('readonly',s=>s.get('queue'))||[];if(!q.some(x=>x.user===user&&x.id===id))q.push({user,id});await access('readwrite',s=>s.put(q,'queue'));},
 queueItems:async()=>await access('readonly',s=>s.get('queue'))||[],
 async remove(user,id){const q=await this.queueItems();await access('readwrite',s=>s.put(q.filter(x=>x.user!==user||x.id!==id),'queue'));},
 clear:()=>access('readwrite',s=>s.clear())
};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/patient-sw.js',{scope:'/'}).catch(()=>{});
})();
