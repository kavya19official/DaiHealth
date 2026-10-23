// ============================================================================
// Facility Discovery API (fixed route order + patient location router)
// ============================================================================

const express = require('express');

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = function (app, { pool, authenticateToken, authorizeRole }) {
  const facilities = express.Router();
  const patient = express.Router();

  // GET /api/facilities/search
  facilities.get('/search', async (req, res) => {
    try {
      const {
        city,
        facility_type,
        service,
        capability,
        language,
        accessibility,
        max_distance_km = 50,
        limit = 20,
        user_lat,
        user_lon
      } = req.query;

      let query = `
        SELECT
          f.*,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'service_name', fs.service_name,
              'service_category', fs.service_category,
              'available', fs.available
            )) FILTER (WHERE fs.service_name IS NOT NULL),
            '[]'::json
          ) as services,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'capability', fc.capability,
              'available', fc.available
            )) FILTER (WHERE fc.capability IS NOT NULL),
            '[]'::json
          ) as capabilities
        FROM facilities f
        LEFT JOIN facility_services fs ON f.id = fs.facility_id AND fs.available = TRUE
        LEFT JOIN facility_capabilities fc ON f.id = fc.facility_id AND fc.available = TRUE
        WHERE f.active = TRUE
      `;
      const params = [];
      let n = 0;

      if (city) {
        n++; query += ` AND LOWER(f.city) = LOWER($${n})`; params.push(city);
      }
      if (facility_type) {
        n++; query += ` AND f.facility_type = $${n}`; params.push(facility_type);
      }
      if (service) {
        n++; query += ` AND EXISTS (
          SELECT 1 FROM facility_services fs2
          WHERE fs2.facility_id = f.id AND fs2.available = TRUE
            AND (fs2.service_name = $${n} OR fs2.service_category = $${n})
        )`; params.push(service);
      }
      if (capability) {
        n++; query += ` AND EXISTS (
          SELECT 1 FROM facility_capabilities fc2
          WHERE fc2.facility_id = f.id AND fc2.capability = $${n} AND fc2.available = TRUE
        )`; params.push(capability);
      }
      if (language) {
        n++; query += ` AND f.languages ? $${n}`; params.push(language);
      }
      if (accessibility) {
        n++; query += ` AND f.accessibility_features ? $${n}`; params.push(accessibility);
      }

      n++; query += ` GROUP BY f.id ORDER BY f.name LIMIT $${n}`;
      params.push(Math.min(parseInt(limit, 10) || 20, 100));

      const result = await pool.query(query, params);
      let rows = result.rows;

      if (user_lat && user_lon) {
        const maxD = parseFloat(max_distance_km) || 50;
        rows = rows.map((f) => {
          if (f.latitude != null && f.longitude != null) {
            const distance = calculateDistance(
              parseFloat(user_lat), parseFloat(user_lon),
              parseFloat(f.latitude), parseFloat(f.longitude)
            );
            return { ...f, distance_km: Math.round(distance * 10) / 10 };
          }
          return { ...f, distance_km: null };
        }).filter((f) => f.distance_km == null || f.distance_km <= maxD);
        rows.sort((a, b) => {
          if (a.distance_km == null) return 1;
          if (b.distance_km == null) return -1;
          return a.distance_km - b.distance_km;
        });
      }

      res.json({
        facilities: rows,
        count: rows.length,
        filters: { city, facility_type, service, capability, language, accessibility, max_distance_km }
      });
    } catch (error) {
      console.error('Facility search error:', error);
      res.status(500).json({ error: 'Failed to search facilities' });
    }
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
