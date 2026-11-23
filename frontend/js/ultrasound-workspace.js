(function () {
  'use strict';

  const root = document.querySelector('[data-ultrasound-workspace]');
  if (!root) return;
  const clinician = root.dataset.ultrasoundWorkspace === 'doctor';
  const patientPath = '/patient/ultrasound';
  const messages = {pending:'Pending review', under_review:'Under review', reviewed:'Reviewed'};
  const decisions = {
    review_complete:'Review complete', follow_up_needed:'Follow-up needed', replacement_requested:'New image requested',
  };
  const states = {
    quality_issue:'Image quality issue', model_unavailable:'Model unavailable',
    prediction:'Research scores available', priority_review:'Priority review', low_confidence:'Low confidence',
  };
  let patient = '';
  let offset = 0;
  let generation = 0;
  let busy = false;
  let opened = false;
  const previews = new Set();

  function element(tag, text, attrs) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    return node;
  }

  function button(text, handler) {
    const item = element('button', text, {type:'button', class:'uw-button'});
    item.addEventListener('click', handler);
    return item;
  }

  function notice(text, error = false) {
    const item = root.querySelector('[data-ultrasound-notice]');
    if (item) {
      item.setAttribute('role', error ? 'alert' : 'status');
      item.textContent = text;
    }
  }

  function revokePreviews() {
    for (const url of previews) URL.revokeObjectURL(url);
    previews.clear();
  }

  async function request(path, options = {}, image = false) {
    const response = await fetch(window.DaiAPI.API_BASE + path, {
      credentials:'include', cache:'no-store', signal:AbortSignal.timeout(40000), ...options,
    });
    if (image && response.ok && response.headers.get('content-type')?.startsWith('image/png')) return response.blob();
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) {
      throw new Error(value?.error || (response.status === 401 ? 'Sign in to view ultrasound scans.' :
        'Could not load the ultrasound workspace. Try again.'));
    }
    return value;
  }

  function base() {
    return clinician ? '/doctor/patients/' + patient + '/ultrasound' : patientPath;
  }

  function select(options, label, selected) {
    const input = element('select', null, {'aria-label':label});
    input.append(element('option', label, {value:''}));
    for (const option of options) input.append(element('option', option.name, {value:option.id}));
    input.value = selected || '';
    return input;
  }

  function label(text, input) {
    const name = element('label', text);
    name.append(input);
    return name;
  }

  async function perform(action, success) {
    if (busy) return;
    busy = true;
    const active = generation;
    notice('Working…');
    try {
      await action();
      if (active === generation) {
        if (await load() && active + 1 === generation) notice(success);
      }
    } catch (error) {
      if (active === generation) notice(error.message, true);
    } finally {
      busy = false;
    }
  }

  function uploadForm(options) {
    const form = element('form', null, {class:'uw-form'});
    form.append(element('h2','Upload a scan'));
    form.append(element('p','Choose a single PNG, JPEG or WebP image up to 12 MiB. Remove any identifying text visible in the image.'));
    const file = element('input', null, {type:'file', accept:'image/png,image/jpeg,image/webp', required:''});
    const consent = element('input', null, {type:'checkbox', required:''});
    const doctor = clinician ? null : select(options, 'Choose a doctor');
    if (doctor) {
      doctor.required = true;
      form.append(label('Share with', doctor));
    }
    form.append(label('Ultrasound image', file), label(clinician ?
      ' The patient agreed to share this scan for review.' :
      ' I agree to share this scan with the selected doctor.', consent),
    element('button','Upload for review',{type:'submit',class:'uw-button'}));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const frame = file.files[0];
      if (!frame || !consent.checked) return;
      if (frame.size > 12 * 1024 * 1024) return notice('Choose an image up to 12 MiB.', true);
      const path = base() + (doctor ? '?doctor=' + encodeURIComponent(doctor.value) : '');
      perform(() => request(path, {method:'POST', body:frame, headers:{
        'content-type':frame.type,'x-dai-ultrasound':'upload','x-dai-ultrasound-consent':'yes',
      }}), 'Scan uploaded for review.');
    });
    return form;
  }

  function preview(card, record) {
    if (!record.image_available) {
      card.append(element('p','The image is no longer available. Any released report remains below.'));
      return;
    }
    const path = base() + '/' + record.id + '/image';
    const image = element('img', null, {alt:'Uploaded ultrasound frame',class:'uw-image',hidden:''});
    const open = button('View scan image', async () => {
      if (image.src && !image.hidden) {
        URL.revokeObjectURL(image.src);
        previews.delete(image.src);
        image.removeAttribute('src');
        image.hidden = true;
        open.textContent = 'View scan image';
        return;
      }
      const active = generation;
      open.disabled = true;
      try {
        const blob = await request(path, {}, true);
        if (generation !== active || !card.isConnected) return;
        const url = URL.createObjectURL(blob);
        previews.add(url);
        image.src = url;
        image.hidden = false;
        open.textContent = 'Hide scan image';
      } catch (error) {
        if (generation === active) notice(error.message, true);
      } finally { open.disabled = false; }
    });
    card.append(open, image);
  }

  function report(card, data, heading) {
    card.append(element('h3', heading), element('p',decisions[data.decision]),
      element('h4','Clinical findings'), element('p',data.findings || '—'),
      element('h4','Next steps'), element('p',data.instructions || '—'));
    if (data.released_at) card.append(element('p','Released ' + new Date(data.released_at).toLocaleString()));
  }

  function review(card, record) {
    const analysis = record.analysis || {};
    const context = record.pregnancy_context || {};
    card.append(element('h3','Pregnancy context'),
      element('p', [context.stage, context.edd && 'Estimated due date ' + context.edd,
        context.lmp && 'Recorded LMP ' + context.lmp].filter(Boolean).join(' · ') || 'Pregnancy dates unavailable.'),
      element('h3','Image assessment'),
      element('p', states[analysis.state] || 'Assessment unavailable.'),
      element('p', record.reasons?.join(' ') || ''),
      element('p', analysis.state === 'quality_issue' ? 'Raster quality check flagged this image.' :
        analysis.quality?.width ? 'Passed raster checks.' : 'Raster quality not assessed.'));
    if (analysis.probabilities) {
      const research = element('details', null, {class:'uw-research'});
      research.append(element('summary','Experimental AI output'),
        element('p','Research archive scores. Verified clinical conclusions are recorded separately.'),
        element('p',Object.entries(analysis.probabilities).map(([key,score]) =>
          key + ' ' + (score*100).toFixed(1) + '%').join(' · ')),
        element('p','Model version ' + analysis.model_version));
      card.append(research);
    }
    if (record.note) card.append(element('h3','Private clinician notes'),element('p',record.note));
    if (record.report || record.archived) return;
    const change = (action, fields, success) => perform(() => request(base() + '/' + record.id + '/' + action, {
      method:'POST', body:JSON.stringify({revision:record.revision,...fields}),
      headers:{'content-type':'application/json','x-dai-ultrasound':'review'},
    }), success);
    if (record.status === 'pending') {
      card.append(button('Start review', () => change('start',{},'Scan marked under review.')));
    }
    if (!record.draft && analysis.state === 'model_unavailable' && record.image_available) {
      card.append(button('Retry image assessment', () => change('retry',{},'Image assessment updated.')));
    }
    if (record.draft) {
      report(card, record.draft, 'Draft review · visible to clinicians');
      card.append(button('Release report to patient', () => {
        if (window.confirm('Release the findings and next steps to the patient? Private notes stay in the clinician workspace.')) {
          change('release',{},'Report released to the patient.');
        }
      }));
    }
    const form = element('form',null,{class:'uw-form'});
    const decision = select(Object.entries(decisions).map(([id,name])=>({id,name})), 'Choose a decision', record.draft?.decision);
    decision.required = true;
    const findings = element('textarea',null,{required:'',minlength:'5',maxlength:'2000'});
    const instructions = element('textarea',null,{required:'',minlength:'5',maxlength:'2000'});
    const note = element('textarea',null,{maxlength:'2000'});
    findings.value = record.draft?.findings || '';
    instructions.value = record.draft?.instructions || '';
    note.value = record.note || '';
    form.append(label('Clinical decision',decision),label('Clinical findings to share',findings),
      label('Next steps to share',instructions),label('Private clinician notes',note),
      element('button','Save review draft',{type:'submit',class:'uw-button'}));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      change('review',{decision:decision.value,findings:findings.value,instructions:instructions.value,note:note.value},
        'Review saved. Release the report when ready.');
    });
    card.append(form);
  }

  function scanCard(record, archived = false) {
    const card = element('article',null,{class:'uw-card'});
    card.append(element('h2', 'Scan uploaded ' + new Date(record.created_at).toLocaleString()),
      element('p',archived ? 'Archived hospital record' : messages[record.status],{class:'uw-state'}));
    preview(card,record);
    if (clinician) review(card, archived ? {...record, archived, note:record.review_note} : record);
    if (record.report) report(card,record.report,'Released clinician report');
    if (archived && record.decision) card.append(element('p','Recorded decision · ' + decisions[record.decision]));
    if (!clinician && !record.report) card.append(element('p','Check back for the clinician’s report and next steps.'));
    return card;
  }

  async function load() {
    const active = ++generation;
    revokePreviews();
    root.replaceChildren(element('p','Loading ultrasound scans…',{role:'status','data-ultrasound-notice':''}));
    try {
      const options = await request(clinician ? '/doctor/ultrasound/patients' : patientPath + '/options');
      if (active !== generation) return;
      notice('');
      if (clinician) {
        const chooser = select(options.patients, 'Choose a patient', patient);
        chooser.addEventListener('change',()=>{patient=chooser.value;offset=0;load();});
        root.append(label('Patient',chooser));
        if (!chooser.value) {
          patient = '';
          root.append(element('p',options.patients.length ? 'Choose a patient to open their scan history.' :
            'No authorized patients are available.'));
          return;
        }
      } else if (options.doctors.length && options.can_upload) {
        root.append(uploadForm(options.doctors));
      } else {
        root.append(element('p',options.can_upload ? 'A confirmed appointment with a verified doctor is needed to share a scan.' :
          'New uploads require an active pregnancy with recorded dates.'));
      }
      const data = await request(base() + '?offset=' + offset);
      if (active !== generation) return;
      const refresh = button('Refresh scans', load);
      if (clinician) root.append(uploadForm([]));
      root.append(refresh, element('h2','Scan history'));
      if (!data.items.length && !data.archived?.length) root.append(element('p','No scans are available yet.'));
      for (const scan of data.items) root.append(scanCard(scan));
      for (const scan of data.archived || []) root.append(scanCard(scan,true));
      if (offset) root.append(button('Previous scans',()=>{offset=Math.max(0,offset-25);load();}));
      if (data.has_more) root.append(button('More scans',()=>{offset+=25;load();}));
      return true;
    } catch (error) {
      if (active !== generation) return;
      notice(error.message,true);
      root.append(button('Try again', load));
    }
  }

  function activate(panel) {
    const active = panel === 'ultrasound';
    if (active === opened) return;
    opened = active;
    if (active) load();
    else {
      generation++;
      revokePreviews();
      root.replaceChildren();
    }
  }

  window.addEventListener(clinician ? 'dai:doctor-ultrasound-panel' : 'dai:patient-panel',
    event => activate(event.detail.panel));
  window.addEventListener('pagehide', revokePreviews);
  if (root.closest('.is-active')) activate('ultrasound');
})();
