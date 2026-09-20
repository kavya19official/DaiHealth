'use strict';

const fs = require('fs');
const path = require('path');

const HOSPITAL_TODAY = '2026-09-20T09:00:00+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'hospital-demo-state.json');

const pathways = {
  maternal: {
    name: 'Maternal continuity',
    events: [
      { id: 'anc-12', stage: 'Trimester 1', type: 'ANC visit', offset: 84, requiredDocs: ['visit_note'] },
      { id: 'anomaly-scan', stage: 'Trimester 2', type: 'Anomaly scan', offset: 140, requiredDocs: ['scan_report'] },
      { id: 'gtt', stage: 'Trimester 2', type: 'Glucose tolerance test', offset: 168, requiredDocs: ['lab_result'] },
      { id: 'birth-plan', stage: 'Trimester 3', type: 'Birth plan readiness', offset: 252, requiredDocs: ['care_plan'] }
    ]
  },
  oncology: {
    name: 'Oncology follow-up',
    events: [
      { id: 'cycle-review', stage: 'Cycle review', type: 'Post-cycle review', offset: 21, requiredDocs: ['visit_note'] },
      { id: 'cbc', stage: 'Investigation', type: 'CBC lab upload', offset: 28, requiredDocs: ['lab_result'] },
      { id: 'scan-review', stage: 'Follow-up imaging', type: 'Follow-up scan filed', offset: 90, requiredDocs: ['imaging_report'] }
    ]
  },
  diabetes: {
    name: 'Diabetes clinic',
    events: [
      { id: 'hba1c', stage: 'Quarterly labs', type: 'HbA1c result upload', offset: 90, requiredDocs: ['lab_result'] },
      { id: 'foot-check', stage: 'Annual review', type: 'Foot check recorded', offset: 180, requiredDocs: ['visit_note'] },
      { id: 'eye-referral', stage: 'Annual review', type: 'Eye referral letter', offset: 210, requiredDocs: ['referral_letter'] }
    ]
  }
};

const patients = [
  { id: 'P-1001', name: 'Asha Nair', age: 31, program: 'maternal', provider: 'Dr. S. Kumar', stage: 'Trimester 2', pathwayStart: '2026-04-07', lastTouch: '2026-08-28', noShows: 1, phone: '+91 90000 11111', consent: { documents: true, outreach: true, emergencyLocation: true } },
  { id: 'P-1002', name: 'Meera Joshi', age: 28, program: 'maternal', provider: 'Dr. S. Kumar', stage: 'Trimester 3', pathwayStart: '2025-12-10', lastTouch: '2026-08-02', noShows: 3, phone: '+91 90000 22222', consent: { documents: true, outreach: true, emergencyLocation: false } },
  { id: 'P-2030', name: 'Farhan Ali', age: 54, program: 'diabetes', provider: 'Dr. N. Rao', stage: 'Quarterly labs', pathwayStart: '2026-02-08', lastTouch: '2026-08-14', noShows: 2, phone: '+91 90000 33333', consent: { documents: true, outreach: true, emergencyLocation: false } },
  { id: 'P-3091', name: 'Leela Menon', age: 47, program: 'oncology', provider: 'Dr. A. Shah', stage: 'Follow-up imaging', pathwayStart: '2026-05-14', lastTouch: '2026-09-17', noShows: 0, phone: '+91 90000 44444', consent: { documents: true, outreach: false, emergencyLocation: false } },
  { id: 'P-3094', name: 'Ritika Sen', age: 39, program: 'oncology', provider: 'Dr. A. Shah', stage: 'Investigation', pathwayStart: '2026-06-01', lastTouch: '2026-07-24', noShows: 2, phone: '+91 90000 55555', consent: { documents: true, outreach: true, emergencyLocation: false } }
];

