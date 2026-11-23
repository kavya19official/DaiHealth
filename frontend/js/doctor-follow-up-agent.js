(function () {
  'use strict';
  const root = document.getElementById('dwFollowupAgent');
  if (!root) return;
  const status = root.querySelector('[data-followup-status]');
  const refresh = root.querySelector('[data-followup-refresh]');
  const list = root.querySelector('[data-followup-items]');
  const more = root.querySelector('[data-followup-more]');
  const summaries = document.getElementById('dwFollowupSummaries');
  const labels = {
    report_to_review: 'Possible report match',
    visit_to_check: 'Possible appointment match',
    overdue: 'Past due',
    waiting: 'Awaiting due date',
    check_manually: 'Check with patient'
  };
  let cursor = null;
  let busy = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  async function request(path, body) {
    const response = await fetch('/api/doctor/follow-up-agent' + path, {
      method: body ? 'PUT' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw Error(response.status === 403 ? 'The queue is available to verified clinicians.' :
      response.status === 404 ? 'This item changed. Refresh the queue.' : 'Could not complete the request. Try again.');
    return response.json();
  }

  function render(item) {
    const card = element('article', '', 'dw-attention-item');
    const heading = (item.patient_name || 'Patient') + ' · ' + item.title;
    card.append(element('span', labels[item.status], 'dw-eyebrow'), element('h3', heading));
    card.append(element('p', 'Approved visit plan v' + item.version + ' · ' + item.visit_date +
      (item.due_date ? ' · Due ' + item.due_date : '')));
    if (item.note) card.append(element('p', item.note));
    for (const report of item.reports) {
      const link = element('a', 'Open ' + report.title + ' · ' + report.date, 'dw-text-button');
      link.href = '/api/documents/' + encodeURIComponent(report.id) + '/download';
      link.target = '_blank';
      link.rel = 'noopener';
      card.append(link, document.createElement('br'));
    }
    if (item.appointment) {
      card.append(element('p', 'Recorded appointment · ' + item.appointment.date + ' · ' + item.appointment.status));
    }
    if (item.reminder) {
      const draft = element('label', 'Editable reminder draft');
      const text = element('textarea', '');
      text.value = item.reminder;
      text.rows = 3;
      draft.append(text);
      const copy = element('button', 'Copy reminder', 'dw-text-button');
      copy.type = 'button';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(text.value);
          status.textContent = 'Reminder draft copied.';
        } catch {
          text.select();
          status.textContent = 'Use your copy shortcut to copy the selected reminder.';
        }
      };
      card.append(draft, copy);
    }
    const resolve = element('button', 'Mark reviewed', 'dw-primary');
    resolve.type = 'button';
    resolve.onclick = async () => {
      resolve.disabled = true;
      try {
        await request('/' + encodeURIComponent(item.summary_id) + '/review', { item_key: item.key });
        card.remove();
        status.textContent = list.children.length ? 'Marked reviewed.' : 'All items in this view have been reviewed.';
      } catch (error) {
        status.textContent = error.message;
        resolve.disabled = false;
      }
    };
    card.append(resolve);
    return card;
  }

  async function load(append = false) {
    if (busy) return;
    busy = true;
    refresh.disabled = more.disabled = true;
    status.textContent = 'Checking approved visit plans and current evidence…';
    try {
      const data = await request(append ? '?before=' + encodeURIComponent(cursor) : '');
      if (!append) list.replaceChildren();
      list.append(...data.items.map(render));
      cursor = data.next_before;
      more.hidden = cursor == null;
      status.textContent = list.children.length ? 'Confirm possible matches before marking items reviewed.' :
        cursor == null ? 'No open items in the plans checked.' : 'No open items on this page. Older plans are available.';
    } catch (error) {
      list.replaceChildren();
      cursor = null;
      more.hidden = true;
      status.textContent = error.message;
    } finally {
      busy = false;
      refresh.disabled = more.disabled = false;
    }
  }

  refresh.onclick = () => load();
  more.onclick = () => load(true);
  summaries.addEventListener('toggle', () => {
    if (summaries.open) window.VisitSummaryDoctor?.load();
  });
  window.DoctorFollowupAgent = { load };
})();
