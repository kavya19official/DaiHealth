// ============================================================================
// Notification Center
//
// Notifications aren't hand-authored — they're derived fresh from the data
// every time GET /api/notifications is called, then upserted by a stable
// dedupe_key so the same condition never shows twice. A condition that stops
// being true (a vaccine gets marked given, an appointment passes) is removed
// automatically if the mother never read it, and left alone (so her read
// history doesn't get rewritten) if she already had.
//
//   GET    /api/notifications              list, newest first, plus unread_count
//   PATCH  /api/notifications/:id/read     mark one read
//   POST   /api/notifications/read-all
//   DELETE /api/notifications/:id          dismiss (hide, doesn't come back
//                                           unless the underlying condition changes)
//
// Mothers get: vaccines due/missed for each child, low/severe growth flags,
// care-timeline items due soon or overdue, and appointments happening soon.
// Doctors get: pending appointment requests and today's confirmed appointments.
// ============================================================================
const Ref = require('../shared/child-reference.js');

const NOTIF_COLUMNS = 'id, dedupe_key, severity, category, title, body, route, route_sub, child_id, event_date, created_at, read_at';

function todayISOOf(pool) {
  return pool.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`).then((r) => r.rows[0].d);
}
function relDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

module.exports = function registerNotificationRoutes(app, { pool, authenticateToken }) {
  // Builds today's candidate notifications for a mother: [{ dedupe_key, severity, category, title, body, route, route_sub, child_id, event_date }]
  async function computeMotherNotifications(motherId, today) {
    const out = [];

    // Children: vaccines due/missed, growth flags
    const kids = (await pool.query(
      `SELECT id, name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, sex, born_at_weeks FROM children WHERE mother_id = $1`,
      [motherId])).rows;
    if (kids.length) {
      const ids = kids.map((k) => k.id);
      const [vax, growth] = await Promise.all([
        pool.query(`SELECT child_id, vaccine_code, to_char(given_on, 'YYYY-MM-DD') AS given_on FROM child_vaccinations WHERE child_id = ANY($1::int[])`, [ids]),
        pool.query(`SELECT child_id, to_char(measured_on, 'YYYY-MM-DD') AS measured_on, weight_kg::float8 AS weight_kg FROM child_growth_logs
                      WHERE child_id = ANY($1::int[]) AND weight_kg IS NOT NULL ORDER BY child_id, measured_on`, [ids]),
      ]);
      kids.forEach((k) => {
        const given = {};
        vax.rows.filter((v) => v.child_id === k.id).forEach((v) => { given[v.vaccine_code] = v.given_on; });
        const sched = Ref.vaccineSchedule(k.date_of_birth, given, today);
        sched.forEach((v) => {
          if (v.status === 'missed') {
            out.push({ dedupe_key: `vax:${k.id}:${v.code}:missed`, severity: 'warn', category: 'vaccine',
              title: `${v.name} is overdue for ${k.name}`, body: `Due ${v.dueDate} · ${v.stage}. A late dose can usually still be given — ask your ASHA worker or health centre.`,
              route: 'child', route_sub: 'vaccines', child_id: k.id, event_date: v.dueDate });
          } else if (v.status === 'due') {
            out.push({ dedupe_key: `vax:${k.id}:${v.code}:due`, severity: 'info', category: 'vaccine',
              title: `${v.name} is due ${relDays(v.daysUntil)} for ${k.name}`, body: `${v.stage} · due ${v.dueDate}.`,
              route: 'child', route_sub: 'vaccines', child_id: k.id, event_date: v.dueDate });
          }
        });
        const rows = growth.rows.filter((g) => g.child_id === k.id);
        const last = rows[rows.length - 1];
        if (last) {
          const status = Ref.weightStatus(k.sex, Ref.chartAgeMonths(k.date_of_birth, last.measured_on, k.born_at_weeks), last.weight_kg);
          if (status === 'severe' || status === 'low') {
            out.push({ dedupe_key: `growth:${k.id}:${last.measured_on}:${status}`, severity: status === 'severe' ? 'danger' : 'warn', category: 'growth',
              title: `${k.name}'s weight is ${status === 'severe' ? 'well ' : ''}below the WHO reference`,
              body: `${last.weight_kg} kg on ${last.measured_on}. This is a screening flag, not a diagnosis — please show it to your paediatrician.`,
              route: 'child', route_sub: 'growth', child_id: k.id, event_date: last.measured_on });
          }
        }
      });
    }

    // Care timeline: due soon or overdue, not completed
    const milestones = (await pool.query(
      `SELECT id, title, to_char(due_date, 'YYYY-MM-DD') AS due_date
         FROM care_milestones
        WHERE mother_id = $1 AND completed_at IS NULL AND due_date <= ($2::date + 7)
        ORDER BY due_date ASC LIMIT 8`, [motherId, today])).rows;
    milestones.forEach((m) => {
      const days = Ref.daysBetween(today, m.due_date);
      out.push({ dedupe_key: `care:${m.id}:${days < 0 ? 'overdue' : 'due'}`, severity: days < 0 ? 'warn' : 'info', category: 'care_plan',
        title: days < 0 ? `${m.title} is overdue` : `${m.title} is due ${relDays(days)}`, body: `Due ${m.due_date}.`,
        route: 'dashboard', route_sub: null, child_id: null, event_date: m.due_date });
    });

    // Appointments in the next 3 days that are still pending or confirmed
    const appts = (await pool.query(
      `SELECT a.id, a.status, to_char(a.requested_date, 'YYYY-MM-DD') AS requested_date, dp.full_name AS doctor_name
         FROM appointments a JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
        WHERE a.mother_id = $1 AND a.status IN ('pending', 'confirmed')
          AND a.requested_date BETWEEN $2::date AND ($2::date + 3)
        ORDER BY a.requested_date ASC LIMIT 8`, [motherId, today]).catch(() => ({ rows: [] }))).rows;
    appts.forEach((a) => {
      const days = Ref.daysBetween(today, a.requested_date);
      out.push({ dedupe_key: `appt:${a.id}:${relDays(days)}`, severity: 'info', category: 'appointment',
        title: `Appointment with Dr. ${a.doctor_name} ${relDays(days)}`,
        body: a.status === 'pending' ? 'Still waiting for the doctor to confirm.' : 'Confirmed.',
        route: 'appointments', route_sub: null, child_id: null, event_date: a.requested_date });
    });

    return out;
  }

  async function computeDoctorNotifications(doctorId, today) {
    const out = [];
    const pending = (await pool.query(
      `SELECT a.id, to_char(a.requested_date, 'YYYY-MM-DD') AS requested_date, mp.full_name AS mother_name
         FROM appointments a JOIN mother_profiles mp ON mp.user_id = a.mother_id
        WHERE a.doctor_id = $1 AND a.status = 'pending' ORDER BY a.requested_date ASC LIMIT 15`, [doctorId])).rows;
    pending.forEach((a) => out.push({ dedupe_key: `apptreq:${a.id}`, severity: 'info', category: 'appointment',
      title: `${a.mother_name} requested an appointment`, body: `Requested for ${a.requested_date}.`,
      route: 'appointments', route_sub: null, child_id: null, event_date: a.requested_date }));

    const todayAppts = (await pool.query(
      `SELECT a.id, mp.full_name AS mother_name
         FROM appointments a JOIN mother_profiles mp ON mp.user_id = a.mother_id
        WHERE a.doctor_id = $1 AND a.status = 'confirmed' AND a.requested_date = $2::date`, [doctorId, today])).rows;
    todayAppts.forEach((a) => out.push({ dedupe_key: `apptoday:${a.id}`, severity: 'info', category: 'appointment',
      title: `${a.mother_name} is booked today`, body: 'Confirmed appointment today.',
      route: 'appointments', route_sub: null, child_id: null, event_date: today }));

    return out;
  }

  // Upserts the freshly computed set, and clears out unread rows whose condition
  // no longer holds (read ones are kept as history, just left unmatched by future syncs).
  async function sync(userId, fresh) {
    if (fresh.length) {
      const values = [];
      const params = [userId];
      fresh.forEach((n, i) => {
        const base = params.length;
        params.push(n.dedupe_key, n.severity, n.category, n.title.slice(0, 200), (n.body || '').slice(0, 500) || null, n.route, n.route_sub, n.child_id, n.event_date);
        values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
      });
      await pool.query(
        `INSERT INTO notifications (user_id, dedupe_key, severity, category, title, body, route, route_sub, child_id, event_date)
         VALUES ${values.join(', ')}
         ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
           severity = EXCLUDED.severity, title = EXCLUDED.title, body = EXCLUDED.body, event_date = EXCLUDED.event_date`,
        params);
    }
    const keep = fresh.map((n) => n.dedupe_key);
    await pool.query(
      `DELETE FROM notifications WHERE user_id = $1 AND read_at IS NULL AND NOT (dedupe_key = ANY($2::text[]))`,
      [userId, keep]);
  }

  app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
      const today = await todayISOOf(pool);
      const fresh = req.user.role === 'mother'
        ? await computeMotherNotifications(req.user.id, today)
        : req.user.role === 'doctor' ? await computeDoctorNotifications(req.user.id, today) : [];
      await sync(req.user.id, fresh);

      const rows = (await pool.query(
        `SELECT ${NOTIF_COLUMNS} FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL
          ORDER BY (read_at IS NULL) DESC, event_date ASC NULLS LAST, created_at DESC LIMIT 50`, [req.user.id])).rows;
      res.json({ notifications: rows, unread_count: rows.filter((r) => !r.read_at).length });
    } catch (error) {
      console.error('Load notifications error:', error);
      res.status(500).json({ error: 'Failed to load notifications' });
    }
  });

  app.patch('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Notification not found' });
      res.json({ message: 'Marked read' });
    } catch (error) {
      console.error('Mark notification read error:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  });

  app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
      await pool.query('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
      res.json({ message: 'All marked read' });
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      res.status(500).json({ error: 'Failed to update notifications' });
    }
  });

  app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const r = await pool.query('UPDATE notifications SET dismissed_at = CURRENT_TIMESTAMP, read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Notification not found' });
      res.json({ message: 'Dismissed' });
    } catch (error) {
      console.error('Dismiss notification error:', error);
      res.status(500).json({ error: 'Failed to dismiss notification' });
    }
  });
};