const careEvents = [
  { id: 'EV-1', patientId: 'P-1001', type: 'ANC visit', recordedAt: '2026-07-01', source: 'EMR', documentRef: 'visit-4401' },
  { id: 'EV-2', patientId: 'P-1001', type: 'Anomaly scan', recordedAt: '2026-08-25', source: 'Radiology', documentRef: 'scan-8840' },
  { id: 'EV-3', patientId: 'P-1002', type: 'ANC visit', recordedAt: '2026-03-10', source: 'EMR', documentRef: 'visit-4204' },
  { id: 'EV-4', patientId: 'P-1002', type: 'Anomaly scan', recordedAt: '2026-05-01', source: 'Radiology', documentRef: 'scan-8322' },
  { id: 'EV-5', patientId: 'P-2030', type: 'Foot check recorded', recordedAt: '2026-08-08', source: 'EMR', documentRef: 'visit-5180' },
  { id: 'EV-6', patientId: 'P-3091', type: 'Post-cycle review', recordedAt: '2026-06-06', source: 'EMR', documentRef: 'visit-7731' },
  { id: 'EV-7', patientId: 'P-3091', type: 'CBC lab upload', recordedAt: '2026-06-15', source: 'Lab system', documentRef: 'lab-9018' },
  { id: 'EV-8', patientId: 'P-3094', type: 'Post-cycle review', recordedAt: '2026-06-25', source: 'EMR', documentRef: 'visit-7852' }
];

