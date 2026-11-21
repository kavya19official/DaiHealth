'use strict';

const { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas');
const { imageSize } = require('image-size');
const { dateValid } = require('./patientContinuity');
const MAX_CANDIDATES = 40;
const MAX_PAGES = 5;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PIXELS = 12_000_000;
const MAX_SIDE = 6000;
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/. -]\d{1,2}[/. -]\d{4}|\d{1,2}[ -](?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[ ,.-]+\d{4})\b/gi;
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const LAB_NAMES = /^(?:ha?emoglobin|hb|(?:fasting\s+|random\s+)?(?:blood\s+)?glucose|blood sugar|platelets?|tsh|creatinine|wbc|rbc|hba1c|vitamin [bd](?:12)?|blood pressure)\b/i;
const VACCINES = /^(?:bcg|opv|ipv|hepatitis[- ]b|pentavalent|rotavirus|pcv|mmr|measles|tt|tdap|td)\b/i;
const LAB_VALUE = /^(-?\d+(?:\.\d+)?|positive|negative|reactive|non[- ]reactive)(?:\s*([a-zµμ%/][a-z0-9µμ%/^.-]*(?:\s*\/\s*[a-z]+)?))?\s*$/i;
const STRENGTH = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|μg|g|ml|iu|units?)\b/i;

function sourceError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function readDate(raw) {
  if (/^\d{4}-/.test(raw)) return dateValid(raw) ? raw : '';
  const [day, month, year] = raw.toLowerCase().split(/[\s/.,-]+/);
  const numericMonth = /^\d+$/.test(month);
  // A date like 03/04/2026 could mean either 3 April or 4 March.
  if (numericMonth && Number(day) <= 12 && Number(day) !== Number(month)) return '';
  const m = numericMonth ? Number(month) : MONTHS.indexOf(month.slice(0, 3)) + 1;
  const iso = year + '-' + String(m).padStart(2, '0') + '-' + day.padStart(2, '0');
  return dateValid(iso) ? iso : '';
}

function datesIn(line) {
  return [...line.matchAll(DATE_PATTERN)].map(match => ({ text: match[0], value: readDate(match[0]) }));
}

function parsePages(pages, documentType, today) {
  const candidates = [];
  let truncated = false;
  for (const { page, text } of pages) {
    const lines = text.split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const headingDates = lines.filter(line => /^(?:report|prescription|collection) date\b|^date\s*[:=]/i.test(line))
      .flatMap(datesIn);
    const uniqueDates = [...new Set(headingDates.map(date => date.value))];
    const pageDate = uniqueDates.length === 1 ? uniqueDates[0] : '';
    for (const line of lines) {
      const dates = datesIn(line);
      const ownDate = dates.length === 1 ? dates[0].value : '';
      const body = line.replace(DATE_PATTERN, '').replace(/^[\s:|–-]+|[\s:|–-]+$/g, '');
      const lab = body.match(/^(?:(?:test(?: result)?|result)\s*[:=]\s*)?(.+?)\s*[:=]\s*(\S.*)$/i);
      const knownLab = body.match(LAB_NAMES);
      const knownValue = knownLab && body.slice(knownLab[0].length).trim().replace(/^[:=]\s*/, '');
      const finding = knownValue && knownValue.match(LAB_VALUE);
      const namedResult = lab?.[2].match(LAB_VALUE);
      const vaccination = body.match(/^(?:vaccin(?:ation|e)\s*[:=]\s*|(?:vaccine|vaccination)\s+)(.+)/i);
      const visit = body.match(/^(?:ANC\b|antenatal\s+(?:visit|check[- ]?up)\b)(.*)$/i);
      const medicine = body.match(/^(?:(?:medicine|medication|drug|rx)\s*[:=]\s*|(?:tab(?:let)?|cap(?:sule)?|syrup)\.?\s+)(.+)/i);
      const other = body.match(/^(diagnosis|procedure|discharge note|clinical note)\s*[:=]\s*(.+)$/i);
      let entry;
      if (vaccination || (documentType === 'vaccination_card' && VACCINES.test(body))) {
        const vaccine = vaccination?.[1] || body;
        const dose = vaccine.match(/\bdose\s*[:=]\s*(.+)$/i);
        entry = { kind: 'vaccination', label: dose ? vaccine.slice(0, dose.index).trim() : vaccine, dosage: dose?.[1] || '' };
      } else if (visit) {
        entry = { kind: 'antenatal_visit', label: body };
      } else if (finding) {
        entry = { kind: 'lab_result', label: knownLab[0], result: finding[1], unit: finding[2] || '' };
      } else if (lab && /^(?:test(?: result)?|result)\s*[:=]/i.test(body)) {
        entry = { kind: 'lab_result', label: lab[1], result: namedResult?.[1] || lab[2], unit: namedResult?.[2] };
      } else if (medicine || (documentType === 'prescription' && /^[\p{L}][\p{L}\p{N} -]{1,70}\s+\d/iu.test(body) && STRENGTH.test(body))) {
        const medication = medicine?.[1] || body;
        const strength = STRENGTH.exec(medication);
        const dose = medication.match(/\b(?:dosage|dose)\s*[:=]\s*(.+)$/i);
        const end = Math.min(strength?.index ?? medication.length, dose?.index ?? medication.length);
        const label = medication.slice(0, end).trim().replace(/[\s,;:–-]+$/g, '');
        if (label) entry = { kind: 'medicine', label, dosage: dose?.[1] || (strength ? medication.slice(strength.index).trim() : '') };
      } else if (documentType === 'lab_report' && lab && namedResult &&
          !/\b(?:date|time|id|age|page|range|gender|sex|phone|reference)\b/i.test(lab[1]) &&
          (knownLab || namedResult[2] || /[a-z]/i.test(namedResult[1]))) {
        entry = { kind: 'lab_result', label: lab[1], result: namedResult[1], unit: namedResult[2] };
      } else if (other) {
        entry = { kind: 'other', label: other[1], notes: other[2].length <= 300 ? other[2] : '' };
      }
      if (!entry?.label) continue;
      if (candidates.length === MAX_CANDIDATES) {
        truncated = true;
        break;
      }
      const fallback = ['medicine', 'lab_result'].includes(entry.kind) ? pageDate : '';
      const occurredOn = dates.length ? ownDate : fallback;
      candidates.push({
        ...entry,
        label: entry.label.length <= 160 ? entry.label : '',
        dosage: entry.dosage?.length <= 120 ? entry.dosage : '',
        result: entry.result?.length <= 160 ? entry.result : '',
        unit: entry.unit?.length <= 40 ? entry.unit : '',
        occurred_on: occurredOn && occurredOn <= today ? occurredOn : '',
        source_line: line.slice(0, 350),
        page
      });
    }
    if (truncated) break;
  }
  return { candidates, truncated };
}

