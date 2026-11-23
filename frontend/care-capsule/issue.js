(function () {
  'use strict';
  const entry = document.querySelector('[data-issue-capsule]');
  if (!entry) return;
  const labels = {
    allergies: 'Recorded allergies', blood_group: 'Recorded blood group', recorded_risk: 'Last recorded risk level',
    risk_factors: 'Recorded risk factors', pregnancy_week: 'Pregnancy week when issued', vaccines: 'Four most recent recorded vaccine doses'
  };
  const api = window.DaiAPI.API_BASE;
  async function request(path = '', options) {
    const response = await fetch(api + '/patient/care-capsules' + path, {
      credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Sign in as a patient to manage Care Capsules.');
    return data;
  }

  function node(tag, text) {
    const item = document.createElement(tag);
    item.textContent = text;
    return item;
  }

  entry.onclick = async () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'capsule-issuer';
    dialog.setAttribute('aria-label', 'Create a Care Capsule');
    dialog.innerHTML = `
      <div class="capsule-actions"><h2>Create a Care Capsule</h2><button type="button" data-close>Close</button></div>
      <p>Anyone holding the QR can read the fields you select. Keep the paper or saved image private.</p>
      <p role="status"></p>
      <form hidden>
        <label>Record<select name="subject"><option value="">My maternal record</option></select></label>
        <fieldset><legend>Fields to share</legend><div data-fields></div></fieldset>
        <label>Expires in<select name="days"><option>1</option><option selected>7</option><option>30</option></select> days</label>
        <label><input name="confirmed" type="checkbox" required> I agree to share the selected fields in this portable QR.</label>
        <button type="submit">Create capsule QR</button>
      </form>
      <section class="capsule-print-sheet" hidden></section>
      <section data-active></section>
      <p><a href="/care-capsule/index.html" target="_blank" rel="noopener">Open the clinician’s offline verifier</a></p>`;
    const status = dialog.querySelector('[role=status]');
    const form = dialog.querySelector('form');
    const fields = form.querySelector('[data-fields]');
    const active = dialog.querySelector('[data-active]');
    const print = dialog.querySelector('.capsule-print-sheet');
    const submit = form.querySelector('[type=submit]');
    let values = {};
    let generation = 0;

    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      document.body.classList.remove('capsule-print');
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();

    function activeCapsules(capsules) {
      active.replaceChildren(node('h3', 'Active capsules'));
      for (const capsule of capsules) {
        const row = node('div', (capsule.subject === 'child' ? 'Child' : 'Maternal') + ' capsule · expires ' +
          new Date(capsule.expires_at).toLocaleString() + ' ');
        const button = node('button', 'Revoke');
        button.type = 'button';
        button.onclick = async () => {
          button.disabled = true;
          try {
            await request('/' + capsule.id, { method: 'DELETE' });
            row.remove();
            if (print.dataset.id === capsule.id) {
              print.replaceChildren();
              print.hidden = true;
            }
            status.textContent = 'Capsule revoked. Offline verifiers will flag it after their next sync.';
          } catch (error) {
            status.textContent = error.message;
          } finally { button.disabled = false; }
        };
        row.append(button);
        active.append(row);
      }
      if (!capsules.length) active.append(node('p', 'No active capsules.'));
    }

    async function loadFields() {
      const requested = ++generation;
      const child = form.elements.subject.value;
      fields.replaceChildren();
      form.elements.confirmed.checked = false;
      submit.disabled = true;
      status.textContent = 'Loading shareable fields…';
      try {
        const data = await request('/fields' + (child ? '?child_id=' + encodeURIComponent(child) : ''));
        if (!dialog.open || requested !== generation) return;
        values = data.fields;
        let available = 0;
        for (const [name, value] of Object.entries(values)) {
          if (value == null || !Object.hasOwn(labels, name)) continue;
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.name = 'field';
          checkbox.value = name;
          const preview = name === 'vaccines' ? value.map(row => row.code + ' (' + row.date + ')').join(', ') : name === 'risk_factors' ? value.join(', ') : value;
          label.append(checkbox, document.createTextNode(' ' + labels[name] + ' · ' + preview));
          fields.append(label);
          available++;
        }
        status.textContent = available ? '' : 'This record has no shareable fields yet.';
        submit.disabled = !available;
      } catch (error) {
        if (requested === generation) status.textContent = error.message;
      }
    }

    form.elements.subject.onchange = loadFields;
    form.onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(form);
      const selected = Object.fromEntries(data.getAll('field').map(key => [key, values[key]]));
      if (!Object.keys(selected).length) {
        status.textContent = 'Select at least one field.';
        return;
      }
      submit.disabled = form.elements.subject.disabled = true;
      status.textContent = 'Signing your capsule…';
      try {
        const capsule = await request('', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            child_id: data.get('subject') || null, days: Number(data.get('days')), fields: selected,
            confirmed: data.has('confirmed')
          })
        });
        if (!dialog.open) return;
        const image = document.createElement('img');
        image.src = capsule.qr;
        image.alt = 'Signed Care Capsule QR';
        const save = node('a', 'Save QR image');
        save.href = capsule.qr;
        save.download = 'dai-care-capsule.png';
        const button = node('button', 'Print capsule');
        button.onclick = async () => {
          await image.decode();
          if (!dialog.open) return;
          document.body.classList.add('capsule-print');
          window.addEventListener('afterprint', () => document.body.classList.remove('capsule-print'), { once: true });
          window.print();
        };
        print.replaceChildren(node('h3', 'DaiHealth Care Capsule'), image,
          node('p', 'Expires ' + new Date(capsule.expires_at).toLocaleString()),
          node('p', 'Scan with a prepared DaiHealth Care Capsule verifier.'), button, document.createTextNode(' '), save);
        print.dataset.id = capsule.id;
        print.hidden = false;
        form.elements.confirmed.checked = false;
        status.textContent = 'Care Capsule ready.';
        activeCapsules((await request()).capsules);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = form.elements.subject.disabled = false;
      }
    };

    try {
      status.textContent = 'Loading Care Capsule…';
      const data = await request();
      if (!dialog.open) return;
      for (const child of data.children) {
        const option = node('option', child.name);
        option.value = child.id;
        form.elements.subject.append(option);
      }
      activeCapsules(data.capsules);
      form.hidden = false;
      await loadFields();
    } catch (error) {
      status.textContent = error.message;
    }
  };
})();
