'use strict';

const { revokedSql, activeRelationshipSql } = require('./accessControl');
const { verifiedDoctor } = require('./clinicalDashboard');
const { today } = require('../frontend/js/patient-model');

const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const aliases = [
  ['cbc', 'complete blood count', 'full blood count', 'fbc'],
  ['lft', 'liver function test', 'liver function tests'],
  ['hba1c', 'hemoglobin a1c', 'haemoglobin a1c']
];

function matchesReport(name, title) {
  const term = normalize(name);
  if (term.length < 3) return false;
  const words = ' ' + normalize(title) + ' ';
  return (aliases.find(group => group.includes(term)) || [term]).some(value => words.includes(' ' + value + ' '));
}

function planItems(summary) {
  const tests = (summary.pending_tests || []).flatMap((test, index) => test?.name ? [{
    key: 'test:' + index, title: test.name, note: test.note, due_date: test.due_date
  }] : []);
  const steps = (summary.next_steps || []).flatMap((step, index) => step ? [{
    key: 'step:' + index, title: step
  }] : []);
  const followup = summary.follow_up || {};
  const visit = followup.text || followup.due_date ? [{
    key: 'visit', title: 'Follow-up visit', note: followup.text, due_date: followup.due_date
  }] : [];
  return [...tests, ...visit, ...steps];
}

function reviewItems(summary, date) {
  return planItems(summary).filter(item => !(summary.reviewed || []).includes(item.key)).map(item => {
    const isTest = item.key.startsWith('test:');
    const reports = isTest ? (summary.reports || []).filter(report => matchesReport(item.title, report.title)).slice(0, 5) : [];
    const appointment = item.key === 'visit' ? summary.next_visit : isTest && !reports.length
      ? (summary.test_visits || []).find(visit => {
        const term = normalize(item.title);
        const names = aliases.find(group => group.includes(term)) || [term];
        return term && names.includes(normalize(visit.reason));
      }) : null;
    const status = reports.length ? 'report_to_review' : appointment ? 'visit_to_check' :
      item.due_date && item.due_date < date ? 'overdue' :
      item.due_date ? 'waiting' : 'check_manually';
    const reminder = status === 'overdue'
      ? isTest
        ? 'Hello, I’m checking in about a test listed in your visit summary. If you’ve completed it, please let us know whether the report is available. If you need help arranging it, please contact the clinic.'
        : 'Hello, I’m checking in about the follow-up discussed at your visit. Please contact the clinic to confirm whether you have an appointment or need help arranging one.'
      : null;
    return {
      ...item, status, reports, appointment: appointment ? { id: appointment.id, date: appointment.date,
        status: appointment.status } : null, reminder, summary_id: summary.id,
      appointment_id: summary.appointment_id, patient_name: summary.patient_name,
      visit_date: summary.visit_date, version: summary.version
    };
  });
}

const eligible = `s.doctor_id = $1 AND a.doctor_id = $1 AND a.mother_id = s.mother_id
  AND s.status = 'approved' AND a.status IN ('completed','confirmed','scheduled')
  AND a.child_id IS NULL AND NOT ${revokedSql('a.mother_id', 'a.doctor_id', 'a.facility_uuid')}`;

