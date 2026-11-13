/* ============================================================
 * sw.js — DZ POS PRO Service Worker (v4.1)
 * ------------------------------------------------------------
 * Offline-first PWA, rebuilt around one rule:
 *   THE USER ALWAYS GETS THE DEPLOYED VERSION WHEN ONLINE.
 *
 *   • App shell (HTML/CSS/JS/lang) → NETWORK-FIRST with cache
 *     fallback. (v4.0 served the cached copy first — after every
 *     update, phones kept running the OLD code from cache until a
 *     second reload, which showed empty dashboards + "Offline".)
 *   • API GET → network-first with a 2-minute freshness cap: a
 *     cached response is only used while offline AND only if it is
 *     fresh, so statistics can never go stale.
 *   • /socket.io requests bypass the SW completely (caching polling
 *     responses breaks realtime on flaky mobile networks).
 *   • Icons/vendor/CDN libs → cache-first (immutable).
 *   • Web Push (VAPID) + Background Sync unchanged.
 * ============================================================ */

const VERSION = 'v4.2.1';
const SHELL_CACHE = `dzpos-shell-${VERSION}`;
const STATIC_CACHE = `dzpos-static-${VERSION}`;
const API_CACHE = `dzpos-api-${VERSION}`;
const OFFLINE_URL = 'offline.html';
const API_CACHE_MAX_AGE_MS = 120000; // cached API data never older than 2 min

const SHELL_ASSETS = [
    './',
    './index.html',
    './dashboard.html',
    './register.html',
    './offline.html',
    './manifest.json',
    './css/main.css',
    './css/pages.css',
    './css/theme-light.css',
    './css/theme-dark.css',
    './css/features.css',
    './css/upgrade.css',
    './vendor/sweetalert2.min.css',
    './js/config.js',
    './js/toast.js',
    './js/api.js',
    './js/socket.js',
    './js/flags.js',
    './js/i18n.js',
    './js/db.js',
    './js/pwa.js',
    './js/notify.js',
    './js/exporter.js',
    './js/receipt.js',
    './js/commandPalette.js',
    './js/app.js',
    './js/dashboard.js',
    './js/modules/dashboard.js',
    './js/modules/products.js',
    './js/modules/categories.js',
    './js/modules/customers.js',
    './js/modules/sales.js',
    './js/modules/tickets.js',
    './js/modules/invoices.js',
    './js/modules/reports.js',
    './js/modules/coupons.js',
    './js/modules/suppliers.js',
    './js/modules/purchaseOrders.js',
    './js/modules/returns.js',
    './js/modules/inventory.js',
    './js/modules/users.js',
    './js/modules/sessions.js',
    './js/modules/settings.js',
    './js/modules/ai.js',
    './js/modules/audit.js',
    './js/modules/platform.js',
    './vendor/sweetalert2.min.js',
    './vendor/chart.umd.min.js',
    './vendor/jspdf.umd.min.js',
    './vendor/jspdf.plugin.autotable.min.js',
    './vendor/socket.io.min.js',
    './vendor/xlsx.full.min.js',
    './lang/ar.json',
    './lang/en.json',
    './lang/fr.json',
    './lang/tr.json',
    './lang/es.json',
    './lang/it.json',
    './lang/de.json',
    './lang/ru.json',
    './lang/zh.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/favicon-64.png'
];

/* ---------- install: precache app shell ---------- */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

/* ---------- activate: clean every old cache ---------- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k.startsWith('dzpos-') && ![SHELL_CACHE, STATIC_CACHE, API_CACHE].includes(k))
                .map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

/* ---------- helpers ---------- */
function isAppShell(req, url) {
    if (url.origin !== self.location.origin) return false;
    if (req.mode === 'navigate') return true;
    const p = url.pathname;
    return p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.js') ||
           p.includes('/lang/') || p.endsWith('manifest.json');
}

