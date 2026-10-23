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
    'care_access',
    'notif_appt',
    'notif_vax',
    'notif_growth',
    'notif_care',
    'notif_sms',
    'privacy_share_doctors',
    'privacy_analytics',
    'theme', 'notif_whatsapp', 'quiet_hours_enabled', 'quiet_start', 'quiet_end', 'text_size', 'read_aloud', 'offline_enabled',
  ];

  function cleanPrefs(incoming) {
    const clean = {};
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return clean;
    for (const k of ALLOWED) {
      if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
      if (k === 'care_access') {
        const { parsePreferences } = require('./facilityMatching');
        if (!incoming[k] || typeof incoming[k] !== 'object' || Array.isArray(incoming[k])) throw new Error('Access preferences must be an object');
        const allowed = ['language','max_distance_km','budget_min','budget_max','preferred_date','preferred_time','transport_difficulty','strict_preferences'];
        const values=Object.fromEntries(allowed.filter(key=>incoming[k][key]!==undefined && incoming[k][key]!==null).map(key=>[key,String(incoming[k][key])]));
        const parsed=parsePreferences(values);
        clean.care_access=Object.fromEntries(allowed.map(key=>[key,parsed[key]]));
      } else if (k === 'lang') {
        const v = String(incoming[k] || '').toLowerCase();
        if (['en','hi','mr','ta','bn'].includes(v)) clean.lang=v;
        else if(v==='hindi')clean.lang='hi';
        else if(v==='english')clean.lang='en';
      } else if(k==='theme'){
        if(['light','dark'].includes(incoming[k]))clean[k]=incoming[k];
      } else if(k==='text_size'){
        if(['standard','large','extra-large'].includes(incoming[k]))clean[k]=incoming[k];
      } else if(k==='quiet_start'||k==='quiet_end'){
        if(/^([01]\d|2[0-3]):[0-5]\d$/.test(incoming[k]))clean[k]=incoming[k];
      } else if(typeof incoming[k]==='boolean'){
        clean[k] = incoming[k];
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
      let clean;
      try { clean=cleanPrefs(req.body && req.body.preferences); }
      catch(error){ return res.status(400).json({error:error.message}); }
      const before=await pool.query('SELECT preferences FROM patient_preferences WHERE user_id=$1',[req.user.id]);
      const { rows } = await pool.query(
        `INSERT INTO patient_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET preferences = patient_preferences.preferences || EXCLUDED.preferences,
               updated_at = NOW()
         RETURNING preferences`,
        [req.user.id, JSON.stringify(clean)]
      );
      if(Object.prototype.hasOwnProperty.call(clean,'privacy_share_doctors') && clean.privacy_share_doctors !== before.rows[0]?.preferences?.privacy_share_doctors){
        await pool.query("INSERT INTO patient_access_events(mother_id,event_type,details) VALUES($1,'document_sharing_preference',$2)",[req.user.id,JSON.stringify({enabled:clean.privacy_share_doctors})]);
      }
      res.json({ preferences: rows[0].preferences });
    } catch (err) {
      console.error('PATCH /api/me/preferences', err.message);
      res.status(500).json({ error: 'Could not save preferences' });
    }
  });
};
