import { inflateSync, strFromU8 } from '../vendor/three/examples/jsm/libs/fflate.module.js';

const pattern = /^DAIC1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{1,810})\.([A-Za-z0-9_-]{86})$/;
const secondsPerDay = 86400;

function bytes(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}

export function capsuleCode(input) {
  const value = String(input || '').trim();
  if (pattern.test(value)) return value;
  try {
    const url = new URL(value);
    const token = url.hash.slice(1);
    if (['https:', 'http:'].includes(url.protocol) && url.pathname === '/care-capsule/index.html' &&
        pattern.test(token)) return token;
  } catch {
    // Arbitrary scanner input is never opened as a link.
  }
  return null;
}

const text = value => typeof value === 'string' && value.length > 0 && [...value].length <= 140;
const recordedText = value => typeof value === 'string' && !!value.trim() && new TextEncoder().encode(value).length <= 2048;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const motherFields = new Set(['recorded_risk', 'risk_factors', 'pregnancy_week', 'expected_delivery', 'medical_conditions', 'current_medications']);
const childFields = new Set(['vaccines', 'recent_child_history']);
const validators = {
  patient_name: recordedText,
  allergies: recordedText,
  medical_conditions: recordedText,
  current_medications: recordedText,
  expected_delivery: date,
  blood_group: value => /^(A|B|AB|O)[+-]$/.test(value),
  recorded_risk: text,
  risk_factors: value => Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(text),
  pregnancy_week: value => Number.isInteger(value) && value >= 0 && value <= 45,
  vaccines: value => Array.isArray(value) && value.length > 0 && value.length <= 4 &&
    value.every(entry => entry && Object.keys(entry).length === 2 &&
      typeof entry.code === 'string' && entry.code.length <= 20 && date(entry.date)),
  recent_child_history: value => Array.isArray(value) && value.length > 0 && value.length <= 2 &&
    value.every(entry => entry && Object.keys(entry).length === 2 &&
      typeof entry.title === 'string' && [...entry.title].length <= 160 && date(entry.date))
};

export async function verifyCapsule(code, trust, now = Math.floor(Date.now() / 1000)) {
  const match = pattern.exec(code);
  if (!match) throw Error('This is not a DaiHealth Care Capsule.');
  const [, kid, compressed, signature] = match;
  const key = trust?.keys?.find(entry => entry.kid === kid);
  if (!key) throw Error('This signing key is unavailable. Sync the verifier online, then try again.');
  const publicKey = await crypto.subtle.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, bytes(signature),
    new TextEncoder().encode('DAIC1.' + kid + '.' + compressed));
  if (!verified) throw Error('Signature verification failed. Ask for a newly issued capsule.');
  let data;
  try {
    data = JSON.parse(strFromU8(inflateSync(bytes(compressed), { out: new Uint8Array(4096) })));
  } catch {
    throw Error('The signed capsule could not be read.');
  }
  const validFields = data?.fields && typeof data.fields === 'object' && !Array.isArray(data.fields) && Object.entries(data.fields);
  if (data?.v !== 1 || !/^[a-f0-9-]{36}$/.test(data.id) || !['mother', 'child'].includes(data.subject) ||
      !Number.isInteger(data.iat) || !Number.isInteger(data.exp) || data.exp <= data.iat ||
      data.exp - data.iat > 30 * secondsPerDay || !validFields?.length ||
      validFields.some(([name, value]) => !Object.hasOwn(validators, name) || !validators[name](value) ||
        (childFields.has(name) && data.subject !== 'child') ||
        (motherFields.has(name) && data.subject !== 'mother'))) {
    throw Error('The signed capsule format is invalid.');
  }
  if (trust.revoked.includes(data.id)) throw Error('Revoked. Ask the patient for a current capsule.');
  if (data.exp <= now) throw Error('Expired. Ask the patient for a current capsule.');
  if (data.iat > now + 300) throw Error('The capsule issue date is ahead of this device’s clock.');
  return data;
}
