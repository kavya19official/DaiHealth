/* Recovery presentation and visible care routes. Existing clinical forms and APIs are unchanged. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),T=(en,hi)=>document.documentElement.lang==='hi'?hi:en;
 const icon=k=>'<svg aria-hidden="true"><use href="#i-'+k+'"/></svg>';
 const routes=[['facilities','search','Nearby care','नज़दीकी देखभाल'],['appointments','cal','Appointments','अपॉइंटमेंट'],['records','file','Reports & records','रिपोर्ट और रिकॉर्ड'],['family','shield','Family & consent','परिवार और सहमति']];
 function setup(){
  const home=$('panel-dashboard'),right=document.querySelector('.topbar__right');if(!home||!right)return;
  if(!$('patientFindCare')){const b=document.createElement('button');b.type='button';b.id='patientFindCare';b.className='pa-find-care';b.dataset.route='facilities';right.prepend(b);}
  if(!$('patientCareShortcuts')){const section=document.createElement('section');section.id='patientCareShortcuts';section.className='pa-shortcuts';section.setAttribute('aria-label','Care services');section.innerHTML=routes.map(([id,i,en,hi])=>'<button type="button" data-route="'+id+'">'+icon(i)+'<span data-pa-en="'+en+'" data-pa-hi="'+hi+'"></span><span aria-hidden="true">↗</span></button>').join('');home.append(section);}
  const hero=home.querySelector('.home-hero-grid');if(hero&&hero.nextElementSibling!==$('patientCareShortcuts'))hero.after($('patientCareShortcuts'));
  $('patientFindCare').innerHTML=icon('search')+'<span>'+T('Find care','देखभाल खोजें')+'</span>';$('patientFindCare').setAttribute('aria-label',T('Open Nearby care','नज़दीकी देखभाल खोलें'));
  if($('panel-facilities')?.classList.contains('is-active')&&$('nwSearchDrawer'))$('nwSearchDrawer').open=true;
  document.querySelectorAll('[data-pa-en]').forEach(n=>n.textContent=T(n.dataset.paEn,n.dataset.paHi));
 }
 function update(state){
  setup();const root=$('recoveryWorld'),p=state.post||{};if(!root||!p.active)return;
  root.classList.add('rx-recovery');
  const hero=root.querySelector('.lw-recovery-hero');if(!hero)return;
  const heading=hero.querySelector('h1');if(heading){const h=document.createElement('h2');h.textContent=T('Your recovery, at your pace.','आपकी रिकवरी, आपकी गति से।');heading.replaceWith(h);}
  const copy=hero.querySelector('.lw-hero-copy');copy.querySelector('.lw-eyebrow').textContent=T('AFTER DELIVERY · STILL CARING FOR YOU','प्रसव के बाद · आपकी देखभाल जारी');
  copy.querySelector('p').textContent=T('Your follow-ups, questions and support—in one gentle place.','आपके फॉलो-अप, सवाल और सहयोग—एक ही जगह।');
  copy.querySelector('small').textContent=T('Your dates describe time since birth, not a recovery score.','ये तारीखें जन्म के बाद का समय बताती हैं, रिकवरी स्कोर नहीं।');
  const action=copy.querySelector('.btn');action.textContent=T(p.checkins_open?'Your recovery check-in →':'View your recovery plan →',p.checkins_open?'आपका रिकवरी चेक-इन →':'अपनी रिकवरी योजना देखें →');action.href=p.checkins_open?'#ppCheckinCard':'#ppRoot';
  const art=hero.querySelector('.lw-recovery-art');art.innerHTML='<img src="assets/patient/mother-selfcare-v1.png" alt="" width="320" height="330">';
  let summary=root.querySelector('.rx-summary');if(!summary){summary=document.createElement('section');summary.className='rx-summary';summary.setAttribute('aria-label','Recorded recovery overview');hero.after(summary);}
  const day=Number.isFinite(p.days_postpartum)&&p.days_postpartum>=0?p.days_postpartum:null,open=Array.isArray(p.schedule)?p.schedule.filter(c=>c.status!=='done').length:null;
  summary.replaceChildren();
  for(const [i,value,label,href] of [['clock',day===null?T('Not recorded','दर्ज नहीं'):String(day),T('Days since birth','जन्म के बाद दिन'),'#ppRoot'],['cal',open===null?T('Not shared','साझा नहीं'):String(open),T('Recorded follow-ups open','दर्ज खुले फॉलो-अप'),'#ppRoot'],['heart',!p.checkins_open?T('Window closed','समय सीमा पूरी'):p.today_checkin?T('Saved today','आज सहेजा गया'):T('Not recorded today','आज दर्ज नहीं'),T('Daily recovery check-in','दैनिक रिकवरी चेक-इन'),'#ppCheckinCard']]){const a=document.createElement('a');a.href=href;a.innerHTML=icon(i)+'<span><strong></strong><small></small></span><span aria-hidden="true">↗</span>';a.querySelector('strong').textContent=value;a.querySelector('small').textContent=label;summary.append(a);}
  if(!(state.children||[]).length){const baby=$('lwBabyLane');if(baby&&!baby.querySelector('[data-lw-open-baby]'))baby.textContent=T('No child records are linked yet. Open My children to manage your records.','अभी बच्चे के रिकॉर्ड जुड़े नहीं हैं। अपने रिकॉर्ड के लिए मेरे बच्चे खोलें।');}
 }
 window.PatientRecoveryAccess={setup,update};
 window.addEventListener('dai:patient-panel',setup);
 new MutationObserver(setup).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setup();setTimeout(setup,0);});else setup();
})();
