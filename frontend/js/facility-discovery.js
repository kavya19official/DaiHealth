/* Facility Discovery - Location setup, facility search, booking, and referrals */

(function () {
  'use strict';

  const API_BASE = window.DaiAPI ? window.DaiAPI.API_BASE : (window.DAI_API_BASE || '/api');
  const $ = (id) => document.getElementById(id);

  // State
  let userLocation = null;
  let facilities = [];
  let selectedFacility = null;

  // DOM Elements
  const locationForm = $('locationForm');
  const deviceLocationBtn = $('deviceLocationBtn');
  const saveLocationBtn = $('saveLocationBtn');
  const searchBtn = $('searchBtn');
  const facilitiesList = $('facilitiesList');
  const loadingState = $('loadingState');
  const emptyState = $('emptyState');
  const appointmentModal = $('appointmentModal');
  const appointmentForm = $('appointmentForm');
  const closeAppointmentModal = $('closeAppointmentModal');
  const facilityModal = $('facilityModal');
  const closeFacilityModal = $('closeFacilityModal');

  // Load saved location on page load
  async function loadSavedLocation() {
    try {
      const response = await fetch(`${API_BASE}/patient/location`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (data.location) {
        userLocation = data.location;
        $('city').value = data.location.city || '';
        $('pincode').value = data.location.pincode || '';
        $('district').value = data.location.district || '';
        $('state').value = data.location.state || '';
        updateLocationUI();
      }
    } catch (error) {
      console.error('Failed to load saved location:', error);
    }
  }

  // Save location
  async function saveLocation(source = 'manual') {
    const city = $('city').value.trim();
    const pincode = $('pincode').value.trim();
    const district = $('district').value.trim();
    const state = $('state').value.trim();

    if (!city) {
      alert('Please enter a city');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/patient/location`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          pincode,
          district,
          state,
          latitude: userLocation?.latitude,
          longitude: userLocation?.longitude,
          location_source: source
        })
      });

      if (response.ok) {
        const data = await response.json();
        userLocation = data.location;
        updateLocationUI();
        alert('Location saved successfully!');
      } else {
        const error = await response.json();
        alert('Failed to save location: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to save location:', error);
      alert('Failed to save location. Please try again.');
    }
  }

  // Get device location
  function getDeviceLocation() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    deviceLocationBtn.disabled = true;
    deviceLocationBtn.textContent = 'Getting location...';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        // Reverse geocode to get city (simplified - in production use a geocoding API)
        try {
          // For now, we'll just save coordinates and let user fill in city
          userLocation = { latitude, longitude };
          alert('Location detected! Please fill in your city name and save.');
          deviceLocationBtn.disabled = false;
          deviceLocationBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Location Detected ✓
          `;
        } catch (error) {
          console.error('Geocoding error:', error);
          alert('Could not determine city from location. Please enter manually.');
          deviceLocationBtn.disabled = false;
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        let message = 'Could not get your location. ';
        if (error.code === 1) {
          message += 'Please enable location permissions.';
        } else if (error.code === 2) {
          message += 'Position unavailable.';
        } else if (error.code === 3) {
          message += 'Request timed out.';
        }
        alert(message);
        deviceLocationBtn.disabled = false;
        deviceLocationBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Use My Current Location
        `;
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // Update location UI
  function updateLocationUI() {
    if (userLocation && userLocation.city) {
      $('locationSetup').style.background = 'linear-gradient(135deg, #ecfdf5, #d1fae5)';
      $('locationSetup').style.borderColor = '#10b981';
    }
  }

  // Search facilities
  async function searchFacilities() {
    const city = $('city').value.trim();
    const facilityType = $('facilityType').value;
    const service = $('service').value;
    const capability = $('capability').value;
    const language = $('language').value;
    const maxDistance = $('maxDistance').value;

    if (!city) {
      alert('Please set your location first');
      return;
    }

    // Show loading state
    loadingState.style.display = 'block';
    emptyState.style.display = 'none';
    facilitiesList.innerHTML = '';

    const params = new URLSearchParams({
      city,
      ...(facilityType && { facility_type: facilityType }),
      ...(service && { service }),
      ...(capability && { capability }),
      ...(language && { language }),
      ...(maxDistance && { max_distance_km: maxDistance }),
      ...(userLocation?.latitude && { user_lat: userLocation.latitude }),
      ...(userLocation?.longitude && { user_lon: userLocation.longitude }),
      limit: 50
    });

    try {
      const response = await fetch(`${API_BASE}/facilities/search?${params}`, {
        credentials: 'include'
      });
      const data = await response.json();

      loadingState.style.display = 'none';

      if (data.facilities && data.facilities.length > 0) {
        facilities = data.facilities;
        renderFacilities(data.facilities);
      } else {
        emptyState.style.display = 'block';
      }
    } catch (error) {
      console.error('Search error:', error);
      loadingState.style.display = 'none';
      alert('Failed to search facilities. Please try again.');
    }
  }

  // Render facilities
  function renderFacilities(facilitiesData) {
    facilitiesList.innerHTML = facilitiesData.map(facility => `
      <div class="facility-card">
        <div class="facility-header">
          <div>
            <h3 class="facility-name">${escapeHtml(facility.name)}</h3>
            <div class="facility-type">${escapeHtml(facility.facility_type || 'Healthcare Facility')}</div>
          </div>
          ${facility.distance_km ? `<div class="facility-distance">${facility.distance_km} km</div>` : ''}
        </div>
        <div class="facility-address">
          ${escapeHtml(facility.address)}, ${escapeHtml(facility.city)}, ${escapeHtml(facility.pincode)}
        </div>
        <div class="facility-contact">
          ${facility.phone ? `<a href="tel:${escapeHtml(facility.phone)}">📞 ${escapeHtml(facility.phone)}</a>` : ''}
          ${facility.email ? `<a href="mailto:${escapeHtml(facility.email)}">✉️ ${escapeHtml(facility.email)}</a>` : ''}
        </div>
        <div class="services-list">
          ${renderServiceTags(facility.services || [])}
        </div>
        <div class="verification-badge ${facility.verified_at ? 'verified' : ''}">
          ${facility.verified_at ? '✓ Verified' : '⚠ Unverified'}
          ${facility.verification_source ? `· ${escapeHtml(facility.verification_source)}` : ''}
          ${facility.verified_at ? `· ${formatDate(facility.verified_at)}` : ''}
        </div>
        <div class="facility-actions">
          <button type="button" class="primary" onclick="window.FacilityDiscovery.bookAppointment(${facility.id})">
            Book Appointment
          </button>
          <button type="button" onclick="window.FacilityDiscovery.showDetails(${facility.id})">
            View Details
          </button>
          <button type="button" onclick="window.FacilityDiscovery.callFacility('${escapeHtml(facility.phone || '')}')">
            Call
          </button>
        </div>
      </div>
    `).join('');
  }

  // Render service tags
  function renderServiceTags(services) {
    if (!services || services.length === 0) {
      return '<span class="service-tag">No services listed</span>';
    }
    return services.slice(0, 5).map(s => 
      `<span class="service-tag">${escapeHtml(s.service_name)}</span>`
    ).join('') + (services.length > 5 ? `<span class="service-tag">+${services.length - 5} more</span>` : '');
  }

  // Show facility details
  async function showDetails(facilityId) {
    try {
      const response = await fetch(`${API_BASE}/facilities/${facilityId}`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.facility) {
        selectedFacility = data.facility;
        renderFacilityDetails(data.facility);
        facilityModal.classList.add('is-open');
      }
    } catch (error) {
      console.error('Failed to load facility details:', error);
      alert('Failed to load facility details');
    }
  }

  // Render facility details in modal
  function renderFacilityDetails(facility) {
    $('facilityModalTitle').textContent = facility.name;
    $('facilityModalContent').innerHTML = `
      <div style="margin-bottom: 1rem;">
        <strong>Address:</strong><br>
        ${escapeHtml(facility.address)}<br>
        ${escapeHtml(facility.city)}, ${escapeHtml(facility.district)}, ${escapeHtml(facility.state)}<br>
        PIN: ${escapeHtml(facility.pincode)}
      </div>
      ${facility.phone ? `<div style="margin-bottom: 1rem;"><strong>Phone:</strong> <a href="tel:${escapeHtml(facility.phone)}">${escapeHtml(facility.phone)}</a></div>` : ''}
      ${facility.email ? `<div style="margin-bottom: 1rem;"><strong>Email:</strong> <a href="mailto:${escapeHtml(facility.email)}">${escapeHtml(facility.email)}</a></div>` : ''}
      ${facility.website ? `<div style="margin-bottom: 1rem;"><strong>Website:</strong> <a href="${escapeHtml(facility.website)}" target="_blank">${escapeHtml(facility.website)}</a></div>` : ''}
      
      <div style="margin: 1.5rem 0; padding: 1rem; background: var(--ground); border-radius: 8px;">
        <strong>Services:</strong>
        <div class="services-list" style="margin-top: 0.5rem;">
          ${renderServiceTags(facility.services || [])}
        </div>
      </div>

      <div style="margin: 1.5rem 0; padding: 1rem; background: var(--ground); border-radius: 8px;">
        <strong>Capabilities:</strong>
        <div class="services-list" style="margin-top: 0.5rem;">
          ${facility.capabilities && facility.capabilities.length > 0 
            ? facility.capabilities.map(c => `<span class="service-tag">${escapeHtml(c.capability)}</span>`).join('')
            : '<span class="service-tag">No capabilities listed</span>'}
        </div>
      </div>

      ${facility.languages && facility.languages.length > 0 ? `
        <div style="margin-bottom: 1rem;">
          <strong>Languages:</strong> ${facility.languages.map(l => escapeHtml(l)).join(', ')}
        </div>
      ` : ''}

      ${facility.accessibility_features && facility.accessibility_features.length > 0 ? `
        <div style="margin-bottom: 1rem;">
          <strong>Accessibility:</strong> ${facility.accessibility_features.map(a => escapeHtml(a)).join(', ')}
        </div>
      ` : ''}

      <div style="margin: 1.5rem 0; padding: 1rem; border: 1px solid var(--line); border-radius: 8px;">
        <strong>Information Source:</strong><br>
        Source: ${escapeHtml(facility.verification_source || 'Not specified')}<br>
        Last Updated: ${facility.last_updated ? formatDate(facility.last_updated) : 'Not specified'}<br>
        ${facility.verified_at ? `Verified: ${formatDate(facility.verified_at)}` : 'Not verified'}
      </div>

      <div class="facility-actions" style="margin-top: 1.5rem;">
        <button type="button" class="primary" onclick="window.FacilityDiscovery.bookAppointment(${facility.id})">
          Book Appointment
        </button>
        <button type="button" onclick="window.FacilityDiscovery.showDoctors(${facility.id})">
          View Doctors
        </button>
        <button type="button" onclick="window.FacilityDiscovery.createReferral(${facility.id})">
          Request Referral
        </button>
      </div>
    `;
  }

  // Show doctors at facility
  async function showDoctors(facilityId) {
    try {
      const response = await fetch(`${API_BASE}/facilities/${facilityId}/doctors`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.doctors && data.doctors.length > 0) {
        const doctorsHtml = data.doctors.map(doctor => `
          <div class="doctor-item">
            <div class="doctor-name">${escapeHtml(doctor.full_name)}</div>
            <div class="doctor-specialization">${escapeHtml(doctor.specialization || 'Specialization not specified')}</div>
            ${doctor.medical_license_number ? `<div style="font-size: 0.8rem; color: var(--ink-3);">License: ${escapeHtml(doctor.medical_license_number)}</div>` : ''}
            ${doctor.phone ? `<div style="font-size: 0.8rem; margin-top: 0.3rem;">📞 ${escapeHtml(doctor.phone)}</div>` : ''}
            ${doctor.qualification_verified ? '<div style="font-size: 0.8rem; color: var(--green); margin-top: 0.3rem;">✓ Qualification Verified</div>' : ''}
          </div>
        `).join('');

        $('facilityModalContent').innerHTML = `
          <h3>Doctors at ${selectedFacility.name}</h3>
          <div class="doctor-list">${doctorsHtml}</div>
        `;
      } else {
        $('facilityModalContent').innerHTML = `
          <h3>Doctors at ${selectedFacility.name}</h3>
          <p>No doctors listed at this facility.</p>
        `;
      }
    } catch (error) {
      console.error('Failed to load doctors:', error);
      alert('Failed to load doctors');
    }
  }

  // Book appointment
  function bookAppointment(facilityId) {
    selectedFacility = facilities.find(f => f.id === facilityId);
    if (!selectedFacility) {
      selectedFacility = { id: facilityId, name: 'Facility' };
    }
    $('appointmentFacilityId').value = facilityId;
    appointmentModal.classList.add('is-open');
  }

  // Create referral
  function createReferral(facilityId) {
    const reason = prompt('Why do you need a referral to this facility?');
    if (reason) {
      alert('Referral request functionality would be implemented here. In production, this would create a referral record.');
    }
  }

  // Call facility
  function callFacility(phone) {
    if (phone) {
      window.location.href = `tel:${phone}`;
    } else {
      alert('No phone number available for this facility');
    }
  }

  // Submit appointment form
  async function submitAppointment(e) {
    e.preventDefault();
    const facilityId = $('appointmentFacilityId').value;
    const appointmentType = $('appointmentType').value;
    const appointmentDate = $('appointmentDate').value;
    const appointmentTime = $('appointmentTime').value;
    const appointmentReason = $('appointmentReason').value;

    try {
      const response = await fetch(`${API_BASE}/facilities/${facilityId}/appointment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_type: appointmentType,
          requested_date: appointmentDate,
          preferred_time: appointmentTime,
          reason: appointmentReason
        })
      });

      if (response.ok) {
        alert('Appointment request submitted successfully! The facility will confirm your appointment.');
        appointmentModal.classList.remove('is-open');
        appointmentForm.reset();
      } else {
        const error = await response.json();
        alert('Failed to book appointment: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Appointment booking error:', error);
      alert('Failed to book appointment. Please try again.');
    }
  }

  // Helper functions
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Event listeners
  deviceLocationBtn.addEventListener('click', getDeviceLocation);
  saveLocationBtn.addEventListener('click', () => saveLocation('manual'));
  searchBtn.addEventListener('click', searchFacilities);
  appointmentForm.addEventListener('submit', submitAppointment);
  closeAppointmentModal.addEventListener('click', () => appointmentModal.classList.remove('is-open'));
  closeFacilityModal.addEventListener('click', () => facilityModal.classList.remove('is-open'));

  // Close modals on overlay click
  appointmentModal.addEventListener('click', (e) => {
    if (e.target === appointmentModal) appointmentModal.classList.remove('is-open');
  });
  facilityModal.addEventListener('click', (e) => {
    if (e.target === facilityModal) facilityModal.classList.remove('is-open');
  });

  // Initialize
  loadSavedLocation();

  // Expose functions globally for onclick handlers
  window.FacilityDiscovery = {
    bookAppointment,
    showDetails,
    callFacility,
    showDoctors,
    createReferral
  };
})();
