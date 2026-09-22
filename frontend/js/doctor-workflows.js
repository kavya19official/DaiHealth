(function () {
  'use strict';
  var api = window.DaiAPI;
  var state = null;
  var selectedPatientId = null;
  var root = document.getElementById('panel-clinical-review');
  if (!api || !root) return;

  var demoState = {
    doctor: {name:'Dr. S. Kumar'},
    patients: [
      {id:'P-1001',name:'Asha Nair',program:'Maternal care',stage:'Trimester 2',openGapCount:2,openGaps:[{eventLabel:'Haemoglobin recheck',reason:'Expected report not found',status:'open'},{eventLabel:'Follow-up visit',reason:'Due in 3 days',status:'upcoming'}]},
      {id:'P-1002',name:'Meera Joshi',program:'Maternal care',stage:'Trimester 3',openGapCount:3,doctorPriorityFlag:{active:true},openGaps:[{eventLabel:'Glucose tolerance test',reason:'Result overdue',status:'overdue'},{eventLabel:'Birth-plan readiness',reason:'Facility confirmation pending',status:'open'}]}
    ],
    consultationBrief:{appointmentId:'DEMO-A2',status:'pending_review',facts:[{label:'Last consultation',value:'12 Sep 2026',source:'Visit record'},{label:'Uploaded report',value:'Anomaly scan',source:'Document store'},{label:'Current stage',value:'Trimester 3',source:'Care timeline'}],flags:[{label:'Missing glucose-test result',detail:'Expected pathway document not found'},{label:'Referral reference needs review',detail:'Referenced scan is not attached'}]},
    drafts:[{id:'D-501',type:'Referral letter',language:'English',status:'pending_review',body:'Draft referral letter assembled from reviewed patient facts.'},{id:'D-502',type:'Patient handout',language:'Hindi',status:'draft',body:'Antenatal follow-up instructions based on approved hospital content.'},{id:'D-503',type:'Department summary',language:'English',status:'approved',body:'Operational follow-up summary ready for finalization.'}],
    audit:[{action:'brief_generated',actor:'DAI assistant',entityId:'DEMO-A2',timestamp:new Date().toISOString()},{action:'priority_updated',actor:'Dr. S. Kumar',entityId:'P-1002',timestamp:new Date(Date.now()-3600000).toISOString()},{action:'draft_created',actor:'Dr. S. Kumar',entityId:'D-501',timestamp:new Date(Date.now()-7200000).toISOString()}]
  };

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function label(value) { return String(value || '').replaceAll('_', ' '); }
  function selectedPatient() {
    return (state && state.patients || []).find(function (p) { return p.id === selectedPatientId; }) || (state && state.patients || [])[0];
  }
  function updateState(result) {
    if (result && result.state) state = result.state;
    if (!selectedPatientId && state && state.patients.length) selectedPatientId = state.patients[0].id;
    render();
  }
  async function load() {
    var data = await api.apiRequest('/doctor-portal/state');
    state = data || JSON.parse(JSON.stringify(demoState));
    if (!data) el('opsStatus').textContent = 'Demo clinical review data · human review required';
    if (!selectedPatientId && state.patients.length) selectedPatientId = state.patients[0].id;
    render();
  }
  async function post(path, body) {
    var result = await api.apiRequest(path, {method:'POST', body:Object.assign({actor:(state.doctor && state.doctor.name) || 'Dr. S. Kumar'}, body || {})});
    if (result) {
      updateState(result);
      api.toast(result.message || 'Action recorded in the audit log');
      return;
    }
    // Complete local demo behavior when the database/backend is unavailable.
    var priorityMatch = path.match(/patients\/([^/]+)\/priority/);
    var draftMatch = path.match(/drafts\/([^/]+)\/(approve|reject|finalize)/);
    if (priorityMatch) {
      var patient = state.patients.find(function (p) { return p.id === decodeURIComponent(priorityMatch[1]); });
      if (patient) patient.doctorPriorityFlag = body.active ? {active:true,notes:body.notes} : null;
    } else if (path.indexOf('/brief/review') > -1) state.consultationBrief.status = 'reviewed';
    else if (path.indexOf('/brief/reject') > -1) state.consultationBrief.status = 'needs_correction';
    else if (path === '/doctor-portal/drafts') state.drafts.unshift({id:'D-'+Date.now(),type:'Referral letter',language:'English',status:'draft',body:'Demo draft generated from reviewed patient facts.'});
    else if (draftMatch) {
      var draft = state.drafts.find(function (d) { return d.id === decodeURIComponent(draftMatch[1]); });
      if (draft) draft.status = draftMatch[2] === 'approve' ? 'approved' : draftMatch[2] === 'reject' ? 'rejected' : 'published';
    }
    state.audit.unshift({action:'demo_action_recorded',actor:'Dr. S. Kumar',entityId:'Local demo',timestamp:new Date().toISOString()});
    render();
    api.toast('Demo action recorded in the audit log');
  }
  function renderMetrics() {
    var patients = state.patients || [];
    var gapCount = patients.reduce(function (sum, p) { return sum + Number(p.openGapCount || 0); }, 0);
    var priorityCount = patients.filter(function (p) { return p.doctorPriorityFlag; }).length;
    var drafts = (state.drafts || []).filter(function (d) { return d.status === 'draft' || d.status === 'pending_review'; }).length;
    el('opsMetrics').innerHTML = [
      ['Assigned patients', patients.length, 'Current doctor panel'],
      ['Open care gaps', gapCount, 'Operational follow-up'],
      ['Doctor priority flags', priorityCount, 'Set manually by doctor'],
      ['Items to review', drafts + (state.consultationBrief && state.consultationBrief.status === 'pending_review' ? 1 : 0), 'Briefs and drafts']
    ].map(function (m) {
      return '<div class="card ops-metric"><span>' + m[0] + '</span><b>' + m[1] + '</b><small>' + m[2] + '</small></div>';
    }).join('');
  }
  function renderPatients() {
    var patients = state.patients || [];
    el('opsPatients').innerHTML = patients.map(function (p) {
      var active = p.id === selectedPatientId ? ' is-selected' : '';
      return '<button type="button" class="ops-patient' + active + '" data-select-patient="' + esc(p.id) + '">' +
        '<span><b>' + esc(p.name) + '</b><small>' + esc(p.id) + ' · ' + Number(p.openGapCount || 0) + ' open gaps</small></span>' +
        '<span class="tag ' + (p.doctorPriorityFlag ? 'tag--due' : 'tag--info') + '">' + (p.doctorPriorityFlag ? 'priority' : 'routine') + '</span></button>';
    }).join('') || '<div class="empty">No assigned patients.</div>';

    var p = selectedPatient();
    if (!p) { el('opsPatientDetail').innerHTML = '<div class="empty">Select a patient.</div>'; return; }
    var gaps = p.openGaps || [];
    el('opsPatientDetail').innerHTML = '<div class="section-head"><div><div class="section-title">' + esc(p.name) + '</div><div class="muted">' + esc(p.id) + ' · ' + esc(p.program || p.stage || 'Continuity pathway') + '</div></div>' +
      '<span class="tag ' + (p.doctorPriorityFlag ? 'tag--due' : 'tag--info') + '">' + (p.doctorPriorityFlag ? 'Doctor-set priority' : 'No manual priority') + '</span></div>' +
      '<div class="ops-actions"><button class="btn btn--primary btn--sm" data-action="set-priority">Set priority</button><button class="btn btn--ghost btn--sm" data-action="clear-priority">Clear priority</button></div>' +
      '<div class="ops-gap-list">' + (gaps.map(function (g) { return '<div class="list-row"><div><b>' + esc(g.eventLabel || g.label || g.event) + '</b><small>' + esc(g.reason || g.status || 'Follow-up required') + '</small></div><span class="tag tag--pending">' + esc(g.status || 'open') + '</span></div>'; }).join('') || '<div class="empty">No open care gaps.</div>') + '</div>';
  }
  function renderBrief() {
    var brief = state.consultationBrief || {};
    el('opsBriefState').textContent = label(brief.status || 'pending review');
    el('opsBriefFacts').innerHTML = (brief.facts || []).map(function (f) {
      return '<div class="list-row"><div><b>' + esc(f.label || f.name) + '</b><small>' + esc(f.value) + (f.source ? ' · ' + esc(f.source) : '') + '</small></div></div>';
    }).join('') || '<div class="empty">No extracted facts.</div>';
    el('opsBriefFlags').innerHTML = (brief.flags || brief.missingOrInconsistent || []).map(function (f) {
      return '<div class="list-row"><div><b>' + esc(f.label || f.title || f) + '</b><small>' + esc(f.detail || f.reason || 'Requires human review') + '</small></div></div>';
    }).join('') || '<div class="empty">No missing or inconsistent information.</div>';
  }
  function renderDrafts() {
    el('opsDrafts').innerHTML = (state.drafts || []).map(function (d) {
      var approve = d.status === 'draft' || d.status === 'pending_review';
      var finalize = d.status === 'approved';
      return '<article class="ops-draft"><div><b>' + esc(d.type) + '</b><small>' + esc(d.id) + ' · ' + esc(d.language || 'English') + '</small></div><span class="tag tag--info">' + esc(label(d.status)) + '</span><p>' + esc(d.body) + '</p><div class="ops-actions">' +
        (approve ? '<button class="btn btn--primary btn--sm" data-draft="' + esc(d.id) + '" data-action="approve-draft">Approve</button>' : '') +
        (finalize ? '<button class="btn btn--primary btn--sm" data-draft="' + esc(d.id) + '" data-action="finalize-draft">Finalize</button>' : '') +
        '<button class="btn btn--ghost btn--sm" data-draft="' + esc(d.id) + '" data-action="reject-draft">Reject</button></div></article>';
    }).join('') || '<div class="empty">No drafts available.</div>';
  }
  function renderAudit() {
    el('opsAudit').innerHTML = (state.audit || []).slice(0, 12).map(function (a) {
      return '<div class="list-row"><div><b>' + esc(label(a.action)) + '</b><small>' + esc(a.actor) + ' · ' + esc(a.entityId || a.entity || '') + '<br>' + esc(a.timestamp ? new Date(a.timestamp).toLocaleString('en-IN') : '') + '</small></div></div>';
    }).join('') || '<div class="empty">No audit activity.</div>';
  }
  function render() {
    if (!state) return;
    el('opsStatus').textContent = 'Assistive workflow · human review required · every action audited';
    renderMetrics(); renderPatients(); renderBrief(); renderDrafts(); renderAudit();
  }

  root.addEventListener('click', function (event) {
    var patientButton = event.target.closest('[data-select-patient]');
    if (patientButton) { selectedPatientId = patientButton.dataset.selectPatient; renderPatients(); return; }
    var button = event.target.closest('[data-action]');
    if (!button || !state) return;
    var action = button.dataset.action;
    var p = selectedPatient();
    if (action === 'set-priority' || action === 'clear-priority') {
      var notes = window.prompt('Reason for this manual priority change:', action === 'set-priority' ? 'Needs earlier operational follow-up' : 'Follow-up completed');
      if (notes === null) return;
      post('/doctor-portal/patients/' + encodeURIComponent(p.id) + '/priority', {active:action === 'set-priority', notes:notes});
    } else if (action === 'review-brief' || action === 'reject-brief') {
      post('/doctor-portal/consultations/' + encodeURIComponent(state.consultationBrief.appointmentId) + '/brief/' + (action === 'review-brief' ? 'review' : 'reject'));
    } else if (action === 'new-draft') {
      post('/doctor-portal/drafts', {patientId:p && p.id});
    } else if (button.dataset.draft) {
      var draftAction = action === 'approve-draft' ? 'approve' : action === 'finalize-draft' ? 'finalize' : 'reject';
      var reviewNotes = window.prompt('Review note for this draft action:', 'Reviewed by doctor');
      if (reviewNotes === null) return;
      post('/doctor-portal/drafts/' + encodeURIComponent(button.dataset.draft) + '/' + draftAction, {notes:reviewNotes});
    }
  });

  load();
})();
