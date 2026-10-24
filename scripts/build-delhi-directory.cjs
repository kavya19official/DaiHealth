#!/usr/bin/env node
'use strict';
// Generates backend/db/delhi_directory.sql (the Delhi facility directory).
//   node scripts/build-delhi-directory.cjs
//
// HONESTY RULES for this dataset
//  * Names and localities are real, compiled from public information (hospital
//    websites, public directories). Coordinates are neighbourhood-level
//    (about 1-2 km), NOT surveyed.
//  * Nothing is marked verified: verified_at stays NULL and verification_source
//    says where it was compiled from. The app shows these as "Unverified".
//  * Phone numbers, opening hours and fees are NOT invented. They stay NULL
//    (the UI says "not available") unless a source gave them (noted per row).
//  * Services / capabilities are what an institution of that kind publicly
//    describes (e.g. a tertiary govt hospital's labour room and NICU). They are
//    "listed", not confirmed, so patients are told to call and confirm.
const fs = require('node:fs');
const path = require('node:path');
const { resolveLocation } = require('../backend/delhiGazetteer');

const SOURCE = 'public_directory_compilation';
const COMPILED = '2026-10-24';

const S = {
  ob: ['Antenatal care and delivery', 'obstetrics'],
  gy: ['Gynaecology OPD', 'gynecology'],
  us: ['Ultrasound / obstetric imaging', 'ultrasound'],
  lab: ['Laboratory tests', 'lab_tests'],
  em: ['Emergency care', 'emergency'],
  nicu: ['Newborn intensive care (NICU)', 'nicu'],
  bb: ['Blood bank', 'blood_bank'],
  vax: ['Child and maternal vaccination', 'vaccination'],
  ivf: ['IVF / assisted reproduction', 'fertility'],
  fert: ['Fertility consultation', 'fertility'],
};
const C = {
  hrp: 'high_risk_pregnancy', em: 'emergency_maternity', cs: 'c_section_24x7',
  bt: 'blood_transfusion', icu: 'icu_mother', neo: 'neonatal_surgery',
};
const PROFILES = {
  tertiary: { type: 'hospital', own: 'govt', tier: 'medical_college', nicu: 'III', em: true, amb: true, bb: true,
    svc: [S.ob, S.gy, S.us, S.lab, S.em, S.nicu, S.bb, S.vax], cap: [C.hrp, C.em, C.cs, C.bt, C.icu] },
  govt: { type: 'hospital', own: 'govt', tier: 'district_hospital', nicu: 'II', em: true, amb: true, bb: false,
    svc: [S.ob, S.gy, S.us, S.lab, S.em, S.nicu, S.vax], cap: [C.em, C.cs] },
  corp: { type: 'hospital', own: 'private', tier: 'private_hospital', nicu: 'III', em: true, amb: true, bb: true,
    svc: [S.ob, S.gy, S.us, S.lab, S.em, S.nicu, S.bb, S.vax, S.fert], cap: [C.hrp, C.em, C.cs, C.bt, C.icu] },
  mid: { type: 'hospital', own: 'private', tier: 'private_hospital', nicu: 'II', em: true, amb: true, bb: false,
    svc: [S.ob, S.gy, S.us, S.lab, S.em, S.nicu], cap: [C.em, C.cs] },
  women: { type: 'maternity_centre', own: 'private', tier: 'private_hospital', nicu: 'II', em: false, amb: false, bb: false,
    svc: [S.ob, S.gy, S.us, S.lab, S.nicu, S.fert], cap: [C.hrp, C.em] },
  paeds: { type: 'hospital', own: 'govt', tier: 'district_hospital', nicu: 'II', em: true, amb: true, bb: false,
    svc: [S.em, S.nicu, S.vax, S.lab], cap: [] },
  nh: { type: 'nursing_home', own: 'private', tier: 'private_hospital', nicu: 'none', em: false, amb: false, bb: false,
    svc: [S.ob, S.gy, S.us, S.lab], cap: [] },
  ivf: { type: 'ivf_centre', own: 'private', tier: 'clinic', nicu: 'none', em: false, amb: false, bb: false,
    svc: [S.ivf, S.fert, S.gy, S.us, S.lab], cap: [] },
  clinic: { type: 'clinic', own: 'private', tier: 'clinic', nicu: 'none', em: false, amb: false, bb: false,
    svc: [S.gy, S.us, S.vax], cap: [] },
  lab: { type: 'diagnostic_lab', own: 'private', tier: 'diagnostic_center', nicu: 'none', em: false, amb: false, bb: false,
    svc: [S.lab, S.us], cap: [] },
  vax: { type: 'vaccination_center', own: 'govt', tier: 'phc', nicu: 'none', em: false, amb: false, bb: false,
    svc: [S.vax, S.gy], cap: [] },
};

