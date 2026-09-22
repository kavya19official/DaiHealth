'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOSPITAL_TODAY = process.env.HOSPITAL_TODAY || '2026-09-22T09:00:00+05:30';
const DATA_DIR = process.env.HOSPITAL_DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = process.env.HOSPITAL_STATE_FILE || path.join(DATA_DIR, 'hospital-demo-state.json');
const UPLOAD_DIR = process.env.HOSPITAL_UPLOAD_DIR || path.join(DATA_DIR, 'hospital-uploads');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);

const seedState = {
  pathways: {
    maternal: { name: 'Maternal continuity', version: 1, events: [
      { id: 'anc-12', stage: 'Trimester 1', type: 'ANC visit', offset: 84, requiredDocs: ['visit_note'] },
      { id: 'anomaly-scan', stage: 'Trimester 2', type: 'Anomaly scan', offset: 140, requiredDocs: ['scan_report'] },
      { id: 'gtt', stage: 'Trimester 2', type: 'Glucose tolerance test', offset: 168, requiredDocs: ['lab_result'] },
      { id: 'birth-plan', stage: 'Trimester 3', type: 'Birth plan readiness', offset: 252, requiredDocs: ['care_plan'] }
    ] },
    oncology: { name: 'Oncology follow-up', version: 1, events: [
      { id: 'cycle-review', stage: 'Cycle review', type: 'Post-cycle review', offset: 21, requiredDocs: ['visit_note'] },
      { id: 'cbc', stage: 'Investigation', type: 'CBC lab upload', offset: 28, requiredDocs: ['lab_result'] },
      { id: 'scan-review', stage: 'Follow-up imaging', type: 'Follow-up scan filed', offset: 90, requiredDocs: ['imaging_report'] }
    ] },
    diabetes: { name: 'Diabetes clinic', version: 1, events: [
      { id: 'hba1c', stage: 'Quarterly labs', type: 'HbA1c result upload', offset: 90, requiredDocs: ['lab_result'] },
      { id: 'foot-check', stage: 'Annual review', type: 'Foot check recorded', offset: 180, requiredDocs: ['visit_note'] },
      { id: 'eye-referral', stage: 'Annual review', type: 'Eye referral letter', offset: 210, requiredDocs: ['referral_letter'] }
    ] }
  },
  patients: [
    { id: 'P-1001', name: 'Asha Nair', age: 31, program: 'maternal', provider: 'Dr. S. Kumar', stage: 'Trimester 2', pathwayStart: '2026-04-07', lastTouch: '2026-08-28', noShows: 1, phone: '+91 90000 11111', referralSource: 'Community clinic', consent: { documents: true, outreach: true, emergencyLocation: true } },
    { id: 'P-1002', name: 'Meera Joshi', age: 28, program: 'maternal', provider: 'Dr. S. Kumar', stage: 'Trimester 3', pathwayStart: '2025-12-10', lastTouch: '2026-08-02', noShows: 3, phone: '+91 90000 22222', referralSource: 'Self referral', consent: { documents: true, outreach: true, emergencyLocation: false } },
    { id: 'P-2030', name: 'Farhan Ali', age: 54, program: 'diabetes', provider: 'Dr. N. Rao', stage: 'Quarterly labs', pathwayStart: '2026-02-08', lastTouch: '2026-08-14', noShows: 2, phone: '+91 90000 33333', referralSource: 'Internal medicine', consent: { documents: true, outreach: true, emergencyLocation: false } },
    { id: 'P-3091', name: 'Leela Menon', age: 47, program: 'oncology', provider: 'Dr. A. Shah', stage: 'Follow-up imaging', pathwayStart: '2026-05-14', lastTouch: '2026-09-17', noShows: 0, phone: '+91 90000 44444', referralSource: 'District hospital', consent: { documents: true, outreach: false, emergencyLocation: false } },
    { id: 'P-3094', name: 'Ritika Sen', age: 39, program: 'oncology', provider: 'Dr. A. Shah', stage: 'Investigation', pathwayStart: '2026-06-01', lastTouch: '2026-07-24', noShows: 2, phone: '+91 90000 55555', referralSource: 'Community clinic', consent: { documents: true, outreach: true, emergencyLocation: false } }
  ],
  careEvents: [
    { id: 'EV-1', patientId: 'P-1001', type: 'ANC visit', recordedAt: '2026-07-01', source: 'EMR', documentRef: 'visit-4401' },
    { id: 'EV-2', patientId: 'P-1001', type: 'Anomaly scan', recordedAt: '2026-08-25', source: 'Radiology', documentRef: 'scan-8840' },
    { id: 'EV-3', patientId: 'P-1002', type: 'ANC visit', recordedAt: '2026-03-10', source: 'EMR', documentRef: 'visit-4204' },
    { id: 'EV-4', patientId: 'P-1002', type: 'Anomaly scan', recordedAt: '2026-05-01', source: 'Radiology', documentRef: 'scan-8322' },
    { id: 'EV-5', patientId: 'P-2030', type: 'Foot check recorded', recordedAt: '2026-08-08', source: 'EMR', documentRef: 'visit-5180' },
    { id: 'EV-6', patientId: 'P-3091', type: 'Post-cycle review', recordedAt: '2026-06-06', source: 'EMR', documentRef: 'visit-7731' },
    { id: 'EV-7', patientId: 'P-3091', type: 'CBC lab upload', recordedAt: '2026-06-15', source: 'Lab system', documentRef: 'lab-9018' },
    { id: 'EV-8', patientId: 'P-3094', type: 'Post-cycle review', recordedAt: '2026-06-25', source: 'EMR', documentRef: 'visit-7852' }
  ],
  gapWork: {},
  doctorPriorityFlags: { 'P-1002': { active: true, setBy: 'Dr. S. Kumar', label: 'Doctor-set high-priority follow-up', notes: 'Manual flag for closer follow-up before next OPD visit.', updatedAt: HOSPITAL_TODAY } },
  consultationBriefs: [{ patientId: 'P-1002', appointmentId: 'A-902', status: 'pending_review', facts: [
    { id: 'F-1', label: 'Last ANC visit', value: '2026-03-10', source: 'EMR visit-4204', confidence: 'typed/coded', status: 'accepted' },
    { id: 'F-2', label: 'Anomaly scan document', value: 'Uploaded 2026-05-01', source: 'Radiology scan-8322', confidence: 'typed/coded', status: 'accepted' },
    { id: 'F-3', label: 'Referral letter', value: 'Scan planned after 2026-08-15', source: 'OCR doc-ref-192', confidence: '0.82', status: 'pending_review' }
  ], flags: [
    { type: 'missing_info', text: 'No glucose tolerance test result found after expected date.', source: 'Gap engine, pathway event gtt' },
    { type: 'inconsistent_info', text: 'Referral letter references a scan not present in document store.', source: 'OCR doc-ref-192' }
  ] }],
  queue: [
    { id: 'A-902', slot: '09:30', patientId: 'P-1002', provider: 'Dr. S. Kumar', status: 'checked_in', waitMins: 18, urgency: 'Staff-set: high-priority follow-up', urgencySetBy: 'Dr. S. Kumar' },
    { id: 'A-903', slot: '09:45', patientId: 'P-3091', provider: 'Dr. A. Shah', status: 'waiting', waitMins: 11, urgency: '', urgencySetBy: '' },
    { id: 'A-904', slot: '10:00', patientId: 'P-2030', provider: 'Dr. N. Rao', status: 'delayed_labs', waitMins: 8, urgency: '', urgencySetBy: '' },
    { id: 'A-905', slot: '10:15', patientId: 'P-1001', provider: 'Dr. S. Kumar', status: 'cancelled', waitMins: 0, urgency: '', urgencySetBy: '' }
  ],
  documents: [
    { id: 'doc-ref-192', patientId: 'P-1002', name: 'Referral letter.pdf', type: 'referral_letter', mimeType: 'application/pdf', uploadedAt: '2026-09-18T10:20:00+05:30', status: 'extracted', source: 'Hospital upload', sha256: 'demo-reference' },
    { id: 'scan-8322', patientId: 'P-1002', name: 'Anomaly scan report.pdf', type: 'scan_report', mimeType: 'application/pdf', uploadedAt: '2026-05-01T12:10:00+05:30', status: 'reviewed', source: 'Radiology', sha256: 'demo-reference' }
  ],
  drafts: [
    { id: 'D-501', type: 'referral letter', language: 'English', patientId: 'P-1002', status: 'pending_review', version: 1, source: 'Reviewed patient facts', body: 'Draft referral letter assembled from reviewed demographics, recent appointment history, and listed document references.', reviewNotes: '' },
    { id: 'D-502', type: 'patient handout', language: 'Hindi', patientId: null, status: 'draft', version: 1, source: 'Hospital-approved antenatal knowledge base', body: 'Draft multilingual clinic handout based on the hospital-approved antenatal visit schedule knowledge base.', reviewNotes: '' },
    { id: 'D-503', type: 'department report', language: 'English', patientId: null, status: 'approved', version: 1, source: 'Operational registry data', body: 'Operational report draft: open follow-up gaps by program, outreach workload, and slot utilisation.', reviewNotes: 'Approved for internal use.' }
  ],
  campaigns: [],
  knowledgeBase: [
    { id: 'KB-1', title: 'Antenatal visit schedule', category: 'maternal', language: 'English', status: 'approved', source: 'Hospital clinical governance committee', reviewedAt: '2026-08-10', summary: 'Approved schedule and administrative preparation notes for antenatal visits.' },
    { id: 'KB-2', title: 'Preparing for a diabetes follow-up', category: 'diabetes', language: 'Hindi', status: 'approved', source: 'Hospital patient education committee', reviewedAt: '2026-08-18', summary: 'Approved appointment preparation and record-carrying instructions.' },
    { id: 'KB-3', title: 'Oncology follow-up documents', category: 'oncology', language: 'English', status: 'approved', source: 'Oncology department', reviewedAt: '2026-09-01', summary: 'Approved list of reports patients should bring to a follow-up visit.' }
  ],
  facilityCases: [{ id: 'FC-1', patientId: 'P-1002', label: 'Meera Joshi - expected delivery readiness', prioritySource: 'Clinician-set', owner: 'Labour ward coordinator', checklist: [
    { id: 'staff', label: 'Care team confirmed', ready: true, confirmedBy: 'Dr. S. Kumar', confirmedAt: '2026-09-20T08:40:00+05:30' },
    { id: 'room', label: 'Room availability confirmed', ready: false, confirmedBy: '', confirmedAt: '' },
    { id: 'kit', label: 'Delivery kit checked', ready: true, confirmedBy: 'Nurse P. Roy', confirmedAt: '2026-09-20T08:50:00+05:30' },
    { id: 'transport', label: 'Ambulance bay confirmed', ready: false, confirmedBy: '', confirmedAt: '' }
  ] }],
  notifications: [],
  sosRequests: [],
  audit: []
};