/* ---------- strategies ---------- */
// API GET: network-first, cached fallback capped at 2 minutes.
async function apiNetworkFirst(req, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type !== 'opaque') {
            try {
                const body = await fresh.clone().arrayBuffer();
                const headers = new Headers(fresh.headers);
                headers.set('x-dzpos-cached-at', String(Date.now()));
                await cache.put(req, new Response(body, {
                    status: fresh.status, statusText: fresh.statusText, headers
                }));
            } catch (_) { /* cache write is best-effort */ }
        }
        return fresh;
    } catch (err) {
        const cached = await cache.match(req, { ignoreVary: true });
        if (cached) {
            const at = Number(cached.headers.get('x-dzpos-cached-at') || 0);
            if (at && (Date.now() - at) < API_CACHE_MAX_AGE_MS) return cached;
            // stale → still better than nothing? NO — stale stats caused the
            // "charts never update" bug. Only serve cache when it is fresh;
            // otherwise surface the offline envelope so the UI can show a
            // proper "no connection" state instead of old numbers.
        }
        return new Response(JSON.stringify({ success: false, offline: true, message: 'OFFLINE' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

// App shell / app code: ALWAYS the network copy when online.
async function shellNetworkFirst(req) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
    } catch (_) {
        const cached = await cache.match(req, { ignoreVary: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
            const shell = await caches.open(SHELL_CACHE);
            return (await shell.match(OFFLINE_URL)) || Response.error();
        }
        return Response.error();
    }
}

// Icons / vendor / CDN: cache-first with background refresh.
async function staleWhileRevalidate(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req, { ignoreVary: true });
    const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    }).catch(() => null);
    if (cached) return cached;
    try { return await network; } catch (_) {
        if (req.mode === 'navigate') {
            const shell = await caches.open(SHELL_CACHE);
            return (await shell.match(OFFLINE_URL)) || Response.error();
        }
        return Response.error();
    }
}

/* ---------- fetch strategies ---------- */
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (_) { return; }

    // v4.1 — socket.io must never be intercepted (cached polling responses
    // break realtime reconnects, especially on mobile networks).
    if (url.pathname.startsWith('/socket.io')) return;

    // API requests (same-origin /api or the Railway backend /api)
    if (url.pathname.startsWith('/api') || url.pathname.includes('/api/')) {
        if (url.pathname.includes('/api/auth') || url.pathname.includes('/api/ai')) return; // never cache
        // v4.1 — never cache the health probe: a cached "ok" would make the
        // connection chip report ONLINE while offline (false positive).
        if (url.pathname.includes('/api/health')) return;
        event.respondWith(apiNetworkFirst(req, API_CACHE));
        return;
    }

    // App shell + app code → network-first (fresh code every load)
    if (isAppShell(req, url)) {
        event.respondWith(shellNetworkFirst(req));
        return;
    }

    // Same-origin static + cross-origin CDN libs → cache-first (SWR)
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
});

/* ---------- Web Push (works in background / screen off / closed app) ---------- */
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {
        try { data = { body: event.data ? event.data.text() : '' }; } catch (_) {}
    }
    const title = data.title || 'DZ POS PRO';
    const options = {
        body: data.body || '',
        icon: data.icon || './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: data.tag || 'dzpos',
        renotify: true,
        vibrate: [100, 50, 100],
        data: { url: data.url || './dashboard.html' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || './dashboard.html';
    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            if (client.url.includes('dashboard.html') && 'focus' in client) {
                client.focus();
                if (event.notification.data && event.notification.data.link && client.navigate) {
                    client.navigate('./dashboard.html#' + event.notification.data.link).catch(() => {});
                }
                return;
            }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
    })());
});

/* ---------- Background Sync (queue replay) ---------- */
self.addEventListener('sync', (event) => {
    if (event.tag === 'dzpos-sync-pending') {
        event.waitUntil(replayPendingOps());
    }
});

async function replayPendingOps() {
    // Delegate to any open client (needs IndexedDB access); if none, skip.
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
        client.postMessage({ type: 'SYNC_PENDING_OPS' });
        return;
    }
}

/* ---------- message API for the app ---------- */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data && event.data.type === 'SYNC_PENDING_OPS') {
        event.source && event.source.postMessage({ type: 'SYNC_PENDING_OPS' });
    }
    // v4.2 — version handshake: the page verifies it is driven by the
    // CURRENT worker. A stale worker (kept alive by phones for weeks)
    // is the root cause of "empty pages + Offline" after deployments.
    if (event.data && event.data.type === 'GET_VERSION') {
        event.source && event.source.postMessage({ type: 'VERSION', version: VERSION });
    }
});