const seedState = {
  gapWork: {},
  doctorPriorityFlags: {
    'P-1002': { active: true, setBy: 'Dr. S. Kumar', label: 'Doctor-set high-priority follow-up', notes: 'Manual flag for closer follow-up before next OPD visit.', updatedAt: HOSPITAL_TODAY }
  },
  consultationBrief: {
    patientId: 'P-1002', appointmentId: 'A-902', status: 'pending_review',
    facts: [
      { id: 'F-1', label: 'Last ANC visit', value: '2026-03-10', source: 'EMR visit-4204', confidence: 'typed/coded', status: 'accepted' },
      { id: 'F-2', label: 'Anomaly scan document', value: 'Uploaded 2026-05-01', source: 'Radiology scan-8322', confidence: 'typed/coded', status: 'accepted' },
      { id: 'F-3', label: 'Referral letter', value: 'Scan planned after 2026-08-15', source: 'OCR doc-ref-192', confidence: '0.82', status: 'pending_review' }
    ],
    flags: [
      { type: 'missing_info', text: 'No glucose tolerance test result found after expected date.', source: 'Gap engine, pathway event gtt' },
      { type: 'inconsistent_info', text: 'Referral letter references a scan not present in document store.', source: 'OCR doc-ref-192' }
    ]
  },
  queue: [
    { id: 'A-902', slot: '09:30', patientId: 'P-1002', status: 'checked_in', waitMins: 18, urgency: 'Staff-set: high-priority follow-up', urgencySetBy: 'Dr. S. Kumar' },
    { id: 'A-903', slot: '09:45', patientId: 'P-3091', status: 'waiting', waitMins: 11, urgency: '', urgencySetBy: '' },
    { id: 'A-904', slot: '10:00', patientId: 'P-2030', status: 'delayed_labs', waitMins: 8, urgency: '', urgencySetBy: '' },
    { id: 'A-905', slot: '10:15', patientId: 'P-1001', status: 'cancelled', waitMins: 0, urgency: '', urgencySetBy: '' }
  ],
  documents: [
    { id: 'doc-ref-192', patientId: 'P-1002', name: 'Referral letter.pdf', type: 'referral_letter', uploadedAt: '2026-09-18T10:20:00+05:30', status: 'extracted', source: 'Hospital upload' },
    { id: 'scan-8322', patientId: 'P-1002', name: 'Anomaly scan report.pdf', type: 'scan_report', uploadedAt: '2026-05-01T12:10:00+05:30', status: 'reviewed', source: 'Radiology' }
  ],
  drafts: [
    { id: 'D-501', type: 'referral letter', language: 'English', patientId: 'P-1002', status: 'pending_review', version: 1, source: 'Reviewed patient facts', body: 'Draft referral letter assembled from reviewed demographics, recent appointment history, and listed document references.', reviewNotes: '' },
    { id: 'D-502', type: 'patient handout', language: 'Hindi', patientId: null, status: 'draft', version: 1, source: 'Hospital-approved antenatal knowledge base', body: 'Draft multilingual clinic handout based on the hospital-approved antenatal visit schedule knowledge base.', reviewNotes: '' },
    { id: 'D-503', type: 'department report', language: 'English', patientId: null, status: 'approved', version: 1, source: 'Operational registry data', body: 'Operational report draft: open follow-up gaps by program, outreach workload, and slot utilisation.', reviewNotes: 'Approved for internal use.' }
  ],
  facilityCases: [
    { id: 'FC-1', patientId: 'P-1002', label: 'Meera Joshi - expected delivery readiness', prioritySource: 'Clinician-set', owner: 'Labour ward coordinator', checklist: [
      { id: 'staff', label: 'Care team confirmed', ready: true, confirmedBy: 'Dr. S. Kumar', confirmedAt: '2026-09-20T08:40:00+05:30' },
      { id: 'room', label: 'Room availability confirmed', ready: false, confirmedBy: '', confirmedAt: '' },
      { id: 'kit', label: 'Delivery kit checked', ready: true, confirmedBy: 'Nurse P. Roy', confirmedAt: '2026-09-20T08:50:00+05:30' },
      { id: 'transport', label: 'Ambulance bay confirmed', ready: false, confirmedBy: '', confirmedAt: '' }
    ] }
  ],
  sosRequests: [],
  audit: []
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...clone(seedState), ...saved };
  } catch (_) {
    return clone(seedState);
  }
}
const state = loadState();
function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function daysBetween(a, b) { return Math.floor((new Date(a).setHours(0,0,0,0) - new Date(b).setHours(0,0,0,0)) / DAY_MS); }
function addDays(value, days) { return new Date(new Date(value).getTime() + days * DAY_MS); }
function actor(req) { return (req.body && req.body.actor) || (typeof req.get === 'function' && req.get('x-hospital-actor')) || 'Demo hospital user'; }
function role(req) { return (req.body && req.body.role) || (typeof req.get === 'function' && req.get('x-hospital-role')) || 'admin'; }
const permissions = {
  admin: ['*'],
  doctor: ['brief_review', 'draft_edit', 'draft_review', 'priority', 'facility_review'],
  care_team: ['gap_contact', 'gap_reassign', 'gap_resolve', 'document_ingest', 'facility_review', 'sos_review'],
  front_desk: ['gap_contact', 'queue_manage', 'slot_reassign', 'sos_review']
};
function allowed(req, permission) { const list = permissions[role(req)] || []; return list.includes('*') || list.includes(permission); }
function requirePermission(permission) {
  return (req, res, next) => allowed(req, permission) ? next() : res.status(403).json({ error: `The ${role(req)} role cannot perform this action.` });
}
function audit(req, action, entityType, entityId, detail, before, after) {
  const entry = { id: `AUD-${Date.now()}-${Math.floor(Math.random()*1000)}`, actor: actor(req), role: role(req), action, entityType, entityId, detail, before: before || null, after: after || null, timestamp: new Date().toISOString() };
  state.audit.unshift(entry);
  state.audit = state.audit.slice(0, 500);
  saveState();
  return entry;
}
function computeGaps() {
  const today = new Date(HOSPITAL_TODAY);
  const gaps = [];
  patients.forEach((patient) => {
    const template = pathways[patient.program];
    template.events.forEach((expected) => {
      const dueDate = addDays(patient.pathwayStart, expected.offset);
      const daysOverdue = daysBetween(today, dueDate);
      const actual = careEvents.find((event) => event.patientId === patient.id && event.type === expected.type && new Date(event.recordedAt) <= today);
      const id = `${patient.id}:${expected.id}`;
      const work = state.gapWork[id] || {};
      if (!actual && daysOverdue > 0 && !work.resolvedAt) {
        gaps.push({ id, patientId: patient.id, patientName: patient.name, program: patient.program, provider: patient.provider, stage: expected.stage, expectedType: expected.type, dueDate: dueDate.toISOString().slice(0,10), daysOverdue, requiredDocs: expected.requiredDocs, assignedTo: work.assignedTo || patient.provider, contacts: work.contacts || [], operationalPriority: daysOverdue + patient.noShows * 7, reviewStatus: 'open', provenance: `Expected event ${expected.id} from ${template.name}; no matching recorded care event was found.` });
      }
    });
  });
  return gaps.sort((a,b) => b.operationalPriority - a.operationalPriority);
}
function patientTimeline(patientId) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return [];
  const now = new Date(HOSPITAL_TODAY);
  return pathways[patient.program].events.map((expected) => {
    const due = addDays(patient.pathwayStart, expected.offset);
    const recorded = careEvents.find((event) => event.patientId === patientId && event.type === expected.type);
    const work = state.gapWork[`${patientId}:${expected.id}`] || {};
    return { id: expected.id, stage: expected.stage, title: expected.type, dueDate: due.toISOString().slice(0,10), status: recorded ? 'completed' : work.resolvedAt ? 'resolved' : due < now ? 'overdue' : 'upcoming', recordedAt: recorded && recorded.recordedAt, source: recorded && recorded.source, documentRef: recorded && recorded.documentRef };
  });
}
function snapshot() {
  return { today: HOSPITAL_TODAY, safety: { mode: 'assistive_only', requiredHumanReview: true, disallowed: ['diagnosis','treatment_recommendation','clinical_risk_scoring','autonomous_clinical_action'] }, roles: Object.keys(permissions), pathways, patients, careEvents, gaps: computeGaps(), gapWork: state.gapWork, doctorPriorityFlags: state.doctorPriorityFlags, consultationBrief: state.consultationBrief, queue: state.queue, documents: state.documents, drafts: state.drafts, facilityCases: state.facilityCases, sosRequests: state.sosRequests, audit: state.audit };
}
function returnState(res, message, status = 200) { res.status(status).json({ message, state: snapshot() }); }

