/* Shared in-app inbox. Server checks each care connection before returning messages. */
(function(){'use strict';
let info,root,peer='',generation=0,refreshing=false,sending=false,filter='all',query='',older=null,history=[],loading=false;
const nameMatches=(value,term)=>window.DaiNames?window.DaiNames.matches(value,term):String(value||'').toLowerCase().includes(term);
const drafts=new Map(),pending=new Map();
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=()=> (window.DaiAPI?.API_BASE||'/api')+'/demo/care-messages';
async function api(path,body){const r=await fetch(base()+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok){const error=Error(d.error||'Messages unavailable. Please try again.');error.status=r.status;throw error;}return d;}
const visible=()=>!!root?.isConnected&&!document.hidden&&!!root.closest('.panel.is-active');
const contact=()=>info?.contacts.find(c=>String(c.id)===peer);
const initials=name=>name.replace(/^SYNTHETIC\s+/i,'').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
const time=value=>value?new Date(value).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'';
const day=value=>new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
function status(text){if(root)root.querySelector('[data-cm-status]').textContent=text;}
function renderList(){
 if(!root)return;
 const contacts=info.contacts.filter(c=>(filter!=='unread'||c.unread>0)&&(nameMatches(c.name,query)||(c.last_message?.body||'').toLowerCase().includes(query)));
 root.querySelector('[data-cm-list]').innerHTML=contacts.map(c=>'<button type="button" class="cm-contact '+(String(c.id)===peer?'is-selected':'')+'" data-cm-peer="'+c.id+'" aria-pressed="'+(String(c.id)===peer)+'"><span class="cm-avatar">'+E(initials(c.name))+'</span><span class="cm-contact-copy"><span class="cm-contact-top"><strong>'+E(c.name)+'</strong><time>'+E(time(c.last_message?.created_at))+'</time></span><span class="cm-contact-bottom"><span>'+E(c.last_message?(c.last_message.mine?'You: ':'')+c.last_message.body:'Start a conversation')+'</span>'+(c.unread?'<b class="cm-unread" aria-label="'+c.unread+' unread messages">'+c.unread+'</b>':'')+'</span></span></button>').join('')||'<p class="cm-empty">'+(info.contacts.length?'No conversations match your search.':'No connected patients available yet.')+'</p>';
 const unread=info.contacts.reduce((n,c)=>n+(c.unread||0),0);
 root.querySelector('[data-cm-count]').textContent=unread?unread+' unread':info.contacts.length+(info.contacts.length===1?' contact':' contacts');
}
function renderHeader(){const c=contact();root.querySelector('[data-cm-chat-name]').textContent=c?.name||'Your conversations';root.querySelector('[data-cm-chat-initials]').textContent=c?initials(c.name):'DAI';root.querySelector('form').hidden=!c;root.querySelector('[data-cm-chat-sub]').textContent=c?'Connected care conversation':'Choose a patient to start';}
function renderMessages(preserve=false){
 const box=root.querySelector('[data-cm-thread]'),bottom=box.scrollHeight-box.scrollTop-box.clientHeight<90,oldHeight=box.scrollHeight,oldTop=box.scrollTop;
 let previous='';const markup=history.map(m=>{const date=day(m.created_at),divider=date!==previous?'<div class="cm-day"><span>'+E(date)+'</span></div>':'';previous=date;return divider+'<article class="cm-message '+(m.mine?'cm-mine':'')+'"><p>'+E(m.body)+'</p><time>'+E(time(m.created_at))+(m.mine?' <span aria-label="Saved">✓</span>':'')+'</time></article>';}).join('');
 if(box.dataset.signature===markup&&box.dataset.older===String(older))return;
 box.dataset.signature=markup;box.dataset.older=String(older);
 box.innerHTML=(older?'<button type="button" class="cm-load" data-cm-older>Load older messages</button>':'')+markup+(!history.length?'<div class="cm-welcome"><span class="cm-welcome-icon">✉</span><h3>'+(peer?'Say hello':'Messages, all in one place')+'</h3><p>'+(peer?'Start your conversation with '+E(contact()?.name||'this contact')+'.':'Choose a conversation on the left.')+'</p></div>':'');
 if(preserve)box.scrollTop=oldTop+box.scrollHeight-oldHeight;else if(bottom||!box.dataset.loaded)box.scrollTop=box.scrollHeight;
 box.dataset.loaded='true';
}
async function readCurrent(){if(!visible()||!peer||!history.length)return;const chosen=peer;await api('/read',{peer_id:Number(chosen),message_id:String(history.at(-1).id)});if(peer===chosen){const c=contact();if(c)c.unread=0;renderList();}}
async function loadThread(append=false,quiet=false){
 if(!peer||loading)return;
 const chosen=peer,ticket=generation;loading=true;
 if(!quiet)status(append?'Loading older messages…':'Loading conversation…');
 try{
  const d=await api('/thread?peer_id='+encodeURIComponent(chosen)+(append&&older?'&before='+encodeURIComponent(older):''));
  if(ticket!==generation||chosen!==peer)return;
  const first=history.length===0;
  const known=new Map((append?[...d.messages,...history]:[...history,...d.messages]).map(m=>[String(m.id),m]));
  history=[...known.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
  if(append||first)older=d.next_before||null;
  if(first)root.querySelector('[data-cm-thread]').removeAttribute('data-loaded');
  renderMessages(append);status('');await readCurrent();
 }catch(e){if(ticket===generation){if([401,403,404].includes(e.status)){history=[];older=null;renderMessages();}if(!quiet){status(e.message);if(!history.length)root.querySelector('[data-cm-thread]').textContent='Could not load this conversation. Press refresh to try again.';}else status('Updates paused. '+e.message);}}
 finally{if(ticket===generation)loading=false;}
}
function choose(id){if(!info.contacts.some(c=>String(c.id)===String(id)))return;peer=String(id);generation++;loading=false;older=null;history=[];root.classList.add('cm-chat-open');root.querySelector('[data-cm-thread]').removeAttribute('data-loaded');renderHeader();renderList();renderMessages();root.querySelector('textarea').value=drafts.get(peer)||'';loadThread();}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  const d=await api('/contacts');info=d;mount();
  if(peer&&!contact()){generation++;loading=false;peer='';history=[];older=null;renderHeader();renderMessages();status('The care connection changed. Choose an available contact.');}
  renderList();if(peer&&visible())await loadThread(false,true);
 }catch(e){if([401,403,404].includes(e.status)){info.contacts=[];peer='';generation++;loading=false;history=[];older=null;renderList();renderHeader();renderMessages();}status(e.message);}finally{refreshing=false;}
}
async function send(e){
 e.preventDefault();if(sending||!peer)return;
 const input=root.querySelector('textarea'),text=input.value.trim(),chosen=peer;if(!text)return;
 let request=pending.get(chosen);if(!request||request.text!==text){request={text,client_id:crypto.randomUUID()};pending.set(chosen,request);}
 sending=true;root.querySelector('[data-cm-send]').disabled=true;status('Sending…');
 try{
  await api('/thread',{peer_id:Number(chosen),text,client_id:request.client_id});pending.delete(chosen);
  if(drafts.get(chosen)?.trim()===text)drafts.delete(chosen);
  if(peer===chosen){if(input.value.trim()===text)input.value='';await loadThread();root.querySelector('[data-cm-thread]').scrollTop=root.querySelector('[data-cm-thread]').scrollHeight;}
  await refresh();status('');
 }catch(error){status(error.message+' Your draft is preserved.');}
 finally{sending=false;root.querySelector('[data-cm-send]').disabled=false;}
}
function newChat(){
 if(document.getElementById('cmNewChat'))return;
 const dialog=document.createElement('dialog'),opener=document.activeElement;
 dialog.id='cmNewChat';dialog.className='cm-new-dialog';dialog.setAttribute('aria-labelledby','cmNewTitle');
 dialog.innerHTML='<header><div><h2 id="cmNewTitle">New chat</h2><p>Choose a connected '+(info.role==='doctor'?'patient':'clinician')+'</p></div><button type="button" class="cm-icon" data-cm-close aria-label="Close new chat">×</button></header><label class="cm-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Find a contact" placeholder="Search by name" autofocus></label><div class="cm-new-contacts"></div>';
 const list=dialog.querySelector('.cm-new-contacts');
 function render(){const term=dialog.querySelector('input').value.toLowerCase();const contacts=info.contacts.filter(c=>nameMatches(c.name,term));list.innerHTML=contacts.map(c=>'<button type="button" class="cm-contact" data-cm-start="'+c.id+'"><span class="cm-avatar">'+E(initials(c.name))+'</span><span class="cm-contact-copy"><strong>'+E(c.name)+'</strong><small>'+(c.last_message?'Continue conversation':'Start a conversation')+'</small></span><span aria-hidden="true">→</span></button>').join('')||'<p class="cm-empty">No connected contacts match. Try another name.</p>';}
 document.body.append(dialog);render();dialog.querySelector('input').oninput=render;
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-cm-close]'))dialog.close();const b=e.target.closest('[data-cm-start]');if(b){filter='all';query='';root.querySelector('[data-cm-search]').value='';root.querySelectorAll('[data-cm-filter]').forEach(f=>f.setAttribute('aria-pressed',String(f.dataset.cmFilter==='all')));choose(b.dataset.cmStart);dialog.close();root.querySelector('textarea').focus();}});
 dialog.addEventListener('close',()=>{dialog.remove();if(!root.classList.contains('cm-chat-open'))opener?.focus();});dialog.showModal();
}
function mount(){
 if(!info)return false;
 const host=info.role==='doctor'?document.getElementById('docMessages'):document.getElementById('panel-care-messages');if(!host)return false;
 if(root&&host.contains(root))return true;
 root=document.createElement('section');root.id='demoCareMessages';root.className='cm-panel';
 root.innerHTML='<aside class="cm-sidebar"><header class="cm-inbox-title"><div><h2>Messages</h2><p data-cm-count></p></div><button type="button" class="cm-icon" data-cm-refresh aria-label="Refresh conversations">↻</button></header><button type="button" class="cm-new-button" data-cm-new>＋ New chat</button><label class="cm-search"><span aria-hidden="true">⌕</span><input type="search" data-cm-search aria-label="Search patients and messages" placeholder="Search conversations"></label><div class="cm-filters" role="group" aria-label="Conversation filter"><button type="button" data-cm-filter="all" aria-pressed="true">All chats</button><button type="button" data-cm-filter="unread" aria-pressed="false">Unread</button></div><nav class="cm-contacts" data-cm-list aria-label="Patient conversations"></nav><p class="cm-demo-note">Synthetic demo · connected care only</p></aside><div class="cm-chat"><header class="cm-chat-header"><button type="button" class="cm-icon cm-back" data-cm-back aria-label="Back to conversations">←</button><span class="cm-avatar" data-cm-chat-initials>DAI</span><div><h3 data-cm-chat-name>Your conversations</h3><p data-cm-chat-sub>Choose a patient to start</p></div></header><div class="cm-thread" data-cm-thread aria-label="Conversation messages" aria-live="off"></div><div class="cm-compose"><p role="status" aria-live="polite" data-cm-status></p><form hidden><label class="cm-visually-hidden" for="cmMessageInput">Your message</label><textarea id="cmMessageInput" rows="1" maxlength="2000" required placeholder="Type a message…"></textarea><button type="submit" data-cm-send aria-label="Send message">Send <span aria-hidden="true">➤</span></button></form><small>In-app messages · not an emergency channel</small></div></div>';
 if(info.role==='doctor')host.replaceChildren(root);else host.prepend(root);
 root.querySelector('[data-cm-search]').value=query;
 root.querySelector('[data-cm-search]').oninput=e=>{query=e.target.value.toLowerCase();renderList();};
 root.querySelector('textarea').value=drafts.get(peer)||'';
 root.querySelector('textarea').oninput=e=>drafts.set(peer,e.target.value);
 root.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();root.querySelector('form').requestSubmit();}};
 root.querySelector('form').onsubmit=send;
 root.addEventListener('click',e=>{const c=e.target.closest('[data-cm-peer]');if(c)choose(c.dataset.cmPeer);const f=e.target.closest('[data-cm-filter]');if(f){filter=f.dataset.cmFilter;root.querySelectorAll('[data-cm-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===f)));renderList();}if(e.target.closest('[data-cm-new]'))newChat();if(e.target.closest('[data-cm-refresh]'))refresh();if(e.target.closest('[data-cm-older]'))loadThread(true);if(e.target.closest('[data-cm-back]'))root.classList.remove('cm-chat-open');});
 renderList();renderHeader();renderMessages();return true;
}
window.DaiDemoMessages={mountDoctor:mount,refresh,async openDoctor(){document.querySelector('[data-panel=care-messages]')?.click();await refresh();const first=info?.contacts?.[0];if(first)choose(first.id);}};
document.addEventListener('click',e=>{if(e.target.closest('[data-panel="messages"],[data-panel="settings"],[data-go="messages"]'))setTimeout(refresh,0);});
window.addEventListener('hashchange',()=>{if(visible())refresh();});
document.addEventListener('visibilitychange',()=>{if(visible())refresh();});
window.addEventListener('online',()=>{if(visible())refresh();});
setInterval(()=>{if(visible())refresh();},5000);
async function setup(){try{info=await api('/contacts');mount();}catch{/* Existing non-demo messaging fallback stays visible. */}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
