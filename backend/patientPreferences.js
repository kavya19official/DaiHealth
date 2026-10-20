/**
 * Patient preferences API
 *
 *   GET   /api/me/preferences
 *   PATCH /api/me/preferences   body: { preferences: { ... } }
 *
 * Merges whitelist keys into JSONB so clients can send partial updates.
 * Survives refresh and re-login when the JWT cookie is present.
 */
module.exports = function registerPatientPreferences(app, { pool, authenticateToken }) {
  const ALLOWED = [
    'lang',
    'notif_appt',
    'notif_vax',
    'notif_growth',
    'notif_care',
    'notif_sms',
    'privacy_share_doctors',
    'privacy_analytics',
  ];

  function cleanPrefs(incoming) {
    const clean = {};
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return clean;
    for (const k of ALLOWED) {
      if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
      if (k === 'lang') {
        const v = String(incoming[k] || '').toLowerCase();
        if (v === 'hi' || v === 'hindi') clean.lang = 'hi';
        else if (v === 'en' || v === 'english') clean.lang = 'en';
      } else {
        clean[k] = !!incoming[k];
      }
    }
    return clean;
  }

  app.get('/api/me/preferences', authenticateToken, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT preferences FROM patient_preferences WHERE user_id = $1',
        [req.user.id]
      );
      res.json({ preferences: (rows[0] && rows[0].preferences) || {} });
    } catch (err) {
      console.error('GET /api/me/preferences', err.message);
      res.status(500).json({ error: 'Could not load preferences' });
    }
  });

  app.patch('/api/me/preferences', authenticateToken, async (req, res) => {
    try {
      const clean = cleanPrefs(req.body && req.body.preferences);
      const { rows } = await pool.query(
        `INSERT INTO patient_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET preferences = patient_preferences.preferences || EXCLUDED.preferences,
               updated_at = NOW()
         RETURNING preferences`,
        [req.user.id, JSON.stringify(clean)]
      );
      res.json({ preferences: rows[0].preferences });
    } catch (err) {
      console.error('PATCH /api/me/preferences', err.message);
      res.status(500).json({ error: 'Could not save preferences' });
    }
  });
};
