/* Reference-inspired clinician overview. Presentation only over authorised workspace data. */
(function(){
 'use strict';
 let extraOpen=false;
 const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function enhance(data,root,mode,stage,showAllChildren){
  const home=root.querySelector('.dd-home');if(!home||home.classList.contains('dr-home'))return;
  home.classList.add('dr-home');document.body.classList.add('doctor-reference');
  const art=home.querySelector('.dd-hero-art');art.src='assets/doctor/clinician-reference-v1.png';art.alt='Decorative illustration of a doctor holding a tablet';
  const hero=home.querySelector('.dd-hero-copy'),date=hero.querySelector(':scope>p');date.classList.add('dr-date');
  const intro=document.createElement('p');intro.className='dr-intro';intro.textContent=mode==='child'?'Your linked child visits, shared records and follow-ups, together.':'Here’s a quick overview of your patients, follow-ups and care activities for today.';hero.querySelector('h1').after(intro);
  const row=document.createElement('div');row.className='dr-summary-row';row.id='doctorSummaryRow';
  const clinic=home.querySelector('.dd-clinic'),completion=home.querySelector('.dd-completion'),incoming=home.querySelector('.dd-side .dd-card');
  row.append(clinic,completion,incoming);home.querySelector('.dd-journey').after(row);
  const more=document.createElement('details');more.className='dr-more';more.id='doctorMoreOverview';more.open=extraOpen||stage!=='all'||!!showAllChildren;more.addEventListener('toggle',()=>{if(more.isConnected)extraOpen=more.open;});
  more.innerHTML='<summary><span>More from your clinical workspace</span><span aria-hidden="true">＋</span></summary><div class="dr-more-body"></div>';
  const body=more.querySelector('div');body.append(home.querySelector('.dd-layout'),home.querySelector('.dd-bottom-layout'));row.after(more);
  home.querySelector('.dd-primary-row')?.remove();
  const all=home.querySelector('.dd-journey .dd-card-head [data-dd-stage="all"]');if(all){all.removeAttribute('data-dd-stage');all.removeAttribute('aria-pressed');all.setAttribute('data-dd-viewall','');all.append(' →');}
  const inHospital=home.querySelector('[data-dd-stage="admitted"] .dd-stage-dot');if(inHospital)inHospital.innerHTML=window.DoctorWorkspace?.icon('bed')||'';
  const ring=completion.querySelector('.dd-ring-wrap');
  if(ring){const items=(data.milestones||[]).filter(m=>mode!=='child'||m.category==='child'),done=items.filter(m=>m.completed_at).length;const text=ring.querySelector('p');text.className='dr-completion-count';text.innerHTML='<strong>'+done+' of '+items.length+'</strong><span>recorded care milestones</span><button type="button" class="dw-text-button" data-dw-route="analytics">View details →</button>';}
  completion.querySelector('.dd-completion-chips').classList.add('dr-completion-categories');
  const empty=incoming.querySelector('.dd-empty');if(empty){empty.innerHTML='<button type="button" class="dr-assistant" data-dr-assistant><span aria-hidden="true">✦</span><span><strong>Ask Dhruv</strong><small>AI care companion</small></span></button><p>'+E(data.hospital?'No incoming handoffs.':'Handoff data not shared.')+'</p>';}
  const icons={Today:'calendar','Care completion':'chart','Incoming handoffs':'arrow','Patient journeys':'heart','Little journeys':'heart'};
  home.querySelectorAll('.dd-card-head h2').forEach(h=>{const name=h.textContent;if(icons[name])h.insertAdjacentHTML('afterbegin','<span class="dr-heading-icon">'+(window.DoctorWorkspace?.icon(icons[name])||'')+'</span>');});
 }
 document.addEventListener('click',e=>{if(!e.target.closest('[data-dr-assistant]'))return;const launcher=document.querySelector('.care-chatbot__launcher');if(launcher&&!launcher.hidden)launcher.click();else{const input=document.querySelector('.care-chatbot__form input');if(input&&!input.closest('[hidden]'))input.focus();else window.DaiAPI?.toast('Care companion is loading. Please try again.');}});
 window.DoctorHomeReference={enhance};
})();
