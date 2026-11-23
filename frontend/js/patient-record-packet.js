(function () {
  'use strict';

  const patientEntry = document.querySelector('[data-create-record-packet]');
  const doctorEntry = document.querySelector('[data-scan-record-packet]');
  const phoneEntry = doctorEntry?.hasAttribute('data-open-record-link');
  const phoneToken = phoneEntry ? location.hash.slice(1) : '';
  if (phoneEntry) history.replaceState(null, '', location.pathname);
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
  if (!patientEntry && !doctorEntry) return;

  const apiBase = window.DaiAPI.API_BASE;
  function formatDate(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
  }
  const codePattern = /^dai-record:v1:[A-Za-z0-9_-]{43}$/;

  function scanCode(value) {
    if (codePattern.test(value || '')) return value;
    try {
      const url = new URL(value);
      const token = url.hash.slice(1);
      return url.origin === location.origin && url.pathname === '/record-packet.html' &&
        tokenPattern.test(token) ? 'dai-record:v1:' + token : null;
    } catch {
      return null;
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = Error(data.error || 'Sign in and check your connection before trying again.');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function post(path, value) {
    return request(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
    });
  }

  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function modal(title) {
    const dialog = document.createElement('dialog');
    dialog.className = 'record-packet-dialog';
    const heading = element('h2', title);
    heading.id = 'record-packet-heading';
    dialog.setAttribute('aria-labelledby', heading.id);
    const close = element('button', 'Close');
    close.type = 'button';
    close.onclick = () => dialog.close();
    const header = document.createElement('header');
    header.append(heading, close);
    const status = element('p', '');
    status.setAttribute('role', 'status');
    dialog.append(header, status);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    return { dialog, status };
  }

  if (patientEntry) patientEntry.onclick = async () => {
    const { dialog, status } = modal('Share a record packet');
    status.textContent = 'Checking your current sharing permissions…';
    const form = document.createElement('form');
    form.innerHTML = `
      <p>The packet includes your shared clinical summary and the reports you select. Clinic history is included when you have enabled it for the recipient.</p>
      <label>Doctor<select name="recipient" required></select></label>
      <fieldset><legend>Original files to include (up to eight)</legend><div data-packet-reports></div></fieldset>
      <label><input type="checkbox" name="confirm" required> I agree that this doctor may save an offline copy of the selected records.</label>
      <button type="submit">Generate QR</button>`;
    const recipient = form.elements.recipient;
    const reports = form.querySelector('[data-packet-reports]');
    const submit = form.querySelector('button');
    const generated = document.createElement('section');
    const active = document.createElement('section');
    let ticket = 0;
    let limit = 8;

    async function refreshShares() {
      const data = await request('/patient/record-packets');
      if (!dialog.open) return;
      active.replaceChildren(element('h3', 'Active QR codes'));
      for (const packet of data.packets) {
        const row = element('div', packet.doctor_name + ' · expires ' + formatDate(packet.expires_at) + ' ');
        const revoke = element('button', 'Revoke QR');
        revoke.type = 'button';
        revoke.onclick = async () => {
          revoke.disabled = true;
          try {
            await request('/patient/record-packets/' + packet.id, { method: 'DELETE' });
            if (generated.dataset.id === String(packet.id)) generated.replaceChildren();
            row.remove();
            status.textContent = 'QR revoked. Copies already downloaded remain on the recipient’s device.';
          } catch (error) {
            status.textContent = error.message;
            revoke.disabled = false;
          }
        };
        row.append(revoke);
        active.append(row);
      }
      return data;
    }

    async function loadReports() {
      const check = ++ticket;
      submit.disabled = true;
      reports.replaceChildren(element('p', 'Loading shared files…'));
      try {
        const data = await request('/patient/record-packets/reports/' + recipient.value);
        if (check !== ticket || !dialog.open) return;
        reports.replaceChildren();
        for (const report of data.reports) {
          const label = element('label', '');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'report';
          input.value = report.id;
          label.append(input, document.createTextNode(' ' + report.title));
          reports.append(label);
        }
        if (!data.reports.length) reports.append(element('p', 'No eligible reports currently shared with this doctor. You can still share the summary.'));
        submit.disabled = false;
      } catch (error) {
        if (check === ticket) reports.replaceChildren(element('p', error.message));
      }
    }

    try {
      const data = await refreshShares();
      if (!data) return;
      dialog.append(active);
      if (!data.recipients.length) {
        status.textContent = 'Share your clinical summary with a connected, verified doctor first.';
        return;
      }
      limit = data.max_reports;
      for (const doctor of data.recipients) {
        const option = element('option', doctor.name);
        option.value = doctor.id;
        recipient.append(option);
      }
      dialog.insertBefore(form, active);
      dialog.insertBefore(generated, active);
      status.textContent = '';
      recipient.onchange = loadReports;
      void loadReports();
    } catch (error) {
      status.textContent = error.message;
    }

    form.onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(form);
      const ids = data.getAll('report').map(Number);
      if (ids.length > limit) {
        status.textContent = 'Select up to ' + limit + ' original files.';
        return;
      }
      submit.disabled = recipient.disabled = true;
      form.elements.confirm.disabled = true;
      try {
        const result = await post('/patient/record-packets', {
          doctor_id: Number(data.get('recipient')), document_ids: ids, confirmed: data.has('confirm')
        });
        if (!dialog.open) return;
        const qr = document.createElement('img');
        qr.src = result.qr;
        qr.alt = 'Patient record packet QR code';
        const manual = element('label', 'Code for manual entry');
        const input = document.createElement('input');
        input.readOnly = true;
        input.value = result.code;
        manual.append(input);
        generated.dataset.id = result.id;
        generated.replaceChildren(qr, manual, element('p', 'Expires ' + formatDate(result.expires_at)));
        status.textContent = result.phone_reachable
          ? 'Have the doctor scan this QR with their phone Camera and tap the link.'
          : 'This local QR opens on your computer. Generate it on the hosted DaiHealth site to use a phone Camera.';
        form.elements.confirm.checked = false;
        await refreshShares();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = recipient.disabled = form.elements.confirm.disabled = false;
      }
    };
  };

  function packetLines(packet) {
    const p = packet.profile;
    const lines = ['DAIHEALTH · SHARED PATIENT RECORD', 'Patient: ' + p.name, 'Captured: ' + formatDate(packet.captured_at)];
    if (p.stage) lines.push('Care stage: ' + p.stage);
    lines.push('Offline snapshot. Check the live chart for updates.', '', 'RECENT MEASUREMENTS');
    let readings = 0;
    for (const metric of p.measurements) {
      for (const [key, source] of [['clinical', 'Clinical summary'], ['patient_reported', 'Patient reported']]) {
        for (const reading of metric[key]) {
          lines.push(metric.label + ': ' + reading.value + (reading.diastolic == null ? '' : '/' + reading.diastolic) +
            ' ' + metric.unit + ' · ' + (reading.date ? formatDate(reading.date) : 'Date unavailable') + ' · ' + source);
          readings++;
        }
      }
    }
    if (!readings) lines.push('No measurements in the shared summary.');
    lines.push('', 'CARE PLANS');
    for (const plan of p.care_plans) lines.push(plan.title + ' · ' + formatDate(plan.created_at), plan.description);
    if (!p.care_plans.length) lines.push('No care plans in the shared summary.');
    if (p.history) {
      lines.push('', 'SHARED CLINICAL HISTORY');
      for (const [label, value] of Object.entries(p.history.fields)) {
        if (value != null && value !== '') lines.push(label.replaceAll('_', ' ') + ': ' + value);
      }
      for (const visit of p.history.visits) {
        lines.push([visit.visit_date, visit.facility, visit.doctor].filter(Boolean).join(' · '));
      }
    }
    lines.push('', 'SELECTED ORIGINAL FILES');
    for (const report of packet.reports) lines.push(report.title + ' · ' + report.filename);
    if (!packet.reports.length) lines.push('No original files included.');
    return lines;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function openScanner(initialCode) {
    const { dialog, status } = modal('Scan a patient record QR');
    const form = document.createElement('form');
    form.innerHTML = `
      <p>Open a QR issued to you by the patient. Download the PDF or complete packet to use it offline.</p>
      <div class="record-packet-actions">
        <button type="button" data-packet-camera>Start camera</button>
        <label>Scan a QR image<input type="file" name="image" accept="image/*"></label>
      </div>
      <video playsinline muted autoplay hidden></video>
      <label>Or enter the patient’s code<input name="code" autocomplete="off" spellcheck="false" required maxlength="57"></label>
      <button type="submit">Open record packet</button>`;
    const result = document.createElement('section');
    dialog.append(form, result);
    const video = form.querySelector('video');
    const camera = form.querySelector('[data-packet-camera]');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stream, timer, cameraTicket = 0;
    let busy = false;

    function stopCamera() {
      cameraTicket++;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
      video.hidden = true;
      camera.textContent = 'Start camera';
      camera.disabled = false;
    }

    function decode(source, width, height) {
      const scale = Math.min(1, 1600 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(pixels.data, pixels.width, pixels.height)?.data;
    }

    function scanFrame() {
      if (!stream || !dialog.open) return;
      if (video.videoWidth && video.videoHeight) {
        const code = scanCode(decode(video, video.videoWidth, video.videoHeight));
        if (codePattern.test(code || '')) {
          form.elements.code.value = code;
          void redeem(code);
          return;
        }
      }
      timer = setTimeout(scanFrame, 300);
    }

    camera.onclick = async () => {
      if (stream) { stopCamera(); return; }
      const ticket = ++cameraTicket;
      camera.disabled = true;
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (!dialog.open || ticket !== cameraTicket) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        stream = media;
        video.srcObject = media;
        video.hidden = false;
        camera.textContent = 'Stop camera';
        status.textContent = 'Point the camera at the patient’s record QR.';
        scanFrame();
      } catch {
        stopCamera();
        status.textContent = 'Camera unavailable. Choose a QR image or paste the patient’s code.';
      } finally {
        camera.disabled = false;
      }
    };

    form.elements.image.onchange = async () => {
      const file = form.elements.image.files[0];
      form.elements.image.value = '';
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        status.textContent = 'Choose a QR image smaller than 12 MB.';
        return;
      }
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
        const code = scanCode(decode(bitmap, bitmap.width, bitmap.height));
        if (!dialog.open) return;
        if (!codePattern.test(code || '')) throw Error('Invalid QR');
        form.elements.code.value = code;
        await redeem(code);
      } catch {
        status.textContent = 'No DaiHealth record QR found in that image.';
      } finally {
        bitmap?.close();
      }
    };

    function visibility() {
      if (document.hidden) stopCamera();
    }
    document.addEventListener('visibilitychange', visibility);
    dialog.addEventListener('close', () => {
      stopCamera();
      document.removeEventListener('visibilitychange', visibility);
    }, { once: true });

    form.onsubmit = event => {
      event.preventDefault();
      void redeem(form.elements.code.value.trim());
    };

    async function redeem(code) {
      if (busy) return;
      if (!codePattern.test(code)) {
        status.textContent = 'Scan or enter a valid DaiHealth patient record QR.';
        return;
      }
      stopCamera();
      busy = true;
      result.replaceChildren();
      status.textContent = 'Checking the patient’s sharing permissions…';
      try {
        const packet = await post('/doctor/record-packets/redeem', { code });
        if (!dialog.open) return;
        result.append(element('h3', packet.profile.name));
        result.append(element('p', packet.reports.length + ' selected original files · expires ' + formatDate(packet.expires_at)));
        const preview = element('pre', packetLines(packet).join('\n'));
        result.append(preview);
        for (const [label, archive] of [['Download profile PDF', false], ['Download offline packet (ZIP)', true]]) {
          const button = element('button', label);
          button.type = 'button';
          button.onclick = () => exportPacket(code, archive);
          result.append(button);
        }
        status.textContent = packet.omitted_reports ? 'Some selected files are no longer available.' : 'Record packet ready.';
      } catch (error) {
        status.textContent = error.message;
        if (error.status === 401 || error.status === 403) {
          const signIn = element('a', 'Sign in as doctor');
          signIn.href = '/auth.html?role=doctor#record-packet=' + code.slice('dai-record:v1:'.length);
          result.append(signIn);
        }
      } finally {
        busy = false;
      }
    }

    async function exportPacket(code, archive) {
      if (busy) return;
      busy = true;
      const controls = [...result.querySelectorAll('button')];
      controls.forEach(button => { button.disabled = true; });
      status.textContent = 'Checking access and preparing your download…';
      try {
        const packet = await post('/doctor/record-packets/redeem', { code });
        const pdf = await window.PrescriptionPDF.create(packetLines(packet));
        if (!dialog.open) return;
        if (archive) {
          const { zipSync } = await import('../vendor/three/examples/jsm/libs/fflate.module.js');
          const files = { 'patient-profile.pdf': new Uint8Array(await pdf.arrayBuffer()) };
          for (const report of packet.reports) {
            const response = await fetch(apiBase + '/documents/' + encodeURIComponent(report.id) + '/download', {
              credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000)
            });
            if (!response.ok) throw Error('A selected original could not be downloaded. Refresh the packet and try again.');
            const name = report.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'original';
            files['reports/' + report.id + '-' + name] = new Uint8Array(await response.arrayBuffer());
            if (!dialog.open) return;
          }
          download(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'dai-patient-record.zip');
        } else {
          download(pdf, 'dai-patient-profile.pdf');
        }
        status.textContent = 'Download ready. Keep the offline copy private.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        controls.forEach(button => { button.disabled = false; });
        busy = false;
      }
    }

    if (initialCode) {
      form.elements.code.value = initialCode;
      form.hidden = true;
      void redeem(initialCode);
    }
  }

  if (doctorEntry) doctorEntry.onclick = () => openScanner();
  if (phoneEntry && tokenPattern.test(phoneToken)) {
    doctorEntry.onclick = () => openScanner('dai-record:v1:' + phoneToken);
    doctorEntry.click();
  }
})();
