const CACHE_NAME = 'beatbayngr-v1.1.0';
const CORE_ASSETS = [
  './', './index.html', './offline.html', './manifest.json',
  './css/styles.css', './js/app.js', './js/audio-engine.js', './js/presets.js', './js/pwa.js',
  './assets/logos/beatbayngr-master-logo.png', './assets/icons/beatbayngr-app-icon.png',
  './assets/presets/make-it-better.png', './assets/presets/nockn.png', './assets/presets/we-cookn.png',
  './assets/presets/its-a-vibe.png', './assets/presets/nah-this-crazy.png', './assets/presets/yea-this-one.png',
  './icons/icon-72.png','./icons/icon-96.png','./icons/icon-128.png','./icons/icon-144.png','./icons/icon-152.png','./icons/icon-192.png','./icons/icon-384.png','./icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html').then(res => res || caches.match('./offline.html'))));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      return res;
    }).catch(() => caches.match('./offline.html'))));
  }
});
