const CACHE_NAME = 'jfy-v1';
const PRECACHE = [
  '/',
  '/chat',
  'css/login.css',
  'css/chat.css',
  'js/login.js',
  'js/chat.js',
  'sounds/notify.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Network first for API and socket, cache first for static
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Push notification
self.addEventListener('push', (e) => {
  let data = { title: 'Made Just for You', body: 'New message!', icon: '/icons/icon-192.png' };
  if (e.data) {
    try { data = e.data.json(); } catch (err) { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'jfy-msg',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(cls => {
      if (cls.length > 0) { cls[0].focus(); return; }
      clients.openWindow('/chat');
    })
  );
});