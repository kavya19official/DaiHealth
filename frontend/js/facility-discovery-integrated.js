/* Facility Discovery - Integrated with dashboard panel */

(function () {
  'use strict';

  const API_BASE = window.DaiAPI ? window.DaiAPI.API_BASE : (window.DAI_API_BASE || '/api');
  const $ = (id) => document.getElementById(id);

  // State
  let userLocation = null;
  let facilities = [];

  // Check if we're on the facilities panel
  function initFacilityDiscovery() {
    const locationForm = $('locationForm');
    if (!locationForm) return; // Panel not present

    const deviceLocationBtn = $('deviceLocationBtn');
    const saveLocationBtn = $('saveLocationBtn');
    const changeLocationBtn = $('changeLocationBtn');
    const searchBtn = $('searchBtn');
    const facilitiesList = $('facilitiesList');
    const locationChip = $('locationChip');

    // Load saved location
    loadSavedLocation();

    // Event listeners
    if (deviceLocationBtn) {
      deviceLocationBtn.addEventListener('click', getDeviceLocation);
    }
    if (saveLocationBtn) {
      saveLocationBtn.addEventListener('click', () => saveLocation('manual'));
    }
    if (changeLocationBtn) {
      changeLocationBtn.addEventListener('click', () => {
        if (locationForm) {
          locationForm.hidden = false;
          changeLocationBtn.style.display = 'none';
        }
      });
    }
    if (searchBtn) {
      searchBtn.addEventListener('click', searchFacilities);
    }
  }

  // Load saved location
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

    const deviceLocationBtn = $('deviceLocationBtn');
    deviceLocationBtn.disabled = true;
    deviceLocationBtn.textContent = 'Getting location...';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        userLocation = { latitude, longitude };
        alert('Location detected! Please fill in your city name and save.');
        deviceLocationBtn.disabled = false;
        deviceLocationBtn.textContent = 'Location detected ✓';
      },
      (error) {
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
        deviceLocationBtn.textContent = 'Use my current location';
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // Update location UI
  function updateLocationUI() {
    const locationSetup = $('locationSetup');
    const locationChip = $('locationChip');
    const changeLocationBtn = $('changeLocationBtn');
    const locationForm = $('locationForm');

    if (userLocation && userLocation.city) {
      if (locationSetup) locationSetup.classList.add('is-set');
      if (locationChip) {
        locationChip.textContent = userLocation.city + (userLocation.pincode ? ' • ' + userLocation.pincode : '');
        locationChip.classList.add('is-visible');
      }
      if (changeLocationBtn) changeLocationBtn.style.display = 'inline-block';
      if (locationForm) locationForm.hidden = true;
    }
  }

  // Search facilities
  async function searchFacilities() {
    const city = $('city').value.trim();
    const facilityType = $('facilityType').value;
    const service = $('service').value;
    const capability = $('capability').value;
    const language = $('language').value;
    const accessibility = $('accessibility').value;
    const maxDistance = $('maxDistance') ? $('maxDistance').value : 50;

    if (!city) {
      alert('Please set your location first');
      return;
    }

    // Show loading state
    const loadingState = $('loadingState');
    const emptyState = $('emptyState');
    const facilitiesList = $('facilitiesList');
    
    if (loadingState) loadingState.hidden = false;
    if (emptyState) emptyState.hidden = true;
    if (facilitiesList) facilitiesList.innerHTML = '';

    const params = new URLSearchParams({
      city,
      ...(facilityType && { facility_type: facilityType }),
      ...(service && { service }),
      ...(capability && { capability }),
      ...(language && { language }),
      ...(accessibility && { accessibility }),
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

      if (loadingState) loadingState.hidden = true;

      if (data.facilities && data.facilities.length > 0) {
        facilities = data.facilities;
        renderFacilities(data.facilities);
      } else {
        if (emptyState) emptyState.hidden = false;
      }
    } catch (error) {
      console.error('Search error:', error);
      if (loadingState) loadingState.style.display = 'none';
      alert('Failed to search facilities. Please try again.');
    }
  }

  // Render facilities
  function renderFacilities(facilitiesData) {
    const facilitiesList = $('facilitiesList');
    if (!facilitiesList) return;

    facilitiesList.innerHTML = facilitiesData.map(facility => `
      <div class="facility-card">
        <div class="facility-header">
          <div>
            <div class="facility-name">${escapeHtml(facility.name)}</div>
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
        <div class="verification-badge ${facility.verified_at ? 'verified' : 'unverified'}">
          ${facility.verified_at ? '✓ Verified' : '⚠ Unverified'}
          ${facility.verification_source ? `· ${escapeHtml(facility.verification_source)}` : ''}
          ${facility.verified_at ? `· ${formatDate(facility.verified_at)}` : ''}
        </div>
        <div class="facility-actions">
          <button type="button" class="btn btn--primary btn--sm" onclick="window.FacilityDiscovery.bookAppointment(${facility.id})">
            Book Appointment
          </button>
          <button type="button" class="btn btn--ghost btn--sm" onclick="window.FacilityDiscovery.callFacility('${escapeHtml(facility.phone || '')}')">
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

  // Book appointment (placeholder - would open modal)
  function bookAppointment(facilityId) {
    alert('Appointment booking would open a modal here. Facility ID: ' + facilityId);
  }

  // Call facility
  function callFacility(phone) {
    if (phone) {
      window.location.href = `tel:${phone}`;
    } else {
      alert('No phone number available for this facility');
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFacilityDiscovery);
  } else {
    initFacilityDiscovery();
  }

  // Expose functions globally
  window.FacilityDiscovery = {
    bookAppointment,
    callFacility
  };
})();
