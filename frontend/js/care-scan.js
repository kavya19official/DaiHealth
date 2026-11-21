(function () {
  'use strict';

  const find = id => document.getElementById(id);
  const dialog = find('careScanDialog');
  if (!dialog) return;
  const uploadForm = find('careScanUpload');
  const reviewForm = find('careScanReview');
  const patient = uploadForm.elements.patient;
  const entries = find('careScanEntries');
  const add = find('careScanAdd');
  const resultActions = find('careScanResult');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const fileTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const allowed = new Set(Object.values(fileTypes));
  const editable = ['kind', 'occurred_on', 'label', 'dosage', 'result', 'unit', 'notes'];
  let profiles = [];
  let state;
  let actions;
  let file;
  let previewUrl;
  let reviewToken;
  let source;
  let result;
  let pending = false;
  let rowNumber = 0;

  function setStatus(message) {
    find('careScanStatus').textContent = message;
  }

  function updateProfiles() {
    const current = patient.value;
    patient.replaceChildren(new Option('Choose a patient', '', true, true));
    patient.options[0].disabled = true;
    for (const { value, name } of profiles) patient.add(new Option(name, value));
    patient.value = profiles.some(profile => profile.value === current) ? current : '';
  }

  function clearReview() {
    file = previewUrl = reviewToken = source = result = undefined;
    rowNumber = 0;
    entries.replaceChildren();
    find('careScanWarnings').replaceChildren();
    find('careScanPatient').textContent = '';
    find('careScanPreview').replaceChildren();
    find('careScanOriginal').removeAttribute('href');
    find('careScanOriginal').removeAttribute('download');
    uploadForm.reset();
    reviewForm.reset();
    updateProfiles();
    find('careScanFilename').textContent = 'Choose a PDF, JPEG, PNG or WebP file up to 5 MB.';
    uploadForm.hidden = false;
    reviewForm.hidden = true;
    resultActions.hidden = true;
    add.disabled = false;
    setStatus('');
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearReview();
  }

  function busy(value) {
    pending = value;
    dialog.setAttribute('aria-busy', String(value));
    for (const form of [uploadForm, reviewForm]) form.querySelector('fieldset').disabled = value;
    dialog.querySelector('[data-scan-close]').disabled = value;
  }

  async function request(action, body) {
    let response;
    try {
      response = await fetch(DaiAPI.API_BASE + '/patient/care-scan/' + action, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error.name === 'TimeoutError') throw new Error('CareScan took too long. Please retry.');
      throw new Error('Connection lost. Try again when you’re online.');
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Sign in again to continue with CareScan.');
    if (response.status === 413) throw new Error('Choose a file up to 5 MB.');
    if (!response.ok) throw new Error(payload.error || 'CareScan could not finish. Please try again.');
    return payload;
  }

  function setFile(selected) {
    if (!selected) return;
    file = undefined;
    find('careScanFilename').textContent = 'No file selected.';
    const mime = selected.type || fileTypes[selected.name.toLowerCase().split('.').at(-1)];
    if (!allowed.has(mime) || !selected.size || selected.size > 5 * 1024 * 1024) {
      setStatus('Choose a PDF, JPEG, PNG or WebP file up to 5 MB.');
      return;
    }
    file = selected.type ? selected : new File([selected], selected.name, { type: mime });
    find('careScanFilename').textContent = file.name;
    setStatus('');
  }

  function updateFields(row) {
    const kind = row.querySelector('[name="kind"]').value;
    for (const label of row.querySelectorAll('[data-scan-field]')) {
      const visible = label.dataset.scanField === 'dosage' ?
        kind === 'medicine' || kind === 'vaccination' : kind === 'lab_result';
      label.hidden = !visible;
      label.querySelector('input').disabled = !visible;
    }
  }

  function addRow(candidate) {
    const row = find('careScanEntry').content.firstElementChild.cloneNode(true);
    const index = ++rowNumber;
    row.dataset.candidateId = candidate?.candidate_id ?? '';
    row.querySelector('legend').textContent = candidate ? 'Extracted entry ' + index : 'Manual entry ' + index;
    const excerpt = row.querySelector('[data-scan-source]');
    excerpt.hidden = !candidate?.source_line;
    if (!excerpt.hidden) excerpt.textContent = 'Page ' + candidate.page + ' · ' + candidate.source_line;
    for (const name of editable) row.querySelector('[name="' + name + '"]').value = candidate?.[name] ?? (name === 'kind' ? 'other' : '');
    row.querySelector('[name="occurred_on"]').max = today();
    if (source.child_id) row.querySelector('[name="kind"] option[value="antenatal_visit"]').disabled = true;
    row.querySelectorAll('[data-scan-decision]').forEach(radio => { radio.name = 'decision-' + index; });
    row.addEventListener('input', event => {
      if (event.target.matches('[data-scan-decision]')) return;
      row.querySelectorAll('[data-scan-decision]').forEach(radio => { radio.checked = false; });
      reviewForm.elements.confirm_source.checked = false;
    });
    row.addEventListener('change', event => {
      if (event.target.name === 'kind') updateFields(row);
      if (event.target.matches('[data-scan-decision]')) reviewForm.elements.confirm_source.checked = false;
    });
    updateFields(row);
    entries.append(row);
    return row;
  }

  function startReview(payload, patientName) {
    reviewToken = payload.review_token;
    uploadForm.hidden = true;
    reviewForm.hidden = false;
    find('careScanPatient').textContent = 'Patient: ' + patientName;
    for (const message of payload.warnings) {
      const li = document.createElement('li');
      li.textContent = message;
      find('careScanWarnings').append(li);
    }
    previewUrl = URL.createObjectURL(file);
    const original = find('careScanOriginal');
    original.href = previewUrl;
    original.download = file.name;
    const pdf = file.type === 'application/pdf';
    const preview = document.createElement(pdf ? 'iframe' : 'img');
    if (pdf) {
      preview.title = 'Original PDF selected for CareScan';
      preview.setAttribute('sandbox', '');
    } else preview.alt = 'Original image selected for CareScan';
    preview.src = previewUrl;
    find('careScanPreview').append(preview);
    for (const entry of payload.candidates) addRow(entry);
    if (!payload.candidates.length) addRow();
    setStatus('Review each entry before saving.');
    (entries.querySelector('select') || add).focus();
  }

  function finish(payload) {
    reset();
    result = payload;
    uploadForm.hidden = true;
    resultActions.hidden = false;
    find('careScanView').hidden = !payload.first_entry_id;
    if (payload.already_saved) setStatus('This original is already linked to your care timeline.');
    else if (payload.saved || payload.duplicates) {
      setStatus(payload.saved + ' saved to your care timeline. ' +
        (payload.duplicates ? payload.duplicates + ' duplicate entries skipped.' : ''));
    } else setStatus('No entries were saved.');
    const action = payload.first_entry_id ? find('careScanView') : resultActions.querySelector('[data-scan-reset]');
    action.focus();
    if (payload.saved || payload.already_saved || payload.duplicates) {
      void window.PatientExperience?.refreshTimeline();
      void actions.reloadDocuments();
    }
  }

  uploadForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    if (!file) {
      setStatus('Choose a file or take a photo first.');
      return;
    }
    const patientId = patient.value;
    const patientName = patient.options[patient.selectedIndex].text;
    const documentType = uploadForm.elements.document_type.value;
    busy(true);
    setStatus('Reading the document. This can take a moment…');
    try {
      source = { filename: file.name, mime_type: file.type, content_base64: await actions.fileToBase64(file),
        document_type: documentType, child_id: patientId === 'mother' ? null : Number(patientId) };
      const payload = await request('extract', source);
      if (payload.already_saved) finish(payload);
      else startReview(payload, patientName);
    } catch (error) {
      setStatus(error.message);
    } finally {
      busy(false);
      if (!reviewForm.hidden) entries.querySelector('select')?.focus();
    }
  });

  function readDecisions() {
    return Array.from(entries.children, (row, index) => {
      const choice = row.querySelector('[data-scan-decision]:checked');
      if (!choice) {
        row.querySelector('[data-scan-decision]').focus();
        throw new Error('Verify or reject entry ' + (index + 1) + '.');
      }
      const record = { candidate_id: row.dataset.candidateId ? Number(row.dataset.candidateId) : null, decision: choice.value };
      if (choice.value === 'reject') return record;
      for (const name of editable) {
        const field = row.querySelector('[name="' + name + '"]');
        if (!field.disabled) record[name] = field.value.trim();
      }
      for (const [name, missing] of [
        ['occurred_on', !record.occurred_on || record.occurred_on < '1900-01-01' || record.occurred_on > today()],
        ['label', !record.label], ['result', record.kind === 'lab_result' && !record.result]
      ]) {
        if (!missing) continue;
        row.querySelector('[name="' + name + '"]').focus();
        throw new Error('Check the date, name and any required result on entry ' + (index + 1) + '.');
      }
      return record;
    });
  }

  reviewForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    try {
      const decisions = readDecisions();
      if (!decisions.some(row => row.decision === 'verify')) {
        finish({ saved: 0 });
        return;
      }
      if (!reviewForm.elements.confirm_source.checked) {
        reviewForm.elements.confirm_source.focus();
        throw new Error('Confirm that you checked the verified entries against the original.');
      }
      busy(true);
      setStatus('Saving verified entries…');
      finish(await request('confirm', { ...source, review_token: reviewToken, confirm_source: true, entries: decisions }));
    } catch (error) {
      setStatus(error.message);
    } finally {
      busy(false);
    }
  });

  add.addEventListener('click', () => {
    const row = addRow();
    reviewForm.elements.confirm_source.checked = false;
    add.disabled = entries.querySelectorAll('[data-candidate-id=""]').length >= 12;
    row.querySelector('select').focus();
  });
  find('careScanFile').addEventListener('change', event => setFile(event.target.files[0]));
  find('careScanCamera').addEventListener('change', event => setFile(event.target.files[0]));
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', reset);
  dialog.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || pending) return;
    if (button.dataset.scanPick) {
      const input = find(button.dataset.scanPick);
      input.value = '';
      input.click();
    }
    if (button.hasAttribute('data-scan-close')) dialog.close();
    if (button.hasAttribute('data-scan-reset')) {
      reset();
      patient.focus();
    }
  });

  find('careScanView').addEventListener('click', async () => {
    if (!result?.first_entry_id || pending) return;
    const saved = result;
    dialog.close();
    actions.showPanel('timeline');
    await window.PatientExperience?.refreshTimeline();
    window.PatientJourney?.revealCareScan(saved.first_entry_id, saved.child_id);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.scanSourceDocument) {
      if (navigator.onLine) window.PatientConnected?.viewReport(button.dataset.scanSourceDocument, true);
      else DaiAPI.toast('Connect to open the original document.');
    }
    if (!button.hasAttribute('data-care-scan-open')) return;
    if (!state?.user || state.user.guest) return DaiAPI.toast('Sign in to scan and save documents.');
    if (state.offline || !navigator.onLine) return DaiAPI.toast('Connect to the internet to use CareScan.');
    reset();
    dialog.showModal();
    patient.focus();
  });

  window.CareScan = {
    update(next, bridge) {
      state = next;
      actions = bridge;
      const nextProfiles = [{ value: 'mother', name: 'Mother (my record)' }].concat(
        (next.children || []).map(child => ({ value: String(child.id), name: child.name })));
      const changed = nextProfiles.length !== profiles.length ||
        nextProfiles.some((profile, index) => profile.value !== profiles[index].value || profile.name !== profiles[index].name);
      profiles = nextProfiles;
      if (changed && !uploadForm.hidden) updateProfiles();
    }
  };
})();
