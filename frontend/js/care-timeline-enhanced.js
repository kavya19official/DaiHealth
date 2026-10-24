/* Enhanced Care Timeline - Patient UI */
(function() {
  'use strict';

  const api = window.DaiAPI;
  const $ = id => document.getElementById(id);
  const E = window.PatientModel ? window.PatientModel.escape : (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#x27;'}[m])));

  let state = {
    milestones: [],
    gestationalAge: null,
    currentStage: null,
    pregnancyStatus: null,
    loading: false,
    error: false
  };

  const fmt = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }) : 'Date not recorded';

  const renderGestationalAge = () => {
    const el = $('gestationalAgeDisplay');
    if (!el) return;

    if (!state.gestationalAge) {
      el.innerHTML = '<span class="stage-unknown">Gestational age unknown - add LMP/EDD in profile</span>';
      return;
    }

    const { weeks, days } = state.gestationalAge;
    el.innerHTML = `<span class="stage-badge">${weeks}w ${days}d</span> <span class="stage-label">${state.currentStage || 'Unknown stage'}</span>`;
  };

  const renderTimeline = () => {
    const container = $('enhancedTimelineList');
    if (!container) return;

    if (state.loading) {
      container.innerHTML = '<div class="empty">Loading your care timeline...</div>';
      return;
    }

    if (state.error) {
      container.innerHTML = '<div class="empty" role="status">Could not load your care timeline. Check your connection and try again. <button type="button" class="link-btn" data-retry-timeline>Retry</button></div>';
      return;
    }

    if (state.milestones.length === 0) {
      container.innerHTML = '<div class="empty">No milestones recorded yet. Add pregnancy dates in your profile.</div>';
      return;
    }

    // Group milestones by stage
    const grouped = state.milestones.reduce((acc, m) => {
      if (!acc[m.stage]) acc[m.stage] = [];
      acc[m.stage].push(m);
      return acc;
    }, {});

    let html = '';
    for (const [stage, milestones] of Object.entries(grouped)) {
      html += `<div class="timeline-stage"><h3 class="timeline-stage-title">${E(stage)}</h3>`;
      html += milestones.map(m => renderMilestone(m)).join('');
      html += '</div>';
    }

    container.innerHTML = html;
  };

  const renderMilestone = (m) => {
    const status = m.status || 'upcoming';
    const statusClass = status === 'completed' ? 'is-completed' : status === 'overdue' ? 'is-overdue' : 'is-upcoming';
    const statusIcon = status === 'completed' ? '✓' : status === 'overdue' ? '!' : '○';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

    return `
      <div class="timeline-item ${statusClass}" data-id="${E(m.id)}">
        <div class="timeline-item-marker">
          <span class="timeline-item-icon">${statusIcon}</span>
        </div>
        <div class="timeline-item-content">
          <div class="timeline-item-header">
            <strong class="timeline-item-title">${E(m.title)}</strong>
            <span class="timeline-item-status tag tag--${status === 'completed' ? 'ok' : status === 'overdue' ? 'pending' : 'info'}">${E(statusLabel)}</span>
          </div>
          <div class="timeline-item-meta">
            <span class="timeline-item-date">${E(fmt(m.due_date))}</span>
            ${m.edit_count > 0 ? `<span class="timeline-item-edits" title="Edited by clinician">${m.edit_count} edit(s)</span>` : ''}
          </div>
          ${m.guidance ? `<p class="timeline-item-guidance">${E(m.guidance)}</p>` : ''}
          ${m.verified_facility_name ? `<p class="timeline-item-verification">Verified at: ${E(m.verified_facility_name)}</p>` : ''}
          ${status !== 'completed' ? `
            <div class="timeline-item-actions">
              <button type="button" class="btn btn--sm btn--primary" data-complete="${E(m.id)}">Mark done</button>
              ${m.edit_count > 0 ? `<button type="button" class="link-btn" data-view-edits="${E(m.id)}">View edit history</button>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  const loadTimeline = async () => {
    if (state.loading) return;
    state.loading = true;
    state.error = false;
    renderTimeline();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const data = await api.apiRequest('/timeline/enhanced', { signal: controller.signal });
      if (data) {
        state.milestones = data.milestones || [];
        state.gestationalAge = data.gestational_age;
        state.currentStage = data.current_stage;
        state.pregnancyStatus = data.pregnancy_status;
        renderGestationalAge();
      } else {
        state.error = true;
      }
    } catch (error) {
      state.error = true;
      console.error('Failed to load timeline:', error);
      api.toast('Failed to load your care timeline. Please try again.');
    } finally {
      clearTimeout(timeout);
      state.loading = false;
      renderTimeline();
    }
  };

  const completeMilestone = async (id) => {
    try {
      const r = await api.apiRequest('/timeline/' + encodeURIComponent(id) + '/complete-verified', {
        method: 'PATCH',
        body: {
          completion_verification: 'self_reported'
        }
      });

      if (r) {
        api.toast('Milestone marked complete!');
        await loadTimeline();
      }
    } catch (error) {
      console.error('Failed to complete milestone:', error);
      api.toast('Failed to mark milestone complete. Please try again.');
    }
  };

  const viewEditHistory = async (id) => {
    try {
      const data = await api.apiRequest('/timeline/' + encodeURIComponent(id) + '/edits');
      if (data && data.edits) {
        const editsHtml = data.edits.map(e => `
          <div class="edit-history-item">
            <div class="edit-history-header">
              <strong>${E(e.edit_type)}</strong>
              <small>${E(new Date(e.created_at).toLocaleString())}</small>
            </div>
            <div class="edit-history-changes">
              ${e.previous_value ? `<p><em>Was:</em> ${E(e.previous_value)}</p>` : ''}
              <p><em>Now:</em> ${E(e.new_value)}</p>
            </div>
            ${e.edited_by_name ? `<p class="edit-history-author">By: ${E(e.edited_by_name)}</p>` : ''}
            ${e.edit_reason ? `<p class="edit-history-reason"><em>Reason:</em> ${E(e.edit_reason)}</p>` : ''}
          </div>
        `).join('');

        const modal = document.createElement('div');
        modal.className = 'modal-overlay care-feature-modal is-open';
        modal.innerHTML = `
          <div class="modal">
            <div class="modal-header">
              <h2>Edit History</h2>
              <button type="button" class="modal-close" aria-label="Close">×</button>
            </div>
            <div class="modal-body">
              ${editsHtml || '<p class="empty">No edit history available.</p>'}
            </div>
          </div>
        `;

        document.body.appendChild(modal);
        modal.querySelector('.modal-close').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
      }
    } catch (error) {
      console.error('Failed to load edit history:', error);
      api.toast('Failed to load edit history. Please try again.');
    }
  };

  const setup = () => {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.hasAttribute('data-retry-timeline')) await loadTimeline();

      if (btn.dataset.complete) {
        e.preventDefault();
        await completeMilestone(btn.dataset.complete);
      }

      if (btn.dataset.viewEdits) {
        e.preventDefault();
        await viewEditHistory(btn.dataset.viewEdits);
      }
    });
  };

  // Public API
  window.PatientCareTimelineEnhanced = {
    load: loadTimeline,
    update: loadTimeline,
    getState: () => state
  };

  document.addEventListener('toggle', event => {
    if (event.target.id === 'timelineRecordDetails' && event.target.open) loadTimeline();
  }, true);

  // Standalone views load immediately; the patient journey loads details on demand.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setup();
      if ($('enhancedTimelineList') && !$('timelineRecordDetails')) loadTimeline();
    });
  } else {
    setup();
    if ($('enhancedTimelineList') && !$('timelineRecordDetails')) loadTimeline();
  }

})();
