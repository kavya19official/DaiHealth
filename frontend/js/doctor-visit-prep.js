(function () {
  'use strict';

  function mount(pane, { api, patientId, alive, addNote }) {
    pane.innerHTML = `
      <div class="dpp-rx-heading">
        <div><h3>Visit Prep Agent</h3><p class="dpp-muted">Review recent shared measurements and care plans before the visit.</p></div>
      </div>
      <label class="dpp-consent" data-prep-ai hidden>
        <input type="checkbox"> The patient agreed to share chart entry categories, dates, and source types with Gemini for prioritization.
      </label>
      <button type="button" class="dw-primary" data-prep-run>Prepare visit</button>
      <p role="status" data-prep-status></p>
      <div data-prep-result hidden>
        <h4>Chart sources</h4>
        <ol data-prep-sources></ol>
        <h4>Questions for the visit</h4>
        <ul data-prep-questions></ul>
        <label>Visit note draft<textarea rows="9" maxlength="10000" data-prep-note></textarea></label>
        <button type="button" class="dw-text-button" data-prep-use>Add to consultation draft</button>
        <label>Patient message draft<textarea rows="4" maxlength="2000" data-prep-message></textarea></label>
        <button type="button" class="dw-text-button" data-prep-copy>Copy message</button>
      </div>`;

    const get = name => pane.querySelector('[data-prep-' + name + ']');
    const consent = get('ai').querySelector('input');
    const run = get('run');
    const note = get('note');
    const message = get('message');
    const status = get('status');
    let dirty = false;
    api('/doctor/visit-prep/config').then(config => {
      if (alive()) get('ai').hidden = !config.ai;
    }).catch(() => {});

    function display(data) {
      const list = get('sources');
      const refs = new Map(data.sources.map((source, index) => [source.id, index + 1]));
      list.replaceChildren();
      for (const source of data.sources) {
        const row = document.createElement('li');
        row.textContent = [source.label + ': ' + source.text, source.date, source.origin].filter(Boolean).join(' · ');
        list.append(row);
      }
      if (!data.sources.length) {
        const row = document.createElement('li');
        row.textContent = 'No recent measurements or care plans in the shared summary.';
        list.append(row);
      }
      const questions = get('questions');
      questions.replaceChildren();
      for (const question of data.questions) {
        const row = document.createElement('li');
        const reference = refs.get(question.sourceId);
        row.textContent = question.text + (reference ? ' [Source ' + reference + ']' : '');
        questions.append(row);
      }
      note.value = data.note;
      message.value = data.message;
      get('result').hidden = false;
      dirty = false;
    }

    run.onclick = async () => {
      if (dirty && !window.confirm('Replace the edited visit prep drafts?')) return;
      run.disabled = true;
      note.disabled = message.disabled = true;
      get('use').disabled = get('copy').disabled = true;
      status.textContent = 'Checking shared records and preparing drafts…';
      try {
        const data = await api('/doctor/patients/' + encodeURIComponent(patientId) + '/visit-prep', {
          method: 'POST', body: { external_consent: consent.checked }
        });
        if (!alive()) return;
        display(data);
        const modes = {
          ai: 'Gemini prioritized the chart sources.',
          local: 'Prepared from the shared chart.',
          fallback: 'Gemini was unavailable. Prepared from the shared chart.',
          rate_limited: 'Gemini was recently used. Prepared from the shared chart.'
        };
        status.textContent = modes[data.mode] + ' Review the drafts before using them.';
        run.textContent = 'Refresh visit prep';
      } catch (error) {
        if (!alive()) return;
        status.textContent = error.message;
        get('result').hidden = true;
        get('sources').replaceChildren();
        get('questions').replaceChildren();
        note.value = message.value = '';
        dirty = false;
      } finally {
        if (alive()) {
          run.disabled = false;
          note.disabled = message.disabled = false;
          get('use').disabled = get('copy').disabled = false;
        }
      }
    };

    note.oninput = message.oninput = () => { dirty = true; };
    get('use').onclick = () => {
      if (!note.value.trim()) {
        status.textContent = 'Add text to the visit note first.';
      } else if (!addNote(note.value.trim())) {
        status.textContent = 'Finish voice processing or make room in the consultation notes first.';
      }
    };
    get('copy').onclick = async () => {
      if (!message.value.trim()) {
        status.textContent = 'Add text to the message draft first.';
        return;
      }
      try {
        await navigator.clipboard.writeText(message.value.trim());
        status.textContent = 'Message draft copied.';
      } catch {
        message.focus();
        message.select();
        status.textContent = 'Use your device’s copy shortcut to copy the selected draft.';
      }
    };
  }

  window.DoctorVisitPrep = { mount };
})();
