/* Optional access assistance. Existing rules remain usable before/without any request. */
(function(){'use strict';
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=()=>window.DaiAPI;let settings={enabled:false,consent:{}},ready=false,cache=new Map(),pending=new Set(),epoch=0,support=null,reminder=null;
const active=()=>settings.enabled&&settings.consent.personalization;
const badge=source=>source==='ml'?'<small class="patient-ml-badge">Simulated on synthetic data</small>':'';
async function call(path,body){if(!api()?.apiRequest)return null;return api().apiRequest('/patient/ml/'+path,{method:'POST',body});}
function publish(){window.dispatchEvent(new Event('dai:patient-ml-updated'));}
function signature(rows){return JSON.stringify(rows.map(m=>[m.key,m.due_date,m.completed_at,m.clinician_priority]));}
function orderGaps(rows){
 if(!active())return rows;
 const open=rows.filter(m=>m.source==='milestone'&&window.PatientPendingModel.status(m)!=='completed'&&window.PatientPendingModel.status(m)!=='queued'),key=signature(open),saved=cache.get(key);
 if(saved){const byId=new Map(saved.items.map((x,i)=>[x.id,{...x,index:i}]));const ranked=rows.filter(r=>byId.has(r.key)).map(r=>({...r,ml_reason:byId.get(r.key).reason,ml_source:saved.source})).sort((a,b)=>{const P=window.PatientPendingModel,group={overdue:0,week:1,upcoming:2};return (group[P.status(a)]??3)-(group[P.status(b)]??3)||P.priority(b)-P.priority(a)||byId.get(a.key).index-byId.get(b.key).index;});let i=0;return rows.map(r=>byId.has(r.key)?ranked[i++]:r);}
 if(open.length&&!pending.has(key)){
  pending.add(key);const version=epoch;
  call('rank-gaps',{gaps:open.slice(0,200).map(m=>({id:m.key,gap_type:({visits:0,tests:1,vaccines:2,postpartum:3})[window.PatientPendingModel.category(m)]||0}))}).then(r=>{if(epoch!==version)return;cache.set(key,r&&Array.isArray(r.items)?r:{items:[],source:'rules'});publish();}).finally(()=>pending.delete(key));
 }
 return rows;
}
async function rankFacilities(rows,service){
 if(!active())return rows;
 const version=epoch,r=await call('rank-facilities',{needed_service:service||'',candidates:rows.slice(0,100).map(f=>({id:String(f.id),...(settings.consent.location&&Number.isFinite(f.distance_km)?{distance_km:f.distance_km}:{})}))});
 if(version!==epoch||!r||r.source!=='ml'||!Array.isArray(r.items))return rows;
 const byId=new Map(r.items.map((x,i)=>[x.id,{...x,index:i}]));
 return rows.map(f=>({...f,ml_reason:byId.get(String(f.id))?.reason,ml_source:byId.has(String(f.id))?'ml':null,ml_best:byId.get(String(f.id))?.index===0})).sort((a,b)=>(byId.get(String(a.id))?.index??10000)-(byId.get(String(b.id))?.index??10000));
}
function supportHTML(){if(!support)return '';return '<section class="patient-ml-help"><h3>A little help with your next step</h3>'+(support.source==='rules'?'<small>Recorded information and simple rules</small>':badge(support.source))+support.actions.map(a=>'<article><p>'+E(a.reason)+'</p><button type="button" class="link-btn" data-route="'+({nearby:'facilities',asha:'family',schemes:'schemes'})[a.action]+'">'+({nearby:'Explore nearer care',asha:'Find care-team support',schemes:'View official schemes'})[a.action]+' →</button></article>').join('')+'</section>';}
function reminderHTML(){return reminder?'<aside class="patient-ml-help"><h3>Your app reminder</h3>'+badge(reminder.source)+'<p>'+E(String(reminder.hour).padStart(2,'0')+':00 · '+reminder.reason)+'</p><small>App inbox only. SMS, WhatsApp and voice delivery are not connected.</small>'+(reminder.state==='ready'?'<button type="button" class="link-btn" data-ml-reminder-open="'+E(reminder.id)+'">Open Pending Care →</button>':'')+'</aside>':'';}
function renderControls(){const panel=document.getElementById('panel-settings');if(!panel)return;let el=document.getElementById('patientMLSettings');if(!el){el=document.createElement('section');el.id='patientMLSettings';el.className='card section-card patient-ml-settings';panel.appendChild(el);}el.innerHTML='<h2>Help that works around you</h2><p>Optional assistance can order your existing care tasks and suggest an app reminder time. It never decides a condition or changes your care plan.</p><small>'+ (settings.enabled?'Assistance service enabled.':'Rule-based mode · ML_ENABLED is off on this server.')+'</small>'+[['personalization','Use my permitted profile for assistance'],['location','Use my journey distance for suggestions'],['reminders','Suggest and schedule app reminder times'],['events','Save my care interaction events for future improvement']].map(([k,t])=>'<label><input type="checkbox" data-ml-consent="'+k+'" '+(settings.consent[k]?'checked':'')+'>'+t+'</label>').join('')+'<button type="button" class="btn btn--primary" data-ml-save>Save my choices</button><p>All choices start off. You can turn them off at any time. Clinical and family-sharing permissions stay separate.</p>';}
async function refresh(){const version=++epoch;try{const r=await api()?.apiRequest('/patient/ml/settings');if(version!==epoch||!r)return;settings=r;ready=true;cache.clear();support=null;renderControls();publish();const help=settings.consent.personalization?await call('support-suggestions',{}):null;if(version!==epoch)return;support=help;publish();}catch{/* Preserve original rule-based screen. */}}
function log(event_type,entity_id){if(!settings.consent.events||!entity_id)return;api()?.apiRequest('/patient/ml-events',{method:'POST',body:{event_type,entity_id:String(entity_id).slice(0,120)}});}
document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;
 if(b.hasAttribute('data-ml-save')){const body={};document.querySelectorAll('[data-ml-consent]').forEach(i=>body[i.dataset.mlConsent]=i.checked);const r=await api()?.apiRequest('/patient/ml/settings',{method:'PUT',body});if(r){await refresh();api().toast('Your assistance choices were saved.');}return;}
 if(b.dataset.mlReminderOpen){log('reminder_opened','reminder-'+b.dataset.mlReminderOpen);document.querySelector('[data-panel="gaps"]')?.click();}
 const action=b.dataset.action,id=b.dataset.id;
 if(action==='details')log('facility_viewed',id);
 if(action==='book')log('facility_chosen',id);
 if(b.dataset.book||b.dataset.pendingReport||b.dataset.pendingChild)log('action_started',b.dataset.pendingReport||b.dataset.pendingChild||b.closest('article[id]')?.id||'care-action');
});
window.PatientML={orderGaps,rankFacilities,badge,supportHTML,reminderHTML,log,refresh,acceptReminder(r){reminder=r;publish();},isActive:active,getSettings:()=>settings};
window.addEventListener('dai:patient-ready',()=>{refresh();});
if(window.__daiMLReady)refresh();
})();