function register(app, { pool, authenticateToken, authorizeRole, verify = verifiedDoctor }) {
  const guards = [authenticateToken, authorizeRole(['doctor'])];
  app.get('/api/doctor/follow-up-agent', ...guards, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && (!Number.isInteger(before) || before < 1 || before > 2147483647)) {
      return res.status(400).json({ error: 'Invalid queue cursor.' });
    }
    try {
      if (!await verify(pool, req.user.id)) return res.status(403).json({ error: 'Verified clinician access is required.' });
      const { rows } = await pool.query(`
        WITH batch AS (
          SELECT s.id, s.appointment_id, s.mother_id, s.version, s.pending_tests, s.next_steps, s.follow_up,
                 a.requested_date, to_char(a.requested_date,'YYYY-MM-DD') AS visit_date,
                 mp.full_name AS patient_name,
                 ARRAY(SELECT review.item_key FROM doctor_followup_reviews review WHERE review.summary_id=s.id) AS reviewed
          FROM visit_summaries s JOIN appointments a ON a.id=s.appointment_id
          LEFT JOIN mother_profiles mp ON mp.user_id=s.mother_id
          WHERE ${eligible} AND ($2::int IS NULL OR s.id < $2)
            AND (s.pending_tests <> '[]'::jsonb OR s.next_steps <> '[]'::jsonb OR s.follow_up <> '{}'::jsonb)
          ORDER BY s.id DESC LIMIT 26
        )
        SELECT b.*, COALESCE(reports.items,'[]'::jsonb) AS reports, next_visit.item AS next_visit, COALESCE(test_visits.items,'[]'::jsonb) AS test_visits
        FROM batch b
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(to_jsonb(candidate) ORDER BY candidate.id DESC) AS items
          FROM (
            SELECT d.id,d.title,to_char(COALESCE(d.report_date,d.uploaded_at::date),'YYYY-MM-DD') AS date
            FROM patient_documents d
            WHERE b.pending_tests <> '[]'::jsonb AND d.mother_id=b.mother_id
              AND d.child_id IS NULL AND d.deleted_at IS NULL AND NOT COALESCE(d.is_sensitive,false)
              AND d.doc_type IN ('lab_report','medical_report','scan_imaging')
              AND d.verification_status <> 'rejected'
              AND COALESCE(d.report_date,d.uploaded_at::date) >= b.requested_date
              AND (d.appointment_id IS NULL OR d.appointment_id=b.appointment_id)
              AND ((d.uploaded_by_role='doctor' AND d.uploaded_by=$1
                    AND ${activeRelationshipSql('d.mother_id', '$1::int')})
                OR (COALESCE((SELECT (preferences->>'privacy_share_doctors')::boolean FROM patient_preferences WHERE user_id=d.mother_id),TRUE)
                  AND EXISTS (SELECT 1 FROM patient_document_shares ds WHERE ds.document_id=d.id AND ds.doctor_id=$1
                    AND ds.revoked_at IS NULL AND (ds.expires_at IS NULL OR ds.expires_at>NOW()))))
            ORDER BY d.id DESC LIMIT 50
          ) candidate
        ) reports ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_build_object('id',v.id,'date',to_char(v.requested_date,'YYYY-MM-DD'),'status',v.status) AS item
          FROM appointments v WHERE b.follow_up <> '{}'::jsonb AND v.mother_id=b.mother_id AND v.doctor_id=$1 AND NOT ${revokedSql('v.mother_id','v.doctor_id','v.facility_uuid')}
            AND v.id<>b.appointment_id AND v.child_id IS NULL AND v.requested_date>=b.requested_date
            AND LOWER(COALESCE(v.visit_type,''))='follow-up'
            AND v.status IN ('confirmed','scheduled','completed')
          ORDER BY ABS(v.requested_date-COALESCE((b.follow_up->>'due_date')::date,b.requested_date)),
                   v.requested_date, v.id LIMIT 1
        ) next_visit ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(to_jsonb(candidate) ORDER BY candidate.date,candidate.id) AS items
          FROM (
            SELECT v.id,to_char(v.requested_date,'YYYY-MM-DD') AS date,v.status,v.reason
            FROM appointments v WHERE b.pending_tests <> '[]'::jsonb AND v.mother_id=b.mother_id
              AND v.doctor_id=$1 AND v.id<>b.appointment_id AND v.child_id IS NULL
              AND v.requested_date>=GREATEST((NOW() AT TIME ZONE 'Asia/Kolkata')::date,b.requested_date)
              AND v.status IN ('confirmed','scheduled')
              AND NOT ${revokedSql('v.mother_id','v.doctor_id','v.facility_uuid')}
            ORDER BY v.requested_date,v.id LIMIT 50
          ) candidate
        ) test_visits ON true
        ORDER BY b.id DESC`, [req.user.id, before]);
      const date = today();
      const priority = ['overdue', 'report_to_review', 'visit_to_check', 'check_manually', 'waiting'];
      const items = rows.slice(0, 25).flatMap(row => reviewItems(row, date))
        .sort((a,b) => priority.indexOf(a.status) - priority.indexOf(b.status) ||
          (a.due_date || '9999').localeCompare(b.due_date || '9999'));
      res.json({ items, next_before: rows.length > 25 ? rows[24].id : null });
    } catch {
      res.status(500).json({ error: 'Could not load the follow-up review queue.' });
    }
  });

  app.put('/api/doctor/follow-up-agent/:summaryId/review', ...guards, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const id = Number(req.params.summaryId);
    const key = req.body?.item_key;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || typeof key !== 'string' ||
        !/^(test:[0-7]|step:[0-7]|visit)$/.test(key)) {
      return res.status(400).json({ error: 'Invalid follow-up item.' });
    }
    try {
      if (!await verify(pool, req.user.id)) return res.status(403).json({ error: 'Verified clinician access is required.' });
      const { rows } = await pool.query(`
        INSERT INTO doctor_followup_reviews (summary_id,item_key,reviewed_by)
        SELECT s.id,$3::text,$1 FROM visit_summaries s JOIN appointments a ON a.id=s.appointment_id
        WHERE s.id=$2 AND ${eligible}
          AND CASE
            WHEN $3='visit' THEN s.follow_up <> '{}'::jsonb
            WHEN $3 LIKE 'test:%' THEN s.pending_tests -> (split_part($3,':',2)::int) IS NOT NULL
            ELSE s.next_steps -> (split_part($3,':',2)::int) IS NOT NULL
          END
        ON CONFLICT (summary_id,item_key) DO UPDATE SET reviewed_at=doctor_followup_reviews.reviewed_at
        RETURNING summary_id`, [req.user.id, id, key]);
      if (!rows.length) return res.status(404).json({ error: 'This follow-up is no longer available. Refresh the queue.' });
      res.json({ reviewed: true });
    } catch {
      res.status(500).json({ error: 'Could not mark the follow-up reviewed.' });
    }
  });
}

module.exports = { register, matchesReport, reviewItems };
