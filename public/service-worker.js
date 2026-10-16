const CACHE_NAME = 'qr-attendance-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/teacher.html',
  '/student.html',
  '/css/style.css',
  '/js/teacher.js',
  '/js/student.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS)));
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
