// ============================================================================
// Facility Discovery API (fixed route order + patient location router)
// ============================================================================

const express = require('express');

const { parsePreferences, rankFacilities } = require('./facilityMatching');

module.exports = function (app, { pool, authenticateToken, authorizeRole }) {
  const facilities = express.Router();
  const patient = express.Router();

  // Capability filters are SQL eligibility gates; preferences only rank eligible rows.
  facilities.get('/search', async (req, res) => {
    let preferences;
    try { preferences = parsePreferences(req.query); }
    catch (error) { return res.status(400).json({error:error.message}); }
    const limit=Number(req.query.limit||20);
    if (!Number.isInteger(limit)||limit<1||limit>100) return res.status(400).json({error:'Limit must be between 1 and 100'});
    try {
      const params=[];
      let query=`SELECT f.*,
        COALESCE((SELECT json_agg(fs) FROM facility_services fs WHERE fs.facility_id=f.id AND fs.available=TRUE),'[]'::json) AS services,
        COALESCE((SELECT json_agg(fc) FROM facility_capabilities fc WHERE fc.facility_id=f.id AND fc.available=TRUE),'[]'::json) AS capabilities,
        COALESCE((SELECT json_agg(json_build_object('id',sl.id,'facility_service_id',sl.facility_service_id,'doctor_id',sl.doctor_id,'doctor_name',dp.full_name,'clinician_eligible',(df.active=TRUE AND df.qualification_verified=TRUE AND du.role='doctor' AND dp.full_name IS NOT NULL),'starts_at',sl.starts_at,'ends_at',sl.ends_at,'available_places',sl.available_places,'source',sl.source,'updated_at',sl.updated_at)) FROM facility_service_slots sl JOIN facility_services fs ON fs.id=sl.facility_service_id LEFT JOIN doctor_profiles dp ON dp.user_id=sl.doctor_id LEFT JOIN users du ON du.id=sl.doctor_id LEFT JOIN doctor_facilities df ON df.doctor_id=sl.doctor_id AND df.facility_id=f.id WHERE fs.facility_id=f.id AND fs.available=TRUE),'[]'::json) AS slots
        FROM facilities f WHERE f.active=TRUE`;
      function filter(clause,value){params.push(value);query+=' AND '+clause.replaceAll('?', '$'+params.length);}
      if(req.query.city)filter('LOWER(f.city)=LOWER(?)',String(req.query.city));
      if(req.query.facility_type)filter('f.facility_type=?',String(req.query.facility_type));
      if(preferences.service)filter('EXISTS(SELECT 1 FROM facility_services fs WHERE fs.facility_id=f.id AND fs.available=TRUE AND (fs.service_name=? OR fs.service_category=?))',preferences.service);
      if(preferences.capability)filter('EXISTS(SELECT 1 FROM facility_capabilities fc WHERE fc.facility_id=f.id AND fc.available=TRUE AND fc.capability=?)',preferences.capability);
      if(preferences.accessibility)filter('jsonb_exists(f.accessibility_features, ?)',preferences.accessibility);
      // Do not LIMIT alphabetically before ranking; the best match might be last.
      const result=await pool.query(query,params);
      const matches=rankFacilities(result.rows,preferences);
      const warnings=[];
      if(preferences.user_lat===null)warnings.push('Distance is unknown without coordinates. A city or PIN code is not converted into a precise location; the distance limit cannot be checked.');
      if(!preferences.service)warnings.push('Choose a required service to see preference matching scores.');
      res.json({facilities:matches.slice(0,limit),count:Math.min(matches.length,limit),total:matches.length,preferences,warnings,scoring_note:'Preference match, not a clinical safety or hospital-quality score. Unknown evidence earns no points. Required service and capability checks are never traded for a better score.'});
    }catch(error){console.error('Facility search error:',error.message);res.status(500).json({error:'Failed to search facilities'});}
  });

  // Static path BEFORE /:id
  facilities.get('/appointments', async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await pool.query(
        `SELECT fa.*, f.name as facility_name, f.facility_type, f.address, f.phone as facility_phone,
                dp.full_name as doctor_name, dp.specialization
         FROM facility_appointments fa
         JOIN facilities f ON fa.facility_id = f.id
         LEFT JOIN doctor_profiles dp ON fa.doctor_id = dp.user_id
         WHERE fa.user_id = $1
         ORDER BY fa.requested_date DESC, fa.booked_at DESC`,
        [userId]
      );
      res.json({ appointments: result.rows });
    } catch (error) {
      console.error('Get facility appointments error:', error);
      res.status(500).json({ error: 'Failed to get appointments' });
    }
  });

  facilities.post('/referral', async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        from_facility_id,
        to_facility_id,
        referral_reason,
        urgency = 'routine',
        referral_notes
      } = req.body || {};
      if (!to_facility_id || !referral_reason) {
        return res.status(400).json({ error: 'To facility and reason are required' });
      }
      const result = await pool.query(
        `INSERT INTO facility_referrals
          (user_id, from_facility_id, to_facility_id, referral_reason, urgency, referral_notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, from_facility_id || null, to_facility_id, referral_reason, urgency, referral_notes || null]
      );
      res.status(201).json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Create referral error:', error);
      res.status(500).json({ error: 'Failed to create referral' });
    }
  });

  facilities.get('/:id/doctors', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT df.*, u.email, dp.full_name, dp.specialization, dp.phone, dp.medical_license_number
         FROM doctor_facilities df
         JOIN users u ON df.doctor_id = u.id
         JOIN doctor_profiles dp ON u.id = dp.user_id
         WHERE df.facility_id = $1 AND df.active = TRUE
         ORDER BY dp.full_name`,
        [req.params.id]
      );
      res.json({ doctors: result.rows });
    } catch (error) {
      console.error('Get facility doctors error:', error);
      res.status(500).json({ error: 'Failed to get facility doctors' });
    }
  });

  facilities.post('/:id/appointment', async (req, res) => {
    try {
      const userId = req.user.id;
      const facilityId = req.params.id;
      const { doctor_id, appointment_type, requested_date, preferred_time, reason } = req.body || {};
      if (!appointment_type || !requested_date) {
        return res.status(400).json({ error: 'Appointment type and date are required' });
      }
      const result = await pool.query(
        `INSERT INTO facility_appointments
          (user_id, facility_id, doctor_id, appointment_type, requested_date, preferred_time, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, facilityId, doctor_id || null, appointment_type, requested_date, preferred_time || null, reason || null]
      );
      res.status(201).json({ appointment: result.rows[0] });
    } catch (error) {
      console.error('Book facility appointment error:', error);
      res.status(500).json({ error: 'Failed to book appointment' });
    }
  });

  facilities.get('/:id', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT f.*,
          COALESCE(json_agg(DISTINCT jsonb_build_object(
            'service_name', fs.service_name, 'service_category', fs.service_category,
            'available', fs.available, 'notes', fs.notes
          )) FILTER (WHERE fs.service_name IS NOT NULL), '[]'::json) as services,
          COALESCE(json_agg(DISTINCT jsonb_build_object(
            'capability', fc.capability, 'available', fc.available, 'notes', fc.notes
          )) FILTER (WHERE fc.capability IS NOT NULL), '[]'::json) as capabilities
         FROM facilities f
         LEFT JOIN facility_services fs ON f.id = fs.facility_id
         LEFT JOIN facility_capabilities fc ON f.id = fc.facility_id
         WHERE f.id = $1
         GROUP BY f.id`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Facility not found' });
      res.json({ facility: result.rows[0] });
    } catch (error) {
      console.error('Get facility error:', error);
      res.status(500).json({ error: 'Failed to get facility details' });
    }
  });

  // Patient location — dedicated router under /api/patient
  patient.post('/location', async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        city, district, state, pincode, latitude, longitude, location_source = 'manual'
      } = req.body || {};
      if (!city) return res.status(400).json({ error: 'City is required' });
      await pool.query('UPDATE patient_locations SET is_primary = FALSE WHERE user_id = $1', [userId]);
      const result = await pool.query(
        `INSERT INTO patient_locations
          (user_id, city, district, state, pincode, latitude, longitude, location_source, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
        [userId, city, district || null, state || null, pincode || null,
         latitude ?? null, longitude ?? null, location_source]
      );
      res.status(201).json({ location: result.rows[0] });
    } catch (error) {
      console.error('Save patient location error:', error);
      res.status(500).json({ error: 'Failed to save location' });
    }
  });

  patient.get('/location', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM patient_locations WHERE user_id = $1 AND is_primary = TRUE LIMIT 1',
        [req.user.id]
      );
      res.json({ location: result.rows[0] || null });
    } catch (error) {
      console.error('Get patient location error:', error);
      res.status(500).json({ error: 'Failed to get location' });
    }
  });

  app.use('/api/facilities', authenticateToken, authorizeRole(['mother', 'doctor']), facilities);
  app.use('/api/patient', authenticateToken, authorizeRole(['mother']), patient);
};