// [code, name, profile, locality (gazetteer), lat, lon, website, extraNote, phone]
// lat/lon null => use the locality centre from the gazetteer (still approximate).
const ROWS = [
  // --- Government / teaching hospitals -------------------------------------
  ['AIIMS', 'All India Institute of Medical Sciences (AIIMS), New Delhi', 'tertiary', 'Safdarjung Enclave', 28.5672, 77.2100, 'https://www.aiims.edu', 'Has an Obstetrics & Gynaecology department and an assisted reproduction unit.'],
  ['SJH', 'Safdarjung Hospital', 'tertiary', 'Safdarjung Enclave', 28.5677, 77.2058, null, null],
  ['LHMC', 'Lady Hardinge Medical College & Smt. Sucheta Kriplani Hospital', 'tertiary', 'Connaught Place', 28.6332, 77.2000, null, 'Women and maternity hospital.'],
  ['KSCH', "Kalawati Saran Children's Hospital", 'paeds', 'Connaught Place', 28.6340, 77.2010, null, "Children's hospital; no delivery services listed."],
  ['RML', 'Dr Ram Manohar Lohia Hospital', 'tertiary', 'Connaught Place', 28.6264, 77.2005, null, null],
  ['LNH', 'Lok Nayak Hospital (LNJP)', 'tertiary', 'Daryaganj', 28.6396, 77.2397, null, null],
  ['GBP', 'GB Pant Institute of Postgraduate Medical Education & Research (GIPMER)', 'tertiary', 'Daryaganj', 28.6377, 77.2381, null, null],
  ['GTB', 'Guru Teg Bahadur Hospital', 'tertiary', 'Dilshad Garden', 28.6850, 77.3098, null, null],
  ['DDU', 'Deen Dayal Upadhyay Hospital', 'govt', 'Hari Nagar', 28.6283, 77.1112, null, null],
  ['BSA', 'Dr Baba Saheb Ambedkar Hospital', 'govt', 'Rohini', 28.7150, 77.1225, null, null],
  ['SGM', 'Sanjay Gandhi Memorial Hospital', 'govt', 'Mangolpuri', 28.6830, 77.0720, null, null],
  ['JPC', 'Jag Pravesh Chandra Hospital', 'govt', 'Shastri Park', 28.6700, 77.2570, null, null],
  ['ASB', 'Acharya Shree Bhikshu Government Hospital', 'govt', 'Moti Nagar', null, null, null, null],
  ['RTRM', 'Rao Tula Ram Memorial Hospital', 'govt', 'Najafgarh', null, null, null, null],
  ['CNBC', 'Chacha Nehru Bal Chikitsalaya', 'paeds', 'Geeta Colony', 28.6560, 77.2740, null, "Children's hospital; no delivery services listed."],
  ['IGH', 'Indira Gandhi Hospital, Dwarka', 'govt', 'Dwarka', 28.5880, 77.0420, null, null],
  ['SDD', 'Sri Dada Dev Matri Avum Shishu Chikitsalaya', 'govt', 'Dwarka', 28.6050, 77.0780, null, 'Mother and child hospital (Dabri).'],
  ['LBS', 'Lal Bahadur Shastri Hospital, Khichripur', 'govt', 'Khichripur', 28.6190, 77.3090, null, null],
  ['HRH', 'Hindu Rao Hospital', 'govt', 'Kamla Nagar', 28.6850, 77.2110, null, 'MCD hospital.'],
  ['KAS', 'Kasturba Hospital, Daryaganj', 'govt', 'Daryaganj', 28.6420, 77.2400, null, 'MCD maternity hospital.'],
  ['ESI', 'ESIC Model Hospital, Basaidarapur', 'govt', 'Moti Nagar', 28.6590, 77.1470, null, 'ESI-insured persons only.'],
  // --- Corporate / large private hospitals ---------------------------------
  ['MAXSKT', 'Max Super Speciality Hospital, Saket', 'corp', 'Malviya Nagar', 28.5280, 77.2120, 'https://www.maxhealthcare.in', null],
  ['MAXPPG', 'Max Super Speciality Hospital, Patparganj', 'corp', 'Mayur Vihar', 28.6240, 77.2950, 'https://www.maxhealthcare.in', null],
  ['MAXSHB', 'Max Super Speciality Hospital, Shalimar Bagh', 'corp', 'Shalimar Bagh', 28.7160, 77.1590, 'https://www.maxhealthcare.in', null],
  ['FORTVK', 'Fortis Hospital, Vasant Kunj', 'corp', 'Vasant Kunj', 28.5190, 77.1580, 'https://www.fortishealthcare.com', null],
  ['FORTSB', 'Fortis Hospital, Shalimar Bagh', 'corp', 'Shalimar Bagh', 28.7160, 77.1600, 'https://www.fortishealthcare.com', null],
  ['FORTLF', 'Fortis La Femme, Greater Kailash II', 'women', 'Greater Kailash', 28.5385, 77.2420, 'https://www.fortishealthcare.com', "Women's hospital."],
  ['APOLLO', 'Indraprastha Apollo Hospitals, Sarita Vihar', 'corp', 'Sarita Vihar', 28.5410, 77.2850, 'https://www.apollohospitals.com', null],
  ['APCRAD', 'Apollo Cradle & Children\'s Hospital, Kailash Colony', 'women', 'Greater Kailash', 28.5560, 77.2430, 'https://www.apollocradle.com', 'Maternity and newborn care.'],
  ['BLK', 'BLK-Max Super Speciality Hospital, Pusa Road', 'corp', 'Pusa Road', 28.6430, 77.1790, 'https://www.maxhealthcare.in', null],
  ['SGRH', 'Sir Ganga Ram Hospital, Rajinder Nagar', 'corp', 'Karol Bagh', 28.6380, 77.1900, 'https://sgrh.com', 'Has a dedicated IVF / human reproduction centre.'],
  ['MOOL', 'Moolchand Medcity, Lajpat Nagar', 'corp', 'Lajpat Nagar', 28.5680, 77.2380, 'https://www.moolchandhealthcare.com', null],
  ['BATRA', 'Batra Hospital & Medical Research Centre', 'corp', 'Tughlakabad', 28.5100, 77.2500, 'https://www.batrahospital.com', null],
  ['HFH', 'Holy Family Hospital, Okhla', 'mid', 'Jamia Nagar', 28.5590, 77.2750, null, 'Long-established maternity hospital.'],
  ['SSH', "St. Stephen's Hospital, Tis Hazari", 'mid', 'Civil Lines', 28.6690, 77.2150, null, null],
  ['JEEVAN', 'Jeevan Anmol Hospital, Mayur Vihar', 'mid', 'Mayur Vihar', 28.6070, 77.2970, null, null],
  ['PRIMUS', 'Primus Super Speciality Hospital, Chanakyapuri', 'corp', 'Chanakyapuri', 28.5900, 77.1870, null, null],
  ['VENKAT', 'Venkateshwar Hospital, Dwarka', 'corp', 'Dwarka', 28.5780, 77.0690, null, null],
  ['AAKASH', 'Aakash Healthcare Super Speciality Hospital, Dwarka', 'corp', 'Dwarka', 28.5880, 77.0650, null, null],
  ['MANIPD', 'Manipal Hospital, Dwarka', 'corp', 'Dwarka', 28.5930, 77.0620, 'https://www.manipalhospitals.com', null],
  ['ROCK', 'Rockland Hospital, Qutab Institutional Area', 'corp', 'Hauz Khas', 28.5430, 77.1930, null, null],
  ['SAROJ', 'Saroj Super Speciality Hospital, Rohini', 'corp', 'Rohini', 28.7260, 77.1180, null, null],
  ['JGH', 'Jaipur Golden Hospital, Rohini', 'mid', 'Rohini', 28.7030, 77.1060, null, null],
  ['DHARAM', 'Dharamshila Narayana Superspeciality Hospital', 'corp', 'Preet Vihar', 28.6050, 77.3150, null, 'Vasundhara Enclave.'],
  ['PSRI', 'Pushpawati Singhania Hospital (PSRI), Sheikh Sarai', 'corp', 'Malviya Nagar', 28.5330, 77.2220, null, null],
  ['SPH', 'Sant Parmanand Hospital, Civil Lines', 'mid', 'Civil Lines', 28.6810, 77.2260, null, null],
  ['SMH', 'Shanti Mukand Hospital, Vikas Marg', 'mid', 'Preet Vihar', 28.6460, 77.3020, null, null],
  ['MCD', 'Mata Chanan Devi Hospital, Janakpuri', 'mid', 'Janakpuri', 28.6200, 77.0840, null, null],
  ['BENSUPS', 'Bensups Hospital, Dwarka', 'mid', 'Dwarka', 28.5990, 77.0430, null, null],
  ['SBISR', 'Sitaram Bhartia Institute of Science & Research', 'corp', 'Hauz Khas', 28.5450, 77.1920, null, null],
  ['MADHUK', "Madhukar Rainbow Children's Hospital, Malviya Nagar", 'paeds', 'Malviya Nagar', null, null, null, "Children's hospital; no delivery services listed."],
  // --- IVF / fertility centres (localities from the cited centre pages) ----
  ['DIVF-MH', 'Delhi IVF Centre, Mandi House', 'ivf', 'Connaught Place', null, null, 'https://www.delhi-ivf.com', 'Address given as Bengali Market, Todermal Road area, Mandi House. Phone is the brand-wide line, not centre-specific.', '+919810600235'],
  ['DIVF-LN', 'Delhi IVF Centre, Lajpat Nagar', 'ivf', 'Lajpat Nagar', null, null, 'https://www.delhi-ivf.com', 'Street address not published on the source page. Phone is the brand-wide line, not centre-specific.', '+919810600235'],
  ['DIVF-RH', 'Delhi IVF Centre, Rohini', 'ivf', 'Rohini', null, null, 'https://www.delhi-ivf.com', 'Street address not published on the source page. Phone is the brand-wide line, not centre-specific.', '+919810600235'],
  ['APF-LN', 'Apollo Fertility, Lajpat Nagar (Chirag Enclave)', 'ivf', 'Lajpat Nagar', null, null, 'https://www.apollofertility.com', null],
  ['APF-MN', 'Apollo Fertility, Moti Nagar', 'ivf', 'Moti Nagar', null, null, 'https://www.apollofertility.com', null],
  ['APF-DW', 'Apollo Fertility, Dwarka', 'ivf', 'Dwarka', null, null, 'https://www.apollofertility.com', null],
  ['APF-RH', 'Apollo Fertility, Rohini', 'ivf', 'Rohini', null, null, 'https://www.apollofertility.com', null],
  ['NOVA-PV', 'Nova IVF Fertility, Preet Vihar', 'ivf', 'Preet Vihar', null, null, 'https://www.novaivffertility.com', null],
  ['NOVA-RG', 'Nova IVF Fertility, Rajouri Garden', 'ivf', 'Rajouri Garden', null, null, 'https://www.novaivffertility.com', null],
  ['NOVA-VV', 'Nova IVF Fertility, Vasant Vihar', 'ivf', 'Vasant Vihar', null, null, 'https://www.novaivffertility.com', null],
  ['NOVA-EK', 'Nova IVF Fertility, East of Kailash', 'ivf', 'Kalkaji', null, null, 'https://www.novaivffertility.com', null],
  ['OMYA', 'Omya Fertility, Safdarjung Enclave', 'ivf', 'Safdarjung Enclave', null, null, null, null],
  ['IFC', 'International Fertility Centre, Green Park', 'ivf', 'Hauz Khas', null, null, null, 'Green Park.'],
  ['AFGC', 'Advanced Fertility and Gynaecology Centre, Lajpat Nagar / CR Park', 'ivf', 'Lajpat Nagar', null, null, null, 'Listed for Lajpat Nagar and CR Park; one point used.'],
  ['SOUTHEND', 'Southend Fertility & IVF, Vasant Vihar', 'ivf', 'Vasant Vihar', null, null, null, null],
  // --- Nursing homes, women's hospitals, diagnostics (named in public listings)
  ['HEMRAJ', 'Hemraj Jain Hospital and Maternity Home, Janakpuri', 'nh', 'Janakpuri', null, null, null, 'Maternity home listed in a public hospital directory.'],
  ['CLOUD-PB', 'Cloudnine Hospital, Punjabi Bagh', 'women', 'Paschim Vihar', null, null, 'https://www.cloudninecare.com', 'Maternity and newborn hospital; Punjabi Bagh.'],
  ['LAL-RH', 'Dr Lal PathLabs patient service and radiology centre, Sector 18 Rohini', 'lab', 'Rohini', 28.7388, 77.1364, 'https://www.lalpathlabs.com', 'Coordinates as published on the lab network listing.'],
];
const rows = ROWS;

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const ARR = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'::jsonb`;

