'use strict';
const SHELL_PREFIX = 'technowords-shell-';
const CACHE_NAME = SHELL_PREFIX + '__BUILD_HASH__';
const ASSETS = ['./index.html', './client.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './ai-runtime.js', './ai-worker.js', './ai-panel.js', './WEBLLM-LICENSE.txt'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
const indexURL = new URL('./index.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // All files must arrive before a new worker is installed. A failed update leaves the old one active.
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Never remove IndexedDB, localStorage, model caches, or caches owned by another app.
    await Promise.all(keys.filter(key => key.startsWith(SHELL_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  url.search = ''; url.hash = '';
  if (event.request.mode === 'navigate' && url.href.startsWith(self.registration.scope)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(indexURL)) || fetch(event.request);
    })());
  } else if (assetURLs.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.href)) || fetch(event.request);
    })());
  }
});