function validateSource(bytes, mime) {
  if (mime === 'application/pdf') {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw sourceError('This file is not a PDF.');
    return;
  }
  if (!Object.hasOwn(IMAGE_TYPES, mime)) throw sourceError('Use a PDF, JPEG, PNG or WebP file.');
  let size;
  try { size = imageSize(bytes); } catch { throw sourceError('This image could not be read.'); }
  if (size.type !== IMAGE_TYPES[mime]) throw sourceError('The file type does not match the image contents.');
  if (!size.width || !size.height || size.width * size.height > MAX_PIXELS || Math.max(size.width, size.height) > MAX_SIDE) {
    throw sourceError('Use an image under 12 megapixels and no more than 6,000 pixels on either side.');
  }
}

function readableOCRLines(tsv) {
  const lines = new Map();
  for (const row of (tsv || '').split('\n')) {
    const cells = row.split('\t');
    const word = cells[11]?.trim();
    if (cells[0] !== '5' || !word) continue;
    const key = cells.slice(1, 5).join(':');
    if (!lines.has(key)) lines.set(key, { words: [], readable: true });
    const line = lines.get(key);
    line.words.push(word);
    if (Number(cells[10]) < 50) line.readable = false;
  }
  return {
    text: [...lines.values()].filter(line => line.readable).map(line => line.words.join(' ')).join('\n'),
    omittedWords: [...lines.values()].some(line => !line.readable)
  };
}

async function extractPages(bytes, mime) {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const warnings = [];
  const pages = [];
  let ocrWorker;
  let ocrDir;
  let task;
  let validated = false;
  let unclearOCR = false;
  const deadline = Date.now() + 40_000;

  async function readImage(canvas) {
    let timer;
    try {
      if (Date.now() >= deadline) throw new Error('OCR timed out');
      if (!ocrWorker) {
        ocrDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dai-care-scan-'));
        ocrWorker = await require('tesseract.js').createWorker('eng', 1, {
          langPath: require('@tesseract.js-data/eng').langPath, cachePath: ocrDir
        });
      }
      const result = await Promise.race([
        ocrWorker.recognize(canvas.toBuffer('image/png'), {}, { tsv: true }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('OCR timed out')), Math.max(0, deadline - Date.now()));
        })
      ]);
      const { text, omittedWords } = readableOCRLines(result.data.tsv);
      unclearOCR ||= omittedWords;
      return text.slice(0, 20_000);
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    if (mime !== 'application/pdf') {
      let image;
      try { image = await loadImage(bytes); } catch { throw sourceError('This image could not be decoded.'); }
      if (!image.width || !image.height || image.width * image.height > MAX_PIXELS || Math.max(image.width, image.height) > MAX_SIDE) {
        throw sourceError('The decoded image exceeds the size limit.');
      }
      validated = true;
      const scale = Math.min(1, 2800 / Math.max(image.width, image.height));
      const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      pages.push({ page: 1, text: await readImage(canvas) });
    } else {
      globalThis.DOMMatrix ??= DOMMatrix;
      globalThis.ImageData ??= ImageData;
      globalThis.Path2D ??= Path2D;
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
        enableXfa: false, verbosity: 0, maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4, stopAtErrors: true });
      let pdf;
      try { pdf = await task.promise; } catch { throw sourceError('Use a readable PDF without password protection.'); }
      validated = true;
      if (pdf.numPages > MAX_PAGES) warnings.push('CareScan reads the first five pages. You can transcribe entries from later pages.');
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
        if (Date.now() >= deadline) throw new Error('OCR timed out');
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const plainText = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').slice(0, 20_000);
        let text = plainText;
        if (plainText.replace(/\s/g, '').length < 25) {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 2400 / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
          text = await readImage(canvas) || plainText;
        }
        pages.push({ page: n, text });
      }
    }
  } catch (error) {
    if (error.status) throw error;
    if (!validated) throw Object.assign(new Error('Document validation is temporarily unavailable. Please retry.'), { status: 503 });
    warnings.push('Text extraction was incomplete. Read the original and add any clear entries by hand.');
  } finally {
    try { await task?.destroy(); } catch {}
    try { await ocrWorker?.terminate(); } catch {}
    if (ocrDir) await fs.rm(ocrDir, { recursive: true, force: true });
  }
  if (unclearOCR) warnings.push('CareScan left out some unclear text. Compare the entries with the original.');
  return { pages, warnings };
}

module.exports = { validateSource, extractPages, parsePages, MAX_CANDIDATES };
