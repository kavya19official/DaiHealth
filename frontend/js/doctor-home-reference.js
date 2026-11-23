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
  const intro=document.createElement('p');intro.className='dr-intro';intro.textContent=mode==='child'?'Your linked child visits, shared records and follow-ups, together.':'Your clinic today. Your patients at a glance.';hero.querySelector('h1').after(intro);
  const row=document.createElement('div');row.className='dr-summary-row';row.id='doctorSummaryRow';
  const clinic=home.querySelector('.dd-clinic'),incoming=home.querySelector('.dd-side .dd-card');
  const metrics=home.querySelector('.dd-glance');metrics.setAttribute('aria-label','Your clinical day in numbers');home.querySelector('.dd-hero').after(metrics);
  row.append(clinic,incoming);home.querySelector('.dd-journey').after(row);
  const more=document.createElement('details');more.className='dr-more';more.id='doctorMoreOverview';more.open=extraOpen||stage!=='all'||!!showAllChildren;more.addEventListener('toggle',()=>{if(more.isConnected)extraOpen=more.open;});
  more.innerHTML='<summary><span>More from your clinical workspace</span><span aria-hidden="true">＋</span></summary><div class="dr-more-body"></div>';
  const body=more.querySelector('div');body.append(home.querySelector('.dd-layout'),home.querySelector('.dd-bottom-layout'));row.after(more);
  home.querySelector('.dd-primary-row')?.remove();
  const all=home.querySelector('.dd-journey .dd-card-head [data-dd-stage="all"]');if(all){all.removeAttribute('data-dd-stage');all.removeAttribute('aria-pressed');all.setAttribute('data-dd-viewall','');all.append(' →');}
  const inHospital=home.querySelector('[data-dd-stage="admitted"] .dd-stage-dot');if(inHospital)inHospital.innerHTML=window.DoctorWorkspace?.icon('bed')||'';
  const empty=incoming.querySelector('.dd-empty');if(empty){empty.innerHTML='<p>'+E(data.hospital?'No incoming handoffs.':'Handoff data not shared.')+'</p>';}
  const icons={Today:'calendar','Care completion':'chart','Incoming handoffs':'arrow','Your patients by stage':'people','Little journeys':'heart'};
  home.querySelectorAll('.dd-card-head h2').forEach(h=>{const name=h.textContent;if(icons[name])h.insertAdjacentHTML('afterbegin','<span class="dr-heading-icon">'+(window.DoctorWorkspace?.icon(icons[name])||'')+'</span>');});
 }
 document.addEventListener('click',e=>{if(!e.target.closest('[data-dr-assistant]'))return;const launcher=document.querySelector('.care-chatbot__launcher');if(launcher&&!launcher.hidden)launcher.click();else{const input=document.querySelector('.care-chatbot__form input');if(input&&!input.closest('[hidden]'))input.focus();else window.DaiAPI?.toast('Care companion is loading. Please try again.');}});
 window.DoctorHomeReference={enhance};
})();
