// ============================================================================
// Facility Discovery API
//
// Endpoints:
//   GET    /api/facilities/search          - Search facilities with filters
//   GET    /api/facilities/:id            - Get facility details
//   GET    /api/facilities/:id/doctors   - Get doctors at facility
//   POST   /api/patient/location          - Save patient location
//   GET    /api/patient/location          - Get patient location
//   POST   /api/facilities/:id/appointment - Book facility appointment
//   GET    /api/facilities/appointments  - Get patient's facility appointments
//   POST   /api/facilities/referral       - Create facility referral
// ============================================================================

const express = require('express');

// Helper: Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = function(app, { pool, authenticateToken, authorizeRole }) {
  const router = express.Router();

  // GET /api/facilities/search
  // Query params: city, facility_type, service, capability, language, accessibility, max_distance_km, limit
  router.get('/search', async (req, res) => {
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
            json_agg(
              json_build_object(
                'service_name', fs.service_name,
                'service_category', fs.service_category,
                'available', fs.available
              )
            ) FILTER (WHERE fs.service_name IS NOT NULL),
            '[]'::jsonb
          ) as services,
          COALESCE(
            json_agg(
              json_build_object(
                'capability', fc.capability,
                'available', fc.available
              )
            ) FILTER (WHERE fc.capability IS NOT NULL),
            '[]'::jsonb
          ) as capabilities
        FROM facilities f
        LEFT JOIN facility_services fs ON f.id = fs.facility_id AND fs.available = TRUE
        LEFT JOIN facility_capabilities fc ON f.id = fc.facility_id AND fc.available = TRUE
        WHERE f.active = TRUE
      `;
      const params = [];
      let paramCount = 0;

      if (city) {
        paramCount++;
        query += ` AND LOWER(f.city) = LOWER($${paramCount})`;
        params.push(city);
      }

      if (facility_type) {
        paramCount++;
        query += ` AND f.facility_type = $${paramCount}`;
        params.push(facility_type);
      }

      if (service) {
        paramCount++;
        query += ` AND EXISTS (
          SELECT 1 FROM facility_services fs2
          WHERE fs2.facility_id = f.id
          AND fs2.service_name = $${paramCount}
          AND fs2.available = TRUE
        )`;
        params.push(service);
      }

      if (capability) {
        paramCount++;
        query += ` AND EXISTS (
          SELECT 1 FROM facility_capabilities fc2
          WHERE fc2.facility_id = f.id
          AND fc2.capability = $${paramCount}
          AND fc2.available = TRUE
        )`;
        params.push(capability);
      }

      if (language) {
        paramCount++;
        query += ` AND f.languages ? $${paramCount}`;
        params.push(language);
      }

      if (accessibility) {
        paramCount++;
        query += ` AND f.accessibility_features ? $${paramCount}`;
        params.push(accessibility);
      }

      query += `
        GROUP BY f.id
        ORDER BY f.name
        LIMIT $${paramCount + 1}
      `;
      params.push(parseInt(limit));

      const result = await pool.query(query, params);

      // Calculate distances if user location provided
      let facilities = result.rows;
      if (user_lat && user_lon) {
        facilities = facilities.map(f => {
          if (f.latitude && f.longitude) {
            const distance = calculateDistance(
              parseFloat(user_lat),
              parseFloat(user_lon),
              parseFloat(f.latitude),
              parseFloat(f.longitude)
            );
            return { ...f, distance_km: Math.round(distance * 10) / 10 };
          }
          return { ...f, distance_km: null };
        }).filter(f => f.distance_km === null || f.distance_km <= parseFloat(max_distance_km));

        // Sort by distance
        facilities.sort((a, b) => {
          if (a.distance_km === null) return 1;
          if (b.distance_km === null) return -1;
          return a.distance_km - b.distance_km;
        });
      }

      res.json({
        facilities: facilities,
        count: facilities.length,
        filters: { city, facility_type, service, capability, language, accessibility, max_distance_km }
      });
    } catch (error) {
      console.error('Facility search error:', error);
      res.status(500).json({ error: 'Failed to search facilities' });
    }
  });

  // GET /api/facilities/:id
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const query = `
        SELECT
          f.*,
          COALESCE(
            json_agg(
              json_build_object(
                'service_name', fs.service_name,
                'service_category', fs.service_category,
                'available', fs.available,
                'notes', fs.notes
              )
            ) FILTER (WHERE fs.service_name IS NOT NULL),
            '[]'::jsonb
          ) as services,
          COALESCE(
            json_agg(
              json_build_object(
                'capability', fc.capability,
                'available', fc.available,
                'notes', fc.notes
              )
            ) FILTER (WHERE fc.capability IS NOT NULL),
            '[]'::jsonb
          ) as capabilities
        FROM facilities f
        LEFT JOIN facility_services fs ON f.id = fs.facility_id
        LEFT JOIN facility_capabilities fc ON f.id = fc.facility_id
        WHERE f.id = $1
        GROUP BY f.id
      `;

      const result = await pool.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }

      res.json({ facility: result.rows[0] });
    } catch (error) {
      console.error('Get facility error:', error);
      res.status(500).json({ error: 'Failed to get facility details' });
    }
  });

  // GET /api/facilities/:id/doctors
  router.get('/:id/doctors', async (req, res) => {
    try {
      const { id } = req.params;

      const query = `
        SELECT
          df.*,
          u.email,
          dp.full_name,
          dp.specialization,
          dp.phone,
          dp.medical_license_number
        FROM doctor_facilities df
        JOIN users u ON df.doctor_id = u.id
        JOIN doctor_profiles dp ON u.id = dp.user_id
        WHERE df.facility_id = $1 AND df.active = TRUE
        ORDER BY dp.full_name
      `;

      const result = await pool.query(query, [id]);

      res.json({ doctors: result.rows });
    } catch (error) {
      console.error('Get facility doctors error:', error);
      res.status(500).json({ error: 'Failed to get facility doctors' });
    }
  });

  // POST /api/patient/location
  router.post('/location', async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        city,
        district,
        state,
        pincode,
        latitude,
        longitude,
        location_source = 'manual'
      } = req.body;

      if (!city) {
        return res.status(400).json({ error: 'City is required' });
      }

      // Mark existing primary location as non-primary
      await pool.query(
        'UPDATE patient_locations SET is_primary = FALSE WHERE user_id = $1',
        [userId]
      );

      // Insert new primary location
      const result = await pool.query(
        `INSERT INTO patient_locations
          (user_id, city, district, state, pincode, latitude, longitude, location_source, is_primary)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
          RETURNING *`,
        [userId, city, district, state, pincode, latitude, longitude, location_source]
      );

      res.status(201).json({ location: result.rows[0] });
    } catch (error) {
      console.error('Save patient location error:', error);
      res.status(500).json({ error: 'Failed to save location' });
    }
  });

  // GET /api/patient/location
  router.get('/location', async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        'SELECT * FROM patient_locations WHERE user_id = $1 AND is_primary = TRUE',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.json({ location: null });
      }

      res.json({ location: result.rows[0] });
    } catch (error) {
      console.error('Get patient location error:', error);
      res.status(500).json({ error: 'Failed to get location' });
    }
  });

  // POST /api/facilities/:id/appointment
  router.post('/:id/appointment', async (req, res) => {
    try {
      const userId = req.user.id;
      const { id: facilityId } = req.params;
      const {
        doctor_id,
        appointment_type,
        requested_date,
        preferred_time,
        reason
      } = req.body;

      if (!appointment_type || !requested_date) {
        return res.status(400).json({ error: 'Appointment type and date are required' });
      }

      const result = await pool.query(
        `INSERT INTO facility_appointments
          (user_id, facility_id, doctor_id, appointment_type, requested_date, preferred_time, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *`,
        [userId, facilityId, doctor_id, appointment_type, requested_date, preferred_time, reason]
      );

      res.status(201).json({ appointment: result.rows[0] });
    } catch (error) {
      console.error('Book facility appointment error:', error);
      res.status(500).json({ error: 'Failed to book appointment' });
    }
  });

  // GET /api/facilities/appointments
  router.get('/appointments', async (req, res) => {
    try {
      const userId = req.user.id;

      const query = `
        SELECT
          fa.*,
          f.name as facility_name,
          f.facility_type,
          f.address,
          f.phone as facility_phone,
          dp.full_name as doctor_name,
          dp.specialization
        FROM facility_appointments fa
        JOIN facilities f ON fa.facility_id = f.id
        LEFT JOIN doctor_profiles dp ON fa.doctor_id = dp.user_id
        WHERE fa.user_id = $1
        ORDER BY fa.requested_date DESC, fa.booked_at DESC
      `;

      const result = await pool.query(query, [userId]);

      res.json({ appointments: result.rows });
    } catch (error) {
      console.error('Get facility appointments error:', error);
      res.status(500).json({ error: 'Failed to get appointments' });
    }
  });

  // POST /api/facilities/referral
  router.post('/referral', async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        from_facility_id,
        to_facility_id,
        referral_reason,
        urgency = 'routine',
        referral_notes
      } = req.body;

      if (!to_facility_id || !referral_reason) {
        return res.status(400).json({ error: 'To facility and reason are required' });
      }

      const result = await pool.query(
        `INSERT INTO facility_referrals
          (user_id, from_facility_id, to_facility_id, referral_reason, urgency, referral_notes)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *`,
        [userId, from_facility_id, to_facility_id, referral_reason, urgency, referral_notes]
      );

      res.status(201).json({ referral: result.rows[0] });
    } catch (error) {
      console.error('Create referral error:', error);
      res.status(500).json({ error: 'Failed to create referral' });
    }
  });

  app.use('/api/facilities', authenticateToken, authorizeRole(['mother', 'doctor']), router);
  app.use('/api/patient', authenticateToken, authorizeRole(['mother']), router);
};