let out = `-- ============================================================================
-- Delhi facility directory (generated by scripts/build-delhi-directory.cjs)
--
-- ${rows.length} real Delhi institutions, compiled ${COMPILED} from public information.
-- Idempotent: re-running updates the same rows (matched on facility_code).
--
-- READ THIS BEFORE TRUSTING IT
--  * Nothing here is "verified": verified_at is NULL and the app labels the
--    rows Unverified. verification_source = '${SOURCE}'.
--  * Coordinates are neighbourhood-level (about 1-2 km), not surveyed.
--  * Phone numbers, opening hours and fees are NULL unless noted per row.
--  * Services are what such an institution publicly describes, not a
--    confirmed live service list. Call before travelling.
--
-- Also widens two CHECK constraints so IVF centres can be represented:
--   facilities.facility_type      + 'ivf_centre'
--   facility_services.service_category + 'fertility'
-- Apply after facility_discovery.sql:
--   psql "$DATABASE_URL" -f backend/db/delhi_directory.sql
-- ============================================================================

ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_facility_type_check;
ALTER TABLE facilities ADD CONSTRAINT facilities_facility_type_check CHECK (facility_type IN (
  'hospital', 'maternity_centre', 'clinic', 'diagnostic_lab',
  'vaccination_center', 'phc', 'chc', 'nursing_home', 'ivf_centre'
));
ALTER TABLE facility_services DROP CONSTRAINT IF EXISTS facility_services_service_category_check;
ALTER TABLE facility_services ADD CONSTRAINT facility_services_service_category_check CHECK (service_category IN (
  'obstetrics', 'gynecology', 'ultrasound', 'lab_tests',
  'vaccination', 'emergency', 'nicu', 'blood_bank',
  'pharmacy', 'ambulance', 'telemedicine', 'fertility'
));

`;

