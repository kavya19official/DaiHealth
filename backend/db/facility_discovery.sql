-- ============================================================================
-- Facility Discovery & Doctor Directory
--
-- This migration adds tables for:
-- - Facility directory with comprehensive metadata
-- - Service offerings and capabilities
-- - Doctor-facility relationships
-- - Patient location preferences
-- - Facility appointments and referrals
--
-- Apply with:
--   psql "$DATABASE_URL" -f backend/db/facility_discovery.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Facilities
-- Comprehensive facility registry for hospitals, clinics, diagnostic labs,
-- vaccination centers, etc.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
  id SERIAL PRIMARY KEY,
  facility_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  facility_type VARCHAR(50) NOT NULL CHECK (facility_type IN (
    'hospital', 'maternity_centre', 'clinic', 'diagnostic_lab',
    'vaccination_center', 'phc', 'chc', 'nursing_home'
  )),
  tier VARCHAR(50) CHECK (tier IN (
    'medical_college', 'district_hospital', 'chc', 'phc',
    'private_hospital', 'clinic', 'diagnostic_center'
  )),
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL,
  state VARCHAR(50) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  phone VARCHAR(20),
  alternate_phone VARCHAR(20),
  email VARCHAR(255),
  website VARCHAR(255),
  ownership VARCHAR(20) CHECK (ownership IN ('govt', 'private', 'ngo', 'public_private')),
  nabh_accredited BOOLEAN DEFAULT FALSE,
  emergency_24x7 BOOLEAN DEFAULT FALSE,
  has_ambulance BOOLEAN DEFAULT FALSE,
  has_blood_bank BOOLEAN DEFAULT FALSE,
  has_nicu_level VARCHAR(10) CHECK (has_nicu_level IN ('none', 'I', 'II', 'III')),
  total_beds INTEGER,
  labour_tables INTEGER,
  operating_hours JSONB, -- { "monday": "09:00-17:00", ... }
  languages JSONB DEFAULT '[]'::jsonb, -- ["hindi", "english", "marathi"]
  accessibility_features JSONB DEFAULT '[]'::jsonb, -- ["wheelchair", "elevator", "accessible_toilet"]
  verified_at TIMESTAMPTZ,
  verification_source VARCHAR(100), -- "nmc_registry", "facility_direct_submission", "manual_verification"
  last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_facilities_location ON facilities(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_facilities_city ON facilities(city);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(facility_type);
CREATE INDEX IF NOT EXISTS idx_facilities_active ON facilities(active) WHERE active = TRUE;

-- ----------------------------------------------------------------------------
-- Facility Services
-- Services offered by each facility (ultrasound, lab tests, vaccination, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_services (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  service_name VARCHAR(100) NOT NULL,
  service_category VARCHAR(50) NOT NULL CHECK (service_category IN (
    'obstetrics', 'gynecology', 'ultrasound', 'lab_tests',
    'vaccination', 'emergency', 'nicu', 'blood_bank',
    'pharmacy', 'ambulance', 'telemedicine'
  )),
  available BOOLEAN DEFAULT TRUE,
  notes TEXT,
  UNIQUE(facility_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_facility_services_facility ON facility_services(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_services_category ON facility_services(service_category);

-- ----------------------------------------------------------------------------
-- Facility Capabilities
-- High-level capabilities (high-risk pregnancy, emergency maternity, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_capabilities (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  capability VARCHAR(100) NOT NULL CHECK (capability IN (
    'high_risk_pregnancy', 'emergency_maternity', 'c_section_24x7',
    'blood_transfusion', 'neonatal_surgery', 'icu_mother',
    'telemedicine', 'home_visits', 'mental_health_support'
  )),
  available BOOLEAN DEFAULT TRUE,
  notes TEXT,
  UNIQUE(facility_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_facility_capabilities_facility ON facility_capabilities(facility_id);

-- ----------------------------------------------------------------------------
-- Doctor-Facility Relationships
-- Track which doctors work at which facilities with their schedules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_facilities (
  id SERIAL PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN (
    'consultant', 'resident', 'visiting', 'head_of_department'
  )),
  specialization VARCHAR(100),
  consultation_fee NUMERIC(10, 2),
  clinic_hours JSONB, -- { "monday": ["09:00-13:00", "14:00-17:00"], ... }
  accepts_new_patients BOOLEAN DEFAULT TRUE,
  languages JSONB DEFAULT '[]'::jsonb,
  qualification_verified BOOLEAN DEFAULT FALSE,
  verification_details JSONB, -- { "registration_number": "MCI-12345", "verified_at": "2024-01-01" }
  active BOOLEAN DEFAULT TRUE,
  joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_facilities_doctor ON doctor_facilities(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_facilities_facility ON doctor_facilities(facility_id);
CREATE INDEX IF NOT EXISTS idx_doctor_facilities_active ON doctor_facilities(active) WHERE active = TRUE;

-- ----------------------------------------------------------------------------
-- Patient Location Preferences
-- Store patient's preferred location for facility search
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_locations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city VARCHAR(100) NOT NULL,
  district VARCHAR(100),
  state VARCHAR(50),
  pincode VARCHAR(10),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  location_source VARCHAR(20) CHECK (location_source IN ('manual', 'device', 'both')),
  is_primary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_locations_user ON patient_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_patient_locations_primary ON patient_locations(user_id, is_primary) WHERE is_primary = TRUE;

-- ----------------------------------------------------------------------------
-- Facility Appointments
-- Patient appointments at facilities (separate from doctor appointments)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_appointments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  doctor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  appointment_type VARCHAR(50) NOT NULL CHECK (appointment_type IN (
    'consultation', 'diagnostic', 'vaccination', 'follow_up', 'emergency'
  )),
  requested_date DATE NOT NULL,
  preferred_time VARCHAR(20),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'completed', 'cancelled', 'no_show'
  )),
  facility_notes TEXT,
  booked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_facility_appointments_user ON facility_appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_facility_appointments_facility ON facility_appointments(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_appointments_status ON facility_appointments(status);
CREATE INDEX IF NOT EXISTS idx_facility_appointments_date ON facility_appointments(requested_date);

-- ----------------------------------------------------------------------------
-- Facility Referrals
-- Referrals from one facility to another
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_referrals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  to_facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  referral_reason TEXT NOT NULL,
  urgency VARCHAR(20) CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  referral_notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'in_transit', 'arrived', 'completed', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_facility_referrals_user ON facility_referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_facility_referrals_to_facility ON facility_referrals(to_facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_referrals_status ON facility_referrals(status);

COMMIT;
