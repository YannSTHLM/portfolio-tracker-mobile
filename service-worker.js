"use strict";

const CACHE_NAME = 'portfolio-tracker-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/sections/00-core.js',
  './js/sections/01-carryforward.js',
  './js/sections/02-rebalancing.js',
  './js/sections/03-import-export.js',
  './js/sections/04-parsers.js',
  './js/sections/05-api-dashboard.js',
  './js/sections/06-editing-rebalance.js',
  './js/sections/07-charts.js',
  './js/sections/08-analytics.js',
  './js/sections/09-ai-holdings.js',
  './js/sections/10-retirement-prices.js',
  './js/sections/11-momentum.js',
  './js/sections/12-notes.js'
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first with cache fallback for CDN resources, cache-first for local files
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests (e.g. POST to AI API) — Cache API only supports GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // For CDN resources (tailwind, chart.js, fonts), try cache-first then network
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // For local files, network-first with cache fallback
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});