module.exports = function registerHospitalPlatform(app) {
  if (!state.audit.length) {
    const fakeReq = { body: { actor: 'system', role: 'admin' }, get: () => null };
    audit(fakeReq, 'gap_engine_run', 'CareGap', 'all', 'Deterministic expected-versus-recorded comparison completed.');
  }

  app.get('/api/hospital/state', (req,res) => res.json(snapshot()));
  app.get('/api/hospital/patients/:id/timeline', (req,res) => res.json({ timeline: patientTimeline(req.params.id) }));
  app.get('/api/hospital/patients/:id/gaps', (req,res) => res.json({ gaps: computeGaps().filter((gap) => gap.patientId === req.params.id), reviewStatus: 'human_review_required' }));
  app.get('/api/hospital/gaps', (req,res) => {
    const overdue = Number(req.query.overdue_gt || 0);
    const gaps = computeGaps().filter((gap) => (!req.query.program || gap.program === req.query.program) && (!req.query.provider || gap.provider === req.query.provider) && (!req.query.assigned || gap.assignedTo === req.query.assigned) && (!overdue || gap.daysOverdue > overdue));
    res.json({ gaps, scoringLabel: 'Operational outreach priority, not clinical risk.' });
  });
  app.post('/api/hospital/gaps/:id/contact', requirePermission('gap_contact'), (req,res) => {
    const patient = patients.find((item) => item.id === req.params.id.split(':')[0]);
    if (!patient || !patient.consent.outreach) return res.status(409).json({ error: 'Outreach is blocked because patient consent is not recorded.' });
    const work = state.gapWork[req.params.id] || { assignedTo: patient.provider, contacts: [] };
    const before = clone(work);
    work.contacts = work.contacts || [];
    work.contacts.push({ method: req.body.method || 'phone', outcome: req.body.outcome || 'attempted', notes: req.body.notes || '', at: new Date().toISOString(), by: actor(req) });
    state.gapWork[req.params.id] = work;
    audit(req, 'gap_contacted', 'CareGap', req.params.id, `${req.body.method || 'phone'} outreach recorded.`, before, work);
    returnState(res, 'Contact outcome saved and audited.');
  });
  app.post('/api/hospital/gaps/:id/reassign', requirePermission('gap_reassign'), (req,res) => {
    if (!req.body.assignedTo) return res.status(400).json({ error: 'New assignee is required.' });
    const work = state.gapWork[req.params.id] || { contacts: [] };
    const before = clone(work); work.assignedTo = req.body.assignedTo; state.gapWork[req.params.id] = work;
    audit(req, 'gap_reassigned', 'CareGap', req.params.id, req.body.notes || `Assigned to ${req.body.assignedTo}.`, before, work);
    returnState(res, 'Gap reassigned and audited.');
  });
  app.post('/api/hospital/gaps/:id/resolve', requirePermission('gap_resolve'), (req,res) => {
    if (!req.body.notes || !req.body.evidence) return res.status(400).json({ error: 'Resolution notes and evidence are required.' });
    const work = state.gapWork[req.params.id] || { contacts: [] };
    const before = clone(work); work.resolvedAt = new Date().toISOString(); work.resolvedBy = actor(req); work.resolutionNotes = req.body.notes; work.evidence = req.body.evidence; state.gapWork[req.params.id] = work;
    audit(req, 'gap_resolved', 'CareGap', req.params.id, req.body.notes, before, work);
    returnState(res, 'Gap resolved. The next pathway milestone is now visible.');
  });
  app.post('/api/hospital/pathways/:program/events', requirePermission('pathway_manage'), (req,res) => {
    const pathway = pathways[req.params.program];
    if (!pathway) return res.status(404).json({ error: 'Program not found.' });
    if (!req.body.type || !Number.isFinite(Number(req.body.offset))) return res.status(400).json({ error: 'Event name and day offset are required.' });
    const event = { id: `custom-${Date.now()}`, stage: req.body.stage || 'Custom stage', type: req.body.type, offset: Number(req.body.offset), requiredDocs: req.body.requiredDocs || [] };
    pathway.events.push(event); audit(req, 'pathway_event_added', 'CarePathway', req.params.program, `Added ${event.type}.`, null, event); returnState(res, 'Pathway event added.');
  });
  app.post('/api/hospital/documents/ingest', requirePermission('document_ingest'), (req,res) => {
    const patient = patients.find((item) => item.id === req.body.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    if (!patient.consent.documents) return res.status(409).json({ error: 'Document access consent is not recorded.' });
    if (!req.body.name) return res.status(400).json({ error: 'Document name is required.' });
    const id = `DOC-${Date.now()}`;
    const document = { id, patientId: patient.id, name: req.body.name, type: req.body.type || 'clinical_document', uploadedAt: new Date().toISOString(), status: 'pending_review', source: 'Hospital upload' };
    state.documents.unshift(document);
    const fact = { id: `F-${Date.now()}`, label: req.body.factLabel || 'Document received', value: req.body.factValue || req.body.name, source: `${document.source} ${id}`, confidence: 'demo extraction - review required', status: 'pending_review' };
    if (state.consultationBrief.patientId === patient.id) state.consultationBrief.facts.push(fact);
    audit(req, 'document_ingested', 'Document', id, 'Document metadata received and a review-required fact was extracted.', null, document);
    returnState(res, 'Document uploaded. Extracted facts require human review.', 201);
  });
  app.post('/api/hospital/consultations/:id/brief/review', requirePermission('brief_review'), (req,res) => { const before = state.consultationBrief.status; state.consultationBrief.status = 'reviewed'; audit(req,'brief_reviewed','ConsultationBrief',req.params.id,req.body.notes || 'Fact-only brief reviewed.',before,'reviewed'); returnState(res,'Brief reviewed.'); });
  app.post('/api/hospital/consultations/:id/facts/:factId/reject', requirePermission('brief_review'), (req,res) => {
    const fact = state.consultationBrief.facts.find((item) => item.id === req.params.factId); if (!fact) return res.status(404).json({ error: 'Fact not found.' });
    const before = clone(fact); fact.status = 'rejected'; fact.reviewNotes = req.body.notes || 'Rejected for correction'; state.consultationBrief.status = 'needs_correction'; audit(req,'brief_fact_rejected','BriefFact',fact.id,fact.reviewNotes,before,fact); returnState(res,'Extracted fact rejected for correction.');
  });
  app.post('/api/hospital/clinic/queue/:id/status', requirePermission('queue_manage'), (req,res) => {
    const item = state.queue.find((slot) => slot.id === req.params.id); if (!item) return res.status(404).json({ error: 'Queue item not found.' });
    const allowedStatuses = ['scheduled','checked_in','waiting','in_consultation','completed','cancelled','delayed_labs']; if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid queue status.' });
    const before = clone(item); item.status = req.body.status; item.waitMins = Number(req.body.waitMins || item.waitMins || 0); audit(req,'queue_status_updated','Appointment',item.id,`Status changed to ${item.status}.`,before,item); returnState(res,'Queue updated and audited.');
  });
  app.post('/api/hospital/clinic/queue/:id/urgency', requirePermission('queue_manage'), (req,res) => {
    const item = state.queue.find((slot) => slot.id === req.params.id); if (!item) return res.status(404).json({ error: 'Queue item not found.' });
    const before = clone(item); item.urgency = req.body.urgency || ''; item.urgencySetBy = item.urgency ? actor(req) : ''; audit(req,'manual_urgency_updated','Appointment',item.id,item.urgency || 'Manual urgency cleared.',before,item); returnState(res,'Manual urgency updated.');
  });
  app.post('/api/hospital/clinic/slots/:gapId/reassign', requirePermission('slot_reassign'), (req,res) => {
    const gap = computeGaps().find((item) => item.id === req.params.gapId); if (!gap) return res.status(404).json({ error: 'Care gap not found.' });
    const slot = state.queue.find((item) => item.status === 'cancelled'); if (!slot) return res.status(409).json({ error: 'No cancelled slot is available.' });
    const before = clone(slot); slot.patientId = gap.patientId; slot.status = 'scheduled'; slot.urgency = ''; slot.urgencySetBy = ''; audit(req,'slot_reassigned','Appointment',slot.id,`Front desk assigned ${slot.slot} to ${gap.patientName}.`,before,slot); returnState(res,'Slot reassigned and patient notification queued.');
  });
  app.post('/api/hospital/content/draft', requirePermission('draft_edit'), (req,res) => {
    const draft = { id: `D-${Date.now()}`, type: req.body.type || 'patient handout', language: req.body.language || 'English', patientId: req.body.patientId || null, status: 'draft', version: 1, source: req.body.source || 'Hospital-approved knowledge base', body: req.body.body || 'New draft created from approved hospital source material.', reviewNotes: '' };
    state.drafts.unshift(draft); audit(req,'draft_generated','ContentDraft',draft.id,'Draft generated and held for review.',null,draft); returnState(res,'Draft generated and held for review.',201);
  });
  app.post('/api/hospital/content/:id/edit', requirePermission('draft_edit'), (req,res) => {
    const draft = state.drafts.find((item) => item.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); if (draft.status === 'published') return res.status(409).json({ error: 'Published content cannot be edited.' });
    const before = clone(draft); draft.body = req.body.body || draft.body; draft.language = req.body.language || draft.language; draft.version += 1; draft.status = 'pending_review'; audit(req,'draft_edited','ContentDraft',draft.id,'Draft edited and returned to review.',before,draft); returnState(res,'Draft saved and returned to review.');
  });
  app.post('/api/hospital/content/:id/approve', requirePermission('draft_review'), (req,res) => { const draft=state.drafts.find((item)=>item.id===req.params.id); if(!draft)return res.status(404).json({error:'Draft not found.'}); const before=clone(draft); draft.status='approved'; draft.reviewNotes=req.body.notes||''; audit(req,'draft_approved','ContentDraft',draft.id,'Draft approved by clinician.',before,draft); returnState(res,'Draft approved.'); });
  app.post('/api/hospital/content/:id/reject', requirePermission('draft_review'), (req,res) => { const draft=state.drafts.find((item)=>item.id===req.params.id); if(!draft)return res.status(404).json({error:'Draft not found.'}); const before=clone(draft); draft.status='rejected'; draft.reviewNotes=req.body.notes||'Rejected'; audit(req,'draft_rejected','ContentDraft',draft.id,draft.reviewNotes,before,draft); returnState(res,'Draft rejected.'); });
  app.post('/api/hospital/content/:id/publish', requirePermission('draft_review'), (req,res) => { const draft=state.drafts.find((item)=>item.id===req.params.id); if(!draft)return res.status(404).json({error:'Draft not found.'}); if(draft.status!=='approved')return res.status(409).json({error:'Publishing is blocked until a clinician approves the draft.'}); const before=clone(draft); draft.status='published'; audit(req,'draft_published','ContentDraft',draft.id,'Approved content published/filed.',before,draft); returnState(res,'Approved content published.'); });
  app.post('/api/hospital/facility/:caseId/items/:itemId/toggle', requirePermission('facility_review'), (req,res) => {
    const facilityCase=state.facilityCases.find((item)=>item.id===req.params.caseId); const item=facilityCase && facilityCase.checklist.find((x)=>x.id===req.params.itemId); if(!item)return res.status(404).json({error:'Readiness item not found.'}); const before=clone(item); item.ready=req.body.ready !== false; item.confirmedBy=item.ready?actor(req):''; item.confirmedAt=item.ready?new Date().toISOString():''; audit(req,'facility_readiness_updated','FacilityCase',facilityCase.id,`${item.label}: ${item.ready?'ready':'not ready'}.`,before,item); returnState(res,'Facility readiness updated.');
  });
  app.post('/api/hospital/sos/trigger', (req,res) => {
    const patient=patients.find((item)=>item.id===req.body.patientId); if(!patient)return res.status(404).json({error:'Patient not found.'}); if(!req.body.consentConfirmed)return res.status(400).json({error:'Consent confirmation is required.'});
    const request={id:`SOS-${Date.now()}`,patientId:patient.id,status:'awaiting_verification',location:req.body.location||'Location shared with consent',createdAt:new Date().toISOString(),verifiedBy:'',respondedBy:''}; state.sosRequests.unshift(request); audit(req,'sos_received','SOSRequest',request.id,'Emergency request received; verification required.',null,request); returnState(res,'SOS received and awaiting verification.',201);
  });
  app.post('/api/hospital/sos/:id/authenticate', requirePermission('sos_review'), (req,res) => { const request=state.sosRequests.find((item)=>item.id===req.params.id); if(!request)return res.status(404).json({error:'SOS request not found.'}); const before=clone(request); request.status='verified'; request.verifiedBy=actor(req); request.verifiedAt=new Date().toISOString(); audit(req,'sos_verified','SOSRequest',request.id,'Second-layer verification completed.',before,request); returnState(res,'SOS verified. Facility response is now enabled.'); });
  app.post('/api/hospital/sos/:id/respond', requirePermission('sos_review'), (req,res) => { const request=state.sosRequests.find((item)=>item.id===req.params.id); if(!request)return res.status(404).json({error:'SOS request not found.'}); if(request.status!=='verified')return res.status(409).json({error:'SOS must be verified before a facility responds.'}); const before=clone(request); request.status=req.body.response==='decline'?'declined':'accepted'; request.respondedBy=actor(req); request.respondedAt=new Date().toISOString(); audit(req,'sos_response_recorded','SOSRequest',request.id,`Facility ${request.status} the request.`,before,request); returnState(res,'Facility response recorded in the patient history.'); });
  app.get('/api/hospital/audit', (req,res) => { const rows=state.audit.filter((entry)=>(!req.query.actor||entry.actor.includes(req.query.actor))&&(!req.query.action||entry.action.includes(req.query.action))&&(!req.query.entity||entry.entityId.includes(req.query.entity))&&(!req.query.date||entry.timestamp.slice(0,10)===req.query.date)); res.json({audit:rows}); });

  function doctorSnapshot(provider='Dr. S. Kumar') { const gaps=computeGaps(); const doctorPatients=patients.filter((p)=>p.provider===provider).map((p)=>({...p,openGaps:gaps.filter((g)=>g.patientId===p.id),openGapCount:gaps.filter((g)=>g.patientId===p.id).length,doctorPriorityFlag:state.doctorPriorityFlags[p.id]||null,nextAppointment:state.queue.find((slot)=>slot.patientId===p.id)||null,timeline:patientTimeline(p.id)})); return {today:HOSPITAL_TODAY,safety:snapshot().safety,doctor:{id:'DOC-100',name:provider,role:'doctor',specialty:'Maternal continuity and OPD follow-up'},patients:doctorPatients,consultationBrief:state.consultationBrief,appointments:state.queue.filter((slot)=>doctorPatients.some((p)=>p.id===slot.patientId)).map((slot)=>({...slot,patient:patients.find((p)=>p.id===slot.patientId)})),drafts:state.drafts,audit:state.audit}; }
  app.get('/api/doctor-portal/state',(req,res)=>res.json(doctorSnapshot(req.query.provider||'Dr. S. Kumar')));
  app.post('/api/doctor-portal/patients/:id/priority',(req,res)=>{const patient=patients.find((p)=>p.id===req.params.id);if(!patient)return res.status(404).json({error:'Patient not found.'});state.doctorPriorityFlags[patient.id]={active:req.body.active!==false,setBy:req.body.actor||patient.provider,label:'Doctor-set high-priority follow-up',notes:req.body.notes||'Manual doctor-set priority.',updatedAt:new Date().toISOString()};audit({...req,body:{...req.body,role:'doctor'}},'doctor_priority_updated','Patient',patient.id,state.doctorPriorityFlags[patient.id].notes,null,state.doctorPriorityFlags[patient.id]);res.json({message:'Doctor-set priority updated.',state:doctorSnapshot(patient.provider)});});
  app.post('/api/doctor-portal/consultations/:id/brief/review',(req,res)=>{state.consultationBrief.status='reviewed';audit({...req,body:{...req.body,role:'doctor'}},'doctor_brief_reviewed','ConsultationBrief',req.params.id,'Doctor reviewed fact-only brief.');res.json({message:'Brief reviewed.',state:doctorSnapshot(req.body.actor||'Dr. S. Kumar')});});
  app.post('/api/doctor-portal/consultations/:id/brief/reject',(req,res)=>{state.consultationBrief.status='needs_correction';audit({...req,body:{...req.body,role:'doctor'}},'doctor_brief_rejected','ConsultationBrief',req.params.id,'Doctor requested correction.');res.json({message:'Brief correction requested.',state:doctorSnapshot(req.body.actor||'Dr. S. Kumar')});});
  app.post('/api/doctor-portal/drafts',(req,res)=>{req.body.role='doctor';const draft={id:`D-${Date.now()}`,type:req.body.type||'referral letter',language:'English',patientId:req.body.patientId||null,status:'draft',version:1,source:'Reviewed patient facts',body:req.body.body||'Doctor draft generated from reviewed facts.',reviewNotes:''};state.drafts.unshift(draft);audit(req,'doctor_draft_generated','ContentDraft',draft.id,'Doctor draft generated.',null,draft);res.status(201).json({draft,state:doctorSnapshot(req.body.actor||'Dr. S. Kumar')});});
  app.post('/api/doctor-portal/drafts/:id/:action',(req,res)=>{const draft=state.drafts.find((d)=>d.id===req.params.id);if(!draft)return res.status(404).json({error:'Draft not found.'});const before=clone(draft);if(req.params.action==='finalize'&&draft.status!=='approved')return res.status(409).json({error:'Finalizing is blocked until approval.'});draft.status=req.params.action==='approve'?'approved':req.params.action==='reject'?'rejected':'published';req.body.role='doctor';audit(req,`doctor_draft_${req.params.action}`,'ContentDraft',draft.id,req.body.notes||`Draft ${draft.status}.`,before,draft);res.json({message:'Draft updated.',state:doctorSnapshot(req.body.actor||'Dr. S. Kumar')});});
  app.get('/api/patient/state',(req,res)=>res.json({patient:{id:'P-1002',name:'Meera Joshi',stage:'Trimester 3',language:'English',consent:patients.find((p)=>p.id==='P-1002').consent},timeline:patientTimeline('P-1002'),appointments:state.queue.filter((slot)=>slot.patientId==='P-1002'),documents:state.documents.filter((doc)=>doc.patientId==='P-1002'),safety:{companionScope:'milestone_explanation_only',noDiagnosisOrTreatmentAdvice:true}}));
};
