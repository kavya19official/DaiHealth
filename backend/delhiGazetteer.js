'use strict';
// ============================================================================
// Delhi locality / PIN gazetteer
//
// Turns a typed locality, PIN code or "Delhi" into approximate coordinates so
// distance ranking works WITHOUT device location, and snaps device coordinates
// to the nearest known locality for display.
//
// Accuracy: points are neighbourhood centres, good to roughly 1-2 km. They are
// for ranking by approximate distance, not for navigation. Every result says
// how it was resolved (`precision`) so the UI can say so instead of implying
// an exact address.
//
// Coverage: the National Capital Territory of Delhi only. A PIN that starts
// with 110 but is not listed resolves to the Delhi centre with
// precision 'city'. Anything else is "outside coverage", never guessed.
// ============================================================================

// [name, pincode, lat, lon, ...aliases]
const LOCALITIES = [
  ['Connaught Place', '110001', 28.6315, 77.2167, 'cp', 'rajiv chowk', 'central delhi', 'mandi house', 'barakhamba'],
  ['Daryaganj', '110002', 28.6420, 77.2400, 'delhi gate', 'asaf ali road'],
  ['Lodhi Road', '110003', 28.5900, 77.2270, 'lodhi colony', 'jor bagh', 'khan market'],
  ['Karol Bagh', '110005', 28.6510, 77.1900, 'rajendra place', 'patel nagar'],
  ['Chandni Chowk', '110006', 28.6560, 77.2300, 'old delhi', 'red fort', 'kashmere gate'],
  ['Kamla Nagar', '110007', 28.6830, 77.2060, 'malka ganj', 'roop nagar'],
  ['Patel Nagar', '110008', 28.6490, 77.1700, 'shadipur', 'east patel nagar'],
  ['Model Town', '110009', 28.7160, 77.1930, 'gtb nagar', 'mukherjee nagar'],
  ['Delhi Cantonment', '110010', 28.5970, 77.1530, 'delhi cantt', 'dhaula kuan', 'sadar bazar cantt'],
  ['Pusa Road', '110012', 28.6400, 77.1650, 'pusa'],
  ['Moti Nagar', '110015', 28.6570, 77.1450, 'kirti nagar', 'ramesh nagar', 'basai darapur'],
  ['Hauz Khas', '110016', 28.5490, 77.2000, 'green park', 'aiims', 'safdarjung development area', 'qutab institutional area', 'ina'],
  ['Malviya Nagar', '110017', 28.5330, 77.2100, 'saket', 'sheikh sarai', 'press enclave', 'panchsheel park'],
  ['Tilak Nagar', '110018', 28.6400, 77.0870, 'subhash nagar', 'tagore garden', 'rajouri garden', 'hari nagar'],
  ['Kalkaji', '110019', 28.5420, 77.2580, 'nehru place', 'govindpuri', 'east of kailash', 'chittaranjan park', 'cr park', 'okhla phase'],
  ['Okhla', '110020', 28.5560, 77.2700, 'okhla industrial area', 'sukhdev vihar'],
  ['Chanakyapuri', '110021', 28.5960, 77.1870, 'diplomatic enclave'],
  ['R K Puram', '110022', 28.5640, 77.1830, 'rk puram', 'sector 12 rk puram'],
  ['Lajpat Nagar', '110024', 28.5680, 77.2430, 'defence colony', 'jangpura', 'bhogal', 'chirag enclave'],
  ['Jamia Nagar', '110025', 28.5600, 77.2800, 'jasola', 'abul fazal enclave', 'new friends colony'],
  ['Rajouri Garden', '110027', 28.6490, 77.1190, 'raja garden', 'khyala', 'vishnu garden'],
  ['Naraina', '110028', 28.6280, 77.1370, 'inderpuri', 'mayapuri'],
  ['Safdarjung Enclave', '110029', 28.5670, 77.2000, 'safdarjung', 'ansari nagar', 'bhikaji cama place'],
  ['Mehrauli', '110030', 28.5190, 77.1850, 'chhatarpur', 'saidulajab', 'ghitorni', 'sultanpur'],
  ['Geeta Colony', '110031', 28.6560, 77.2740, 'krishna nagar', 'gandhi nagar', 'shahdara north'],
  ['Pitampura', '110034', 28.7000, 77.1330, 'netaji subhash place', 'ashok vihar', 'wazirpur'],
  ['Mukherjee Nagar', '110009', 28.7090, 77.2000, 'vijay nagar', 'north campus'],
  ['Greater Kailash', '110048', 28.5400, 77.2400, 'gk', 'gk 1', 'gk 2', 'greater kailash ii', 'kailash colony', 'nehru enclave'],
  ['Janakpuri', '110058', 28.6200, 77.0850, 'uttam nagar', 'vikaspuri', 'hastsal', 'tilak vihar'],
  ['Paschim Vihar', '110063', 28.6710, 77.1000, 'peeragarhi', 'punjabi bagh', 'rohini west'],
  ['Vasant Vihar', '110057', 28.5590, 77.1580, 'munirka', 'vasant kunj road'],
  ['Vasant Kunj', '110070', 28.5200, 77.1580, 'mahipalpur', 'rangpuri', 'kishangarh'],
  ['Dwarka', '110075', 28.5890, 77.0470, 'dwarka sector', 'palam', 'sagarpur', 'najafgarh road'],
  ['Najafgarh', '110043', 28.6090, 76.9790, 'jaffarpur', 'nangloi', 'bakkarwala'],
  ['Rohini', '110085', 28.7150, 77.1200, 'rohini sector', 'prashant vihar', 'budh vihar', 'begumpur'],
  ['Shalimar Bagh', '110088', 28.7160, 77.1590, 'haiderpur', 'jahangirpuri', 'azadpur'],
  ['Civil Lines', '110054', 28.6810, 77.2250, 'tis hazari', 'timarpur', 'sabzi mandi'],
  ['Mayur Vihar', '110091', 28.6070, 77.2970, 'patparganj', 'pandav nagar', 'mayur vihar phase 1', 'mayur vihar phase 3'],
  ['Preet Vihar', '110092', 28.6410, 77.2950, 'laxmi nagar', 'vikas marg', 'karkardooma', 'anand vihar'],
  ['Dilshad Garden', '110095', 28.6850, 77.3100, 'shahdara', 'seemapuri', 'vivek vihar', 'jhilmil'],
  ['Mangolpuri', '110083', 28.6830, 77.0720, 'sultanpuri', 'nangloi jat', 'mundka'],
  ['Shastri Park', '110053', 28.6700, 77.2570, 'seelampur', 'welcome', 'maujpur', 'gokulpuri'],
  ['Sarita Vihar', '110076', 28.5410, 77.2850, 'badarpur', 'jasola vihar', 'madanpur khadar'],
  ['Tughlakabad', '110062', 28.5100, 77.2500, 'neb sarai', 'sangam vihar', 'devli', 'ambedkar nagar'],
  ['Paharganj', '110055', 28.6430, 77.2130, 'new delhi railway station', 'ram nagar'],
  ['Hari Nagar', '110064', 28.6290, 77.1110, 'jail road', 'khayala'],
  ['Khichripur', '110091', 28.6190, 77.3090, 'kondli', 'trilokpuri'],
  ['Burari', '110084', 28.7500, 77.2000, 'sant nagar', 'timarpur north'],
  ['Narela', '110040', 28.8500, 77.0900, 'bawana', 'alipur'],
];

