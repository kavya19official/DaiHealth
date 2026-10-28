/* Local synthetic demo only. Ordinary authenticated requests; no external delivery/AI. */
(function(){'use strict';
 var info,root,peer='',busy=false,generation=0,pendingKey='',pendingId='';
 var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
 var base=function(){return (window.DaiAPI?.API_BASE||'/api')+'/demo/care-messages';};
 async function api(path,body){var r=await fetch(base()+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),body:body?JSON.stringify(body):undefined});var d=await r.json().catch(function(){return {};});if(!r.ok)throw Error(d.error||'Messages unavailable. Please try again.');return d;}
 function status(t){root.querySelector('[data-cm-status]').textContent=t;}
 function controls(value){root.querySelectorAll('select,textarea,button').forEach(function(n){n.disabled=value;});}
 function visible(){return !!root?.closest('.panel.is-active');}
 async function thread(){if(!peer||busy)return;busy=true;controls(true);var token=++generation;status('Loading saved messages…');try{var d=await api('/thread?peer_id='+encodeURIComponent(peer));if(token!==generation)return;root.querySelector('[data-cm-thread]').innerHTML=d.messages.length?d.messages.map(function(m){return '<article class="cm-message '+(m.mine?'cm-mine':'')+'"><strong>'+esc(m.mine?'You':info.contacts.find(function(c){return String(c.id)===peer;})?.name||'Care contact')+'</strong><p>'+esc(m.body)+'</p><time>'+esc(new Date(m.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))+' IST</time></article>';}).join(''):'<p class="cm-empty">No messages yet. Start a synthetic care-team conversation below.</p>';status('Saved in this local demo. Showing up to 100 latest messages; refresh to check for replies.');}catch(e){root.querySelector('[data-cm-thread]').textContent='';status(e.message);}finally{busy=false;controls(false);}}
 async function send(e){e.preventDefault();if(busy||!peer)return;var input=root.querySelector('textarea'),text=input.value.trim();if(!text)return;var key=peer+'\n'+text;if(key!==pendingKey){pendingKey=key;pendingId=crypto.randomUUID();}busy=true;controls(true);status('Saving message…');try{await api('/thread',{peer_id:Number(peer),text:text,client_id:pendingId});input.value='';pendingKey='';pendingId='';busy=false;await thread();status('Message saved for this connected demo account. No SMS or email was sent.');}catch(e){status(e.message+' Your draft is preserved.');}finally{busy=false;controls(false);}}
 function mount(){
  if(!info)return false;
  var host=info.role==='doctor'?document.getElementById('docMessages'):document.getElementById('panel-settings');if(!host)return false;
  if(root&&host.contains(root))return true;
  root=document.createElement('section');root.className='cm-panel';root.id='demoCareMessages';
  root.innerHTML='<header><span class="cm-badge">SYNTHETIC LOCAL DEMO</span><h2>Care-team messages</h2><p>Saved conversations with your connected '+(info.role==='doctor'?'patients':'clinicians')+'. No SMS, email or AI service is involved. This inbox is not an emergency channel.</p></header>'+(info.contacts.length?'<label>Choose '+(info.role==='doctor'?'patient':'clinician')+'<select data-cm-contact aria-label="Care message contact">'+info.contacts.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('')+'</select></label><button type="button" data-cm-refresh>Refresh messages</button><p role="status" aria-live="polite" data-cm-status>Open this section or refresh to load your conversation.</p><div class="cm-thread" data-cm-thread aria-label="Saved care messages"></div><form><label>Your message<textarea maxlength="2000" rows="4" required placeholder="Write a message for this synthetic demonstration"></textarea></label><small>Up to 2,000 characters. Sharing and the care connection are checked before each read and send.</small><button type="submit">Send in-app demo message</button></form>':'<p>No authorised care contacts are available. A connected clinician and patient sharing permission are required.</p>');
  if(info.role==='doctor')host.replaceChildren(root);else host.prepend(root);
  if(!info.contacts.length)return true;
  peer=info.contacts.some(function(c){return String(c.id)===peer;})?peer:String(info.contacts[0].id);root.querySelector('select').value=peer;
  root.querySelector('select').onchange=function(){peer=this.value;thread();};root.querySelector('[data-cm-refresh]').onclick=thread;root.querySelector('form').onsubmit=send;if(visible())thread();return true;
 }
 window.DaiDemoMessages={mountDoctor:mount};
 document.addEventListener('click',function(e){if(e.target.closest('[data-panel="messages"],[data-panel="settings"],[data-go="messages"]'))setTimeout(function(){mount();if(visible()&&peer)thread();},0);});
 async function setup(){try{info=await api('/contacts');mount();}catch{/* Feature is deliberately absent outside local synthetic demo mode. */}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
