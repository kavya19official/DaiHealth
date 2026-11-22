(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const title=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  let loadVersion=0;
  let token=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
  history.replaceState(null,'',location.pathname);

  $('accept').disabled=!token;
  $('toolbar').hidden=false;

  async function api(path,method='GET',body){
    try{
      const response=await fetch('/api'+path,{method,credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      const result=await response.json();
      if(!response.ok){
        $('status').textContent=result.error||'This request is unavailable.';
        if(response.status===401){$('shared').replaceChildren();$('signIn').hidden=false;}
        return null;
      }
      return result;
    }catch{
      $('status').textContent='Could not connect to DAI. Please check that the local server is running.';
      return null;
    }
  }

  const section=(icon,name,note,content,full=false)=>'<section class="family-scope-card '+(full?'full':'')+'"><header class="family-scope-title"><span class="family-scope-icon" aria-hidden="true">'+E(icon)+'</span><div><h3>'+E(name)+'</h3><small>'+E(note)+'</small></div></header>'+content+'</section>';
  const rows=object=>Object.entries(object||{}).filter(([,value])=>value!==null&&value!==''&&value!==undefined).map(([key,value])=>'<dl class="family-row"><dt>'+E(title(key))+'</dt><dd>'+E(value)+'</dd></dl>').join('')||'<p class="family-empty">Nothing has been recorded for this section yet.</p>';

  function appointments(items=[]){
    const content=items.length?items.map(item=>'<article class="family-appointment"><time class="family-date">'+E(new Date(item.date+'T00:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short'}))+'</time><div><strong>'+E(item.subject||'Mother')+'</strong><small>'+E([item.requested_time,item.room].filter(Boolean).join(' · ')||'Time to be confirmed')+'</small></div><span class="family-pill">'+E(item.status||'scheduled')+'</span></article>').join(''):'<p class="family-empty">No upcoming appointments are currently shared.</p>';
    return section('CAL','Upcoming appointments','Help her plan travel and time',content,true);
  }

  function urgent(data={}){
    const contact=data.emergency_contact?'<dl class="family-row"><dt>Trusted contact</dt><dd>'+E(data.emergency_contact.name)+(data.emergency_contact.phone?' · <a href="tel:'+E(data.emergency_contact.phone)+'">'+E(data.emergency_contact.phone)+'</a>':'')+'</dd></dl>':'';
    const signs=(data.danger_signs||[]).map(sign=>'<li>'+E(sign)+'</li>').join('');
    const calls=(data.numbers||[]).map(number=>'<a class="family-call" href="tel:'+E(number.number)+'">'+E(number.label)+' · '+E(number.number)+'</a>').join('');
    return section('SOS','Urgent help','Know when and where to call','<div class="family-alert"><strong>Do not wait for family permission in an emergency.</strong><p>'+E(data.instruction||'Seek urgent medical help for danger signs.')+'</p></div>'+contact+'<ul class="family-danger-list">'+signs+'</ul><div class="family-call-grid">'+calls+'</div>',true);
  }

  function birthPlan(plan={}){return section('PLAN','Practical birth plan','Only the details she chose to share',rows(plan));}
  function tips(items=[]){return section('HELP','How you can help','Practical, respectful support','<ul class="family-tip-list">'+items.map(item=>'<li>'+E(item)+'</li>').join('')+'</ul>');}
  function timeline(items=[]){return section('CARE','Care timeline','Recorded and upcoming care',items.map(item=>'<dl class="family-row"><dt>'+E(item.title)+'</dt><dd>'+E(item.completed_at?'Completed '+new Date(item.completed_at).toLocaleDateString():'Due '+new Date(item.due_date).toLocaleDateString())+'</dd></dl>').join('')||'<p class="family-empty">No timeline steps are shared.</p>',true);}
  function children(items=[]){return section('CHILD','Child growth','Only selected children',items.map(item=>'<dl class="family-row"><dt>'+E(item.name)+(item.measured_on?' · '+E(new Date(item.measured_on).toLocaleDateString()):'')+'</dt><dd>'+E([item.weight_kg&&item.weight_kg+' kg',item.height_cm&&item.height_cm+' cm',item.head_cm&&'Head '+item.head_cm+' cm'].filter(Boolean).join(' · ')||'No measurement recorded')+'</dd></dl>').join('')||'<p class="family-empty">No child growth measurements are shared.</p>');}

  function grantCard(grant,notice){
    const sections=[];
    if(grant.appointments)sections.push(appointments(grant.appointments));
    if(grant.urgent_help)sections.push(urgent(grant.urgent_help));
    if(grant.birth_plan)sections.push(birthPlan(grant.birth_plan));
    if(grant.support_tips)sections.push(tips(grant.support_tips));
    if(grant.timeline)sections.push(timeline(grant.timeline));
    if(grant.children)sections.push(children(grant.children));
    return '<article class="family-grant"><header class="family-grant-head"><div><span class="family-eyebrow">SHARED BY HER</span><h2>'+E(grant.mother_name)+'</h2><p>Access expires '+E(new Date(grant.expires_at).toLocaleString())+'</p></div><span class="family-grant-badge">'+E(grant.relationship||'caregiver')+'</span></header><div class="family-scope-list">'+sections.join('')+'</div><footer class="family-notice">'+E(notice)+'</footer></article>';
  }

  async function load(){
    const version=++loadVersion;
    $('shared').innerHTML='<p class="family-loader">Loading the information shared with you…</p>';
    const result=await api('/family/shared');
    if(!result||version!==loadVersion)return;
    $('signIn').hidden=true;
    $('status').textContent='';
    $('shared').innerHTML=result.shared.length?result.shared.map(grant=>grantCard(grant,result.notice)).join(''):'<article class="family-grant"><div class="family-loader"><strong>No active information is shared with this account.</strong><p>The invitation may still need to be accepted, or access may have expired or been revoked.</p></div></article>';
    if(window.GoldenHourUI)window.GoldenHourUI.mountFamily($('shared'),result.shared);
    await restCards(result.shared,version);

  }

  async function restCards(grants,version){
    const eligible=grants.filter(g=>g.scopes.includes('support_tips'));if(!eligible.length)return;
    const result=await api('/family/sukoon');if(!result||version!==loadVersion)return;
    const section=document.createElement('section');section.className='family-grant';
    section.innerHTML='<h2>A little help tonight</h2><p>Practical requests only. Private Sukoon notes and check-in results are never included.</p>'+result.requests.map(r=>'<article class="family-data-row"><strong>'+E(r.mother_name||'Your family member')+' · '+r.minutes+' minutes of requested rest</strong><span>'+E(r.status==='requested'?'Requested · please confirm if you can help':'You accepted this request')+'</span><button data-rest-id="'+E(r.id)+'" data-rest-action="'+(r.status==='requested'?'accept':'done')+'">'+(r.status==='requested'?'I can help':'Mark my support done')+'</button></article>').join('')+'<h3>What could help?</h3><ul>'+result.tips.map(t=>'<li>'+E(t)+'</li>').join('')+'</ul><form data-family-duty><label>Log a task I handled<select name="grant">'+eligible.map(g=>'<option value="'+E(g.id)+'">'+E(g.mother_name)+'</option>').join('')+'</select></label><select name="kind"><option value="feed">Feed support</option><option value="diaper">Diaper change</option><option value="meal">Food & water</option><option value="settle">Settling baby</option><option value="home">Household task</option></select><label><input type="checkbox" name="consent" required> Share this practical task log with her.</label><button>Record my task</button></form><p>In-app requests only. No alarm, phone call or emergency dispatch. Task logs are not a measure of total work.</p>';
    $('shared').prepend(section);section.querySelectorAll('[data-rest-id]').forEach(button=>button.onclick=async()=>{if(await api('/family/sukoon/'+button.dataset.restId,'PATCH',{action:button.dataset.restAction}))load();});section.querySelector('form').onsubmit=async event=>{event.preventDefault();const f=event.target;if(await api('/family/sukoon/duties','POST',{grant_id:f.grant.value,kind:f.kind.value}))load();};
  }
  $('login').onsubmit=async event=>{
    event.preventDefault();
    const form=event.target;
    const result=await api('/auth/login','POST',{email:form.elements.email.value,password:form.elements.password.value});
    if(result){form.elements.password.value='';$('signIn').hidden=true;$('status').textContent=token?'Signed in. Now accept the private invitation.':'Signed in securely.';load();}
  };
  $('create').onclick=async()=>{
    const form=$('login');
    if(!form.reportValidity())return;
    if(!token){$('status').textContent='Open the private invitation link before creating an account.';return;}
    const result=await api('/auth/register/caregiver','POST',{email:form.elements.email.value,password:form.elements.password.value,invite:token});
    if(result)$('status').textContent=result.message;
  };
  $('accept').onclick=async()=>{
    const result=await api('/family/accept','POST',{token});
    if(result){token='';$('accept').disabled=true;$('status').textContent='Invitation accepted. Your shared view is ready.';load();}
  };
  $('refresh').onclick=load;
  $('logout').onclick=async()=>{loadVersion++;await api('/auth/logout','POST',{});$('shared').replaceChildren();$('signIn').hidden=false;$('status').textContent='Signed out.';};
  setInterval(()=>{if(!document.hidden&&$('signIn').hidden&&!document.activeElement?.closest('[data-family-duty]'))load();},15000);
  load();
})();