const DELHI_CENTRE = { latitude: 28.6139, longitude: 77.2090 };
const DELHI_NAMES = new Set(['delhi', 'new delhi', 'nct', 'nct of delhi', 'delhi ncr', 'ncr', 'national capital territory of delhi', 'old delhi']);

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const byPin = new Map();
const byName = new Map();
for (const [name, pin, lat, lon, ...aliases] of LOCALITIES) {
  const rec = { name, pincode: pin, latitude: lat, longitude: lon };
  if (!byPin.has(pin)) byPin.set(pin, rec);
  for (const key of [name, ...aliases]) if (!byName.has(norm(key))) byName.set(norm(key), rec);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function inDelhiBox(lat, lon) {
  // Generous box around the NCT; used only for coverage messages.
  return lat >= 28.40 && lat <= 28.93 && lon >= 76.80 && lon <= 77.37;
}

/**
 * resolveLocation({ city, pincode, locality }) ->
 *  { ok:true, latitude, longitude, label, precision:'pincode'|'locality'|'city', city:'Delhi', pincode? }
 *  { ok:false, reason:'invalid_pincode'|'outside_coverage'|'empty' , message }
 * Order: PIN, then locality text, then city.
 */
function resolveLocation({ city, pincode, locality } = {}) {
  const pin = String(pincode == null ? '' : pincode).trim();
  if (pin) {
    if (!/^\d{6}$/.test(pin)) return { ok: false, reason: 'invalid_pincode', message: 'PIN code must be 6 digits.' };
    const hit = byPin.get(pin);
    if (hit) return { ok: true, latitude: hit.latitude, longitude: hit.longitude, label: `${hit.name} (${pin})`, precision: 'pincode', city: 'Delhi', pincode: pin };
    if (pin.startsWith('110')) {
      return { ok: true, latitude: DELHI_CENTRE.latitude, longitude: DELHI_CENTRE.longitude, label: `Delhi (PIN ${pin} not in our locality table)`, precision: 'city', city: 'Delhi', pincode: pin };
    }
    return { ok: false, reason: 'outside_coverage', message: `PIN ${pin} is outside Delhi. The directory currently covers Delhi only.` };
  }
  for (const text of [locality, city]) {
    const key = norm(text);
    if (!key) continue;
    const hit = byName.get(key);
    if (hit) {
      const typed = String(text).trim();
      const label = norm(hit.name) === key ? hit.name : `${typed} (${hit.name} area)`;
      return { ok: true, latitude: hit.latitude, longitude: hit.longitude, label, precision: 'locality', city: 'Delhi', pincode: hit.pincode };
    }
  }
  const c = norm(city);
  if (c && DELHI_NAMES.has(c)) {
    return { ok: true, latitude: DELHI_CENTRE.latitude, longitude: DELHI_CENTRE.longitude, label: 'Delhi (city centre)', precision: 'city', city: 'Delhi' };
  }
  if (!c && !norm(locality)) return { ok: false, reason: 'empty', message: 'Enter a Delhi locality, PIN code or "Delhi".' };
  return { ok: false, reason: 'outside_coverage', message: `We could not place "${city || locality}". The directory currently covers Delhi only; try a Delhi locality (e.g. Saket, Rohini, Lajpat Nagar) or a 110xxx PIN code.` };
}

/** Nearest known locality to a device position, or null outside Delhi. */
function nearestLocality(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inDelhiBox(lat, lon)) return null;
  let best = null;
  for (const rec of byPin.values()) {
    const km = haversineKm(lat, lon, rec.latitude, rec.longitude);
    if (!best || km < best.km) best = { ...rec, km };
  }
  return best;
}

function suggestLocalities(prefix, limit = 8) {
  const key = norm(prefix);
  if (!key) return [];
  const out = [];
  for (const rec of byPin.values()) {
    if (norm(rec.name).includes(key) || rec.pincode.startsWith(key)) out.push({ name: rec.name, pincode: rec.pincode });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { resolveLocation, nearestLocality, suggestLocalities, haversineKm, inDelhiBox, LOCALITIES, DELHI_CENTRE };
