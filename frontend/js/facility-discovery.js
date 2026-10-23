/* Facility Discovery — patient/caregiver frontend for /api/facilities & /api/patient/location */
(function () {
  'use strict';

  const API = window.DaiAPI;
  const API_BASE = (API && API.API_BASE) || window.DAI_API_BASE || '/api';
  const toast = (API && API.toast) || function (m) { alert(m); };
  const $ = (id) => document.getElementById(id);

  let userLocation = null;
  let facilities = [];
  let selectedFacility = null;
  let lastSearchHadCoords = false;

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
      const parts = [userLocation.city];
      if (userLocation.pincode) parts.push(userLocation.pincode);
      if (userLocation.latitude != null && userLocation.longitude != null) {
        parts.push('coords saved');
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
    const city = $('city').value.trim();
    if (!city) {
      toast('City is required');
      return;
    }
    const body = {
      city,
      pincode: $('pincode').value.trim() || null,
      district: $('district').value.trim() || null,
      state: $('state').value.trim() || null,
      latitude: userLocation && userLocation.latitude != null ? userLocation.latitude : null,
      longitude: userLocation && userLocation.longitude != null ? userLocation.longitude : null,
      location_source: source || 'manual'
    };
    const data = await api('/patient/location', { method: 'POST', body });
    if (data && data.location) {
      userLocation = data.location;
      updateLocationUI();
      toast('Location saved');
    }
  }

  /** Device location only after explicit button click (browser permission prompt). */
  function getDeviceLocation() {
    if (!navigator.geolocation) {
      toast('Geolocation is not supported in this browser');
      return;
    }
    const btn = $('deviceLocationBtn');
    btn.disabled = true;
    const prev = btn.innerHTML;
    btn.textContent = 'Waiting for permission…';

    navigator.geolocation.getCurrentPosition(
      function (position) {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        userLocation = Object.assign({}, userLocation || {}, { latitude, longitude });
        btn.disabled = false;
        btn.innerHTML = prev.replace('Use my current location', 'Location detected ✓');
        toast('Coordinates saved. Confirm city / PIN and press Save location.');
        if (!$('city').value.trim()) {
          $('city').focus();
        }
      },
      function (error) {
        btn.disabled = false;
        btn.innerHTML = prev;
        let msg = 'Could not use device location. ';
        if (error.code === 1) msg += 'Permission denied — enter city manually.';
        else if (error.code === 2) msg += 'Position unavailable.';
        else if (error.code === 3) msg += 'Timed out.';
        toast(msg);
      },
      { timeout: 12000, enableHighAccuracy: true, maximumAge: 0 }
    );
  }

  function changeLocation() {
    userLocation = userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
      : null;
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
    toast('Enter another city or PIN, then Save and Search');
  }

  async function searchFacilities() {
    const city = $('city').value.trim();
    if (!city) {
      toast('Set a city first (manual entry is enough)');
      $('city').focus();
      return;
    }

    $('loadingState').hidden = false;
    $('emptyState').hidden = true;
    $('alternativesBanner').hidden = true;
    $('facilitiesList').innerHTML = '';
    $('resultsMeta').hidden = true;

    const params = new URLSearchParams({ city, limit: '50' });
    const facilityType = $('facilityType').value;
    const service = $('service').value;
    const capability = $('capability').value;
    const language = $('language').value;
    const accessibility = $('accessibility').value;
    const maxDistance = $('maxDistance').value;

    if (facilityType) params.set('facility_type', facilityType);
    if (service) params.set('service', service);
    if (capability) params.set('capability', capability);
    if (language) params.set('language', language);
    if (accessibility) params.set('accessibility', accessibility);
    if (maxDistance) params.set('max_distance_km', maxDistance);

    lastSearchHadCoords = !!(userLocation && userLocation.latitude != null && userLocation.longitude != null);
    if (lastSearchHadCoords) {
      params.set('user_lat', userLocation.latitude);
      params.set('user_lon', userLocation.longitude);
    }

    const data = await api('/facilities/search?' + params.toString());
    $('loadingState').hidden = true;

    if (!data) return;

    facilities = data.facilities || [];
    $('resultsMeta').hidden = false;
    $('resultsCount').textContent = facilities.length
      ? facilities.length + ' facility' + (facilities.length === 1 ? '' : 'ies') + ' in / near ' + city
      : 'No exact matches for these filters';

    if (facilities.length === 0) {
      $('emptyState').hidden = false;
      if (service || capability || accessibility) {
        await searchNearestAlternatives(city, maxDistance);
      }
      return;
    }

    renderFacilities(facilities);
  }

  /** When filters yield nothing, show nearest appropriate options. */
  async function searchNearestAlternatives(city, maxDistance) {
    const params = new URLSearchParams({
      city,
      limit: '15',
      max_distance_km: String(Math.max(Number(maxDistance) || 50, 100))
    });
    if (userLocation && userLocation.latitude != null) {
      params.set('user_lat', userLocation.latitude);
      params.set('user_lon', userLocation.longitude);
    }
    const data = await api('/facilities/search?' + params.toString());
    if (!data || !data.facilities || !data.facilities.length) return;

    const banner = $('alternativesBanner');
    banner.hidden = false;
    banner.innerHTML =
      '<strong>No exact match nearby.</strong> Showing nearest facilities in this city (filters relaxed). ' +
      'Call or request a referral if the service you need is not listed as verified.';
    facilities = data.facilities;
    $('emptyState').hidden = true;
    $('resultsCount').textContent = facilities.length + ' nearest alternative(s)';
    renderFacilities(facilities);
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
        '<div class="facility-contact">' + phone + '</div>' +
        '<div class="services-list">' + renderServiceTags(f.services, f.capabilities) + '</div>' +
        verificationBlock(f) +
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
        '<br>' + escapeHtml(a.requested_date || '') +
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
