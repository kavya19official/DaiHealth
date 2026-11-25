(function () {
  'use strict';

  const root = document.querySelector('[data-ultrasound-workspace]');
  if (!root) return;
  const clinician = root.dataset.ultrasoundWorkspace === 'doctor';
  const patientPath = '/patient/ultrasound';
  const messages = {pending:'Awaiting doctor review', under_review:'Under review', reviewed:'Reviewed by doctor'};
  const decisions = {
    review_complete:'Review complete', follow_up_needed:'Follow-up needed', replacement_requested:'New image requested',
  };
  const states = {
    quality_issue:'Image quality issue', model_unavailable:'Model unavailable', plane_analysis:'Scan views analyzed',
    prediction:'Research scores available', priority_review:'Research scores available', low_confidence:'Low model confidence',
  };
  let patient = '';
  let offset = 0;
  let generation = 0;
  let busy = false;
  let opened = false;
  let latestUpload = null;
  let clock;
  const interpretations = {
    confirmed:'Agree with the AI interpretation', corrected:'Correct the AI interpretation',
    rejected:'Reject the AI interpretation', independent:'Independent clinical review',
  };
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
    let response;
    try {
      response = await fetch(window.DaiAPI.API_BASE + path, {
        credentials:'include', cache:'no-store', signal:AbortSignal.timeout(40000), ...options,
      });
    } catch {
      throw new Error('Could not reach the ultrasound service. Check your connection and try again.');
    }
    if (image && response.ok && response.headers.get('content-type')?.startsWith('image/png')) return response.blob();
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) {
      if (typeof value?.error === 'string' && value.error) throw new Error(value.error);
      if (response.status === 401) throw new Error('Sign in to view ultrasound scans.');
      if (response.status === 404 && !image) {
        const local = ['localhost', '127.0.0.1'].includes(location.hostname);
        throw new Error(local
          ? 'The running DaiHealth server does not have the ultrasound route. Stop it, restart the updated checkout with npm start, and reopen port 3001.'
          : 'The ultrasound route is unavailable on this deployment.');
      }
      throw new Error(response.ok ? 'The server returned an unexpected ultrasound response.' :
        'The ultrasound request failed (HTTP ' + response.status + '). Try again.');
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
      const result = await action();
      if (active === generation && result?.id) { latestUpload = result.id; offset = 0; }
      if (active === generation) {
        if (await load() && active + 1 === generation) notice(typeof success === "function" ? success(result) : success);
      }
    } catch (error) {
      if (active === generation) notice(error.message, true);
    } finally {
      busy = false;
    }
  }

  function uploadForm(options) {
    const form = element('form', null, {class:'uw-form uw-upload'});
    form.append(element('h2','Upload an ultrasound frame'));
    form.append(element('p','Share one PNG, JPEG or WebP image, up to 12 MiB. Remove any identifying text visible in the image.'));
    const file = element('input', null, {type:'file', accept:'image/png,image/jpeg,image/webp'});
    const zone = label('Choose an image or drop it here', file);
    zone.className = 'uw-drop';
    file.setAttribute('aria-label','Ultrasound image');
    const image = element('img', null, {alt:'Selected ultrasound frame',class:'uw-image',hidden:''});
    const name = element('p',null,{class:'uw-filename'});
    const consent = element('input', null, {type:'checkbox', required:''});
    const doctor = clinician ? null : select(options, 'Choose a doctor');
    const submitLabel = clinician ? 'Upload for review' : 'Upload & analyze';
    const submit = element('button',submitLabel,{type:'submit',class:'uw-button',disabled:''});
    let frame;
    let previewUrl;

    function choose(candidate) {
      frame = null;
      submit.disabled = true;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previews.delete(previewUrl); }
      image.hidden = true;
      image.removeAttribute('src');
      name.textContent = '';
      if (!candidate) return;
      if (!['image/png','image/jpeg','image/webp'].includes(candidate.type)) {
        notice('Choose a PNG, JPEG or WebP image.',true);
      } else if (!candidate.size || candidate.size > 12 * 1024 * 1024) {
        notice('Choose a nonempty image up to 12 MiB.',true);
      } else {
        frame = candidate;
        previewUrl = URL.createObjectURL(frame);
        previews.add(previewUrl);
        image.src = previewUrl;
        image.hidden = false;
        name.textContent = frame.name;
        submit.disabled = false;
        notice('');
      }
    }
    file.addEventListener('change', () => choose(file.files[0]));
    for (const event of ['dragover','dragleave','drop']) zone.addEventListener(event, pointer => {
      pointer.preventDefault();
      zone.classList.toggle('uw-dragging',event === 'dragover');
      if (event === 'drop') choose(pointer.dataTransfer.files[0]);
    });
    form.append(zone,name,image);
    if (doctor) {
      doctor.required = true;
      form.append(label('Share with',doctor));
    }
    form.append(label(clinician ? ' The patient agreed to share this scan.' :
      ' I agree to share this scan with the selected doctor.', consent), submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!frame || !consent.checked || busy) return;
      const path = base() + (doctor ? '?doctor=' + encodeURIComponent(doctor.value) : '');
      submit.disabled = true;
      submit.textContent = 'Uploading…';
      await perform(async () => {
        notice('Uploading image…');
        return request(path, {method:'POST', body:frame, headers:{
          'content-type':frame.type,'x-dai-ultrasound':'upload','x-dai-ultrasound-consent':'yes',
        }});
      }, result => result.duplicate ? 'This image is already in your scan history.' : 'Scan uploaded for review.');
      submit.textContent = submitLabel;
      submit.disabled = false;
    });
    return form;
  }

  function preview(card, record, preload) {
    if (!record.image_available) {
      card.append(element('p','Image unavailable. Released reports remain in your history.'));
      return;
    }
    const path = base() + '/' + record.id + '/image';
    const image = element('img', null, {alt:'Uploaded ultrasound frame',class:'uw-image',hidden:''});
    const open = button('View scan image', async () => {
      if (!image.hidden) {
        URL.revokeObjectURL(image.src);
        previews.delete(image.src);
        image.removeAttribute('src');
        image.hidden = true;
        open.textContent = 'View scan image';
        return;
      }
      const active = generation;
      open.disabled = true;
      open.textContent = 'Loading image…';
      try {
        const blob = await request(path, {}, true);
        if (generation !== active || !card.isConnected) return;
        const url = URL.createObjectURL(blob);
        previews.add(url);
        image.src = url;
        image.hidden = false;
        open.textContent = 'Hide scan image';
      } catch (error) {
        open.textContent = 'View scan image';
        if (generation === active) notice(error.message, true);
      } finally { open.disabled = false; }
    });
    if (record.demo_image) card.append(element('p',
      'Public demonstration image. This frame belongs to a research dataset.', {class:'uw-demo-note'}));
    const viewer = element('div', null, {class:'uw-viewer'});
    viewer.append(image);
    card.append(viewer, open);
    if (preload) queueMicrotask(() => { if (card.isConnected) open.click(); });
  }

  const issueDescriptions = {
    small_image:'The frame is too small.',
    low_contrast:'The frame has too little contrast.',
    low_detail:'The frame appears to have insufficient detail.',
    unusable_views:'The individual views did not pass the image quality checks.',
  };

  function updateClocks() {
    for (const timer of root.querySelectorAll('[data-uw-start]')) {
      const start = Number(timer.dataset.uwStart);
      const end = timer.dataset.uwEnd ? Number(timer.dataset.uwEnd) : Date.now();
      const seconds = Math.max(0, Math.floor((end - start) / 1000));
      timer.textContent = timer.dataset.uwEnd && seconds === 0 ? '<1 s'
        : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }
  }

  const planeLabels = {
    three_vessel:'Three-vessel view', four_chamber:'Four-chamber heart view', abdomen:'Abdominal view',
    brain_cerebellum:'Brain view · cerebellum', brain_transventricular:'Brain view · ventricles',
    femur:'Femur view', kidneys:'Kidney view', lips:'Lips view', left_outflow:'Left ventricular outflow view',
    profile:'Fetal profile', right_outflow:'Right ventricular outflow view',
    spine_coronal:'Spine view · coronal', spine_sagittal:'Spine view · sagittal',
  };

  function renderPlanes(target, planes) {
    target.append(element('p','SonoNet16 analyzed the uploaded image.',{class:'uw-ml-source'}));
    const list = element('dl',null,{class:'uw-plane-results'});
    const positions = {whole:'Uploaded view',top:'Top panel',bottom:'Bottom panel'};
    for (const plane of planes) {
      const item = element('div');
      item.append(element('dt',positions[plane.view]));
      if (plane.state === 'quality_issue') {
        item.append(element('dd','Image quality too low for the model.'));
      } else if (plane.label === 'background') {
        item.append(element('dd','No supported standard view matched.'));
      } else {
        const pct = (plane.score * 100).toFixed(1) + '%';
        const match = plane.score < .70 ? 'Weak match · ' : 'Likely view · ';
        const result = element('dd');
        result.append(element('strong',planeLabels[plane.label]),element('span',match + 'model score ' + pct));
        item.append(result);
      }
      list.append(item);
    }
    target.append(list);
  }

  function renderAssessment(target, record) {
    const result = record.assessment;
    if (!result) return;
    const liveDemo = record.demo_image && result.live_demo_analysis === true;
    target.append(element('h3', liveDemo ? 'AI analysis · SonoNet16' : record.demo_image ? 'Demo assessment' : 'AI analysis'));
    if (liveDemo) target.append(element('p',
      'Live model output on a public demonstration frame. This is not Nivara’s diagnostic result.', {class:'uw-demo-note'}));
    if (record.demo_image && !liveDemo) {
      target.append(element('p',record.demo_teaching_frame ? 'Teaching frame for a fictional patient. No AI analysis was run.' : 'Preloaded demo record with scripted results.',{class:'uw-demo-note'}));
      return;
    }
    const start = Date.parse(result.started_at || record.created_at);
    const finish = Date.parse(result.finished_at);
    if (Number.isFinite(start) && (record.processing || Number.isFinite(finish))) {
      const elapsed = element('p','Analysis elapsed ',{class:'uw-elapsed'});
      elapsed.append(element('span',null,{'data-uw-start':start,'data-uw-end':Number.isFinite(finish) ? finish : ''}));
      target.append(elapsed);
    }
    if (result.steps.length || record.processing) {
      const stages = element('ol',null,{class:'uw-steps','aria-label':'Analysis progress'});
      const phases = [['uploaded','Image saved securely'], ['quality','Image quality checks'],
        ['model_loading','Loading the research model'], ['preprocessing','Preparing the image'],
        ['inference','Running model inference'], ['report','Saving the analysis report'],
        ['handoff','Available for doctor review']];
      for (const [key, label] of phases) {
        if (!record.processing && !['uploaded','handoff'].includes(key) && !result.steps.includes(key)) continue;
        if (key === 'model_loading' && !result.steps.includes(key)) continue;
        const done = key === 'uploaded' || key === 'handoff' && !record.processing ||
          result.steps.includes(key) && result.state !== key;
        const active = result.state === key;
        const step = element('li',label,{'data-step':done ? 'complete' : active ? 'active' : 'waiting'});
        if (active) step.setAttribute('aria-current','step');
        stages.append(step);
      }
      target.append(stages);
    }
    if (record.processing) {
      target.append(element('p', {
        queued:'Waiting for the analysis service.', claimed:'Sending the saved image to the analysis service.',
        quality:'Checking resolution, contrast and detail.', model_loading:'Opening the configured model.',
        preprocessing:'Resizing and normalizing this frame.', inference:'The model is analyzing this uploaded frame.',
        report:'Saving the report and review flag.',
      }[result.state],{class:'uw-processing',role:'status'}));
      return;
    }
    const grade = {good:'Good',acceptable:'Acceptable',poor:'Poor'}[result.grade] || 'Not assessed';
    target.append(element('h4','Image quality'),
      element('p',grade,{class:'uw-quality','data-grade':result.grade || 'unknown'}));
    if (result.image_checks_passed) {
      target.append(element('p','Passed basic image checks for AI processing. A clinician assesses scan suitability.'));
    }
    for (const problem of result.issues) target.append(element('p',issueDescriptions[problem]));
    target.append(element('h4','AI observations'));
    if (result.planes?.length) {
      renderPlanes(target,result.planes);
    } else if (result.model_ran) {
      target.append(element('p','AI analysis completed. Your care team can review the experimental classification scores.'));
    } else if (result.state === 'quality_issue') {
      target.append(element('p','The image did not pass the technical checks for model inference.'));
    } else if (result.state === 'model_unavailable') {
      target.append(element('p','AI analysis unavailable. The scan is available for doctor review.'));
    }
    target.append(element('h4','Clinical significance'),
      element('p',result.planes?.length
        ? 'These scores rank views the model recognizes. A clinician reviews the scan for measurements, abnormalities and fetal health.'
        : 'A single uploaded frame requires clinician interpretation. The image checks cannot verify the scan type or establish fetal health.'));
    if (result.flag) {
      target.append(element('h4','Review flag'),element('p','Review recommended',{class:'uw-flag'}));
      for (const reason of result.flag.reasons) target.append(element('p',reason));
    }
  }

  function report(card, data, heading) {
    card.append(element('h3', heading), element('p',decisions[data.decision]));
    const m = data.measurements;
    if (m && typeof m === 'object') {
      if (m.demo) card.append(element('p','Scripted demonstration measurements. These values were not measured from the frame.',{class:'uw-demo-note'}));
      const rows = [
        ['Scan date', m.scan_date], ['Gestational age', m.gestational_age_weeks != null ? m.gestational_age_weeks + ' weeks' : null],
        ['BPD', m.bpd_mm != null ? m.bpd_mm + ' mm' : null], ['Head circumference', m.hc_mm != null ? m.hc_mm + ' mm' : null],
        ['Abdominal circumference', m.ac_mm != null ? m.ac_mm + ' mm' : null], ['Femur length', m.fl_mm != null ? m.fl_mm + ' mm' : null],
        ['Estimated fetal weight', m.estimated_fetal_weight_g != null ? m.estimated_fetal_weight_g + ' g' : null],
        ['Fetal heart rate', m.fetal_heart_rate_bpm != null ? m.fetal_heart_rate_bpm + ' bpm' : null],
        ['Placenta', m.placenta], ['Amniotic fluid', m.amniotic_fluid], ['Presentation', m.presentation],
        ['Scan type', m.scan_type],
      ].filter(([,v]) => v != null && v !== '');
      if (rows.length) {
        const table = element('table',null,{class:'uw-measurements'});
        for (const [k,v] of rows) {
          const tr = element('tr');
          tr.append(element('th',k), element('td',String(v)));
          table.append(tr);
        }
        card.append(element('h4','Fetal measurements'), table);
      }
    }
    card.append(element('h4','Clinical findings'), element('p',data.findings || '—'),
      element('h4','Next steps'), element('p',data.instructions || '—'));
    if (data.released_at) card.append(element('p','Released ' + new Date(data.released_at).toLocaleString()));
  }

  function review(card, record) {
    const analysis = record.analysis || {};
    const context = record.pregnancy_context || {};
    card.append(element('h3','Pregnancy context'),
      element('p', [context.stage, context.gestation_weeks != null ? context.gestation_weeks + ' weeks gestation' : null,
        context.scan_ga_weeks != null ? 'Scan at ' + context.scan_ga_weeks + ' weeks' : null,
        context.edd && 'Estimated due date ' + context.edd,
        context.lmp && 'Recorded LMP ' + context.lmp].filter(Boolean).join(' · ') || 'Pregnancy dates unavailable.'),
      element('h3','Analysis details'),
      element('p', states[analysis.state] || 'Assessment unavailable.'),
      element('p', record.reasons?.join(' ') || ''));
    if (analysis.quality?.width && analysis.quality?.height && !record.demo_image) {
      const {width,height,dynamic_range,focus} = analysis.quality;
      card.append(element('p', [
        width + ' × ' + height + ' px', dynamic_range != null ? 'contrast range ' + dynamic_range : null,
        focus != null ? 'detail metric ' + focus : null,
      ].filter(Boolean).join(' · ')));
    }
    if (analysis.probabilities) {
      const research = element('details', null, {class:'uw-research'});
      research.append(element('summary','Experimental AI output'),
        element('p','EfficientNet-B0 archive classification for a single raster. Scores express class preference within this model. Scan type, fetal anatomy and clinical risk require clinician assessment.'),
        element('p','Top archive class: ' + analysis.label + ' · model score ' +
          (analysis.confidence * 100).toFixed(1) + '%'),
        element('p',Object.entries(analysis.probabilities).map(([key,score]) =>
          key + ' ' + (score*100).toFixed(1) + '%').join(' · ')),
        element('p','Model version ' + analysis.model_version));
      card.append(research);
    }
    if (record.note) card.append(element('h3','Private clinician notes'),element('p',record.note));
    if (record.report || record.archived || record.processing) return;
    const change = (action, fields, success) => perform(() => request(base() + '/' + record.id + '/' + action, {
      method:'POST', body:JSON.stringify({revision:record.revision,...fields}),
      headers:{'content-type':'application/json','x-dai-ultrasound':'review'},
    }), success);
    if (record.status === 'pending') {
      card.append(button('Start review', () => change('start',{},'Scan marked under review.')));
    }
    if (record.retry_revision) {
      card.append(button('Retry image assessment', () => change('retry',{},'Image assessment queued.')));
    }
    if (record.draft) {
      report(card, record.draft, 'Draft review · visible to clinicians');
      if (record.draft.interpretation) card.append(element('p', interpretations[record.draft.interpretation]));
      card.append(button('Release report to patient', () => {
        if (window.confirm('Release the findings and next steps to the patient? Private notes stay in the clinician workspace.')) {
          change('release',{},'Report released to the patient.');
        }
      }));
    }
    const form = element('form',null,{class:'uw-form'});
    const decision = select(Object.entries(decisions).map(([id,name])=>({id,name})), 'Choose a decision', record.draft?.decision);
    decision.required = true;
    const hasModelOutput = Boolean(analysis.probabilities || analysis.planes?.length);
    const options = hasModelOutput ? Object.entries(interpretations) : [['independent',interpretations.independent]];
    const interpretation = select(options.map(([id,name]) => ({id,name})),
      'Choose how you reviewed the scan', record.draft?.interpretation || (!hasModelOutput ? 'independent' : ''));
    interpretation.required = true;
    const findings = element('textarea',null,{required:'',minlength:'5',maxlength:'2000'});
    const instructions = element('textarea',null,{required:'',minlength:'5',maxlength:'2000'});
    const note = element('textarea',null,{maxlength:'2000'});
    findings.value = record.draft?.findings || '';
    instructions.value = record.draft?.instructions || '';
    note.value = record.note || '';
    form.append(label('AI interpretation',interpretation),label('Clinical decision',decision),label('Clinical findings to share',findings),
      label('Next steps to share',instructions),label('Private clinician notes',note),
      element('button','Save review draft',{type:'submit',class:'uw-button'}));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      change('review',{decision:decision.value,interpretation:interpretation.value,findings:findings.value,instructions:instructions.value,note:note.value},
        'Review saved. Release the report when ready.');
    });
    card.append(form);
  }

  function status(record) {
    if (record.report?.decision === 'replacement_requested') return 'Additional scan required';
    return record.processing ? (record.assessment?.state === 'queued' ? 'Uploaded' : 'Processing') : messages[record.status];
  }

  function scanDetails(details, record, archived) {
    details.replaceChildren();
    const analysis = element('details',null,{class:'uw-analysis-fold'});
    analysis.append(element('summary','AI frame analysis'));
    renderAssessment(analysis,record);
    details.append(analysis);
    if (clinician && !record.processing) review(details, archived ? {...record, archived, note:record.review_note} : record);
    if (record.report) { const released=element('details',null,{class:'uw-report-fold'});released.append(element('summary','Released clinician report'));report(released,record.report,'Clinician report');details.append(released); }
    if (archived && record.decision) details.append(element('p','Recorded decision · ' + decisions[record.decision]));
    if (clinician || record.report || archived) return;
    details.append(element('h4','Doctor review status'), element('p', record.processing
      ? 'Your scan has been saved. The assessment will update here.'
      : record.status === 'under_review' ? 'Your doctor is reviewing the scan.'
      : 'Your scan is in your doctor’s review queue. Their feedback will appear here after release.'));
    if (!record.processing) {
      details.append(element('h4','Recommended next step'), element('p',resultNextStep(record)));
    }
    if (record.retry_revision) {
      details.append(button('Retry AI analysis', () => perform(() => request(base() + '/' + record.id + '/retry', {
        method:'POST', body:JSON.stringify({revision:record.retry_revision}),
        headers:{'content-type':'application/json','x-dai-ultrasound':'review'},
      }), 'Analysis queued for this scan.')));
    }
  }

  function resultNextStep(record) {
    return record.assessment?.grade === 'poor'
      ? 'If you have a clearer frame, share it with your care team.'
      : 'Check here for feedback and next steps from your care team.';
  }

  function updateStatus(card, record) {
    const badge = card.querySelector('.uw-state');
    badge.textContent = status(record);
    badge.dataset.state = record.processing ? 'processing' : record.status;
    card.dataset.inference = record.assessment?.state === 'inference' ? 'active' : '';
  }

  function scanCard(record, archived = false, primary = false) {
    const card = element('article',null,{class:'uw-card','data-scan-id':record.id});
    const disclosure = element('details',null,{class:'uw-scan-disclosure'});
    disclosure.open = primary;
    const heading = element('summary',null,{class:'uw-card-heading'});
    heading.append(element('h3',(record.demo_image ? 'Demo scan' : 'Ultrasound scan') + ' · ' +
      new Date(record.created_at).toLocaleDateString()), element('span',null,{class:'uw-state'}));
    const layout = element('div',null,{class:'uw-scan-layout'});
    const media = element('div',null,{class:'uw-scan-media'});
    const details = element('div',null,{class:'uw-scan-details'});
    preview(media,record,primary);
    if (!archived) media.append(element('p','Scan ID ' + record.id,{class:'uw-scan-ref'}));
    scanDetails(details,record,archived);
    layout.append(media,details);
    disclosure.append(heading,layout);
    card.append(disclosure);
    updateStatus(card,record);
    if (archived) card.querySelector('.uw-state').textContent = 'Archived hospital record';
    if (!archived && (record.processing || !clinician && !record.report)) watch(card,record);
    return card;
  }

  function watch(card, initial) {
    const view = generation;
    const endpoint = base() + '/' + initial.id;
    let record = initial;
    const snapshot = scan => JSON.stringify([scan.assessment, scan.status, scan.report, scan.retry_revision]);
    async function refresh() {
      if (view !== generation || !card.isConnected) return;
      if (!document.hidden && !busy && (record.processing || card.querySelector('details').open)) {
        try {
          const fresh = await request(endpoint);
          if (view !== generation || !card.isConnected) return;
          if (snapshot(record) !== snapshot(fresh)) {
            record = fresh;
            updateStatus(card, record);
            scanDetails(card.querySelector('.uw-scan-details'), record, false);
            updateClocks();
          }
        } catch {
          // Manual refresh remains available if the session or connection is lost.
        }
      }
      if (record.processing || !clinician && !record.report) {
        setTimeout(refresh,record.processing ? 450 : 7000);
      }
    }
    setTimeout(refresh, record.processing ? 250 : 7000);
  }

  async function showAnalysisStatus(badge, view) {
    let state;
    let model;
    try {
      ({state,model} = await request(patientPath + '/status'));
    } catch {
      state = 'status_unavailable';
    }
    if (!badge.isConnected || generation !== view) return;
    const labels = {
      ready: model === 'sononet16' ? 'Live AI ready · SonoNet16' : 'Live AI ready · Research archive model',
      warming: 'Starting the ultrasound model…',
      disabled: 'AI model disabled on this server. Doctor review is available.',
      model_error: 'The AI model could not load. Restart DaiHealth and check the ML service log.',
      service_unreachable: 'The ultrasound AI service is unreachable. Doctor review is available.',
      service_outdated: 'The ultrasound AI service needs an update. Restart DaiHealth from the updated checkout.',
      service_auth_error: 'The ultrasound AI service rejected its connection. Check the service configuration.',
      status_unavailable: 'Live AI status unavailable. Check the running DaiHealth version.',
    };
    badge.textContent = labels[state] || labels.status_unavailable;
    badge.dataset.status = state;
    if (state !== 'ready') setTimeout(() => {
      if (badge.isConnected && generation === view) showAnalysisStatus(badge, view);
    }, state === 'warming' || state === 'service_unreachable' ? 2500 : 10000);
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
        chooser.addEventListener('change',()=>{patient=chooser.value;offset=0;latestUpload=null;load();});
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
      if (!clinician) {
        const badge = element('p','Checking live AI…',{class:'uw-model-badge',role:'status'});
        root.prepend(badge);
        showAnalysisStatus(badge,active);
      }
      const data = await request(base() + '?offset=' + offset);
      if(!Array.isArray(data?.items))throw Error('Ultrasound history could not be loaded. Please try again.');
      if (active !== generation) return;
      const refresh = button('Refresh scans', load);
      if (clinician) root.append(uploadForm([]));
      const historyHeading=element('header',null,{class:'uw-history-heading'});historyHeading.append(element('h2','Scan history'),refresh);root.append(historyHeading,element('p','Open a scan to view its image, AI frame analysis and clinician feedback.',{class:'uw-history-intro'}));
      if (!data.items.length && !data.archived?.length) root.append(element('p','No scans are available yet.'));
      for (const [index,scan] of data.items.entries()) {
        root.append(scanCard(scan,false,scan.id === latestUpload));
      }
      for (const scan of data.archived || []) root.append(scanCard(scan,true));
      if (offset) root.append(button('Previous scans',()=>{offset=Math.max(0,offset-25);load();}));
      if (data.has_more) root.append(button('More scans',()=>{offset+=25;load();}));
      updateClocks();
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
    if (active) {
      load();
      clock = setInterval(updateClocks, 500);
    } else {
      clearInterval(clock);
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
