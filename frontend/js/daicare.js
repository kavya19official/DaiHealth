(function () {
  'use strict';
  const api = (path,options) => DaiAPI.apiRequest('/daicare'+path,options);
  const escape = value => String(value??'').replace(/[&<>"']/g, char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const doctor = location.pathname.endsWith('/doctor.html');
  const appointmentPanel = document.querySelector('#panel-appointments');
  const postpartumPanel = document.querySelector('#panel-postpartum');
  const date = value => new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const day = value => String(value||'').slice(0,10);
  const modes = { home:'In-home',audio:'Audio',video:'Video' };
  const moodNames = ['Very low','Low','Okay','Good','Very good'];
  const names = {waiting:'Waiting for on-call coverage',assigned:'Assigned · awaiting acknowledgement',
    acknowledged:'Acknowledged by clinician',resolved:'Follow-up note available',withdrawn:'Sharing withdrawn'};
  const buttons = (label,action,id) => `<button type="button" class="btn btn--ghost" data-action="${action}" data-id="${escape(id)}">${label}</button>`;
  const options = choices => choices.map(mode=>`<option value="${mode}">${modes[mode]}</option>`).join('');
  const emergency = '<strong>Please seek help now.</strong> If you or your baby may be in immediate danger, call <a href="tel:112">112</a> in India or go to the nearest emergency department. If possible, ask someone you trust to stay with you. Do not wait for an app reply.';
  const notice = (root,value) => {root.querySelector('[data-status]').textContent=value||'';};
  async function busy(control,work) {
    if (!control || control.disabled) return;
    control.disabled=true;
    try { await work(); } finally {control.disabled=false;}
  }
  function section(panel,title,content) {
    const root=document.createElement('section');
    root.className='dai-care-card';
    root.innerHTML=`<h2>${title}</h2><p data-status role="status"></p>${content}`;
    if(doctor&&panel===appointmentPanel&&document.getElementById('doctor-view-appointments')){const more=document.createElement('details');more.className='doctor-appointment-extra';const summary=document.createElement('summary');summary.textContent=title;more.append(summary);root.querySelector('h2')?.remove();more.append(root);document.getElementById('doctor-view-appointments').append(more);}else panel.insertBefore(root,panel.children[1]||null);
    return root;
  }

  function patientWellbeing() {
    if(document.getElementById("patientSukoon")){const link=document.createElement("a");link.className="sk-toast-link";link.href="#sukoon";link.innerHTML="<div><h2>Sukoon · Mind and rest</h2><p>Short check-ins, rest and support. A private space for every mother.</p></div><strong>Open Sukoon ↗</strong>";postpartumPanel.prepend(link);return;}
    const root = section(postpartumPanel,'Postpartum mental health',`
      <p>Track how you feel, take the Edinburgh Postnatal Depression Scale (EPDS), or ask a clinician for support.</p>
      <div class="dai-care-checkin" data-checkin></div>
      <form data-mood class="dai-care-inline">
        <label>How are you feeling today?
          <select name="mood" required><option value="">Choose a mood</option>${moodNames.map((name,i)=>`<option value="${i+1}">${name}</option>`).join('')}</select>
        </label><button class="btn btn--primary">Save private check-in</button>
      </form>
      <details data-screen><summary>Take the 10-question EPDS</summary><div data-questions></div></details>
      <div class="dai-care-urgent" role="alert" data-urgent hidden></div>
      <div data-history></div>
    `);
    let instrument;
    const checkin=root.querySelector('[data-checkin]');
    const questionnaire=root.querySelector('[data-screen]');
    const questions=root.querySelector('[data-questions]');
    const urgency=root.querySelector('[data-urgent]');
    async function refresh() {
      if (localStorage.getItem('dai_guest')) return;
      const data=await api('/wellbeing');
      if (!data) return;
      checkin.textContent=data.due?'Your weekly emotional check-in is due.':`Next weekly check-in ${data.next_check_in}. Most recent mood: ${moodNames[data.check_ins[0].mood-1]}.`;
      root.querySelector('[data-history]').innerHTML=data.screens.length ? '<h3>Screening history</h3>'+data.screens.map(row=>{
        const label = row.priority==='urgent'?'Immediate assessment recommended':row.priority==='follow_up'?'Clinical follow-up recommended':'Request support at any time';
        const state=row.referral_status;
        return `<article class="dai-care-row"><h4>EPDS ${row.score}/30 · ${escape(date(row.created_at))}</h4>
          <p>${label}. This is a screening result.</p>
          ${row.priority==='urgent'?`<p class="dai-care-urgent">${emergency}</p>`:''}
          ${state?`<p>${names[state]||''}${row.clinician?' · '+escape(row.clinician):''}</p>`:''}
          ${row.clinician_note?`<p class="dai-care-note">${escape(row.clinician_note)}</p>`:''}
          ${!state||state==='waiting'?buttons(state?'Check for on-call coverage':'Ask an on-call clinician','refer',row.id):''}
          ${state&&state!=='withdrawn'?buttons('Withdraw screening share','withdraw',row.id):''}
          ${instrument?.ai_available&&row.ai_status==='not_requested'&&row.priority!=='urgent'?buttons('Optional AI review','ai',row.id):''}
          ${row.ai_status==='review'?'<p>AI suggested additional human review.</p>':row.ai_status==='unavailable'?'<p>Optional AI review unavailable. Your score is unchanged.</p>':''}
        </article>`;
      }).join(''):'';
    }
    questionnaire.addEventListener('toggle',async()=>{
      if (!questionnaire.open || instrument) return;
      if(localStorage.getItem('dai_guest')) {questions.textContent='Sign in to save a private screening.';return;}
      instrument=await api('/wellbeing/instrument');
      if(!instrument){questions.textContent='The questionnaire could not be loaded. Close and reopen to retry.';return;}
      questions.innerHTML=`<p>Select the answer closest to how you have felt over the past seven days.</p>
        <form data-epds>
          ${instrument.items.map(([prompt,answers],i)=>`<fieldset><legend>${i+1}. ${escape(prompt)}</legend>
            ${answers.map((answer,index)=>`<label class="dai-care-choice"><input required type="radio" name="q${i}" value="${index}"> ${escape(answer)}</label>`).join('')}
          </fieldset>`).join('')}
          <div class="dai-care-urgent" role="alert" data-item-ten hidden></div>
          <label class="dai-care-choice"><input type="checkbox" name="afterBirth" required> I am completing this screening after a birth.</label>
          <button class="btn btn--primary">Save private screening</button>
        </form>
        <p class="dai-care-source">Cox JL, Holden JM, Sagovsky R (1987). Detection of postnatal depression: Development of the 10-item Edinburgh Postnatal Depression Scale. <i>British Journal of Psychiatry</i>, 150, 782–786.</p>`;
      const form=questions.querySelector('form');
      form.addEventListener('change',event=>{
        if(event.target.name!=='q9')return;
        const alert=form.querySelector('[data-item-ten]');
        alert.hidden=event.target.value==='3';
        alert.innerHTML=alert.hidden?'':emergency;
      });
      await refresh();
    });
    root.addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.target;
      busy(event.submitter,async()=>{
        notice(root,'Saving…');
        if (form.matches('[data-mood]')) {
          const saved=await api('/wellbeing/mood',{method:'POST',body:{mood:Number(form.elements.mood.value)}});
          notice(root,saved?'Private check-in saved.':'The check-in could not be saved.');
        } else {
          const answers=Array.from({length:10},(_,i)=>Number(form.elements['q'+i].value));
          const saved=await api('/wellbeing/epds',{method:'POST',body:{answers,postpartum:form.elements.afterBirth.checked}});
          if (saved) {
            form.reset();questionnaire.open=false;
            form.querySelector('[data-item-ten]').hidden=true;
            urgency.hidden=saved.screen.priority!=='urgent';
            urgency.innerHTML=urgency.hidden?'':emergency;
          }
          notice(root,saved?'Private screening saved.':'The screening could not be saved.');
        }
        await refresh();
      });
    });
    root.addEventListener('click',event=>{
      const b=event.target.closest('[data-action]');
      if (!b) return;
      const prefix='/wellbeing/epds/'+b.dataset.id;
      const operation=b.dataset.action;
      if (operation==='refer'&&!confirm('Share your name and the EPDS score and priority with the assigned on-call clinician? Your individual answers stay private.')) return;
      if (operation==='ai'&&!confirm('Send the current and previous EPDS totals and aggregate mood counts to Google Gemini? No name, item responses or notes are sent. The result only suggests human review.')) return;
      if (operation==='withdraw'&&!confirm('Remove the assigned clinician’s access to this screening summary?')) return;
      busy(b,async()=>{
        const saved=await api(prefix+(operation==='ai'?'/ai-review':'/referral'),{
          method:operation==='withdraw'?'DELETE':'POST',...(operation==='withdraw'?{}:{body:{consent:true}})
        });
        notice(root,saved ? operation==='refer'?names[saved.status]:'Choice saved.' : 'The request could not be completed.');
        await refresh();
      });
    });
    window.addEventListener('dai:patient-panel',event=>{if(event.detail.panel==='postpartum')refresh();});
    if(postpartumPanel.classList.contains('is-active'))refresh();
  }

  function appointmentNetwork() {
    const root=section(appointmentPanel,'DaiCare doctor network',doctor?`
      <details data-schedule><summary>Publish availability</summary>
      <form data-new-slot class="dai-care-inline"><label>Start time in India (IST)<input type="datetime-local" name="time" step="1800" required></label>
      <label>Consultation type<select name="mode" required></select></label><button class="btn btn--primary">Publish 30-minute slot</button></form>
      <div data-slots></div></details>
      <button class="btn btn--ghost" data-action="load">Load bookings and on-call referrals</button>
      <div data-visits></div><div data-referrals></div>`:`
      <details><summary>Find a verified doctor</summary>
      <form data-find class="dai-care-inline"><label>Consultation type<select name="mode">${options(['video','audio','home'])}</select></label>
      <label>Specialty or clinician<input name="q" maxlength="80" placeholder="e.g. Psychiatry"></label>
      <label>City<input name="city" maxlength="80"></label><label>State or union territory<input name="state" maxlength="80"></label>
      <label>PIN code (required for home visits)<input name="pin" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6"></label>
      <button class="btn btn--primary">Find doctors</button></form>
      <div data-directory></div></details>
      <button class="btn btn--ghost" data-action="load">Load my DaiCare bookings</button><div data-visits></div>`);
    if(doctor) root.querySelector('[data-schedule]').addEventListener('toggle',()=>{if(root.querySelector('[data-schedule]').open)loadSchedule();});
    let filters, selected;
    const visits=root.querySelector('[data-visits]');
    const directory=root.querySelector('[data-directory]');
    async function loadSchedule() {
      const response = await api('/schedule');
      if(!response) {notice(root,'An active DaiCare listing is required to publish slots.');return;}
      root.querySelector('[data-new-slot] select').innerHTML=options(response.modes);
      root.querySelector('[data-slots]').innerHTML=response.slots.length?response.slots.map(slot=>
        `<p class="dai-care-inline">${escape(date(slot.starts_at))} · ${modes[slot.mode]} ${slot.booked?'· Booked':buttons('Remove slot','remove-slot',slot.id)}</p>`).join(''):'<p>No upcoming slots published.</p>';
    }
    async function load() {
      const response=await api('/visits');
      if(!response){notice(root,doctor?'An active DaiCare listing is required to manage bookings.':'Could not load bookings.');return;}
      visits.innerHTML='<h3>DaiCare bookings</h3>'+(response.visits.map(item=>{
        const cancelled=item.status==='cancelled'||Boolean(item.revoked_at);
        return `<article class="dai-care-row"><h4>${escape(doctor?item.patient_name:item.doctor_name)}</h4>
          <p>${modes[item.mode]} · ${escape(date(item.starts_at))} IST · ${escape(item.status)}${item.revoked_at?' · Sharing withdrawn':''}</p>
          ${item.address?`<p class="dai-care-note">${escape(item.address)} · ${escape(item.pincode)}</p>`:item.pincode?`<p>PIN ${escape(item.pincode)}</p>`:''}
          ${item.follow_up_on?`<p>Follow-up ${escape(day(item.follow_up_on))} · ${escape(item.follow_up)}</p>
            ${item.follow_up_seen_at?'<p>Follow-up acknowledged</p>':!doctor&&!cancelled?buttons('Acknowledge follow-up','acknowledge_follow_up',item.id):''}`:''}
          ${!cancelled&&item.status==='confirmed'&&item.mode!=='home'?buttons('Open audio/video call','call',item.id):''}
          ${doctor&&!cancelled?doctorActions(item):''}
          ${doctor&&!cancelled&&['confirmed','completed'].includes(item.status)?buttons('View shared care summary','care-summary',item.mother_id)+'<div data-shared-summary></div>':''}
          ${!doctor&&!cancelled?buttons(item.status==='completed'?'Withdraw booking share':'Cancel and withdraw sharing','cancel',item.id):''}
        </article>`;
      }).join('')||'<p>No DaiCare bookings yet.</p>');
      if(doctor) {
        const referrals=root.querySelector('[data-referrals]');
        const response=await api('/mental-health/referrals');
        if(response) referrals.innerHTML='<h3>On-call mental health referrals</h3>'+(response.referrals.map(row=>`
          <article class="dai-care-row"><h4>${escape(row.patient_name)}</h4><p>EPDS ${row.score}/30 · ${escape(row.priority.replace('_',' '))}
            ${row.ai_status==='review'?' · AI suggested review':''}</p><p>${names[row.status]}</p>${row.follow_up_due_at?`<p>Follow-up task due ${escape(date(row.follow_up_due_at))}. ${escape(row.review_prompt||'')}</p>`:''}
          ${row.status==='assigned'?buttons('Acknowledge referral','acknowledge',row.id):''}
          ${row.status==='acknowledged'?`<form data-resolution data-id="${row.id}"><label>Follow-up message<textarea required maxlength="800" name="note"></textarea></label><button class="btn btn--primary">Send message and resolve</button></form>`:''}
          </article>`).join('')||'<p>No currently shared referrals.</p>');
      }
    }
    document.addEventListener('dai:daicare-bookings-changed',load);
    function doctorActions(visit) {
      const id=visit.id;
      if(visit.status==='requested')return buttons('Confirm visit','confirm',id)+buttons('Decline visit','decline',id);
      if(visit.status==='confirmed')return buttons('Mark completed','complete',id)+buttons('Cancel visit','decline',id);
      if(visit.status==='completed')return `<form class="dai-care-inline" data-followup data-id="${id}">
        <label>Follow-up date<input type="date" name="when" required></label>
        <label>Follow-up note<textarea name="note" maxlength="800" required></textarea></label>
        <button class="btn btn--primary">Save follow-up</button></form>`;
      return '';
    }
    root.addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.target, payload=Object.fromEntries(new FormData(form));
      busy(event.submitter,async()=>{
        if(form.matches('[data-find]')) {
          filters=payload;
          if(filters.mode==='home'&&!filters.pin){notice(root,'A home visit needs a six-digit PIN code.');return;}
          const result=await api('/directory?'+new URLSearchParams(filters));
          directory.innerHTML=result?.doctors.map(d=>`<article class="dai-care-row"><h4>${escape(d.full_name)}</h4>
            <p>${escape(d.specialization)} · ${escape(d.qualification)} · ${escape(d.city)}, ${escape(d.state)}</p>
            <p>${escape(d.council)} · ${escape(d.registration_number)} · ${escape(d.public_contact)}</p>
            <p>${escape(d.languages.join(', '))}${d.next_available?' · Next '+escape(date(d.next_available))+' IST':''}</p>
            ${buttons('See available times','slots',d.doctor_id)}<div data-provider-slots></div></article>`).join('')||'<p>No matching verified clinicians found.</p>';
        } else if(form.matches('[data-book]')) {
          const response=await api('/visits',{method:'POST',body:{slot_id:payload.slot_id,pin:selected.pin,address:payload.address,consent:form.elements.share.checked}});
          notice(root,response?'Booking requested. Wait for the clinician to confirm.':'The slot could not be booked.');
          if(response) {form.remove();await load();}
        } else if(form.matches('[data-new-slot]')) {
          const start=new Date(payload.time+'+05:30');
          if (Number.isNaN(+start)){notice(root,'Choose a start time in India.');return;}
          const response=await api('/schedule',{method:'POST',body:{starts_at:start.toISOString(),mode:payload.mode}});
          if(response){form.reset();await loadSchedule();}
        } else if(form.matches('[data-followup]')) {
          const response=await api('/visits/'+form.dataset.id,{method:'PATCH',body:{action:'follow_up',follow_up_on:payload.when,follow_up:payload.note}});
          if(response)await load();
        } else if(form.matches('[data-resolution]')) {
          const response=await api('/mental-health/referrals/'+form.dataset.id,{method:'PATCH',body:{action:'resolve',note:payload.note}});
          if(response)await load();
        }
      });
    });
    root.addEventListener('click',event=>{
      const b=event.target.closest('[data-action]');
      if(!b)return;
      const {action,id}=b.dataset;
      if(['cancel','decline'].includes(action)&&!confirm('Confirm this change to the DaiCare booking?'))return;
      busy(b,async()=>{
        if(action==='load'){await load();return;}
        if(action==='call'){await window.DaiRemoteCalls?.openDaiCare(id);return;}
        if(action==='care-summary'){
          const result=await DaiAPI.apiRequest('/doctor/patients/'+id+'/dashboard');
          const mount=b.parentElement.querySelector('[data-shared-summary]');
          if(!result){mount.textContent='The patient has not shared an active summary with you.';return;}
          const details=result.metrics.flatMap(metric=>metric.readings.slice(-1).map(reading=>
            `<li>${escape(metric.label)} · ${escape(reading.value)} ${escape(metric.unit)} · ${escape(reading.date)}</li>`));
          const plan=result.carePlan.map(item=>`<li>${escape(item.title)}</li>`);
          mount.innerHTML=`<h4>Patient-shared care summary</h4>${details.length?'<ul>'+details.join('')+'</ul>':'<p>No recorded clinical readings.</p>'}${plan.length?'<h4>Care plan</h4><ul>'+plan.join('')+'</ul>':''}`;
          return;
        }
        if(action==='remove-slot'){
          if(await api('/schedule/'+id,{method:'DELETE'}))await loadSchedule();
          return;
        }
        if(action==='slots') {
          const query=new URLSearchParams({mode:filters.mode,pin:filters.pin});
          const response=await api('/doctors/'+id+'/slots?'+query);
          const mount=b.parentElement.querySelector('[data-provider-slots]');
          directory.querySelectorAll('[data-provider-slots]').forEach(node=>node.replaceChildren());
          selected={...filters};
          mount.innerHTML=response?.slots.length?`<form data-book>
            <label>Available times (IST)<select name="slot_id" required>${response.slots.map(slot=>`<option value="${slot.id}">${escape(date(slot.starts_at))}</option>`).join('')}</select></label>
            ${selected.mode==='home'?'<label>Home visit address<textarea required name="address" minlength="8" maxlength="300" autocomplete="street-address"></textarea></label>':''}
            <label class="dai-care-choice"><input type="checkbox" name="share" required> I agree to share my name and booking details with this clinician for this ${modes[selected.mode].toLowerCase()} consultation. My medical records stay under separate consent.</label>
            <button class="btn btn--primary">Request booking</button></form>`:'<p>No open appointments for this consultation type.</p>';
          return;
        }
        const base=action==='acknowledge'?'/mental-health/referrals/':'/visits/';
        if(await api(base+id,{method:'PATCH',body:{action}}))await load();
      });
    });
  }

  // Doctor discovery stays in Nearby Care; keep appointments focused on visits.
  if(!doctor&&postpartumPanel)patientWellbeing();
})();
