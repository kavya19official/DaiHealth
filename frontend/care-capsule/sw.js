'use strict';

const cacheName = 'dai-care-capsule-shell-v3';
const shell = '/care-capsule/index.html';
const assets = [shell, '/care-capsule/capsule.css', '/care-capsule/verify.js',
  '/care-capsule/verify-data.js', '/care-capsule/language.js', '/vendor/qr/jsQR.js', '/vendor/three/examples/jsm/libs/fflate.module.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('dai-care-capsule-shell-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !assets.includes(url.pathname)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(url.pathname)) || fetch(event.request)));
});
