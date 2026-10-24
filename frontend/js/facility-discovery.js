/* Facility Discovery — patient/caregiver frontend for /api/facilities & /api/patient/location */
(function () {
  'use strict';

  const API = window.DaiAPI;
  const API_BASE = (API && API.API_BASE) || window.DAI_API_BASE || '/api';
  const toast = (API && API.toast) || function (m) { alert(m); };
  const $ = (id) => document.getElementById(id);
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  let devicePoint = null; // exact device position; dropped as soon as the person types a different place
  let deviceFresh = false; // coordinates came from the device button since the last save

  let userLocation = null;
  let facilities = [];
  let selectedFacility = null;
  let lastSearchHadCoords = false;
  let locationLabel = '';

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function missing(label) {
    return '<span class="field-missing">' + escapeHtml(label) + ' not available</span>';
  }

  function displayOrMissing(value, label) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
      return missing(label);
    }
    return escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value);
  }

  async function api(path, options) {
    if (API && API.apiRequest) {
      return API.apiRequest(path, options || {});
    }
    const opts = Object.assign({ credentials: 'include' }, options || {});
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) {
      window.location.href = 'auth.html';
      return null;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      toast((data && data.error) || 'Request failed');
      return null;
    }
    return data;
  }

  function updateLocationUI() {
    const setup = $('locationSetup');
    const chip = $('locationChip');
    const changeBtn = $('changeLocationBtn');
    if (userLocation && userLocation.city) {
      setup.classList.add('is-set');
      chip.classList.add('is-visible');
      const parts = [locationLabel || userLocation.city];
      if (userLocation.pincode) parts.push(userLocation.pincode);
      if (userLocation.latitude != null && userLocation.longitude != null) {
        parts.push(userLocation.location_source === 'device' ? 'device location' : 'approximate point');
      }
      chip.textContent = 'Searching near: ' + parts.join(' · ');
      changeBtn.style.display = 'inline-block';
    } else {
      setup.classList.remove('is-set');
      chip.classList.remove('is-visible');
      changeBtn.style.display = 'none';
    }
  }

  async function loadSavedLocation() {
    const data = await api('/patient/location');
    if (data && data.location) {
      userLocation = data.location;
      $('city').value = data.location.city || '';
      $('pincode').value = data.location.pincode || '';
      $('district').value = data.location.district || '';
      $('state').value = data.location.state || '';
      updateLocationUI();
    }
  }

  async function saveLocation(source) {
    const city = val('city');
    const pincode = val('pincode');
    const locality = val('locality');
    const haveDevice = deviceFresh && userLocation && userLocation.latitude != null;
    if (!city && !pincode && !locality && !haveDevice) {
      toast('Enter a Delhi locality, PIN code or city');
      return;
    }
    const body = {
      city: city || 'Delhi',
      locality: locality || null,
      pincode: pincode || null,
      district: val('district') || null,
      state: val('state') || null,
      location_source: source || 'manual'
    };
    // Only send coordinates when they were just taken from the device. Otherwise the server
    // works them out from the typed place, so an old position never follows a new city.
    if (deviceFresh && userLocation && userLocation.latitude != null) {
      body.latitude = userLocation.latitude;
      body.longitude = userLocation.longitude;
      body.location_source = 'device';
    }
    const data = await api('/patient/location', { method: 'POST', body });
    if (data && data.location) {
      userLocation = data.location;
      deviceFresh = false;
      locationLabel = (data.resolution && data.resolution.label) || '';
      $('city').value = data.location.city || '';
      $('pincode').value = data.location.pincode || '';
      updateLocationUI();
      toast('Location saved');
      return data.location;
    }
    return null;
  }

  /** Device location only after explicit button click (browser permission prompt). */
  function getDeviceLocation() {
    if (!navigator.geolocation) {
      toast('This browser cannot share location. Type your area or PIN code instead.');
      return;
    }
    if (window.isSecureContext === false) {
      toast('Device location needs a secure (https) page. Type your area or PIN code instead.');
      return;
    }
    const btn = $('deviceLocationBtn');
    btn.disabled = true;
    const prev = btn.innerHTML;
    btn.textContent = 'Waiting for permission…';

    navigator.geolocation.getCurrentPosition(
      async function (position) {
        userLocation = Object.assign({}, userLocation || {}, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        deviceFresh = true;
        devicePoint = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        // Save straight away: the server snaps the position to the nearest Delhi locality and fills city / PIN.
        const saved = await saveLocation('device');
        btn.disabled = false;
        btn.innerHTML = prev;
        if (saved) { toast('Using your current location'); searchFacilities(); }
      },
      function (error) {
        btn.disabled = false;
        btn.innerHTML = prev;
        let msg = 'Could not read your location. ';
        if (error.code === 1) msg += 'Permission was declined, so type your area or PIN code instead.';
        else if (error.code === 2) msg += 'Your device could not work out its position. Type your area or PIN code instead.';
        else if (error.code === 3) msg += 'It took too long. Try again or type your area or PIN code.';
        else msg += 'Type your area or PIN code instead.';
        toast(msg);
      },
      // Low accuracy is enough to pick a neighbourhood and avoids the timeouts high accuracy causes on laptops.
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }

  function changeLocation() {
    userLocation = null; // Coordinates from the previous city must not follow a new manual location.
    deviceFresh = false; devicePoint = null; locationLabel = '';
    if ($('locality')) $('locality').value = '';
    $('city').value = '';
    $('pincode').value = '';
    $('district').value = '';
    $('state').value = '';
    $('city').focus();
    updateLocationUI();
    $('facilitiesList').innerHTML = '';
    $('resultsMeta').hidden = true;
    $('alternativesBanner').hidden = true;
    $('emptyState').hidden = true;
    toast('Enter another city, then save and search. Use device location again if you want distance ranking.');
  }

  function renderAlternatives(alt) {
    const banner = $('alternativesBanner');
    if (!alt || !alt.facilities || !alt.facilities.length) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = '<strong>No close match.</strong> ' + escapeHtml(alt.reason) +
      ' Call first and confirm the service, or ask for a referral.';
  }

  async function searchFacilities() {
    const city = val('city');
    const pincode = val('pincode');
    const locality = val('locality');
    if (!city && !pincode && !locality && !(userLocation && userLocation.latitude != null)) {
      toast('Enter a Delhi locality or PIN code first (or use your current location).');
      ($('locality') || $('city')).focus();
      return;
    }
    const service = $('service').value;
    const params = new URLSearchParams({limit:'50',...window.FacilityMatchUI.read()});
    if (service) params.set('service', service);
    if (city) params.set('city', city);
    if (pincode) params.set('pincode', pincode);
    if (locality) params.set('locality', locality);
    for (const [key,id] of [['facility_type','facilityType'],['capability','capability'],['accessibility','accessibility']]) if($(id).value)params.set(key,$(id).value);
    // Typed place wins unless the device position was taken since the last save.
    lastSearchHadCoords = !!devicePoint;
    if (devicePoint) { params.set('user_lat',devicePoint.latitude);params.set('user_lon',devicePoint.longitude); }
    else if (!city && !pincode && !locality && userLocation && userLocation.latitude != null) { params.set('user_lat',userLocation.latitude);params.set('user_lon',userLocation.longitude); }
    $('searchBtn').disabled=true;
    $('loadingState').hidden=false;$('emptyState').hidden=true;$('alternativesBanner').hidden=true;
    $('facilitiesList').innerHTML='';$('resultsMeta').hidden=true;$('matchingWarnings').hidden=true;
    try {
      const data=await api('/facilities/search?'+params.toString());
      if(!data)return;
      facilities=data.facilities||[];
      const alt=data.alternatives;
      const shown=facilities.length?facilities:(alt?alt.facilities:[]);
      $('resultsMeta').hidden=false;
      const where=data.location&&data.location.ok?' near '+(data.location.label||'you'):'';
      $('resultsCount').textContent=facilities.length
        ? facilities.length+' suitable '+(facilities.length===1?'facility':'facilities')+where+' · nearest first, then by your stated preferences'
        : (alt ? 'Nothing close by — nearest options that offer this service' : 'No facilities found');
      const warnings=data.warnings||[];
      if(warnings.length){$('matchingWarnings').hidden=false;$('matchingWarnings').className='matching-warning';$('matchingWarnings').textContent=warnings.join(' ');}
      window.FacilityMatchUI.announce(data.scoring_note);
      if(!shown.length){$('emptyState').hidden=false;return;}
      if(!facilities.length)renderAlternatives(alt);
      renderFacilities(shown);
    } finally {$('loadingState').hidden=true;$('searchBtn').disabled=false;}
  }

  /** Doctors registered on DaiHealth near the chosen place, with an honest fallback list of places to call. */
  async function findNearbyDoctors() {
    const box = $('nearbyDoctors');
    if (!box) return;
    const params = new URLSearchParams();
    const specialty = $('doctorSpecialty') ? $('doctorSpecialty').value : '';
    if (specialty) params.set('specialty', specialty);
    for (const [k, id] of [['city','city'],['pincode','pincode'],['locality','locality']]) { const v = val(id); if (v) params.set(k, v); }
    if (devicePoint) { params.set('user_lat', devicePoint.latitude); params.set('user_lon', devicePoint.longitude); }
    if (!params.has('city') && !params.has('pincode') && !params.has('locality') && !params.has('user_lat')) {
      toast('Enter a Delhi locality or PIN code first.');
      return;
    }
    const maxd = val('maxDistance'); if (maxd) params.set('max_distance_km', maxd);
    box.hidden = false;
    box.innerHTML = '<p class="field-missing">Looking for doctors…</p>';
    const data = await api('/facilities/doctors/nearby?' + params.toString());
    if (!data) { box.innerHTML = '<p class="field-missing">Could not load doctors. Try again.</p>'; return; }
    let html = '<h3 style="margin:.2rem 0 .6rem">Doctors near ' + escapeHtml((data.location && data.location.label) || 'you') + '</h3>';
    if (data.doctors.length) {
      html += data.doctors.map(function (d) {
        const fac = d.facility || {};
        return '<div class="doctor-item"><div class="doctor-name">' + escapeHtml(d.full_name) + '</div><div class="doctor-meta">' +
          (d.specialization ? escapeHtml(d.specialization) + ' · ' : '') +
          (d.qualification_verified ? '<span class="badge ok">Registration verified</span>' : '<span class="badge warn">Registration not verified</span>') + ' ' +
          (d.accepts_new_patients ? '<span class="badge ok">Accepts new patients</span>' : '<span class="badge muted">Not accepting new patients</span>') + '<br>' +
          escapeHtml(fac.name || 'Facility') + ' · ' + escapeHtml(String(d.distance_km)) + ' km<br>' +
          (d.languages && d.languages.length ? 'Languages: ' + escapeHtml(d.languages.join(', ')) : '<span class="field-missing">languages not listed</span>') +
          '</div><div class="facility-actions" style="margin-top:.5rem"><button type="button" class="primary" data-action="book" data-id="' + fac.id + '">Book</button></div></div>';
      }).join('');
    }
    (data.warnings || []).forEach(function (w) { html += '<p class="field-missing">' + escapeHtml(w) + '</p>'; });
    if (data.facilities_without_doctors && data.facilities_without_doctors.length) {
      html += '<h4 style="margin:1rem 0 .4rem">Nearby places to call</h4>' + data.facilities_without_doctors.map(function (f) {
        const c = f.contact || {};
        return '<div class="doctor-item"><div class="doctor-name">' + escapeHtml(f.name) + ' · ' + escapeHtml(String(f.distance_km)) + ' km</div><div class="doctor-meta">' +
          escapeHtml(c.advice || '') + '<br>' + contactLinks(f, c) + '</div></div>';
      }).join('');
    }
    box.innerHTML = html;
  }

  function contactLinks(f, c) {
    const out = [];
    if (f.phone) out.push('<a href="tel:' + escapeHtml(f.phone) + '">📞 Call ' + escapeHtml(f.phone) + '</a>');
    if (c && c.website) out.push('<a href="' + escapeHtml(c.website) + '" target="_blank" rel="noopener">Website</a>');
    if (c && c.directions_url) out.push('<a href="' + escapeHtml(c.directions_url) + '" target="_blank" rel="noopener">Directions</a>');
    return out.length ? out.join(' · ') : '<span class="field-missing">No phone or website on record</span>';
  }

  function renderServiceTags(services, capabilities) {
    const tags = [];
    (services || []).slice(0, 6).forEach(function (s) {
      const name = s.service_name || s.service_category || '';
      if (name) tags.push('<span class="service-tag">' + escapeHtml(name) + '</span>');
    });
    (capabilities || []).slice(0, 4).forEach(function (c) {
      const name = c.capability || '';
      if (name) tags.push('<span class="service-tag capability">' + escapeHtml(name.replace(/_/g, ' ')) + '</span>');
    });
    if (!tags.length) return '<span class="field-missing">Services not listed</span>';
    return tags.join('');
  }

  function verificationBlock(f) {
    if (f.verification_source === 'synthetic_fixture') return '<div class="verification-badge unverified">Synthetic demo · Fictional facility, not a verified provider</div>';
    const verified = !!f.verified_at;
    const cls = verified ? 'verified' : 'unverified';
    const source = f.verification_source
      ? escapeHtml(f.verification_source)
      : '<span class="field-missing">source not recorded</span>';
    const when = formatDate(f.verified_at) || formatDate(f.last_updated);
    return (
      '<div class="verification-badge ' + cls + '">' +
      (verified ? '✓ Verified' : '⚠ Unverified') +
      ' · Source: ' + source +
      (when ? ' · Last verified / updated: ' + escapeHtml(when) : ' · <span class="field-missing">date unknown</span>') +
      '</div>'
    );
  }

  function renderFacilities(list) {
    $('facilitiesList').innerHTML = list.map(function (f) {
      const phone = f.phone
        ? '<a href="tel:' + escapeHtml(f.phone) + '">📞 ' + escapeHtml(f.phone) + '</a>'
        : missing('Phone');
      const addr = [f.address, f.city, f.pincode].filter(Boolean).join(', ') || null;
      return (
        '<article class="facility-card" data-id="' + f.id + '">' +
        '<div class="facility-header">' +
        '<div><h3 class="facility-name">' + escapeHtml(f.name) + '</h3>' +
        '<div class="facility-type">' + escapeHtml((f.facility_type || 'facility').replace(/_/g, ' ')) + '</div></div>' +
        (f.distance_km != null
          ? '<div class="facility-distance">' + escapeHtml(String(f.distance_km)) + ' km</div>'
          : (lastSearchHadCoords ? '<div class="facility-distance" title="No coordinates on record">Distance unknown</div>' : '')) +
        '</div>' +
        '<div class="facility-address">' + (addr ? escapeHtml(addr) : missing('Address')) + '</div>' +
        '<div class="facility-contact">' + (f.phone ? phone + ' · ' : '') + contactLinks({phone: null}, f.contact) +
        (f.phone ? '' : ' <span class="field-missing">Phone not available</span>') + '</div>' +
        (f.contact && f.contact.advice ? '<div class="field-missing" style="margin:.2rem 0">' + escapeHtml(f.contact.advice) + '</div>' : '') +
        '<div class="services-list">' + renderServiceTags(f.services, f.capabilities) + '</div>' +
        verificationBlock(f) +
        window.FacilityMatchUI.explain(f) +
        '<div class="facility-actions">' +
        '<button type="button" class="primary" data-action="book" data-id="' + f.id + '">Book</button>' +
        '<button type="button" data-action="details" data-id="' + f.id + '">Details &amp; doctors</button>' +
        '<button type="button" data-action="call" data-phone="' + escapeHtml(f.phone || '') + '">Call</button>' +
        '<button type="button" data-action="refer" data-id="' + f.id + '">Referral</button>' +
        '</div></article>'
      );
    }).join('');
  }

  function hoursText(hours) {
    if (!hours || typeof hours !== 'object') return null;
    try {
      return Object.keys(hours).map(function (d) {
        return d + ': ' + (hours[d] || '—');
      }).join('; ');
    } catch (e) {
      return null;
    }
  }

  async function showDetails(facilityId) {
    const data = await api('/facilities/' + facilityId);
    if (!data || !data.facility) return;
    selectedFacility = data.facility;
    const f = data.facility;
    $('facilityModalTitle').textContent = f.name || 'Facility';

    const opHours = hoursText(f.operating_hours);
    const langs = Array.isArray(f.languages) && f.languages.length
      ? f.languages.join(', ')
      : null;
    const access = Array.isArray(f.accessibility_features) && f.accessibility_features.length
      ? f.accessibility_features.join(', ')
      : null;

    let html =
      '<p><strong>Address</strong><br>' +
      (f.address ? escapeHtml(f.address) + '<br>' : '') +
      [f.city, f.district, f.state, f.pincode].filter(Boolean).map(escapeHtml).join(', ') +
      (!f.address && !f.city ? missing('Address') : '') +
      '</p>' +
      '<p><strong>Phone</strong><br>' +
      (f.phone ? '<a href="tel:' + escapeHtml(f.phone) + '">' + escapeHtml(f.phone) + '</a>' : missing('Phone')) +
      (f.alternate_phone ? ' · alt ' + escapeHtml(f.alternate_phone) : '') +
      '</p>' +
      '<p><strong>Hours</strong><br>' + (opHours ? escapeHtml(opHours) : missing('Operating hours')) + '</p>' +
      '<p><strong>Languages</strong><br>' + (langs ? escapeHtml(langs) : missing('Languages')) + '</p>' +
      '<p><strong>Accessibility</strong><br>' + (access ? escapeHtml(access) : missing('Accessibility features')) + '</p>' +
      '<p><strong>NICU</strong><br>' +
      (f.has_nicu_level && f.has_nicu_level !== 'none'
        ? 'Level ' + escapeHtml(f.has_nicu_level)
        : (f.has_nicu_level === 'none' ? 'None' : missing('NICU level'))) +
      '</p>' +
      '<div style="margin:1rem 0;"><strong>Services</strong><div class="services-list" style="margin-top:0.4rem;">' +
      renderServiceTags(f.services, []) + '</div></div>' +
      '<div style="margin:1rem 0;"><strong>Capabilities</strong><div class="services-list" style="margin-top:0.4rem;">' +
      renderServiceTags([], f.capabilities) + '</div></div>' +
      verificationBlock(f) +
      '<div id="doctorsBlock" style="margin-top:1.25rem;"><p class="field-missing">Loading doctors…</p></div>' +
      '<div class="facility-actions" style="margin-top:1.25rem;">' +
      '<button type="button" class="primary" data-action="book" data-id="' + f.id + '">Book appointment</button>' +
      '<button type="button" data-action="call" data-phone="' + escapeHtml(f.phone || '') + '">Call facility</button>' +
      '<button type="button" data-action="refer" data-id="' + f.id + '">Create referral</button>' +
      '</div>';

    $('facilityModalContent').innerHTML = html;
    $('facilityModal').classList.add('is-open');
    loadDoctors(facilityId);
  }

  async function loadDoctors(facilityId) {
    const data = await api('/facilities/' + facilityId + '/doctors');
    const block = $('doctorsBlock');
    if (!block) return;
    if (!data || !data.doctors || !data.doctors.length) {
      block.innerHTML = '<strong>Doctors</strong><p class="field-missing">No affiliated clinicians listed for this facility.</p>';
      return;
    }
    block.innerHTML =
      '<strong>Doctors at this facility</strong>' +
      data.doctors.map(function (d) {
        const name = d.full_name || 'Clinician';
        const spec = d.specialization || null;
        const verified = d.qualification_verified
          ? '<span class="badge ok">Registration verified</span>'
          : '<span class="badge warn">Verification not confirmed</span>';
        const accepts = d.accepts_new_patients
          ? '<span class="badge ok">Accepts new patients</span>'
          : '<span class="badge muted">Not accepting new patients</span>';
        const langs = Array.isArray(d.languages) && d.languages.length
          ? escapeHtml(d.languages.join(', '))
          : '<span class="field-missing">languages unknown</span>';
        const hours = hoursText(d.clinic_hours);
        const reg = d.verification_details && d.verification_details.registration_number
          ? escapeHtml(d.verification_details.registration_number)
          : (d.medical_license_number ? escapeHtml(d.medical_license_number) : null);
        return (
          '<div class="doctor-item">' +
          '<div class="doctor-name">' + escapeHtml(name) + '</div>' +
          '<div class="doctor-meta">' +
          (spec ? escapeHtml(spec) + ' · ' : '') +
          (d.role ? escapeHtml(String(d.role).replace(/_/g, ' ')) + ' · ' : '') +
          verified + ' ' + accepts + '<br>' +
          'Languages: ' + langs + '<br>' +
          (hours ? 'Clinic hours: ' + escapeHtml(hours) + '<br>' : 'Clinic hours: ' + missing('hours') + '<br>') +
          (reg ? 'Reg. / license: ' + reg : missing('Registration number')) +
          '</div></div>'
        );
      }).join('');

    const sel = $('appointmentDoctorId');
    if (sel && String($('appointmentFacilityId').value) === String(facilityId)) {
      sel.innerHTML = '<option value="">Facility / any available</option>' +
        data.doctors.map(function (d) {
          return '<option value="' + d.doctor_id + '">' + escapeHtml(d.full_name || 'Doctor') +
            (d.specialization ? ' — ' + escapeHtml(d.specialization) : '') + '</option>';
        }).join('');
    }
  }

  async function openBook(facilityId) {
    $('appointmentFacilityId').value = facilityId;
    $('appointmentDoctorId').innerHTML = '<option value="">Facility / any available</option>';
    $('appointmentType').value = '';
    $('appointmentDate').value = '';
    $('appointmentTime').value = '';
    $('appointmentReason').value = '';
    const min = new Date();
    $('appointmentDate').min = min.toISOString().slice(0, 10);
    $('appointmentModal').classList.add('is-open');
    loadDoctors(facilityId);
  }

  async function submitAppointment(e) {
    e.preventDefault();
    const facilityId = $('appointmentFacilityId').value;
    const body = {
      appointment_type: $('appointmentType').value,
      requested_date: $('appointmentDate').value,
      preferred_time: $('appointmentTime').value || null,
      reason: $('appointmentReason').value.trim() || null,
      doctor_id: $('appointmentDoctorId').value || null
    };
    if (!body.appointment_type || !body.requested_date) {
      toast('Type and date are required');
      return;
    }
    const data = await api('/facilities/' + facilityId + '/appointment', { method: 'POST', body });
    if (data && data.appointment) {
      toast('Appointment requested — status: ' + (data.appointment.status || 'pending'));
      $('appointmentModal').classList.remove('is-open');
      loadAppointments();
    }
  }

  function openReferral(facilityId) {
    $('referralToFacilityId').value = facilityId;
    $('referralReason').value = '';
    $('referralNotes').value = '';
    $('referralUrgency').value = 'routine';
    $('referralModal').classList.add('is-open');
  }

  async function submitReferral(e) {
    e.preventDefault();
    const body = {
      to_facility_id: Number($('referralToFacilityId').value),
      referral_reason: $('referralReason').value.trim(),
      urgency: $('referralUrgency').value,
      referral_notes: $('referralNotes').value.trim() || null
    };
    if (!body.to_facility_id || !body.referral_reason) {
      toast('Reason is required');
      return;
    }
    const data = await api('/facilities/referral', { method: 'POST', body });
    if (data && data.referral) {
      toast('Referral created — status: ' + (data.referral.status || 'pending'));
      $('referralModal').classList.remove('is-open');
    }
  }

  async function loadAppointments() {
    const data = await api('/facilities/appointments');
    const section = $('appointmentsSection');
    const list = $('appointmentsList');
    if (!data || !data.appointments) return;
    section.hidden = false;
    if (!data.appointments.length) {
      list.innerHTML = '<p class="field-missing">No facility appointments yet.</p>';
      return;
    }
    list.innerHTML = data.appointments.map(function (a) {
      const st = a.status || 'pending';
      return (
        '<div class="appointment-row">' +
        '<div><strong>' + escapeHtml(a.facility_name || 'Facility') + '</strong><br>' +
        escapeHtml(a.appointment_type || '') +
        (a.doctor_name ? ' · ' + escapeHtml(a.doctor_name) : '') +
        '<br>' + escapeHtml(formatDate(a.requested_date) || a.requested_date || '') +
        (a.preferred_time ? ' · ' + escapeHtml(a.preferred_time) : '') +
        '</div>' +
        '<div class="status-' + escapeHtml(st) + '"><strong>' + escapeHtml(st) + '</strong></div>' +
        '</div>'
      );
    }).join('');
  }

  function callFacility(phone) {
    if (!phone) {
      toast('Phone number not available for this facility');
      return;
    }
    window.location.href = 'tel:' + phone;
  }

  function onListClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (action === 'book') openBook(id);
    else if (action === 'details') showDetails(id);
    else if (action === 'call') callFacility(btn.getAttribute('data-phone'));
    else if (action === 'refer') openReferral(id);
  }

  function closeModals() {
    $('appointmentModal').classList.remove('is-open');
    $('facilityModal').classList.remove('is-open');
    $('referralModal').classList.remove('is-open');
  }

  function init() {
    $('deviceLocationBtn').addEventListener('click', getDeviceLocation);
    $('saveLocationBtn').addEventListener('click', function () { saveLocation('manual'); });
    $('changeLocationBtn').addEventListener('click', changeLocation);
    $('searchBtn').addEventListener('click', searchFacilities);
    ['city', 'pincode', 'locality'].forEach(function (id) { if ($(id)) $(id).addEventListener('input', function () { devicePoint = null; deviceFresh = false; }); });
    if ($('findDoctorsBtn')) $('findDoctorsBtn').addEventListener('click', findNearbyDoctors);
    if ($('nearbyDoctors')) $('nearbyDoctors').addEventListener('click', onListClick);
    $('loadAppointmentsBtn').addEventListener('click', loadAppointments);
    $('facilitiesList').addEventListener('click', onListClick);
    $('facilityModalContent').addEventListener('click', onListClick);
    $('appointmentForm').addEventListener('submit', submitAppointment);
    $('referralForm').addEventListener('submit', submitReferral);
    $('closeAppointmentModal').addEventListener('click', closeModals);
    $('closeFacilityModal').addEventListener('click', closeModals);
    $('closeReferralModal').addEventListener('click', closeModals);
    document.querySelectorAll('.modal-overlay').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target === el) closeModals();
      });
    });

    loadSavedLocation();
  }

  window.FacilityDiscovery = {
    bookAppointment: openBook,
    showDetails: showDetails,
    callFacility: callFacility,
    showDoctors: loadDoctors
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
