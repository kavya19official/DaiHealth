// ============================================================================
// Facility Discovery API (fixed route order + patient location router)
// ============================================================================

const express = require('express');

const { parsePreferences, rankFacilities } = require('./facilityMatching');
const { resolveLocation, nearestLocality, suggestLocalities, haversineKm } = require('./delhiGazetteer');
const { describeFreshness } = require('./facilityFreshness');

const DEFAULT_RADIUS_KM = 25;

// How the person can actually reach a facility: never just "closest".
function contactRoute(f) {
  const hasPoint = f.latitude != null && f.longitude != null;
  return {
    phone: f.phone || null,
    website: f.website || null,
    directions_url: hasPoint ? `https://www.google.com/maps/dir/?api=1&destination=${Number(f.latitude)},${Number(f.longitude)}` : null,
    advice: f.phone
      ? 'Call to confirm the service and timings before travelling.'
      : f.website
        ? 'No phone number on record. Use the facility website or ask your doctor/ASHA worker to confirm before travelling.'
        : 'No phone or website on record. Ask your doctor or ASHA worker to confirm before travelling.',
  };
}

module.exports = function (app, { pool, authenticateToken, authorizeRole }) {
  require('./delhiDemoNetwork')(app,{pool,authenticateToken});
  const facilities = express.Router();
  const patient = express.Router();

  // M. Freshness is shown next to each facility and never feeds ranking: it is added AFTER
  // rankFacilities has already ordered the list, and the order is not touched.
  async function contactStatsByFacility() {
    const stats = new Map();
    try {
      (await pool.query(`SELECT facility_id,
          COUNT(*) FILTER (WHERE outcome='reached') AS reached,
          COUNT(*) FILTER (WHERE outcome='not_reached') AS not_reached
        FROM facility_contact_reports WHERE created_at > NOW() - INTERVAL '180 days' GROUP BY facility_id`)).rows
        .forEach((r) => stats.set(r.facility_id, r));
    } catch (e) { console.warn('Contact reports unavailable:', e.message); }
    return stats;
  }
  const withFreshness = (list, stats) => list.map((f) => ({ ...f, freshness: describeFreshness(f, stats.get(f.id)) }));

  // Capability filters are SQL eligibility gates; preferences only rank eligible rows.
  facilities.get('/search', async (req, res) => {
    let preferences;
    try { preferences = parsePreferences(req.query); }
    catch (error) { return res.status(400).json({error:error.message}); }
    const limit=Number(req.query.limit||20);
    if (!Number.isInteger(limit)||limit<1||limit>100) return res.status(400).json({error:'Limit must be between 1 and 100'});
    // City / locality / PIN -> approximate coordinates, so distance works without device location.
    let location=null;
    const warnings=[];
    if (preferences.user_lat===null) {
      location=resolveLocation({city:req.query.city,pincode:req.query.pincode,locality:req.query.locality});
      if (location.ok) { preferences.user_lat=location.latitude; preferences.user_lon=location.longitude; }
      else warnings.push(location.message);
    } else {
      const near=nearestLocality(preferences.user_lat,preferences.user_lon);
      location={ok:true,latitude:preferences.user_lat,longitude:preferences.user_lon,precision:'device',label:near?`your location (${near.name} area)`:'your location'};
      if (!near) warnings.push('Your device location is outside Delhi. The directory currently covers Delhi only, so results may be far away or empty.');
    }
    const coordsKnown=preferences.user_lat!==null;
    if (coordsKnown && preferences.max_distance_km===null) preferences.max_distance_km=DEFAULT_RADIUS_KM;
    try {
      const params=[];
      let query=`SELECT f.*,
        COALESCE((SELECT json_agg(fs) FROM facility_services fs WHERE fs.facility_id=f.id AND fs.available=TRUE),'[]'::json) AS services,
        COALESCE((SELECT json_agg(fc) FROM facility_capabilities fc WHERE fc.facility_id=f.id AND fc.available=TRUE),'[]'::json) AS capabilities,
        COALESCE((SELECT json_agg(json_build_object('id',sl.id,'facility_service_id',sl.facility_service_id,'doctor_id',sl.doctor_id,'doctor_name',dp.full_name,'clinician_eligible',(df.active=TRUE AND df.qualification_verified=TRUE AND du.role='doctor' AND dp.full_name IS NOT NULL),'starts_at',sl.starts_at,'ends_at',sl.ends_at,'available_places',sl.available_places,'source',sl.source,'updated_at',sl.updated_at)) FROM facility_service_slots sl JOIN facility_services fs ON fs.id=sl.facility_service_id LEFT JOIN doctor_profiles dp ON dp.user_id=sl.doctor_id LEFT JOIN users du ON du.id=sl.doctor_id LEFT JOIN doctor_facilities df ON df.doctor_id=sl.doctor_id AND df.facility_id=f.id WHERE fs.facility_id=f.id AND fs.available=TRUE),'[]'::json) AS slots
        FROM facilities f WHERE f.active=TRUE`;
      function filter(clause,value){params.push(value);query+=' AND '+clause.replaceAll('?', '$'+params.length);}
      // With coordinates, distance decides. Exact-text city matching ("Delhi" vs "New Delhi") hid real results.
      if(req.query.city&&!coordsKnown)filter('LOWER(f.city)=LOWER(?)',String(req.query.city));
      if(req.query.facility_type)filter('f.facility_type=?',String(req.query.facility_type));
      if(preferences.service)filter('EXISTS(SELECT 1 FROM facility_services fs WHERE fs.facility_id=f.id AND fs.available=TRUE AND (fs.service_name=? OR fs.service_category=?))',preferences.service);
      if(preferences.capability)filter('EXISTS(SELECT 1 FROM facility_capabilities fc WHERE fc.facility_id=f.id AND fc.available=TRUE AND fc.capability=?)',preferences.capability);
      if(preferences.accessibility)filter('jsonb_exists(f.accessibility_features, ?)',preferences.accessibility);
      // Do not LIMIT alphabetically before ranking; the best match might be last.
      const result=await pool.query(query,params);
      let matches=rankFacilities(result.rows,preferences);
      if(location&&location.ok&&location.precision!=='device'&&location.precision!=='pincode'){
        warnings.push(location.precision==='city'
          ? 'Distances are measured from the centre of Delhi because only the city was given. Add a locality or PIN code for better ordering.'
          : `Distances are measured from the centre of ${location.label}, an approximate point. Confirm travel time with the facility.`);
      } else if(location&&location.ok&&location.precision==='pincode'){
        warnings.push(`Distances are measured from the centre of ${location.label}, an approximate point.`);
      }
      // Location-aware alternatives: nothing suitable within range -> nearest facilities that still offer
      // the REQUIRED service/capability, ordered by distance, each with a clear way to reach them.
      let alternatives=null;
      if(!matches.length&&coordsKnown){
        const widened={...preferences,max_distance_km:null,strict_preferences:false};
        const far=rankFacilities(result.rows,widened).filter(f=>f.distance_km!==null).sort((a,b)=>a.distance_km-b.distance_km).slice(0,5);
        if(far.length){
          alternatives={reason:`Nothing matched within ${preferences.max_distance_km} km. These are the nearest facilities that offer what you asked for.`,facilities:far.map(f=>({...f,contact:contactRoute(f)}))};
        }
      }
      matches=matches.map(f=>({...f,contact:contactRoute(f)}));
      const freshnessStats=await contactStatsByFacility();
      if(alternatives)alternatives={...alternatives,facilities:withFreshness(alternatives.facilities,freshnessStats)};
      if(!preferences.service)warnings.push('Choose a service to see preference matching scores.');
      res.json({location,alternatives,facilities:withFreshness(matches.slice(0,limit),freshnessStats),count:Math.min(matches.length,limit),total:matches.length,preferences,warnings,scoring_note:'Preference match, not a clinical safety or hospital-quality score. Unknown evidence earns no points. Required service and capability checks are never traded for a better score. Confirmation dates, contact reports and reported availability are shown for context only and never change the order.'});
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

  // Doctors near a location. Only clinicians who registered on DaiHealth and are linked to a facility appear:
  // we never list a doctor we have no record of. Facilities without registered doctors are returned
  // separately so the person still gets somewhere to call.
  facilities.get('/doctors/nearby', async (req, res) => {
    try {
      const specialty=String(req.query.specialty||'').trim().toLowerCase();
      if (specialty.length>60) return res.status(400).json({error:'Specialty is too long'});
      const radius=Number(req.query.max_distance_km||DEFAULT_RADIUS_KM);
      if (!Number.isFinite(radius)||radius<1||radius>500) return res.status(400).json({error:'Maximum distance must be between 1 and 500'});
      let lat=req.query.user_lat,lon=req.query.user_lon,location;
      if (lat!==undefined&&lon!==undefined&&lat!==''&&lon!=='') {
        lat=Number(lat);lon=Number(lon);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return res.status(400).json({error:'Invalid coordinates'});
        const near=nearestLocality(lat,lon);
        location={ok:true,latitude:lat,longitude:lon,precision:'device',label:near?`your location (${near.name} area)`:'your location'};
      } else {
        location=resolveLocation({city:req.query.city,pincode:req.query.pincode,locality:req.query.locality});
        if(!location.ok) return res.status(200).json({location,doctors:[],facilities_without_doctors:[],warnings:[location.message]});
        lat=location.latitude;lon=location.longitude;
      }
      const rows=(await pool.query(
        `SELECT df.id AS link_id, df.doctor_id, df.role, COALESCE(df.specialization, dp.specialization) AS specialization,
                df.consultation_fee, df.clinic_hours, df.accepts_new_patients, df.languages,
                df.qualification_verified, df.verification_details,
                dp.full_name, f.id AS facility_id, f.name AS facility_name, f.facility_type, f.address,
                f.latitude, f.longitude, f.phone AS facility_phone, f.website, f.verified_at, f.verification_source
           FROM doctor_facilities df
           JOIN users u ON u.id=df.doctor_id AND u.role='doctor'
           JOIN doctor_profiles dp ON dp.user_id=u.id
           JOIN facilities f ON f.id=df.facility_id AND f.active=TRUE
          WHERE df.active=TRUE`)).rows;
      const withDist=rows.map(r=>({...r,distance_km:r.latitude!=null&&r.longitude!=null?Math.round(haversineKm(lat,lon,Number(r.latitude),Number(r.longitude))*10)/10:null}))
        .filter(r=>r.distance_km!==null&&r.distance_km<=radius)
        .filter(r=>!specialty||String(r.specialization||'').toLowerCase().includes(specialty));
      withDist.sort((a,b)=>a.distance_km-b.distance_km||String(a.full_name).localeCompare(String(b.full_name)));
      const doctors=withDist.slice(0,50).map(r=>({
        doctor_id:r.doctor_id,full_name:r.full_name,specialization:r.specialization||null,role:r.role,
        qualification_verified:r.qualification_verified===true,
        registration_number:r.verification_details&&r.verification_details.registration_number||null,
        accepts_new_patients:r.accepts_new_patients,languages:r.languages||[],clinic_hours:r.clinic_hours||null,
        consultation_fee:r.consultation_fee,distance_km:r.distance_km,
        facility:{id:r.facility_id,name:r.facility_name,facility_type:r.facility_type,address:r.address,phone:r.facility_phone,verified_at:r.verified_at,verification_source:r.verification_source},
      }));
      // Nearest facilities of any kind that have no registered doctor linked: honest "call this place" fallback.
      const fac=(await pool.query(`SELECT f.id,f.name,f.facility_type,f.address,f.latitude,f.longitude,f.phone,f.website,f.verified_at,f.verification_source,
              COALESCE((SELECT json_agg(fs.service_category) FROM facility_services fs WHERE fs.facility_id=f.id AND fs.available=TRUE),'[]'::json) AS service_categories
            FROM facilities f WHERE f.active=TRUE AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM doctor_facilities d WHERE d.facility_id=f.id AND d.active=TRUE)`)).rows;
      const wanted=({obstetrics:'obstetrics',gynecology:'gynecology',gynaecology:'gynecology',fertility:'fertility',ivf:'fertility',paediatrics:'vaccination',pediatrics:'vaccination'})[specialty]||null;
      const without=fac.map(f=>({...f,distance_km:Math.round(haversineKm(lat,lon,Number(f.latitude),Number(f.longitude))*10)/10}))
        .filter(f=>f.distance_km<=Math.max(radius,10)&&(!wanted||(f.service_categories||[]).includes(wanted)))
        .sort((a,b)=>a.distance_km-b.distance_km).slice(0,8)
        .map(f=>({...f,contact:contactRoute(f)}));
      const warnings=[];
      if(!doctors.length) warnings.push('No clinician registered on DaiHealth is linked to a facility in range. The facilities below have no doctor list yet; call them to ask for a specialist.');
      res.json({location,doctors,facilities_without_doctors:without,warnings});
    } catch (error) {
      console.error('Nearby doctors error:', error.message);
      res.status(500).json({ error: 'Failed to find nearby doctors' });
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
      const focusedDemoFacility = (await pool.query('SELECT verification_source FROM facilities WHERE id=$1',[facilityId])).rows[0];
      if(focusedDemoFacility?.verification_source==='synthetic_delhi_focused_v1')return res.status(409).json({error:'This fictional directory fixture is not enabled for appointments'});
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

  // A signed-in user reports whether they could reach a facility. One report per user per facility per week.
  facilities.post('/:id/contact-report', async (req, res) => {
    try {
      const id = Number(req.params.id), outcome = req.body?.outcome;
      if (!Number.isInteger(id) || !['reached', 'not_reached'].includes(outcome)) return res.status(400).json({ error: 'Choose reached or not reached' });
      if (!(await pool.query('SELECT 1 FROM facilities WHERE id=$1 AND active=TRUE', [id])).rows.length) return res.status(404).json({ error: 'Facility not found' });
      const recent = await pool.query("SELECT 1 FROM facility_contact_reports WHERE facility_id=$1 AND reporter_id=$2 AND created_at > NOW() - INTERVAL '7 days'", [id, req.user.id]);
      if (recent.rows.length) return res.status(429).json({ error: 'You already reported this facility in the last 7 days. Thank you.' });
      await pool.query('INSERT INTO facility_contact_reports(facility_id,reporter_id,outcome) VALUES($1,$2,$3)', [id, req.user.id, outcome]);
      res.status(201).json({ message: 'Thank you. A summary is shown only once several people have reported.' });
    } catch (error) { console.error('Contact report error:', error.message); res.status(500).json({ error: 'Could not save your report' }); }
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
      const facility = result.rows[0];
      try {
        facility.slots = (await pool.query(
          `SELECT sl.starts_at, sl.updated_at, sl.source FROM facility_service_slots sl
             JOIN facility_services fs ON fs.id = sl.facility_service_id
            WHERE fs.facility_id = $1 AND fs.available = TRUE AND sl.starts_at > NOW()`, [req.params.id])).rows;
      } catch (e) { facility.slots = []; }
      facility.freshness = describeFreshness(facility, (await contactStatsByFacility()).get(facility.id));
      res.json({ facility });
    } catch (error) {
      console.error('Get facility error:', error);
      res.status(500).json({ error: 'Failed to get facility details' });
    }
  });

  // Patient location — dedicated router under /api/patient
  // Resolve typed city / locality / PIN to an approximate point (no saving). Also powers locality suggestions.
  patient.get('/location/resolve', (req, res) => {
    const out = resolveLocation({ city: req.query.city, pincode: req.query.pincode, locality: req.query.locality });
    res.json({ resolved: out, suggestions: suggestLocalities(req.query.locality || req.query.city || req.query.pincode) });
  });

  patient.post('/location', async (req, res) => {
    try {
      const userId = req.user.id;
      const b = req.body || {};
      const source = ['manual', 'device', 'both'].includes(b.location_source) ? b.location_source : 'manual';
      let { city, district, state, pincode, latitude, longitude } = b;
      pincode = pincode ? String(pincode).trim() : null;
      if (pincode && !/^\d{6}$/.test(pincode)) return res.status(400).json({ error: 'PIN code must be 6 digits' });
      const hasDevice = latitude != null && latitude !== '' && longitude != null && longitude !== '';
      let resolution = null;
      if (hasDevice) {
        latitude = Number(latitude); longitude = Number(longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return res.status(400).json({ error: 'Invalid coordinates' });
        const near = nearestLocality(latitude, longitude);
        if (near) { city = city || 'Delhi'; pincode = pincode || near.pincode; resolution = { precision: 'device', label: `Near ${near.name}` }; }
      } else {
        resolution = resolveLocation({ city, pincode, locality: b.locality });
        if (resolution.ok) { latitude = resolution.latitude; longitude = resolution.longitude; city = city || resolution.city; pincode = pincode || resolution.pincode || null; }
        else return res.status(400).json({ error: resolution.message });
      }
      if (!city) return res.status(400).json({ error: 'City is required' });
      await pool.query('UPDATE patient_locations SET is_primary = FALSE WHERE user_id = $1', [userId]);
      const result = await pool.query(
        `INSERT INTO patient_locations
          (user_id, city, district, state, pincode, latitude, longitude, location_source, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
        [userId, city, district || null, state || null, pincode, latitude ?? null, longitude ?? null, hasDevice ? (source === 'manual' ? 'device' : source) : 'manual']
      );
      res.status(201).json({ location: result.rows[0], resolution });
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