let count = 0;
for (const [code, name, prof, locality, lat0, lon0, site, note, phone] of rows) {
  const p = PROFILES[prof];
  if (!p) throw new Error('profile ' + prof);
  const loc = resolveLocation({ locality });
  if (!loc.ok) throw new Error('locality ' + locality);
  const lat = lat0 == null ? loc.latitude : lat0;
  const lon = lon0 == null ? loc.longitude : lon0;
  const precision = lat0 == null ? 'Coordinates are the locality centre (approximate).' : 'Coordinates are approximate to the campus/locality.';
  const notes = [note, precision, 'Compiled from public information; not verified. Phone, hours and fees were not published in the source.'].filter(Boolean).join(' ');
  const fcode = 'DEL-' + code;
  out += `-- ${name}\n`;
  out += `INSERT INTO facilities (facility_code, name, facility_type, tier, address, city, district, state, pincode, latitude, longitude, phone, website, ownership, emergency_24x7, has_ambulance, has_blood_bank, has_nicu_level, languages, accessibility_features, verified_at, verification_source, notes)
VALUES (${q(fcode)}, ${q(name)}, ${q(p.type)}, ${q(p.tier)}, ${q(locality + ', Delhi')}, 'Delhi', 'Delhi', 'Delhi', ${q(loc.pincode)}, ${lat}, ${lon}, ${q(phone || null)}, ${q(site)}, ${q(p.own)}, ${p.em}, ${p.amb}, ${p.bb}, ${q(p.nicu === 'none' ? null : p.nicu)}, '["hindi","english"]'::jsonb, '[]'::jsonb, NULL, ${q(SOURCE)}, ${q(notes)})
ON CONFLICT (facility_code) DO UPDATE SET name = EXCLUDED.name, facility_type = EXCLUDED.facility_type, tier = EXCLUDED.tier, address = EXCLUDED.address, pincode = EXCLUDED.pincode, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, phone = EXCLUDED.phone, website = EXCLUDED.website, ownership = EXCLUDED.ownership, emergency_24x7 = EXCLUDED.emergency_24x7, has_ambulance = EXCLUDED.has_ambulance, has_blood_bank = EXCLUDED.has_blood_bank, has_nicu_level = EXCLUDED.has_nicu_level, notes = EXCLUDED.notes;\n`;
  for (const [sname, scat] of p.svc) {
    out += `INSERT INTO facility_services (facility_id, service_name, service_category, available, notes) SELECT id, ${q(sname)}, ${q(scat)}, TRUE, 'Listed from public description; confirm with the facility.' FROM facilities WHERE facility_code = ${q(fcode)} ON CONFLICT (facility_id, service_name) DO NOTHING;\n`;
  }
  for (const cap of p.cap) {
    out += `INSERT INTO facility_capabilities (facility_id, capability, available, notes) SELECT id, ${q(cap)}, TRUE, 'Listed from public description; confirm with the facility.' FROM facilities WHERE facility_code = ${q(fcode)} ON CONFLICT DO NOTHING;\n`;
  }
  out += '\n';
  count++;
}
fs.writeFileSync(path.join(__dirname, '..', 'backend', 'db', 'delhi_directory.sql'), out);
console.log('wrote delhi_directory.sql with', count, 'facilities');
