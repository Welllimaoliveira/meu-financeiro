// Service worker mínimo — só pra permitir "instalar" o app na tela inicial.
// Sem cache agressivo de dados: o app precisa da rede pra falar com o Supabase.
const CACHE = 'meu-financeiro-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/auth.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
