(function () {
  'use strict';

  const panel = document.getElementById('panel-pregnancy-library');
  if (!panel) return;
  const home = document.getElementById('pl-home-summary');
  const content = document.getElementById('pl-content');
  const status = document.getElementById('pl-status');
  const dialog = document.getElementById('pl-dialog');
  const modalBody = document.getElementById('pl-dialog-body');
  const modalTitle = document.getElementById('pl-dialog-title');
  const addMemory = panel.querySelector('[data-kind="memory"]');
  const base = '/api/patient/pregnancy-library';
  const days = 86400000;
  const dateStyle = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeZone:'UTC'});
  const dateTimeStyle = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeZone:'Asia/Kolkata'});
  const types = [['timeline','Timeline'], ['memory','Memory gallery'], ['diary','Private diary'],
    ['letter','Letters to My Baby'], ['milestones','Milestones']];
  const labels = {memory:'Memory', diary:'Diary entry', letter:'Letter'};
  const trimesterName = {1:'First trimester', 2:'Second trimester', 3:'Third trimester'};
  const mediaTypes = new Set(['image/jpeg','image/png','image/webp','video/mp4']);
  let data;
  let active = false;
  let loadController;
  let selectedJourney;
  let selectedWeek;
  let view = 'timeline';
  let modalBusy = false;
  let previewUrls = [];

  const format = date => date ? dateStyle.format(new Date(date)) : '';
  const addDays = (date, offset) => new Date(Date.parse(date) + offset * days).toISOString().slice(0,10);
  const weekName = week => week === 41 ? 'Delivery and birth' : 'Week ' + week;
  const weekFor = (date, journey) => journey.birth_date && date >= journey.birth_date ? 41
    : Math.min(40, Math.max(1, 1 + Math.floor((Date.parse(date) - Date.parse(journey.start_date)) / (7 * days))));

  function el(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== null && text !== undefined) node.textContent = text;
    for (const [name,value] of Object.entries(attributes)) node.setAttribute(name,value);
    return node;
  }

  function button(text, action, className = 'pl-quiet') {
    const node = el('button',text,{type:'button',class:className});
    node.addEventListener('click',action);
    return node;
  }

  function link(text, href, attrs = {}) {
    return el('a',text,{href,class:'pl-inline-link',...attrs});
  }

  function label(text, input) {
    const item = el('label',text);
    item.append(input);
    return item;
  }

  function notify(message = '', error = false) {
    status.textContent = message;
    status.dataset.error = error;
  }

  async function request(path = '', options = {}) {
    const response = await fetch(base + path,{
      credentials:'same-origin',cache:'no-store',...options,
      headers:options.method ? {'x-dai-library':'write', ...options.headers} : options.headers,
    });
    if (response.status === 204) return;
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) throw new Error(value?.error || 'Your library is unavailable. Try again.');
    return value;
  }

  function homeSummary(journey) {
    if (!journey) {
      home.textContent = 'Add pregnancy dates to start your journey.';
      return;
    }
    const stage = journey.week ? weekName(journey.week) + ' · ' + trimesterName[journey.trimester]
      : journey.birth_date ? 'Birth recorded' : 'Saved journey';
    home.textContent = [stage, journey.memories + (journey.memories === 1 ? ' memory' : ' memories'),
      journey.updated_at ? 'Updated ' + dateTimeStyle.format(new Date(journey.updated_at)) : null]
      .filter(Boolean).join(' · ');
  }

  async function updateHome() {
    if (window.IS_GUEST) {
      home.textContent = 'Sign in to keep your journey private.';
      return;
    }
    try {
      const result = await request('/summary');
      homeSummary(result.journey);
    } catch {
      home.textContent = 'Open your library to check your journey.';
    }
  }

  async function refresh(message = '') {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    notify('Opening your library…');
    addMemory.hidden = true;
    if (window.IS_GUEST) {
      notify('');
      const section = el('div',null,{class:'pl-section'});
      section.append(el('h2','Your private keepsake'),link('Sign in to open your library','auth.html?role=mother'));
      content.replaceChildren(section);
      return;
    }
    try {
      const path = selectedJourney ? '?journey=' + encodeURIComponent(selectedJourney) : '';
      const result = await request(path, {signal:controller.signal});
      if (!active || loadController !== controller) return;
      data = result;
      if (!selectedWeek) {
        selectedWeek = data.journey?.week || (data.journey?.birth_date ? 41 : data.entries[0]?.week || 1);
      }
      render();
      if (!selectedJourney || data.journey?.id === data.journeys[0]?.id) homeSummary(data.journey);
      notify(message);
    } catch (error) {
      if (!active || loadController !== controller) return;
      notify(error.message,true);
      content.replaceChildren(button('Try again', () => refresh()));
    }
  }

  function section(title, subtitle, modifier) {
    const block = el('section',null,{class:'pl-section' + (modifier ? ' ' + modifier : '')});
    block.append(el('h2',title));
    if (subtitle) block.append(el('p',subtitle));
    return block;
  }

  function progress() {
    const { journey, journeys } = data;
    const block = el('section',null,{class:'pl-progress'});
    const row = el('div',null,{class:'pl-progress-row'});
    const heading = el('div');
    heading.append(el('h2', journey.week ? weekName(journey.week) + ' of 40'
      : journey.birth_date ? 'Your birth chapter' : 'Your saved journey'),
    el('p',[journey.week ? trimesterName[journey.trimester] : null,
      journey.birth_date ? 'Birth recorded ' + format(journey.birth_date) : 'Estimated due ' + format(journey.due_date),
      journey.demo ? 'Sample entries included' : null].filter(Boolean).join(' · ')));
    row.append(heading);
    if (journeys.length > 1) {
      const select = el('select');
      for (const option of journeys) {
        select.append(el('option','Journey from ' + format(option.start_date),{value:option.id}));
      }
      select.value = journey.id;
      select.addEventListener('change',() => {
        selectedJourney = select.value;
        selectedWeek = null;
        refresh();
      });
      row.append(label('Pregnancy journey',select));
    }
    block.append(row);
    if (journey.week) block.append(el('progress',null,{max:40,value:journey.week,'aria-label':'Pregnancy week progress'}));
    return block;
  }

  function render(focusView) {
    if (!data.journey) {
      const empty = section('Start your pregnancy library','Add your last period or estimated due date to place memories on your timeline.');
      empty.append(link('Edit my profile','#profile'));
      content.replaceChildren(empty);
      addMemory.hidden = true;
      return;
    }
    addMemory.hidden = false;
    const nav = el('nav',null,{class:'pl-tabs','aria-label':'Pregnancy library sections'});
    for (const [key,title] of types) {
      const tab = button(title,() => {
        view = key;
        render(true);
      },'pl-tab');
      tab.setAttribute('aria-pressed',String(view === key));
      nav.append(tab);
    }
    const body = view === 'timeline' ? timeline() : view === 'milestones' ? milestones() : collection(view);
    content.replaceChildren(progress(),nav,body);
    if (focusView) nav.querySelector('[aria-pressed="true"]')?.focus();
  }

  function browseWeek(week) {
    if (week < 1 || week > 41) return;
    selectedWeek = week;
    render();
    document.getElementById('pl-week-heading')?.focus({preventScroll:true});
  }

  function timeline() {
    const journey = data.journey;
    const page = section('Your pregnancy timeline','Choose a week to see the dates, what may be changing, and the moments you’ve kept.');
    const picker = el('div',null,{class:'pl-week-picker'});
    for (const [labelText,first,last] of [['First trimester',1,12],['Second trimester',13,27],['Third trimester',28,40]]) {
      const group = el('details');
      group.open = selectedWeek >= first && selectedWeek <= last;
      const buttons = el('div',null,{class:'pl-week-buttons'});
      for (let week = first; week <= last; week++) {
        const item = button(String(week),() => browseWeek(week),'pl-tab');
        item.setAttribute('aria-label',weekName(week));
        item.setAttribute('aria-pressed',String(week === selectedWeek));
        item.dataset.current = week === journey.week;
        buttons.append(item);
      }
      group.append(el('summary',labelText + ' · Weeks ' + first + '–' + last),buttons);
      picker.append(group);
    }
    const birth = button('Delivery and birth',() => browseWeek(41),'pl-tab');
    birth.setAttribute('aria-pressed',String(selectedWeek === 41));
    picker.append(birth);
    const card = el('section',null,{class:'pl-week-card'});
    const row = el('div',null,{class:'pl-row'});
    const heading = el('div');
    const start = addDays(journey.start_date, (selectedWeek - 1) * 7);
    const personalBirth = data.moments.find(item => item.code === 'birth')?.recorded_on;
    const when = selectedWeek === 41
      ? (personalBirth ? 'Arrival recorded by you · ' + format(personalBirth)
        : journey.birth_date ? 'Birth recorded ' + format(journey.birth_date) : 'Estimated due ' + format(journey.due_date))
      : format(start) + ' – ' + format(addDays(start,6));
    heading.append(el('h3',weekName(selectedWeek),{id:'pl-week-heading',tabindex:'-1'}),el('p',when,{class:'pl-meta'}));
    const previous = button('← Previous',() => browseWeek(selectedWeek - 1));
    const next = button('Next →',() => browseWeek(selectedWeek + 1));
    previous.disabled = selectedWeek === 1;
    next.disabled = selectedWeek === 41;
    const controls = el('div',null,{class:'pl-row'});
    controls.append(previous,next);
    row.append(heading,controls);
    card.append(row);
    const guide = window.PregnancyLibraryGuide?.(selectedWeek);
    if (guide) {
      const education = el('div',null,{class:'pl-education'});
      for (const [name,text] of [['Your baby’s development',guide.baby],['What you may be feeling',guide.mother]]) {
        const tile = el('div');
        tile.append(el('strong',name),el('p',text));
        education.append(tile);
      }
      card.append(education,el('p','These are general changes around this stage of pregnancy.',{class:'pl-meta'}),
        link('Read the NHS week-by-week guide','https://www.nhs.uk/best-start-in-life/pregnancy/week-by-week-guide-to-pregnancy/',{target:'_blank',rel:'noopener noreferrer'}));
    } else {
      card.append(el('p','Keep the story of your baby’s arrival here, whenever you’re ready to write it.'));
    }
    const stops = data.visits.map(item => ({...item, text:'Appointment · ' + ({
      confirmed:'Confirmed', completed:'Completed', pending:'Requested',
    })[item.status]})).concat(data.care.map(item => ({...item, text:item.title + (item.verified ? ' · Verified' : ' · Care plan')})));
    const inWeek = stops.filter(item => weekFor(item.date,journey) === selectedWeek).sort((a,b)=>a.date.localeCompare(b.date));
    if (inWeek.length) {
      const list = el('ul');
      for (const item of inWeek) list.append(el('li',format(item.date) + ' · ' + item.text));
      card.append(el('h4','From your care timeline'),list);
    }
    const personal = data.entries.filter(entry => entry.week === selectedWeek);
    card.append(el('h4','Your entries'));
    if (personal.length) card.append(cards(personal,'pl-gallery'));
    else card.append(el('p','No entries in this week yet.'));
    card.append(button('+ Add a memory for this week',() => editor('memory',null,selectedWeek),'pl-button'));
    page.append(picker,card);
    return page;
  }

  function mediaElement(attachment, mode) {
    const url = base + '/media/' + attachment.id;
    if (attachment.mime_type === 'video/mp4') {
      const video = el('video',null,{preload:'metadata',playsinline:'',
        src:mode === 'thumb' ? url + '#t=0.15' : url});
      if (mode !== 'thumb') video.controls = true;
      return video;
    }
    return el('img',null,{src:url,alt:mode === 'thumb' ? '' : 'Photo from this memory',
      loading:mode === 'thumb' ? 'lazy' : 'eager',decoding:'async'});
  }

  function cards(entries, className) {
    const list = el('div',null,{class:className});
    for (const entry of entries) {
      const card = button(null,() => showEntry(entry),'pl-memory');
      const attachment = entry.media.find(item => item.mime_type.startsWith('image/')) || entry.media[0];
      if (attachment) {
        if (attachment.mime_type === 'video/mp4') {
          const cover = el('span',null,{class:'pl-video-cover'});
          cover.append(mediaElement(attachment,'thumb'),el('span','▶ Video',{class:'pl-play'}));
          card.append(cover);
        } else card.append(mediaElement(attachment,'thumb'));
      }
      const copy = el('span',null,{class:'pl-memory-copy'});
      copy.append(el('strong',entry.title),el('span',format(entry.entry_date) + ' · ' + weekName(entry.week),{class:'pl-meta'}));
      if (entry.body && !attachment) copy.append(el('span',entry.body,{class:'pl-excerpt'}));
      card.append(copy);
      list.append(card);
    }
    return list;
  }

  function collection(kind) {
    const entry = {
      memory:['Memory gallery','Photos, videos and little moments, newest first.','+ Add a Memory','No memories yet.'],
      diary:['Private diary','A place to write down how you feel and what you want to remember.','Write a diary entry','No diary entries yet.'],
      letter:['Letters to My Baby','Words to keep for the day you want to share them.','Write a letter','No letters yet.'],
    }[kind];
    const [title,subtitle,action,empty] = entry;
    const page = section(title,subtitle,kind === 'letter' ? 'pl-letters' : '');
    page.append(button(action,() => editor(kind),'pl-button'));
    const entries = data.entries.filter(entry => entry.kind === kind);
    page.append(entries.length ? cards(entries,kind === 'memory' ? 'pl-gallery' : 'pl-writing') : el('p',empty));
    return page;
  }

  function milestones() {
    const journey = data.journey;
    const page = section('Moments that mark the journey','Calendar milestones follow your profile dates. Record the personal moments you want to keep.');
    const values = [
      [null,'Pregnancy journey started',journey.start_date], ['ultrasound','First ultrasound'], ['heartbeat','First heartbeat'],
      [null,'First trimester completed',addDays(journey.start_date,84)], ['kick','First baby kick'],
      [null,'Halfway through pregnancy (20 weeks)',addDays(journey.start_date,140)],
      [null,'Third trimester started',addDays(journey.start_date,189)], ['shower','Baby shower'],
      [null,'36 weeks completed',addDays(journey.start_date,252)], [null,'Estimated delivery date',journey.due_date,true],
      ['birth','Baby’s arrival',journey.birth_date],
    ];
    const grid = el('div',null,{class:'pl-milestones'});
    for (const [code,title,scheduled,estimate] of values) {
      const manual = data.moments.find(item => item.code === code);
      const date = manual?.recorded_on || scheduled;
      let state = 'Ready to record';
      if (manual) state = 'Recorded by you';
      else if (code === 'birth' && scheduled) state = 'From care records';
      else if (estimate) state = 'Estimated';
      else if (date) state = journey.birth_date && date > journey.birth_date ? 'Calendar reference'
        : date <= data.today ? 'Calendar milestone' : 'Coming up';
      const card = el('article',null,{class:'pl-moment','data-state':state});
      card.append(el('h3',title),el('span',state,{class:'pl-chip'}));
      if (date) card.append(el('p',format(date)));
      if (code) card.append(button(manual ? 'Edit date' : 'Record this moment',() => momentEditor(code,title,manual,scheduled)));
      grid.append(card);
    }
    page.append(grid);
    return page;
  }

  function revokePreviews() {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls = [];
  }

  function showModal(title, nodes) {
    revokePreviews();
    modalTitle.textContent = title;
    modalBody.replaceChildren(...nodes);
    if (!dialog.open) dialog.showModal();
    else {
      dialog.scrollTop = 0;
      dialog.querySelector('input, textarea, button')?.focus();
    }
  }

  function showEntry(entry) {
    const nodes = [el('p',format(entry.entry_date) + ' · ' + weekName(entry.week),{class:'pl-meta'})];
    if (entry.tags.length) nodes.push(el('p',entry.tags.join(' · '),{class:'pl-chip'}));
    if (entry.media.length) {
      const media = el('div',null,{class:'pl-full-media'});
      for (const attachment of entry.media) {
        const item = el('div');
        item.append(mediaElement(attachment,'full'),link('Download ' +
          (attachment.mime_type.startsWith('image/') ? 'photo' : 'video'),base + '/media/' + attachment.id + '?download=1'));
        media.append(item);
      }
      nodes.push(media);
    }
    if (entry.body) nodes.push(el('p',entry.body,{class:'pl-prose'}));
    const controls = el('div',null,{class:'pl-row'});
    const error = el('p',null,{role:'alert'});
    controls.append(button('Edit ' + labels[entry.kind].toLowerCase(),() => editor(entry.kind,entry)),
      button('Delete',() => {
        if (!window.confirm('Delete this entry and its attachments?')) return;
        modalAction(controls,error,async () => {
          await request('/entries/' + entry.id,{method:'DELETE',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({revision:entry.revision})});
          await finish('Entry deleted.');
        });
      },'pl-quiet pl-danger'));
    nodes.push(controls,error);
    showModal(entry.title,nodes);
  }

  function editor(kind, entry, chosenWeek) {
    const journey = data.journey;
    const newId = entry?.id || crypto.randomUUID();
    const form = el('form');
    const title = el('input',null,{required:'',maxlength:120});
    title.value = entry?.title || '';
    const body = el('textarea',null,{maxlength:8000,rows:kind === 'memory' ? 3 : 7});
    body.required = kind !== 'memory';
    body.value = entry?.body || '';
    if (kind === 'letter') body.placeholder = 'Dear little one…';
    if (kind === 'diary') body.placeholder = window.PregnancyLibraryGuide?.(chosenWeek || journey.week)?.prompt ||
      'How are you feeling today?';
    const date = el('input',null,{type:'date',max:data.today,required:''});
    const week = el('select');
    for (let i = 1; i <= 41; i++) week.append(el('option',weekName(i),{value:i}));
    const weekStart = chosenWeek && chosenWeek < 41 ? addDays(journey.start_date,(chosenWeek - 1) * 7) : null;
    date.value = entry?.entry_date || (weekStart && weekStart < data.today ? weekStart : data.today);
    week.value = entry?.week || chosenWeek || weekFor(date.value,journey);
    let manualWeek = Boolean(entry || chosenWeek);
    week.addEventListener('change',() => { manualWeek = true; });
    date.addEventListener('change',() => {
      if (!manualWeek && date.value) week.value = weekFor(date.value,journey);
    });
    const pair = el('div',null,{class:'pl-pair'});
    pair.append(label('Date',date),label('Pregnancy week',week));
    form.append(label('Title',title),pair,label(kind === 'memory' ? 'Description' : labels[kind],body));

    let retained = entry?.media.slice() || [];
    let files = [];
    const error = el('p',null,{role:'alert'});
    const tagInputs = [];
    if (kind === 'memory') {
      const input = el('input',null,{type:'file',accept:[...mediaTypes].join(','),multiple:''});
      const previews = el('div',null,{class:'pl-preview'});
      function showFiles() {
        revokePreviews();
        previews.replaceChildren();
        function preview(media, remove) {
          const tile = el('div');
          tile.append(media,button('Remove',remove));
          previews.append(tile);
        }
        for (const item of retained) preview(mediaElement(item,'thumb'),() => {
          retained = retained.filter(original => original !== item);
          showFiles();
        });
        for (const file of files) {
          const url = URL.createObjectURL(file);
          previewUrls.push(url);
          const media = file.type.startsWith('image/') ? el('img',null,{src:url,alt:'Photo preview'})
            : el('video',null,{src:url,controls:'',preload:'metadata',playsinline:''});
          preview(media,() => {
            files = files.filter(original => original !== file);
            showFiles();
          });
        }
      }
      input.addEventListener('change',() => {
        const picked = [...input.files];
        input.value = '';
        const all = [...files,...picked];
        if (all.length + retained.length > 8 || all.some(file => !mediaTypes.has(file.type) || !file.size ||
            file.size > (file.type === 'video/mp4' ? 20 : 6) * 1024 * 1024) ||
            all.reduce((sum,file)=>sum + file.size,0) > 31 * 1024 * 1024) {
          error.textContent = 'Choose up to eight files. Use photos up to 6 MB and MP4 videos up to 20 MB, with 31 MB total per save.';
          return;
        }
        error.textContent = '';
        files = all;
        showFiles();
      });
      form.append(label('Add photos or an MP4 video',input),
        el('p','JPEG, PNG or WebP up to 6 MB per photo. H.264 MP4 up to 20 MB.',{class:'pl-meta'}),previews);
      const tags = el('fieldset');
      tags.append(el('legend','Tags (optional)'));
      for (const tag of data.tags) {
        const check = el('input',null,{type:'checkbox',value:tag});
        check.checked = entry?.tags.includes(tag) || false;
        tagInputs.push(check);
        const tagLabel = el('label');
        tagLabel.append(check,document.createTextNode(tag));
        tags.append(tagLabel);
      }
      form.append(tags);
      // Show retained media after the previous dialog's object URLs are revoked.
      queueMicrotask(showFiles);
    }
    const submit = el('button','Save ' + labels[kind].toLowerCase(),{type:'submit',class:'pl-button'});
    form.append(error,submit);
    form.addEventListener('submit',event => {
      event.preventDefault();
      modalAction(form,error,async () => {
        const payload = new FormData();
        payload.set('entry',JSON.stringify({id:newId, journey:journey.id, kind, title:title.value, body:body.value,
          entry_date:date.value,week:Number(week.value),tags:tagInputs.filter(item=>item.checked).map(item=>item.value),
          retain:retained.map(item=>item.id),revision:entry?.revision}));
        for (const file of files) payload.append('media',file);
        const result = await request('/entries' + (entry ? '/' + entry.id : ''),{
          method:entry ? 'PATCH' : 'POST',body:payload,
        });
        if (view === 'timeline') selectedWeek = Number(week.value);
        if (kind !== 'memory') view = kind;
        await finish(labels[kind] + ' saved.',result.journey_id);
      });
    });
    showModal((entry ? 'Edit ' : 'New ') + labels[kind].toLowerCase(),[form]);
  }

  function momentEditor(code, name, recorded, scheduled) {
    const form = el('form');
    const date = el('input',null,{type:'date',required:'',max:data.today,min:data.journey.start_date});
    date.value = recorded?.recorded_on || (scheduled && scheduled <= data.today ? scheduled : data.today);
    const error = el('p',null,{role:'alert'});
    const actions = el('div',null,{class:'pl-row'});
    const save = value => modalAction(form,error,async () => {
      const result = await request('/moments/' + code,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({journey:data.journey.id,recorded_on:value})});
      await finish(value ? 'Milestone recorded.' : 'Personal milestone removed.',result.journey_id);
    });
    actions.append(el('button','Save date',{type:'submit',class:'pl-button'}));
    if (recorded) actions.append(button('Remove personal date',()=>save(null)));
    form.append(label('Date',date),error,actions);
    form.addEventListener('submit',event => {
      event.preventDefault();
      save(date.value);
    });
    showModal(name,[form]);
  }

  async function finish(message, id) {
    if (!active) return;
    if (id) selectedJourney = id;
    dialog.close();
    await refresh(message);
    updateHome();
  }

  async function modalAction(container, error, operation) {
    if (modalBusy) return;
    modalBusy = true;
    const controls = [...container.querySelectorAll('input, button, textarea, select')];
    const original = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    error.textContent = 'Saving…';
    try { await operation(); }
    catch (problem) { error.textContent = problem.message; }
    finally {
      modalBusy = false;
      controls.forEach((control,index) => { control.disabled = original[index]; });
    }
  }

  function activate(next) {
    active = next;
    if (active) refresh();
    else {
      loadController?.abort();
      if (dialog.open) dialog.close();
      data = undefined;
      content.replaceChildren();
      notify('');
      addMemory.hidden = true;
    }
  }

  addMemory.addEventListener('click',() => { if (data?.journey) editor('memory'); });
  panel.querySelector('[data-pl-action="close"]').addEventListener('click',() => { if (!modalBusy) dialog.close(); });
  dialog.addEventListener('cancel',event => { if (modalBusy) event.preventDefault(); });
  dialog.addEventListener('close',() => {
    if (!dialog.open) {
      revokePreviews();
      modalBody.replaceChildren();
    }
  });
  window.addEventListener('dai:patient-panel',event => {
    const next = event.detail.panel === 'pregnancy-library';
    if (next !== active) activate(next);
  });
  window.addEventListener('pagehide',() => {
    activate(false);
    home.textContent = '';
  });
  window.addEventListener('pageshow',event => {
    if (!event.persisted) return;
    updateHome();
    if (panel.classList.contains('is-active')) activate(true);
  });
  updateHome();
  if (panel.classList.contains('is-active')) activate(true);
})();
