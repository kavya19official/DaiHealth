/* Reference-inspired clinician overview. Presentation only over authorised workspace data. */
(function(){
 'use strict';
 let extraOpen=false;
 const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function insights(data,mode){
  const rows=window.DoctorDashboardModel.gaps(data,mode),patients=new Set(rows.map(r=>String(r.patient_id))),pending=Number(data.summary?.pending_reviews)||0,card=document.createElement('section');
  card.className='dr-insights';card.setAttribute('aria-label','Clinical insights');
  card.innerHTML='<header><span class="dr-insight-eyebrow">YOUR REVIEW BRIEF</span><h2>Clinical insights</h2><p>'+(patients.size?'<strong>'+patients.size+' '+(patients.size===1?'patient has':'patients have')+'</strong> recorded follow-up items.':'No recorded follow-up items in this view.')+'</p></header><div class="dr-insight-art" aria-hidden="true"><svg viewBox="0 0 240 150"><defs><radialGradient id="drInsightGlow"><stop stop-color="#c8b7ff"/><stop offset=".55" stop-color="#e4daff" stop-opacity=".85"/><stop offset="1" stop-color="#f8f5ff" stop-opacity="0"/></radialGradient><linearGradient id="drInsightPetal" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".9"/><stop offset=".55" stop-color="#ded4ff" stop-opacity=".65"/><stop offset="1" stop-color="#9479df" stop-opacity=".45"/></linearGradient></defs><circle cx="120" cy="75" r="77" fill="url(#drInsightGlow)"/>'+Array.from({length:8},(_,i)=>'<ellipse cx="120" cy="60" rx="35" ry="47" transform="rotate('+i*45+' 120 75)" fill="url(#drInsightPetal)" stroke="#bda9ed" stroke-opacity=".4"/>').join('')+'<circle cx="120" cy="75" r="29" fill="#fff" fill-opacity=".86"/><path d="m120 58 4 12 12 5-12 4-4 13-5-13-12-4 12-5z" fill="#9570e3"/><circle cx="42" cy="51" r="3" fill="#baa3e9"/><circle cx="200" cy="107" r="3" fill="#baa3e9"/><path d="M44 52h24m106 55h24" stroke="#bda9ed" stroke-dasharray="2 3"/></svg><span class="dr-insight-chip dr-insight-chip-left">'+rows.length+' follow-up '+(rows.length===1?'item':'items')+'</span><span class="dr-insight-chip dr-insight-chip-right">'+(mode==='child'?'Linked child care':pending?pending+' shared '+(pending===1?'report':'reports')+' to review':'Shared care records')+'</span></div><button type="button" class="dr-insight-action" data-dr-review-insights><span aria-hidden="true">↗</span> Review insights</button><small>Recorded information · clinician review</small>';
  card.querySelector('[data-dr-review-insights]').onclick=()=>{if(mode==='child'){window.DoctorPages?.setDashboardFilter('child','all');window.DoctorNavigation?.showPanel('patients');}else window.DoctorNavigation?.showPanel('attention');};return card;
 }
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
  const top=document.createElement('div');top.className='dr-top-row';const banner=home.querySelector('.dd-hero');banner.before(top);top.append(banner,insights(data,mode));
  const all=home.querySelector('.dd-journey .dd-card-head [data-dd-stage="all"]');if(all){all.removeAttribute('data-dd-stage');all.removeAttribute('aria-pressed');all.setAttribute('data-dd-viewall','');all.append(' →');}
  const inHospital=home.querySelector('[data-dd-stage="admitted"] .dd-stage-dot');if(inHospital)inHospital.innerHTML=window.DoctorWorkspace?.icon('bed')||'';
  const empty=incoming.querySelector('.dd-empty');if(empty){empty.innerHTML='<p>'+E(data.hospital?'No incoming handoffs.':'Handoff data not shared.')+'</p>';}
  const icons={Today:'calendar','Care completion':'chart','Incoming handoffs':'arrow','Your patients by stage':'people','Little journeys':'heart'};
  home.querySelectorAll('.dd-card-head h2').forEach(h=>{const name=h.textContent;if(icons[name])h.insertAdjacentHTML('afterbegin','<span class="dr-heading-icon">'+(window.DoctorWorkspace?.icon(icons[name])||'')+'</span>');});
 }
 document.addEventListener('click',e=>{if(!e.target.closest('[data-dr-assistant]'))return;const launcher=document.querySelector('.care-chatbot__launcher');if(launcher&&!launcher.hidden)launcher.click();else{const input=document.querySelector('.care-chatbot__form input');if(input&&!input.closest('[hidden]'))input.focus();else window.DaiAPI?.toast('Care companion is loading. Please try again.');}});
 window.DoctorHomeReference={enhance};
})();
