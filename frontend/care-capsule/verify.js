import { capsuleCode, verifyCapsule } from './verify-data.js';
import { translate, locale, fieldLabels, fieldText } from './language.js';

const $ = id => document.getElementById('capsule-' + id);
const readiness = $('ready');
const status = $('status');
const result = $('result');
const video = $('video');
const camera = $('camera');
const storageKey = 'dai-care-capsule-trust-v1';
const languageKey = 'dai-care-capsule-language';
const strings = [...document.querySelectorAll('[data-text]')].map(node => [node, node.textContent]);
let language = 'en';
let readyMessage = '';
let statusMessage = '';
let verifiedData = null;
try { if (localStorage.getItem(languageKey) === 'hi') language = 'hi'; } catch { /* Private mode. */ }
const t = text => translate(language, text);

function setStatus(message) {
  statusMessage = message;
  status.textContent = t(message);
}

function renderLanguage() {
  document.documentElement.lang = language;
  document.title = t('Care Capsule verifier · DaiHealth');
  $('language').value = language;
  for (const [node, text] of strings) node.textContent = t(text);
  for (const node of document.querySelectorAll('[data-label]')) node.setAttribute('aria-label', t(node.dataset.label));
  renderCameraLabel();
  updateReady(readyMessage);
  setStatus(statusMessage);
  renderResult();
}

let trust, stream, pending, lastCode, timer, shellReady = false, savedTrust = false, cameraGeneration = 0;
try {
  trust = JSON.parse(localStorage.getItem(storageKey));
  savedTrust = !!trust;
} catch {
  trust = null;
}

function updateReady(message = '') {
  readyMessage = message;
  const prepared = shellReady && savedTrust ? 'Ready for offline scanning.' : 'Offline setup is incomplete.';
  readiness.textContent = [t(prepared), trust?.synced_at && (t('Last key and revocation sync:') + ' ' +
    new Date(trust.synced_at).toLocaleString(locale(language)) + '.'), t(message)].filter(Boolean).join(' ');
}

function sync() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/care-capsule/trust', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (data.version !== 1 || !data.keys?.length || !Array.isArray(data.revoked)) throw Error();
      trust = data;
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
        savedTrust = true;
      } catch {
        updateReady('This browser could not save the keys for offline use.');
        return false;
      }
      updateReady();
      return true;
    } catch {
      updateReady('Latest revocations could not be checked.');
      return false;
    }
  })().finally(() => { pending = null; });
  return pending;
}

function node(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}

function renderResult() {
  result.replaceChildren();
  if (!verifiedData) return;
  const data = verifiedData;
  const fields = document.createElement('dl');
  for (const [key, value] of Object.entries(data.fields)) {
    fields.append(node('dt', t(fieldLabels[key])), node('dd', fieldText(key, value)));
  }
  result.append(node('h2', t(data.subject === 'mother' ? 'Maternal emergency summary' : 'Child emergency summary')),
    node('p', t('Issued') + ' ' + new Date(data.iat * 1000).toLocaleDateString(locale(language)) + ' · ' +
      t('Expires') + ' ' + new Date(data.exp * 1000).toLocaleString(locale(language))), fields,
    node('p', t('This snapshot contains the fields chosen by the patient. Confirm identity and check for newer information when possible.')));
}

function clearResult() {
  verifiedData = null;
  renderResult();
}

let verification = 0;
let expiryTimer;
async function open(code, synced) {
  const generation = ++verification;
  clearTimeout(expiryTimer);
  clearResult();
  setStatus('Verifying signature…');
  lastCode = code;
  try {
    const data = await verifyCapsule(code, trust);
    if (generation !== verification) return;
    expiryTimer = setTimeout(() => open(code, false), Math.min(2147483647, Math.max(0, data.exp * 1000 - Date.now())));
    setStatus(synced ? 'Signature verified · Revocations checked online.' :
      'Signature verified · Revocations checked against the last sync.');
    verifiedData = data;
    renderResult();
  } catch (error) {
    if (generation === verification) {
      const message = error.message;
      setStatus(translate('hi', message) === message ? 'Could not verify this capsule.' : message);
    }
  }
}

async function scan(value) {
  clearTimeout(expiryTimer);
  const code = capsuleCode(value);
  if (!code) {
    verification++;
    lastCode = null;
    clearResult();
    setStatus('No DaiHealth Care Capsule found.');
    return;
  }
  stopCamera();
  lastCode = code;
  const scanGeneration = ++verification;
  clearResult();
  setStatus('Checking the capsule…');
  const synced = navigator.onLine ? await sync() : false;
  if (scanGeneration === verification) await open(code, synced);
}

async function refresh() {
  const synced = await sync();
  if (lastCode) await open(lastCode, synced);
}

$('sync').onclick = refresh;
window.addEventListener('online', refresh);
window.addEventListener('offline', () => {
  updateReady('Offline. Recent revocations may be unavailable.');
  if (lastCode) void open(lastCode, false);
});
$('form').onsubmit = event => {
  event.preventDefault();
  const value = $('input').value;
  $('input').value = '';
  void scan(value);
};

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
function decode(source, width, height) {
  const scale = Math.min(1, 1680 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return window.jsQR(image.data, image.width, image.height)?.data;
}
function renderCameraLabel() {
  camera.textContent = t(stream ? 'Stop camera' : 'Start camera');
}

function stopCamera() {
  cameraGeneration++;
  clearTimeout(timer);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  video.hidden = true;
  renderCameraLabel();
}
function frame() {
  if (!stream) return;
  if (video.videoWidth && video.videoHeight) {
    const value = decode(video, video.videoWidth, video.videoHeight);
    if (capsuleCode(value)) { void scan(value); return; }
  }
  timer = setTimeout(frame, 250);
}
camera.onclick = async () => {
  if (stream) { stopCamera(); return; }
  const generation = ++cameraGeneration;
  camera.disabled = true;
  try {
    const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    if (generation !== cameraGeneration || document.hidden) {
      media.getTracks().forEach(track => track.stop());
      return;
    }
    stream = media;
    video.srcObject = stream;
    video.hidden = false;
    renderCameraLabel();
    setStatus('Point the camera at the Care Capsule QR.');
    frame();
  } catch {
    stopCamera();
    setStatus('Camera unavailable. Upload a QR photo or paste the capsule link.');
  } finally { camera.disabled = false; }
};
$('image').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { setStatus('Choose an image smaller than 12 MB.'); return; }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    await scan(decode(bitmap, bitmap.width, bitmap.height));
  } catch {
    setStatus('Could not read this image.');
  } finally { bitmap?.close(); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);

$('language').onchange = () => {
  language = $('language').value === 'hi' ? 'hi' : 'en';
  try { localStorage.setItem(languageKey, language); } catch { /* Private mode. */ }
  renderLanguage();
};
renderLanguage();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/care-capsule/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { shellReady = true; updateReady(); })
    .catch(() => updateReady('Offline page setup failed. Try again while online.'));
}
const incoming = location.hash.slice(1);
if (incoming) {
  history.replaceState(null, '', location.pathname);
  void scan(incoming);
} else if (navigator.onLine) {
  void sync();
} else {
  updateReady('Offline. Recent revocations may be unavailable.');
}
