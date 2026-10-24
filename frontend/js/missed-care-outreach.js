/* Missed-Care Outreach Queue - Patient & Staff UI */
(function() {
  'use strict';

  const api = window.DaiAPI;
  const $ = id => document.getElementById(id);
  const E = window.PatientModel ? window.PatientModel.escape : (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#x27;'}[m])));

  let state = {
    missedCareItems: [],
    outreachQueue: [],
    currentMissedCareId: null,
    outreachAttempts: [],
    loading: false
  };

  const fmt = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }) : 'Date not recorded';

  const urgencyColors = {
    critical: '#f43f5e',
    high: '#f59e0b',
    medium: '#3b82f6',
    low: '#10b981'
  };

  const urgencyLabels = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  };

  const renderMissedCareItems = () => {
    const container = $('missedCareItemsList');
    if (!container) return;

    if (state.loading) {
      container.innerHTML = '<div class="empty">Loading missed care items...</div>';
      return;
    }

    if (state.missedCareItems.length === 0) {
      container.innerHTML = '<div class="empty">No missed care items. Great job staying on track with your care plan!</div>';
      return;
    }

    container.innerHTML = state.missedCareItems.map(item => renderMissedCareItem(item)).join('');
  };

  const renderMissedCareItem = (item) => {
    const urgencyColor = urgencyColors[item.urgency_level] || '#6b7280';
    const urgencyLabel = urgencyLabels[item.urgency_level] || item.urgency_level;

    return `
      <div class="missed-care-item" data-id="${E(item.id)}">
        <div class="missed-care-item-header">
          <div class="missed-care-item-urgency" style="background-color: ${urgencyColor}">
            <span class="urgency-label">${E(urgencyLabel)}</span>
            <span class="overdue-days">${item.overdue_days}d overdue</span>
          </div>
          <span class="tag tag--${item.status === 'pending' ? 'pending' : item.status === 'resolved' ? 'ok' : 'info'}">${E(item.status)}</span>
        </div>
        <div class="missed-care-item-content">
          <h4 class="missed-care-item-title">${E(item.title)}</h4>
          <p class="missed-care-item-due">Due: ${E(fmt(item.due_date))}</p>
          ${item.access_barriers && item.access_barriers.length > 0 ? `
            <div class="missed-care-item-barriers">
              <strong>Access barriers:</strong>
              <ul>${item.access_barriers.map(b => `<li>${E(b)}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
        <div class="missed-care-item-actions">
          <button type="button" class="btn btn--sm btn--primary" data-reschedule="${E(item.id)}">Reschedule</button>
          <button type="button" class="link-btn" data-mark-resolved="${E(item.id)}">Mark resolved</button>
        </div>
      </div>
    `;
  };

  const renderOutreachQueue = () => {
    const container = $('outreachQueueList');
    if (!container) return;

    if (state.loading) {
      container.innerHTML = '<div class="empty">Loading outreach queue...</div>';
      return;
    }

    if (state.outreachQueue.length === 0) {
      container.innerHTML = '<div class="empty">No patients need follow-up at this time.</div>';
    } else {
      container.innerHTML = state.outreachQueue.map(item => renderQueueItem(item)).join('');
    }

    // Update summary counts
    const criticalCount = state.outreachQueue.filter(i => i.urgency_level === 'critical').length;
    const highCount = state.outreachQueue.filter(i => i.urgency_level === 'high').length;
    const mediumCount = state.outreachQueue.filter(i => i.urgency_level === 'medium').length;
    const lowCount = state.outreachQueue.filter(i => i.urgency_level === 'low').length;

    if ($('outreachCriticalCount')) $('outreachCriticalCount').textContent = criticalCount;
    if ($('outreachHighCount')) $('outreachHighCount').textContent = highCount;
    if ($('outreachMediumCount')) $('outreachMediumCount').textContent = mediumCount;
    if ($('outreachLowCount')) $('outreachLowCount').textContent = lowCount;
  };

  const renderQueueItem = (item) => {
    const urgencyColor = urgencyColors[item.urgency_level] || '#6b7280';
    const urgencyLabel = urgencyLabels[item.urgency_level] || item.urgency_level;

    return `
      <div class="outreach-queue-item" data-id="${E(item.id)}">
        <div class="outreach-queue-priority" style="border-left: 4px solid ${urgencyColor}">
          <div class="priority-badge">${E(urgencyLabel)}</div>
          <div class="priority-score">Score: ${item.priority_score}</div>
        </div>
        <div class="outreach-queue-content">
          <h4 class="outreach-queue-title">${E(item.title)}</h4>
          <p class="outreach-queue-patient">
            <strong>${E(item.full_name)}</strong>
            ${item.phone ? `<span> · ${E(item.phone)}</span>` : ''}
          </p>
          <p class="outreach-queue-due">Due: ${E(fmt(item.due_date))} · ${item.overdue_days}d overdue</p>
          ${item.address ? `<p class="outreach-queue-address">${E(item.address)}</p>` : ''}
          <p class="outreach-queue-attempts">${item.attempt_count} outreach attempt(s) logged</p>
        </div>
        <div class="outreach-queue-actions">
          <button type="button" class="btn btn--sm btn--primary" data-log-attempt="${E(item.id)}">Log attempt</button>
          <button type="button" class="link-btn" data-view-attempts="${E(item.id)}">View history</button>
        </div>
      </div>
    `;
  };

  const renderOutreachAttempts = () => {
    const container = $('outreachAttemptsList');
    if (!container) return;

    if (state.outreachAttempts.length === 0) {
      container.innerHTML = '<div class="empty">No outreach attempts logged yet.</div>';
      return;
    }

    container.innerHTML = state.outreachAttempts.map(attempt => `
      <div class="outreach-attempt-item">
        <div class="outreach-attempt-header">
          <strong>${E(attempt.attempt_type)}</strong>
          <small>${E(new Date(attempt.attempt_date).toLocaleString())}</small>
        </div>
        <div class="outreach-attempt-content">
          <span class="tag tag--${attempt.outcome === 'reached' || attempt.outcome === 'agreed_followup' ? 'ok' : 'pending'}">${E(attempt.outcome)}</span>
          ${attempt.attempted_by_name ? `<p>By: ${E(attempted_by_name)}</p>` : ''}
          ${attempt.notes ? `<p class="attempt-notes">${E(attempt.notes)}</p>` : ''}
          ${attempt.next_action ? `<p class="attempt-next-action"><strong>Next action:</strong> ${E(attempt.next_action)}</p>` : ''}
          ${attempt.next_action_date ? `<p class="attempt-next-date"><strong>Due:</strong> ${E(fmt(attempt.next_action_date))}</p>` : ''}
        </div>
      </div>
    `).join('');
  };

  const loadMissedCareItems = async () => {
    if (state.loading) return;
    state.loading = true;
    renderMissedCareItems();

    try {
      const data = await api.apiRequest('/patient/missed-care');
      if (data) {
        state.missedCareItems = data.missed_care_items || [];
        renderMissedCareItems();
      }
    } catch (error) {
      console.error('Failed to load missed care items:', error);
      api.toast('Failed to load missed care items. Please try again.');
    } finally {
      state.loading = false;
    }
  };

  const loadOutreachQueue = async (filters = {}) => {
    if (state.loading) return;
    state.loading = true;
    renderOutreachQueue();

    try {
      const queryParams = new URLSearchParams(filters).toString();
      const data = await api.apiRequest('/outreach/queue' + (queryParams ? '?' + queryParams : ''));
      if (data) {
        state.outreachQueue = data.queue || [];
        renderOutreachQueue();
      }
    } catch (error) {
      console.error('Failed to load outreach queue:', error);
      api.toast('Failed to load outreach queue. Please try again.');
    } finally {
      state.loading = false;
    }
  };

  const loadOutreachAttempts = async (missedCareId) => {
    try {
      const data = await api.apiRequest('/outreach/' + encodeURIComponent(missedCareId) + '/attempts');
      if (data) {
        state.outreachAttempts = data.attempts || [];
        state.currentMissedCareId = missedCareId;
        renderOutreachAttempts();
      }
    } catch (error) {
      console.error('Failed to load outreach attempts:', error);
      api.toast('Failed to load outreach attempts. Please try again.');
    }
  };

  const markResolved = async (id) => {
    try {
      const r = await api.apiRequest('/outreach/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: { status: 'resolved' }
      });

      if (r) {
        api.toast('Marked as resolved!');
        await loadMissedCareItems();
      }
    } catch (error) {
      console.error('Failed to mark resolved:', error);
      api.toast('Failed to update status. Please try again.');
    }
  };

  const showLogAttemptDialog = (missedCareId) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Log Outreach Attempt</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <form id="outreachAttemptForm">
            <div class="form-group">
              <label for="attemptType">Attempt Type</label>
              <select id="attemptType" required>
                <option value="">Select type...</option>
                <option value="call">Phone call</option>
                <option value="visit">In-person visit</option>
                <option value="message">Message/SMS</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label for="attemptOutcome">Outcome</label>
              <select id="attemptOutcome" required>
                <option value="">Select outcome...</option>
                <option value="no_answer">No answer</option>
                <option value="reached">Reached patient</option>
                <option value="left_message">Left message</option>
                <option value="agreed_followup">Agreed to follow-up</option>
                <option value="declined">Declined</option>
                <option value="wrong_number">Wrong number</option>
                <option value="rescheduled">Rescheduled</option>
              </select>
            </div>
            <div class="form-group">
              <label for="attemptNotes">Notes</label>
              <textarea id="attemptNotes" rows="3" placeholder="Any additional notes..."></textarea>
            </div>
            <div class="form-group">
              <label for="nextAction">Next Action</label>
              <input type="text" id="nextAction" placeholder="e.g., Call back in 3 days">
            </div>
            <div class="form-group">
              <label for="nextActionDate">Next Action Date</label>
              <input type="date" id="nextActionDate">
            </div>
            <button type="submit" class="btn btn--primary">Log Attempt</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('#outreachAttemptForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const attemptType = document.getElementById('attemptType').value;
      const outcome = document.getElementById('attemptOutcome').value;
      const notes = document.getElementById('attemptNotes').value;
      const nextAction = document.getElementById('nextAction').value;
      const nextActionDate = document.getElementById('nextActionDate').value;

      try {
        const r = await api.apiRequest('/outreach/' + encodeURIComponent(missedCareId) + '/attempts', {
          method: 'POST',
          body: {
            attempt_type: attemptType,
            outcome: outcome,
            notes: notes,
            next_action: nextAction,
            next_action_date: nextActionDate
          }
        });

        if (r) {
          api.toast('Outreach attempt logged!');
          modal.remove();
          await loadOutreachQueue();
        }
      } catch (error) {
        console.error('Failed to log attempt:', error);
        api.toast('Failed to log attempt. Please try again.');
      }
    };

    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

  const setup = () => {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.markResolved) {
        e.preventDefault();
        await markResolved(btn.dataset.markResolved);
      }

      if (btn.dataset.logAttempt) {
        e.preventDefault();
        showLogAttemptDialog(btn.dataset.logAttempt);
      }

      if (btn.dataset.viewAttempts) {
        e.preventDefault();
        await loadOutreachAttempts(btn.dataset.viewAttempts);
      }

      if (btn.dataset.reschedule) {
        e.preventDefault();
        // Navigate to appointments page with pre-filled data
        window.location.hash = '#appointments';
        api.toast('Please book a new appointment for this care item.');
      }

      if (btn.id === 'applyOutreachFilters') {
        e.preventDefault();
        const status = document.getElementById('outreachStatusFilter').value;
        const urgency = document.getElementById('outreachUrgencyFilter').value;
        const limit = document.getElementById('outreachLimitFilter').value;
        await loadOutreachQueue({ status, urgency, limit });
      }

      if (btn.id === 'generateMissedCare') {
        e.preventDefault();
        try {
          const r = await api.apiRequest('/outreach/generate', {
            method: 'POST'
          });
          if (r) {
            api.toast(`Generated ${r.milestones_added} milestone and ${r.appointments_added} appointment missed care items.`);
            await loadOutreachQueue();
          }
        } catch (error) {
          console.error('Failed to generate missed care items:', error);
          api.toast('Failed to generate missed care items. You may not have permission.');
        }
      }
    });
  };

  // Public API
  window.PatientMissedCareOutreach = {
    loadMissedCare: loadMissedCareItems,
    loadQueue: loadOutreachQueue,
    loadAttempts: loadOutreachAttempts,
    getState: () => state
  };

  // Auto-initialize if containers exist
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setup();
      if ($('missedCareItemsList')) loadMissedCareItems();
      if ($('outreachQueueList')) loadOutreachQueue();
    });
  } else {
    setup();
    if ($('missedCareItemsList')) loadMissedCareItems();
    if ($('outreachQueueList')) loadOutreachQueue();
  }

})();
