'use strict';

const { imageSize } = require('image-size');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const MiB = 1024 * 1024;
const MAX_VIDEO = 20 * MiB;
const MAX_IMAGE = 6 * MiB;
const types = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

// Walk ISO BMFF boxes within their declared parent. Only progressive MP4 video
// with a video handler and actual media data is accepted for native playback.
function mp4Video(buffer) {
  function boxes(start, end) {
    const items = [];
    while (start < end && items.length < 4096) {
      if (end - start < 8) return [];
      const size = buffer.readUInt32BE(start);
      const type = buffer.toString('ascii', start + 4, start + 8);
      if (size < 8 || size > end - start) return [];
      items.push({ type, start:start + 8, end:start + size });
      start += size;
    }
    return start === end ? items : [];
  }
  const contents = box => boxes(box.start, box.end);
  const root = boxes(0, buffer.length);
  if (root[0]?.type !== 'ftyp' || root[0].end - root[0].start < 8 ||
      !root.some(box => box.type === 'mdat' && box.end > box.start) ||
      root.some(box => box.type === 'moof')) return false;
  const movie = root.find(box => box.type === 'moov');
  if (!movie) return false;
  for (const track of contents(movie).filter(box => box.type === 'trak')) {
    const media = contents(track).find(box => box.type === 'mdia');
    if (!media) continue;
    const parts = contents(media);
    const handler = parts.find(box => box.type === 'hdlr' && box.end - box.start >= 12);
    if (!handler || buffer.toString('ascii', handler.start + 8, handler.start + 12) !== 'vide') continue;
    const info = parts.find(box => box.type === 'minf');
    const table = info && contents(info).find(box => box.type === 'stbl');
    if (!table) continue;
    const samples = contents(table);
    const formats = samples.find(box => box.type === 'stsd' && box.end - box.start >= 8);
    const sizes = samples.find(box => box.type === 'stsz' && box.end - box.start >= 12);
    if (!formats || !sizes || !buffer.readUInt32BE(sizes.start + 8)) continue;
    const entries = boxes(formats.start + 8, formats.end);
    if (entries.some(box => ['avc1', 'avc3'].includes(box.type) && box.end - box.start >= 78 &&
        boxes(box.start + 78, box.end).some(part => part.type === 'avcC' && part.end - part.start >= 7))) return true;
  }
  return false;
}

async function normalize(file) {
  if (!file?.size) throw new Error('Choose a nonempty photo or video.');
  if (file.type === 'video/mp4') {
    if (file.size > MAX_VIDEO) throw new Error('Choose an MP4 video up to 20 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!mp4Video(bytes)) throw new Error('Choose an MP4 video encoded with H.264.');
    return { type:'video/mp4', bytes };
  }
  if (!types.has(file.type) || file.size > MAX_IMAGE) {
    throw new Error('Choose JPEG, PNG or WebP photos up to 6 MB each.');
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const photo = imageSize(bytes);
    if (photo.type !== types.get(file.type) || !photo.width || !photo.height ||
        photo.width * photo.height > 16_000_000) throw new Error();
    const image = await loadImage(bytes);
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return {type:'image/webp', bytes:await canvas.encode('webp', 86)};
  } catch {
    throw new Error('This photo could not be read. Choose a supported image under 16 megapixels.');
  }
}

function rangeFor(value, size) {
  if (!value) return {start:0, end:size - 1};
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || !(m[1] || m[2]) || m.slice(1).some(n => n && !Number.isSafeInteger(Number(n)))) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end ? {start,end} : null;
}

module.exports = { normalize, rangeFor, MiB };