const permissions = {
  admin: ['*'],
  doctor: ['record_event', 'brief_review', 'draft_edit', 'draft_review', 'priority', 'facility_review', 'campaign_manage', 'knowledge_read'],
  care_team: ['record_event', 'gap_contact', 'gap_reassign', 'gap_resolve', 'document_ingest', 'facility_review', 'sos_review', 'knowledge_read'],
  front_desk: ['gap_contact', 'queue_manage', 'slot_reassign', 'notification_manage', 'sos_review', 'knowledge_read']
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`; }
function safeName(value) { return path.basename(String(value || 'document')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100); }
function mergeState(saved) {
  const merged = { ...clone(seedState), ...(saved || {}) };
  if (saved && saved.consultationBrief && !saved.consultationBriefs) merged.consultationBriefs = [saved.consultationBrief];
  for (const key of Object.keys(seedState)) if (merged[key] == null) merged[key] = clone(seedState[key]);
  return merged;
}
function loadState() {
  try { return mergeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); }
  catch (_) { return mergeState(null); }
}
const state = loadState();
function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, STATE_FILE);
}
function patientById(patientId) { return state.patients.find((item) => item.id === patientId); }
function briefByAppointment(appointmentId) { return state.consultationBriefs.find((item) => item.appointmentId === appointmentId); }
function daysBetween(a, b) { return Math.floor((new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / DAY_MS); }
function addDays(value, days) { return new Date(new Date(value).getTime() + days * DAY_MS); }
function header(req, name) { return req && typeof req.get === 'function' ? req.get(name) : ''; }
function role(req) { return (req.user && req.user.role) || (req.body && req.body.role) || header(req, 'x-hospital-role') || 'admin'; }
function actor(req) { return (req.user && (req.user.name || req.user.email)) || (req.body && req.body.actor) || header(req, 'x-hospital-actor') || 'Demo hospital user'; }
function allowed(req, permission) { const list = permissions[role(req)] || []; return list.includes('*') || list.includes(permission); }
function requirePermission(permission) { return (req, res, next) => allowed(req, permission) ? next() : res.status(403).json({ error: `The ${role(req)} role cannot perform this action.` }); }
function audit(req, action, entityType, entityId, detail, before = null, after = null) {
  const entry = { id: id('AUD'), actor: actor(req), role: role(req), action, entityType, entityId, detail, before, after, timestamp: now() };
  state.audit.unshift(entry); state.audit = state.audit.slice(0, 1000); saveState(); return entry;
}
function notify(req, patientId, channel, message, entityId) {
  const patient = patientById(patientId);
  if (!patient || !patient.consent.outreach) return null;
  const item = { id: id('NOT'), patientId, channel: channel || 'in_app', message, status: 'queued', entityId: entityId || '', createdAt: now(), createdBy: actor(req) };
  state.notifications.unshift(item); return item;
}
function computeGaps() {
  const today = new Date(HOSPITAL_TODAY); const gaps = [];
  state.patients.forEach((patient) => {
    const pathway = state.pathways[patient.program]; if (!pathway) return;
    pathway.events.forEach((expected) => {
      const dueDate = addDays(patient.pathwayStart, expected.offset); const daysOverdue = daysBetween(today, dueDate);
      const actual = state.careEvents.find((event) => event.patientId === patient.id && event.type === expected.type && new Date(event.recordedAt) <= today);
      const gapId = `${patient.id}:${expected.id}`; const work = state.gapWork[gapId] || {};
      if (!actual && daysOverdue > 0 && !work.resolvedAt) gaps.push({ id: gapId, patientId: patient.id, patientName: patient.name, program: patient.program, provider: patient.provider, stage: expected.stage, expectedType: expected.type, dueDate: dueDate.toISOString().slice(0, 10), daysOverdue, requiredDocs: expected.requiredDocs, assignedTo: work.assignedTo || patient.provider, contacts: work.contacts || [], operationalPriority: daysOverdue + patient.noShows * 7, priorityLabel: 'Operational outreach priority only', reviewStatus: 'open', provenance: `Expected event ${expected.id} from ${pathway.name} v${pathway.version || 1}; no matching recorded care event was found.` });
    });
  });
  return gaps.sort((a, b) => b.operationalPriority - a.operationalPriority);
}
function patientTimeline(patientId) {
  const patient = patientById(patientId); if (!patient || !state.pathways[patient.program]) return [];
  const today = new Date(HOSPITAL_TODAY);
  return state.pathways[patient.program].events.map((expected) => {
    const due = addDays(patient.pathwayStart, expected.offset); const recorded = state.careEvents.find((event) => event.patientId === patientId && event.type === expected.type); const work = state.gapWork[`${patientId}:${expected.id}`] || {};
    return { id: expected.id, stage: expected.stage, title: expected.type, dueDate: due.toISOString().slice(0, 10), status: recorded ? 'completed' : work.resolvedAt ? 'resolved' : due < today ? 'overdue' : 'upcoming', recordedAt: recorded && recorded.recordedAt, source: recorded && recorded.source, documentRef: recorded && recorded.documentRef, provenance: recorded ? `Recorded by ${recorded.source}` : `Expected from ${state.pathways[patient.program].name}` };
  });
}
function registry(filters = {}) {
  const gaps = computeGaps();
  const patients = state.patients.filter((p) => (!filters.program || p.program === filters.program) && (!filters.provider || p.provider === filters.provider) && (!filters.stage || p.stage === filters.stage) && (!filters.search || `${p.id} ${p.name}`.toLowerCase().includes(String(filters.search).toLowerCase()))).map((p) => ({ ...p, openGapCount: gaps.filter((g) => g.patientId === p.id).length, nextAppointment: state.queue.find((q) => q.patientId === p.id && q.status !== 'cancelled') || null, lastRecordedEvent: state.careEvents.filter((e) => e.patientId === p.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] || null }));
  const byProgram = {}; patients.forEach((p) => { byProgram[p.program] = (byProgram[p.program] || 0) + 1; });
  return { patients, aggregates: { totalPatients: patients.length, openGaps: gaps.filter((g) => patients.some((p) => p.id === g.patientId)).length, dueToday: state.queue.filter((q) => q.status !== 'cancelled').length, pendingReviews: state.consultationBriefs.filter((b) => b.status !== 'reviewed').length + state.drafts.filter((d) => ['draft', 'pending_review'].includes(d.status)).length, byProgram }, generatedAt: now(), scope: 'Operational registry; no clinical inference.' };
}
function analytics() {
  const gaps = computeGaps(); const activeQueue = state.queue.filter((q) => q.status !== 'cancelled'); const completed = state.queue.filter((q) => q.status === 'completed').length;
  const programMetrics = Object.keys(state.pathways).map((program) => { const members = state.patients.filter((p) => p.program === program); return { program, patients: members.length, openGaps: gaps.filter((g) => g.program === program).length, outreachAttempts: gaps.flatMap((g) => g.contacts).length }; });
  const referralSources = {}; state.patients.forEach((p) => { referralSources[p.referralSource || 'Unknown'] = (referralSources[p.referralSource || 'Unknown'] || 0) + 1; });
  return { scope: 'Operational analytics only; no diagnosis or clinical outcome prediction.', generatedAt: now(), slotUtilisationPercent: state.queue.length ? Math.round(activeQueue.length / state.queue.length * 100) : 0, completedAppointments: completed, averageWaitMinutes: activeQueue.length ? Math.round(activeQueue.reduce((sum, q) => sum + Number(q.waitMins || 0), 0) / activeQueue.length) : 0, gapAging: { under30: gaps.filter((g) => g.daysOverdue < 30).length, days30to89: gaps.filter((g) => g.daysOverdue >= 30 && g.daysOverdue < 90).length, days90plus: gaps.filter((g) => g.daysOverdue >= 90).length }, programMetrics, referralSources };
}
function snapshot() {
  const firstBrief = state.consultationBriefs[0] || null;
  return { today: HOSPITAL_TODAY, safety: { mode: 'assistive_only', requiredHumanReview: true, disallowed: ['diagnosis', 'treatment_recommendation', 'clinical_risk_scoring', 'autonomous_clinical_action'], scoringLabel: 'Operational priority only; clinician-set urgency is separate.' }, roles: Object.keys(permissions), pathways: state.pathways, patients: state.patients, careEvents: state.careEvents, gaps: computeGaps(), gapWork: state.gapWork, doctorPriorityFlags: state.doctorPriorityFlags, consultationBrief: firstBrief, consultationBriefs: state.consultationBriefs, queue: state.queue, documents: state.documents, drafts: state.drafts, campaigns: state.campaigns, knowledgeBase: state.knowledgeBase, notifications: state.notifications, facilityCases: state.facilityCases, sosRequests: state.sosRequests, analytics: analytics(), audit: state.audit };
}
function returnState(res, message, status = 200, extra = {}) { res.status(status).json({ message, ...extra, state: snapshot() }); }
function findGap(req, res) { const gap = computeGaps().find((item) => item.id === req.params.id); if (!gap) res.status(404).json({ error: 'Open care gap not found.' }); return gap; }

module.exports = function registerHospitalPlatform(app, options = {}) {
  const requests = new Map();
  app.use('/api/hospital', (req, res, next) => {
    const key = req.ip || 'local'; const current = requests.get(key) || { count: 0, reset: Date.now() + 60000 };
    if (Date.now() > current.reset) { current.count = 0; current.reset = Date.now() + 60000; }
    current.count += 1; requests.set(key, current); res.set('X-RateLimit-Limit', '180'); res.set('X-RateLimit-Remaining', String(Math.max(0, 180 - current.count)));
    if (current.count > 180) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    next();
  });
  // Local demo mode supports the role switcher. Production requires the same
  // signed cookie used by the rest of the application before any hospital API.
  if (process.env.NODE_ENV === 'production' || process.env.HOSPITAL_DEMO_MODE === 'false') {
    app.use('/api/hospital', (req, res, next) => {
      if (typeof options.authenticateToken !== 'function') return res.status(503).json({ error: 'Hospital authentication is not configured.' });
      return options.authenticateToken(req, res, next);
    });
  }
  if (!state.audit.length) audit({ body: { actor: 'system', role: 'admin' }, get: () => null }, 'gap_engine_run', 'CareGap', 'all', 'Deterministic expected-versus-recorded comparison completed.');

  app.get('/api/hospital/state', (req, res) => res.json(snapshot()));
  app.get('/api/hospital/registry', (req, res) => res.json(registry(req.query)));
  app.get('/api/hospital/analytics', (req, res) => res.json(analytics()));
  app.get('/api/hospital/patients/:id/timeline', (req, res) => { const patient = patientById(req.params.id); if (!patient) return res.status(404).json({ error: 'Patient not found.' }); audit(req, 'patient_timeline_accessed', 'Patient', patient.id, 'Timeline viewed using minimum-necessary hospital access.'); res.json({ patient, timeline: patientTimeline(patient.id) }); });
  app.get('/api/hospital/patients/:id/gaps', (req, res) => res.json({ gaps: computeGaps().filter((gap) => gap.patientId === req.params.id), reviewStatus: 'human_review_required' }));
  app.post('/api/hospital/patients/:id/events', requirePermission('record_event'), (req, res) => {
    const patient = patientById(req.params.id); if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    if (!req.body.type || !req.body.recordedAt || !req.body.source) return res.status(400).json({ error: 'Event type, recorded date, and source are required.' });
    const event = { id: id('EV'), patientId: patient.id, type: String(req.body.type).slice(0, 120), recordedAt: req.body.recordedAt, source: String(req.body.source).slice(0, 100), documentRef: String(req.body.documentRef || '').slice(0, 120), recordedBy: actor(req), createdAt: now() };
    state.careEvents.push(event); audit(req, 'care_event_recorded', 'CareEvent', event.id, `${event.type} recorded with provenance.`, null, event); returnState(res, 'Care event recorded. Matching deterministic gaps were recalculated.', 201, { event });
  });
  app.get('/api/hospital/gaps', (req, res) => { const overdue = Number(req.query.overdue_gt || 0); const gaps = computeGaps().filter((g) => (!req.query.program || g.program === req.query.program) && (!req.query.provider || g.provider === req.query.provider) && (!req.query.assigned || g.assignedTo === req.query.assigned) && (!overdue || g.daysOverdue > overdue)); res.json({ gaps, scoringLabel: 'Operational outreach priority, not clinical risk.' }); });
  app.post('/api/hospital/gaps/:id/contact', requirePermission('gap_contact'), (req, res) => { const gap = findGap(req, res); if (!gap) return; const patient = patientById(gap.patientId); if (!patient.consent.outreach) return res.status(409).json({ error: 'Outreach is blocked because patient consent is not recorded.' }); const work = state.gapWork[gap.id] || { assignedTo: gap.provider, contacts: [] }; const before = clone(work); work.contacts = work.contacts || []; work.contacts.push({ method: req.body.method || 'phone', outcome: req.body.outcome || 'attempted', notes: req.body.notes || '', at: now(), by: actor(req) }); state.gapWork[gap.id] = work; audit(req, 'gap_contacted', 'CareGap', gap.id, `${req.body.method || 'phone'} outreach recorded.`, before, work); returnState(res, 'Contact outcome saved and audited.'); });
  app.post('/api/hospital/gaps/:id/reassign', requirePermission('gap_reassign'), (req, res) => { const gap = findGap(req, res); if (!gap) return; if (!req.body.assignedTo) return res.status(400).json({ error: 'New assignee is required.' }); const work = state.gapWork[gap.id] || { contacts: [] }; const before = clone(work); work.assignedTo = req.body.assignedTo; state.gapWork[gap.id] = work; audit(req, 'gap_reassigned', 'CareGap', gap.id, req.body.notes || `Assigned to ${req.body.assignedTo}.`, before, work); returnState(res, 'Gap reassigned and audited.'); });
  app.post('/api/hospital/gaps/:id/resolve', requirePermission('gap_resolve'), (req, res) => { const gap = findGap(req, res); if (!gap) return; if (!req.body.notes || !req.body.evidence) return res.status(400).json({ error: 'Resolution notes and evidence are required.' }); const work = state.gapWork[gap.id] || { contacts: [] }; const before = clone(work); Object.assign(work, { resolvedAt: now(), resolvedBy: actor(req), resolutionNotes: req.body.notes, evidence: req.body.evidence }); state.gapWork[gap.id] = work; audit(req, 'gap_resolved', 'CareGap', gap.id, req.body.notes, before, work); returnState(res, 'Gap resolved with evidence and audit history.'); });

  app.post('/api/hospital/pathways/:program/events', requirePermission('pathway_manage'), (req, res) => { const pathway = state.pathways[req.params.program]; if (!pathway) return res.status(404).json({ error: 'Program not found.' }); if (!req.body.type || !Number.isFinite(Number(req.body.offset))) return res.status(400).json({ error: 'Event name and day offset are required.' }); const event = { id: id('custom'), stage: req.body.stage || 'Custom stage', type: req.body.type, offset: Number(req.body.offset), requiredDocs: Array.isArray(req.body.requiredDocs) ? req.body.requiredDocs : [] }; pathway.events.push(event); pathway.version = Number(pathway.version || 1) + 1; audit(req, 'pathway_event_added', 'CarePathway', req.params.program, `Added ${event.type}.`, null, event); returnState(res, 'Pathway event added and persisted.', 201, { event }); });
  app.patch('/api/hospital/pathways/:program/events/:eventId', requirePermission('pathway_manage'), (req, res) => { const pathway = state.pathways[req.params.program]; const event = pathway && pathway.events.find((e) => e.id === req.params.eventId); if (!event) return res.status(404).json({ error: 'Pathway event not found.' }); const before = clone(event); if (req.body.type) event.type = req.body.type; if (req.body.stage) event.stage = req.body.stage; if (Number.isFinite(Number(req.body.offset))) event.offset = Number(req.body.offset); if (Array.isArray(req.body.requiredDocs)) event.requiredDocs = req.body.requiredDocs; pathway.version = Number(pathway.version || 1) + 1; audit(req, 'pathway_event_updated', 'CarePathway', req.params.program, `Updated ${event.id}.`, before, event); returnState(res, 'Pathway event updated and persisted.'); });
  app.delete('/api/hospital/pathways/:program/events/:eventId', requirePermission('pathway_manage'), (req, res) => { const pathway = state.pathways[req.params.program]; const index = pathway ? pathway.events.findIndex((e) => e.id === req.params.eventId) : -1; if (index < 0) return res.status(404).json({ error: 'Pathway event not found.' }); const before = pathway.events.splice(index, 1)[0]; pathway.version = Number(pathway.version || 1) + 1; audit(req, 'pathway_event_removed', 'CarePathway', req.params.program, `Removed ${before.type}.`, before, null); returnState(res, 'Pathway event removed and persisted.'); });

  app.get('/api/hospital/documents', (req, res) => res.json({ documents: state.documents.filter((d) => !req.query.patientId || d.patientId === req.query.patientId) }));
  app.post('/api/hospital/documents/ingest', requirePermission('document_ingest'), (req, res) => {
    const patient = patientById(req.body.patientId); if (!patient) return res.status(404).json({ error: 'Patient not found.' }); if (!patient.consent.documents) return res.status(409).json({ error: 'Document access consent is not recorded.' }); if (!req.body.name) return res.status(400).json({ error: 'Document name is required.' });
    const mimeType = req.body.mimeType || 'application/pdf'; if (!ALLOWED_MIME.has(mimeType)) return res.status(415).json({ error: 'Only PDF, PNG, JPEG, and plain-text files are supported.' });
    let buffer = null; if (req.body.contentBase64) { try { buffer = Buffer.from(req.body.contentBase64, 'base64'); } catch (_) { return res.status(400).json({ error: 'Document content is not valid base64.' }); } if (!buffer.length) return res.status(400).json({ error: 'Uploaded document is empty.' }); if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Document exceeds the 5 MB limit.' }); }
    const documentId = id('DOC'); let storageRef = ''; let hash = '';
    if (buffer) { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); const storedName = `${documentId}-${safeName(req.body.name)}`; storageRef = path.relative(DATA_DIR, path.join(UPLOAD_DIR, storedName)); fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer); hash = crypto.createHash('sha256').update(buffer).digest('hex'); }
    const document = { id: documentId, patientId: patient.id, name: safeName(req.body.name), type: req.body.type || 'clinical_document', mimeType, sizeBytes: buffer ? buffer.length : 0, sha256: hash || 'metadata-only', storageRef, uploadedAt: now(), status: 'pending_review', source: 'Hospital upload', extraction: { method: req.body.extractionMethod || 'submitted fact metadata', clinicalInterpretation: false, reviewRequired: true } };
    state.documents.unshift(document); const brief = state.consultationBriefs.find((b) => b.patientId === patient.id); const fact = { id: id('F'), label: req.body.factLabel || 'Document received', value: req.body.factValue || document.name, source: `Hospital upload ${documentId}`, confidence: req.body.confidence || 'unverified', status: 'pending_review' }; if (brief) { brief.facts.push(fact); brief.status = 'pending_review'; }
    audit(req, 'document_ingested', 'Document', documentId, 'Document stored and a review-required fact was created; no clinical interpretation was generated.', null, document); returnState(res, 'Document stored. Extracted facts require human review.', 201, { document, fact });
  });

  app.get('/api/hospital/consultations/:id/brief', (req, res) => { const brief = briefByAppointment(req.params.id); if (!brief) return res.status(404).json({ error: 'Consultation brief not found.' }); audit(req, 'brief_accessed', 'ConsultationBrief', req.params.id, 'Fact-only brief viewed.'); res.json({ brief, safety: 'Facts and missing/inconsistent information only; no clinical interpretation.' }); });
  app.post('/api/hospital/consultations/:id/brief/review', requirePermission('brief_review'), (req, res) => { const brief = briefByAppointment(req.params.id); if (!brief) return res.status(404).json({ error: 'Consultation brief not found.' }); const pending = brief.facts.filter((f) => f.status === 'pending_review'); if (pending.length) return res.status(409).json({ error: `Review ${pending.length} extracted fact(s) before approving the brief.` }); const before = clone(brief); brief.status = 'reviewed'; brief.reviewedBy = actor(req); brief.reviewedAt = now(); audit(req, 'brief_reviewed', 'ConsultationBrief', req.params.id, req.body.notes || 'Fact-only brief reviewed.', before, brief); returnState(res, 'Brief reviewed.'); });
  app.post('/api/hospital/consultations/:id/facts/:factId/accept', requirePermission('brief_review'), (req, res) => { const brief = briefByAppointment(req.params.id); const fact = brief && brief.facts.find((f) => f.id === req.params.factId); if (!fact) return res.status(404).json({ error: 'Fact not found.' }); const before = clone(fact); fact.status = 'accepted'; fact.reviewNotes = req.body.notes || ''; fact.reviewedBy = actor(req); fact.reviewedAt = now(); brief.status = 'pending_review'; audit(req, 'brief_fact_accepted', 'BriefFact', fact.id, fact.reviewNotes || 'Extracted fact accepted.', before, fact); returnState(res, 'Fact accepted.'); });
  app.patch('/api/hospital/consultations/:id/facts/:factId', requirePermission('brief_review'), (req, res) => { const brief = briefByAppointment(req.params.id); const fact = brief && brief.facts.find((f) => f.id === req.params.factId); if (!fact) return res.status(404).json({ error: 'Fact not found.' }); if (!req.body.value) return res.status(400).json({ error: 'Corrected fact value is required.' }); const before = clone(fact); fact.value = req.body.value; fact.status = 'accepted'; fact.reviewNotes = req.body.notes || 'Corrected during human review.'; fact.reviewedBy = actor(req); fact.reviewedAt = now(); audit(req, 'brief_fact_corrected', 'BriefFact', fact.id, fact.reviewNotes, before, fact); returnState(res, 'Fact corrected and accepted.'); });
  app.post('/api/hospital/consultations/:id/facts/:factId/reject', requirePermission('brief_review'), (req, res) => { const brief = briefByAppointment(req.params.id); const fact = brief && brief.facts.find((f) => f.id === req.params.factId); if (!fact) return res.status(404).json({ error: 'Fact not found.' }); const before = clone(fact); fact.status = 'rejected'; fact.reviewNotes = req.body.notes || 'Rejected for correction'; brief.status = 'needs_correction'; audit(req, 'brief_fact_rejected', 'BriefFact', fact.id, fact.reviewNotes, before, fact); returnState(res, 'Extracted fact rejected for correction.'); });

  app.get('/api/hospital/clinic/queue', (req, res) => res.json({ queue: state.queue, generatedAt: now() }));
  app.post('/api/hospital/clinic/queue/:id/status', requirePermission('queue_manage'), (req, res) => { const item = state.queue.find((q) => q.id === req.params.id); if (!item) return res.status(404).json({ error: 'Queue item not found.' }); const statuses = ['scheduled', 'checked_in', 'waiting', 'in_consultation', 'completed', 'cancelled', 'delayed_labs']; if (!statuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid queue status.' }); const before = clone(item); item.status = req.body.status; if (req.body.waitMins != null) item.waitMins = Math.max(0, Number(req.body.waitMins) || 0); if (before.status !== item.status) notify(req, item.patientId, 'in_app', `Appointment ${item.id} status changed to ${item.status.replaceAll('_', ' ')}.`, item.id); audit(req, 'queue_status_updated', 'Appointment', item.id, `Status changed to ${item.status}; patient notification queued when consent allows.`, before, item); returnState(res, 'Queue updated and audited.'); });
  app.post('/api/hospital/clinic/queue/:id/urgency', requirePermission('queue_manage'), (req, res) => { const item = state.queue.find((q) => q.id === req.params.id); if (!item) return res.status(404).json({ error: 'Queue item not found.' }); const before = clone(item); item.urgency = req.body.urgency || ''; item.urgencySetBy = item.urgency ? actor(req) : ''; audit(req, 'manual_urgency_updated', 'Appointment', item.id, item.urgency || 'Manual urgency cleared.', before, item); returnState(res, 'Clinician-set urgency updated.'); });
  app.post('/api/hospital/clinic/slots/:gapId/reassign', requirePermission('slot_reassign'), (req, res) => { const gap = computeGaps().find((g) => g.id === req.params.gapId); if (!gap) return res.status(404).json({ error: 'Care gap not found.' }); const slot = state.queue.find((q) => q.status === 'cancelled'); if (!slot) return res.status(409).json({ error: 'No cancelled slot is available.' }); const before = clone(slot); Object.assign(slot, { patientId: gap.patientId, provider: gap.provider, status: 'scheduled', urgency: '', urgencySetBy: '' }); const notification = notify(req, gap.patientId, req.body.channel || 'SMS', `A ${slot.slot} appointment slot has been assigned. Please confirm with the hospital.`, slot.id); audit(req, 'slot_reassigned', 'Appointment', slot.id, `Front desk assigned ${slot.slot} to ${gap.patientName}; notification ${notification ? 'queued' : 'blocked by consent'}.`, before, slot); returnState(res, 'Slot reassigned and patient notification handled.'); });

  app.get('/api/hospital/content', (req, res) => res.json({ drafts: state.drafts, campaigns: state.campaigns }));
  app.post('/api/hospital/content/draft', requirePermission('draft_edit'), (req, res) => { const source = String(req.body.source || 'Hospital-approved knowledge base'); const draft = { id: id('D'), type: req.body.type || 'patient handout', language: req.body.language || 'English', patientId: req.body.patientId || null, status: 'draft', version: 1, source, body: req.body.body || 'New draft created from approved hospital source material.', reviewNotes: '', createdAt: now() }; state.drafts.unshift(draft); audit(req, 'draft_generated', 'ContentDraft', draft.id, 'Draft generated and held for human review.', null, draft); returnState(res, 'Draft generated and held for review.', 201, { draft }); });
  app.post('/api/hospital/content/:id/edit', requirePermission('draft_edit'), (req, res) => { const draft = state.drafts.find((d) => d.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); if (draft.status === 'published') return res.status(409).json({ error: 'Published content cannot be edited.' }); const before = clone(draft); draft.body = req.body.body || draft.body; draft.language = req.body.language || draft.language; draft.version += 1; draft.status = 'pending_review'; audit(req, 'draft_edited', 'ContentDraft', draft.id, 'Draft edited and returned to review.', before, draft); returnState(res, 'Draft saved and returned to review.'); });
  app.post('/api/hospital/content/:id/approve', requirePermission('draft_review'), (req, res) => { const draft = state.drafts.find((d) => d.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); const before = clone(draft); Object.assign(draft, { status: 'approved', reviewNotes: req.body.notes || '', approvedBy: actor(req), approvedAt: now() }); audit(req, 'draft_approved', 'ContentDraft', draft.id, 'Draft approved by clinician.', before, draft); returnState(res, 'Draft approved.'); });
  app.post('/api/hospital/content/:id/reject', requirePermission('draft_review'), (req, res) => { const draft = state.drafts.find((d) => d.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); const before = clone(draft); draft.status = 'rejected'; draft.reviewNotes = req.body.notes || 'Rejected'; audit(req, 'draft_rejected', 'ContentDraft', draft.id, draft.reviewNotes, before, draft); returnState(res, 'Draft rejected.'); });
  app.post('/api/hospital/content/:id/publish', requirePermission('draft_review'), (req, res) => { const draft = state.drafts.find((d) => d.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); if (draft.status !== 'approved') return res.status(409).json({ error: 'Publishing is blocked until a clinician approves the draft.' }); const before = clone(draft); draft.status = 'published'; draft.publishedBy = actor(req); draft.publishedAt = now(); audit(req, 'draft_published', 'ContentDraft', draft.id, 'Approved content published/filed.', before, draft); returnState(res, 'Approved content published.'); });
  app.post('/api/hospital/campaigns', requirePermission('campaign_manage'), (req, res) => { const draft = state.drafts.find((d) => d.id === req.body.draftId); if (!draft || draft.status !== 'approved') return res.status(409).json({ error: 'A clinician-approved draft is required before scheduling.' }); if (!req.body.scheduledFor) return res.status(400).json({ error: 'Campaign date and time are required.' }); const campaign = { id: id('CAM'), draftId: draft.id, title: req.body.title || draft.type, audience: req.body.audience || 'Selected program cohort', channel: req.body.channel || 'in_app', scheduledFor: req.body.scheduledFor, status: 'scheduled', createdBy: actor(req), createdAt: now() }; state.campaigns.unshift(campaign); audit(req, 'campaign_scheduled', 'Campaign', campaign.id, `Approved content ${draft.id} scheduled.`, null, campaign); returnState(res, 'Campaign scheduled with approved content.', 201, { campaign }); });
  app.get('/api/hospital/campaigns', (req, res) => res.json({ campaigns: state.campaigns }));
  app.get('/api/hospital/knowledge', (req, res) => { const q = String(req.query.q || '').toLowerCase(); const rows = state.knowledgeBase.filter((item) => item.status === 'approved' && (!q || `${item.title} ${item.category} ${item.summary}`.toLowerCase().includes(q))); res.json({ results: rows, safety: 'Approved reading material only; no patient-specific recommendation.' }); });

  app.get('/api/hospital/facility', (req, res) => res.json({ cases: state.facilityCases }));
  app.post('/api/hospital/facility', requirePermission('facility_review'), (req, res) => { const patient = patientById(req.body.patientId); if (!patient) return res.status(404).json({ error: 'Patient not found.' }); const facilityCase = { id: id('FC'), patientId: patient.id, label: req.body.label || `${patient.name} - facility readiness`, prioritySource: 'Clinician-set', owner: req.body.owner || 'Facility coordinator', checklist: (req.body.checklist || ['Care team confirmed', 'Room availability confirmed', 'Equipment checked']).map((label, index) => ({ id: `item-${index + 1}`, label, ready: false, confirmedBy: '', confirmedAt: '' })) }; state.facilityCases.unshift(facilityCase); audit(req, 'facility_case_created', 'FacilityCase', facilityCase.id, 'Readiness case created with clinician-set priority.', null, facilityCase); returnState(res, 'Facility readiness case created.', 201, { facilityCase }); });
  app.post('/api/hospital/facility/:caseId/items/:itemId/toggle', requirePermission('facility_review'), (req, res) => { const facilityCase = state.facilityCases.find((c) => c.id === req.params.caseId); const item = facilityCase && facilityCase.checklist.find((x) => x.id === req.params.itemId); if (!item) return res.status(404).json({ error: 'Readiness item not found.' }); const before = clone(item); item.ready = req.body.ready !== false; item.confirmedBy = item.ready ? actor(req) : ''; item.confirmedAt = item.ready ? now() : ''; audit(req, 'facility_readiness_updated', 'FacilityCase', facilityCase.id, `${item.label}: ${item.ready ? 'ready' : 'not ready'}.`, before, item); returnState(res, 'Facility readiness updated.'); });

  app.get('/api/hospital/notifications', (req, res) => res.json({ notifications: state.notifications.filter((n) => !req.query.patientId || n.patientId === req.query.patientId) }));
  app.post('/api/hospital/notifications/:id/status', requirePermission('notification_manage'), (req, res) => { const item = state.notifications.find((n) => n.id === req.params.id); if (!item) return res.status(404).json({ error: 'Notification not found.' }); const before = clone(item); item.status = ['queued', 'sent', 'failed', 'read'].includes(req.body.status) ? req.body.status : item.status; item.updatedAt = now(); audit(req, 'notification_status_updated', 'Notification', item.id, `Notification marked ${item.status}.`, before, item); returnState(res, 'Notification status updated.'); });

  app.get('/api/hospital/sos', (req, res) => res.json({ requests: state.sosRequests }));
  app.post('/api/hospital/sos/trigger', (req, res) => { const patient = patientById(req.body.patientId); if (!patient) return res.status(404).json({ error: 'Patient not found.' }); if (!req.body.consentConfirmed) return res.status(400).json({ error: 'Consent confirmation is required.' }); if (req.body.location && !patient.consent.emergencyLocation && !req.body.oneTimeLocationConsent) return res.status(409).json({ error: 'Location sharing requires recorded or one-time consent.' }); const request = { id: id('SOS'), patientId: patient.id, status: 'awaiting_verification', location: req.body.location || 'Not shared', consentConfirmed: true, createdAt: now(), verifiedBy: '', respondedBy: '' }; state.sosRequests.unshift(request); audit(req, 'sos_received', 'SOSRequest', request.id, 'Emergency request received; second-layer verification required.', null, request); returnState(res, 'SOS received and awaiting verification.', 201, { request }); });
  app.post('/api/hospital/sos/:id/authenticate', requirePermission('sos_review'), (req, res) => { const request = state.sosRequests.find((s) => s.id === req.params.id); if (!request) return res.status(404).json({ error: 'SOS request not found.' }); const before = clone(request); request.status = 'verified'; request.verifiedBy = actor(req); request.verifiedAt = now(); audit(req, 'sos_verified', 'SOSRequest', request.id, 'Second-layer verification completed.', before, request); returnState(res, 'SOS verified. Facility response is now enabled.'); });
  app.post('/api/hospital/sos/:id/respond', requirePermission('sos_review'), (req, res) => { const request = state.sosRequests.find((s) => s.id === req.params.id); if (!request) return res.status(404).json({ error: 'SOS request not found.' }); if (request.status !== 'verified') return res.status(409).json({ error: 'SOS must be verified before a facility responds.' }); const before = clone(request); request.status = req.body.response === 'decline' ? 'declined' : 'accepted'; request.respondedBy = actor(req); request.respondedAt = now(); audit(req, 'sos_response_recorded', 'SOSRequest', request.id, `Facility ${request.status} the request.`, before, request); returnState(res, 'Facility response recorded in the patient history.'); });
  app.get('/api/hospital/audit', (req, res) => { const rows = state.audit.filter((e) => (!req.query.actor || e.actor.toLowerCase().includes(String(req.query.actor).toLowerCase())) && (!req.query.action || e.action.includes(req.query.action)) && (!req.query.entity || `${e.entityType} ${e.entityId}`.includes(req.query.entity)) && (!req.query.date || e.timestamp.slice(0, 10) === req.query.date)); res.json({ audit: rows }); });

  function doctorSnapshot(provider = 'Dr. S. Kumar') { const gaps = computeGaps(); const doctorPatients = state.patients.filter((p) => p.provider === provider).map((p) => ({ ...p, openGaps: gaps.filter((g) => g.patientId === p.id), openGapCount: gaps.filter((g) => g.patientId === p.id).length, doctorPriorityFlag: state.doctorPriorityFlags[p.id] || null, nextAppointment: state.queue.find((q) => q.patientId === p.id) || null, timeline: patientTimeline(p.id) })); return { today: HOSPITAL_TODAY, safety: snapshot().safety, doctor: { id: 'DOC-100', name: provider, role: 'doctor', specialty: 'Maternal continuity and OPD follow-up' }, patients: doctorPatients, consultationBrief: state.consultationBriefs[0], appointments: state.queue.filter((q) => doctorPatients.some((p) => p.id === q.patientId)).map((q) => ({ ...q, patient: patientById(q.patientId) })), drafts: state.drafts, audit: state.audit }; }
  app.get('/api/doctor-portal/state', (req, res) => res.json(doctorSnapshot(req.query.provider || 'Dr. S. Kumar')));
  app.post('/api/doctor-portal/patients/:id/priority', (req, res) => { const patient = patientById(req.params.id); if (!patient) return res.status(404).json({ error: 'Patient not found.' }); const before = clone(state.doctorPriorityFlags[patient.id] || null); state.doctorPriorityFlags[patient.id] = { active: req.body.active !== false, setBy: req.body.actor || patient.provider, label: 'Doctor-set high-priority follow-up', notes: req.body.notes || 'Manual doctor-set priority.', updatedAt: now() }; audit({ ...req, body: { ...req.body, role: 'doctor' } }, 'doctor_priority_updated', 'Patient', patient.id, state.doctorPriorityFlags[patient.id].notes, before, state.doctorPriorityFlags[patient.id]); res.json({ message: 'Doctor-set priority updated.', state: doctorSnapshot(patient.provider) }); });
  app.post('/api/doctor-portal/consultations/:id/brief/review', (req, res) => { const brief = briefByAppointment(req.params.id); if (!brief) return res.status(404).json({ error: 'Brief not found.' }); if (brief.facts.some((f) => f.status === 'pending_review')) return res.status(409).json({ error: 'Review extracted facts before approving the brief.' }); brief.status = 'reviewed'; audit({ ...req, body: { ...req.body, role: 'doctor' } }, 'doctor_brief_reviewed', 'ConsultationBrief', req.params.id, 'Doctor reviewed fact-only brief.'); res.json({ message: 'Brief reviewed.', state: doctorSnapshot(req.body.actor || 'Dr. S. Kumar') }); });
  app.post('/api/doctor-portal/consultations/:id/brief/reject', (req, res) => { const brief = briefByAppointment(req.params.id); if (!brief) return res.status(404).json({ error: 'Brief not found.' }); brief.status = 'needs_correction'; audit({ ...req, body: { ...req.body, role: 'doctor' } }, 'doctor_brief_rejected', 'ConsultationBrief', req.params.id, 'Doctor requested correction.'); res.json({ message: 'Brief correction requested.', state: doctorSnapshot(req.body.actor || 'Dr. S. Kumar') }); });
  app.post('/api/doctor-portal/drafts', (req, res) => { req.body.role = 'doctor'; const draft = { id: id('D'), type: req.body.type || 'referral letter', language: 'English', patientId: req.body.patientId || null, status: 'draft', version: 1, source: 'Reviewed patient facts', body: req.body.body || 'Doctor draft generated from reviewed facts.', reviewNotes: '' }; state.drafts.unshift(draft); audit(req, 'doctor_draft_generated', 'ContentDraft', draft.id, 'Doctor draft generated.', null, draft); res.status(201).json({ draft, state: doctorSnapshot(req.body.actor || 'Dr. S. Kumar') }); });
  app.post('/api/doctor-portal/drafts/:id/:action', (req, res) => { const draft = state.drafts.find((d) => d.id === req.params.id); if (!draft) return res.status(404).json({ error: 'Draft not found.' }); const before = clone(draft); if (req.params.action === 'finalize' && draft.status !== 'approved') return res.status(409).json({ error: 'Finalizing is blocked until approval.' }); if (!['approve', 'reject', 'finalize'].includes(req.params.action)) return res.status(400).json({ error: 'Invalid draft action.' }); draft.status = req.params.action === 'approve' ? 'approved' : req.params.action === 'reject' ? 'rejected' : 'published'; req.body.role = 'doctor'; audit(req, `doctor_draft_${req.params.action}`, 'ContentDraft', draft.id, req.body.notes || `Draft ${draft.status}.`, before, draft); res.json({ message: 'Draft updated.', state: doctorSnapshot(req.body.actor || 'Dr. S. Kumar') }); });
  app.get('/api/patient/state', (req, res) => { const patient = patientById('P-1002'); res.json({ patient: { id: patient.id, name: patient.name, stage: patient.stage, language: 'English', consent: patient.consent }, timeline: patientTimeline(patient.id), appointments: state.queue.filter((q) => q.patientId === patient.id), documents: state.documents.filter((d) => d.patientId === patient.id), notifications: state.notifications.filter((n) => n.patientId === patient.id), safety: { companionScope: 'milestone_explanation_only', noDiagnosisOrTreatmentAdvice: true } }); });
};
