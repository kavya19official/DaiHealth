/* Smart Referral Handoff - Doctor UI */
(function() {
  'use strict';

  const api = window.DaiAPI;
  const $ = id => document.getElementById(id);
  const E = window.PatientModel ? window.PatientModel.escape : (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#x27;'}[m])));

  let state = {
    referrals: [],
    currentReferral: null,
    communications: [],
    patients: [],
    facilities: [],
    specialists: [],
    loading: false
  };

  const fmt = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }) : 'Date not recorded';

  const fmtDateTime = value => value ? new Date(value).toLocaleString(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : '';

  const priorityColors = {
    routine: '#10b981',
    urgent: '#f59e0b',
    emergency: '#f43f5e'
  };

  const statusColors = {
    pending: '#6b7280',
    accepted: '#10b981',
    rejected: '#f43f5e',
    completed: '#3b82f6',
    cancelled: '#9ca3af'
  };

  const renderReferrals = () => {
    const container = $('referralsList');
    if (!container) return;

    if (state.loading) {
      container.innerHTML = '<div class="empty">Loading referrals...</div>';
      return;
    }

    if (state.referrals.length === 0) {
      container.innerHTML = '<div class="empty">No referrals found. Create a new referral to get started.</div>';
    } else {
      container.innerHTML = state.referrals.map(ref => renderReferralCard(ref)).join('');
    }

    // Update summary counts
    const pendingCount = state.referrals.filter(r => r.status === 'pending').length;
    const acceptedCount = state.referrals.filter(r => r.status === 'accepted').length;
    const rejectedCount = state.referrals.filter(r => r.status === 'rejected').length;
    const completedCount = state.referrals.filter(r => r.status === 'completed').length;

    if ($('referralPendingCount')) $('referralPendingCount').textContent = pendingCount;
    if ($('referralAcceptedCount')) $('referralAcceptedCount').textContent = acceptedCount;
    if ($('referralRejectedCount')) $('referralRejectedCount').textContent = rejectedCount;
    if ($('referralCompletedCount')) $('referralCompletedCount').textContent = completedCount;

    // Update badge
    if ($('referralBadge')) {
      $('referralBadge').textContent = pendingCount;
      $('referralBadge').style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
  };

  const renderReferralCard = (ref) => {
    const priorityColor = priorityColors[ref.priority] || '#6b7280';
    const statusColor = statusColors[ref.status] || '#6b7280';

    return `
      <div class="referral-card" data-id="${E(ref.id)}">
        <div class="referral-card-header">
          <div class="referral-priority" style="background-color: ${priorityColor}">
            <span class="priority-label">${E(ref.priority)}</span>
          </div>
          <span class="tag" style="background-color: ${statusColor}; color: #fff;">${E(ref.status)}</span>
        </div>
        <div class="referral-card-content">
          <h4 class="referral-card-title">${E(ref.referral_type)} Referral</h4>
          <p class="referral-card-patient">
            <strong>Patient:</strong> ${E(ref.patient_name)}
          </p>
          <p class="referral-card-reason">
            <strong>Reason:</strong> ${E(ref.reason)}
          </p>
          ${ref.diagnosis ? `<p class="referral-card-diagnosis"><strong>Diagnosis:</strong> ${E(ref.diagnosis)}</p>` : ''}
          <p class="referral-card-meta">
            <small>Created: ${E(fmt(ref.created_at))}</small>
            ${ref.receiving_facility_name ? `<small> · To: ${E(ref.receiving_facility_name)}</small>` : ''}
            ${ref.receiving_specialist_name ? `<small> · Specialist: ${E(ref.receiving_specialist_name)}</small>` : ''}
          </p>
        </div>
        <div class="referral-card-actions">
          <button type="button" class="btn btn--sm btn--primary" data-view-referral="${E(ref.id)}">View Details</button>
          ${ref.status === 'pending' && (ref.receiving_facility_id || ref.receiving_specialist_id) ? `
            <button type="button" class="btn btn--sm" data-decision-accept="${E(ref.id)}">Accept</button>
            <button type="button" class="btn btn--sm btn--ghost" data-decision-reject="${E(ref.id)}">Reject</button>
          ` : ''}
          ${ref.status === 'accepted' && !ref.summary_returned ? `
            <button type="button" class="btn btn--sm" data-return-summary="${E(ref.id)}">Return Summary</button>
          ` : ''}
        </div>
      </div>
    `;
  };

  const renderReferralDetail = () => {
    const container = $('referralDetailContent');
    if (!container || !state.currentReferral) return;

    const ref = state.currentReferral;

    container.innerHTML = `
      <div class="referral-detail-section">
        <h3>Referral Information</h3>
        <div class="detail-grid">
          <div><strong>Type:</strong> ${E(ref.referral_type)}</div>
          <div><strong>Priority:</strong> ${E(ref.priority)}</div>
          <div><strong>Status:</strong> ${E(ref.status)}</div>
          <div><strong>Created:</strong> ${E(fmtDateTime(ref.created_at))}</div>
        </div>
      </div>

      <div class="referral-detail-section">
        <h3>Patient Information</h3>
        <div class="detail-grid">
          <div><strong>Name:</strong> ${E(ref.patient_name)}</div>
          ${ref.patient_phone ? `<div><strong>Phone:</strong> ${E(ref.patient_phone)}</div>` : ''}
        </div>
      </div>

      <div class="referral-detail-section">
        <h3>Clinical Details</h3>
        <p><strong>Reason for Referral:</strong></p>
        <p>${E(ref.reason)}</p>
        ${ref.clinical_summary ? `
          <p><strong>Clinical Summary:</strong></p>
          <p>${E(ref.clinical_summary)}</p>
        ` : ''}
        ${ref.diagnosis ? `<p><strong>Diagnosis:</strong> ${E(ref.diagnosis)}</p>` : ''}
        ${ref.icd_code ? `<p><strong>ICD Code:</strong> ${E(ref.icd_code)}</p>` : ''}
        ${ref.urgency_notes ? `
          <p><strong>Urgency Notes:</strong></p>
          <p>${E(ref.urgency_notes)}</p>
        ` : ''}
        ${ref.patient_instructions ? `
          <p><strong>Patient Instructions:</strong></p>
          <p>${E(ref.patient_instructions)}</p>
        ` : ''}
      </div>

      ${ref.decision_notes ? `
        <div class="referral-detail-section">
          <h3>Decision</h3>
          <p>${E(ref.decision_notes)}</p>
          <p><small>Decided: ${E(fmtDateTime(ref.decision_at))}</small></p>
        </div>
      ` : ''}

      ${ref.summary_returned ? `
        <div class="referral-detail-section">
          <h3>Patient Summary</h3>
          <p>${E(ref.summary_content)}</p>
          <p><small>Returned: ${E(fmtDateTime(ref.summary_returned_at))}</small></p>
        </div>
      ` : ''}

      <div class="referral-detail-section">
        <h3>Communication History</h3>
        <div id="referralCommunications">
          ${renderCommunications()}
        </div>
        <div class="communication-form">
          <textarea id="newCommunicationMessage" rows="3" placeholder="Add a message..."></textarea>
          <button type="button" class="btn btn--sm btn--primary" id="addCommunicationBtn">Send Message</button>
        </div>
      </div>
    `;

    // Setup communication form
    $('addCommunicationBtn').onclick = () => addCommunication();
  };

  const renderCommunications = () => {
    if (state.communications.length === 0) {
      return '<p class="empty">No communications yet.</p>';
    }

    return state.communications.map(comm => `
      <div class="communication-item ${comm.is_read ? 'is-read' : 'is-unread'}">
        <div class="communication-header">
          <strong>${E(comm.from_user_name || 'Unknown')}</strong>
          <small>${E(fmtDateTime(comm.created_at))}</small>
        </div>
        <p class="communication-message">${E(comm.message)}</p>
        <span class="communication-type tag tag--info">${E(comm.message_type)}</span>
      </div>
    `).join('');
  };

  const loadReferrals = async (filters = {}) => {
    if (state.loading) return;
    state.loading = true;
    renderReferrals();

    try {
      const queryParams = new URLSearchParams(filters).toString();
      const data = await api.apiRequest('/referrals' + (queryParams ? '?' + queryParams : ''));
      if (data) {
        state.referrals = data.referrals || [];
        renderReferrals();
      }
    } catch (error) {
      console.error('Failed to load referrals:', error);
      api.toast('Failed to load referrals. Please try again.');
    } finally {
      state.loading = false;
    }
  };

  const loadReferralDetail = async (id) => {
    try {
      const data = await api.apiRequest('/referrals/' + encodeURIComponent(id));
      if (data) {
        state.currentReferral = data.referral;
        renderReferralDetail();
        await loadCommunications(id);
      }
    } catch (error) {
      console.error('Failed to load referral detail:', error);
      api.toast('Failed to load referral details. Please try again.');
    }
  };

  const loadCommunications = async (referralId) => {
    try {
      const data = await api.apiRequest('/referrals/' + encodeURIComponent(referralId) + '/communications');
      if (data) {
        state.communications = data.communications || [];
        $('referralCommunications').innerHTML = renderCommunications();
      }
    } catch (error) {
      console.error('Failed to load communications:', error);
    }
  };

  const addCommunication = async () => {
    const message = $('newCommunicationMessage').value.trim();
    if (!message || !state.currentReferral) return;

    try {
      const r = await api.apiRequest('/referrals/' + encodeURIComponent(state.currentReferral.id) + '/communications', {
        method: 'POST',
        body: { message }
      });

      if (r) {
        api.toast('Message sent!');
        $('newCommunicationMessage').value = '';
        await loadCommunications(state.currentReferral.id);
      }
    } catch (error) {
      console.error('Failed to add communication:', error);
      api.toast('Failed to send message. Please try again.');
    }
  };

  const showDecisionDialog = (referralId, decision) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${decision === 'accept' ? 'Accept Referral' : 'Reject Referral'}</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <form id="decisionForm">
            <div class="form-group">
              <label for="decisionNotes">Decision Notes</label>
              <textarea id="decisionNotes" rows="4" placeholder="Please provide reasoning for this decision..."></textarea>
            </div>
            ${decision === 'accept' ? `
              <div class="form-group">
                <label for="appointmentDate">Schedule Appointment (Optional)</label>
                <input type="date" id="appointmentDate">
              </div>
            ` : ''}
            <button type="submit" class="btn btn--primary">${decision === 'accept' ? 'Accept' : 'Reject'}</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('#decisionForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const notes = document.getElementById('decisionNotes').value;
      const appointmentDate = decision === 'accept' ? document.getElementById('appointmentDate').value : null;

      try {
        const r = await api.apiRequest('/referrals/' + encodeURIComponent(referralId) + '/decision', {
          method: 'PATCH',
          body: {
            status: decision === 'accept' ? 'accepted' : 'rejected',
            decision_notes: notes,
            appointment_date: appointmentDate || null
          }
        });

        if (r) {
          api.toast(`Referral ${decision}ed successfully!`);
          modal.remove();
          await loadReferrals();
        }
      } catch (error) {
        console.error('Failed to submit decision:', error);
        api.toast('Failed to submit decision. Please try again.');
      }
    };

    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

  const showReturnSummaryDialog = (referralId) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Return Patient Summary</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <form id="summaryForm">
            <div class="form-group">
              <label for="summaryContent">Summary Content</label>
              <textarea id="summaryContent" rows="8" placeholder="Provide a summary of the patient's visit, findings, and recommendations..."></textarea>
            </div>
            <button type="submit" class="btn btn--primary">Return Summary</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('#summaryForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const summaryContent = document.getElementById('summaryContent').value;

      if (!summaryContent.trim()) {
        api.toast('Please provide summary content.');
        return;
      }

      try {
        const r = await api.apiRequest('/referrals/' + encodeURIComponent(referralId) + '/summary', {
          method: 'POST',
          body: { summary_content: summaryContent }
        });

        if (r) {
          api.toast('Summary returned successfully!');
          modal.remove();
          await loadReferrals();
        }
      } catch (error) {
        console.error('Failed to return summary:', error);
        api.toast('Failed to return summary. Please try again.');
      }
    };

    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

  const showCreateReferralDialog = () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Create New Referral</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <form id="createReferralForm">
            <div class="form-group">
              <label for="referralPatient">Patient *</label>
              <select id="referralPatient" required>
                <option value="">Select patient...</option>
                ${state.patients.map(p => `<option value="${p.id}">${E(p.full_name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="referralType">Referral Type</label>
              <select id="referralType" required>
                <option value="">Select type...</option>
                <option value="hospital">Hospital</option>
                <option value="specialist">Specialist</option>
                <option value="lab">Laboratory</option>
                <option value="nicu">NICU</option>
                <option value="radiology">Radiology</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label for="referralPriority">Priority</label>
              <select id="referralPriority">
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div class="form-group">
              <label for="referralReason">Reason for Referral *</label>
              <textarea id="referralReason" rows="3" required placeholder="Explain why this referral is needed..."></textarea>
            </div>
            <div class="form-group">
              <label for="referralDiagnosis">Diagnosis</label>
              <input type="text" id="referralDiagnosis" placeholder="e.g., Gestational diabetes">
            </div>
            <div class="form-group">
              <label for="referralClinicalSummary">Clinical Summary</label>
              <textarea id="referralClinicalSummary" rows="4" placeholder="Relevant clinical information..."></textarea>
            </div>
            <div class="form-group">
              <label for="referralUrgencyNotes">Urgency Notes</label>
              <textarea id="referralUrgencyNotes" rows="2" placeholder="Any urgency-related information..."></textarea>
            </div>
            <div class="form-group">
              <label for="referralPatientInstructions">Patient Instructions</label>
              <textarea id="referralPatientInstructions" rows="2" placeholder="Instructions for the patient..."></textarea>
            </div>
            <button type="submit" class="btn btn--primary">Create Referral</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('#createReferralForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        referral_type: document.getElementById('referralType').value,
        priority: document.getElementById('referralPriority').value,
        reason: document.getElementById('referralReason').value,
        diagnosis: document.getElementById('referralDiagnosis').value || null,
        clinical_summary: document.getElementById('referralClinicalSummary').value || null,
        urgency_notes: document.getElementById('referralUrgencyNotes').value || null,
        patient_instructions: document.getElementById('referralPatientInstructions').value || null,
        patient_id: parseInt(document.getElementById('referralPatient').value, 10)
      };

      try {
        const r = await api.apiRequest('/referrals', {
          method: 'POST',
          body: payload
        });

        if (r) {
          api.toast('Referral created successfully!');
          modal.remove();
          await loadReferrals();
        }
      } catch (error) {
        console.error('Failed to create referral:', error);
        api.toast('Failed to create referral. Please try again.');
      }
    };

    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

  const setup = () => {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.viewReferral) {
        e.preventDefault();
        await loadReferralDetail(btn.dataset.viewReferral);
        $('referralDetailCard').hidden = false;
      }

      if (btn.dataset.decisionAccept) {
        e.preventDefault();
        showDecisionDialog(btn.dataset.decisionAccept, 'accept');
      }

      if (btn.dataset.decisionReject) {
        e.preventDefault();
        showDecisionDialog(btn.dataset.decisionReject, 'reject');
      }

      if (btn.dataset.returnSummary) {
        e.preventDefault();
        showReturnSummaryDialog(btn.dataset.returnSummary);
      }
    });

    document.addEventListener('change', async (e) => {
      if (e.target.id === 'referralStatusFilter' || e.target.id === 'referralTypeFilter') {
        const status = $('referralStatusFilter').value;
        const type = $('referralTypeFilter').value;
        await loadReferrals({ status, type });
      }
    });
  };

  // Public API
  window.SmartReferralHandoff = {
    load: loadReferrals,
    loadDetail: loadReferralDetail,
    create: showCreateReferralDialog,
    getState: () => state
  };

  // Auto-initialize if the container exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setup();
      if ($('referralsList')) loadReferrals();
    });
  } else {
    setup();
    if ($('referralsList')) loadReferrals();
  }

})();
