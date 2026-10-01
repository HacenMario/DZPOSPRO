/* ============================================================
 * sw.js — DZ POS PRO Service Worker (v3)
 * ------------------------------------------------------------
 * Offline-first PWA:
 *   • Precached app shell (pages, css, js, icons, vendor libs)
 *   • Cache-first for static assets + CDN libraries (after first use)
 *   • Network-first for navigations → offline fallback page
 *   • API GET requests: network-first with cache fallback (read-only
 *     data stays visible offline); API writes are queued by the app
 *     (IndexedDB) and replayed when back online — see js/pwa.js
 *   • Web Push (VAPID) handling: notifications show even when the
 *     app is closed / screen is off (installed PWA)
 * ============================================================ */

const VERSION = 'v3.0.0';
const SHELL_CACHE = `dzpos-shell-${VERSION}`;
const STATIC_CACHE = `dzpos-static-${VERSION}`;
const API_CACHE = `dzpos-api-${VERSION}`;
const OFFLINE_URL = 'offline.html';

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
    './js/config.js',
    './js/toast.js',
    './js/api.js',
    './js/socket.js',
    './js/i18n.js',
    './js/db.js',
    './js/pwa.js',
    './js/notify.js',
    './js/exporter.js',
    './js/receipt.js',
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
    './vendor/xlsx.full.min.js',
    './lang/ar.json',
    './lang/en.json',
    './lang/fr.json',
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

/* ---------- activate: clean old caches ---------- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k.startsWith('dzpos-') && ![SHELL_CACHE, STATIC_CACHE, API_CACHE].includes(k))
                .map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

/* ---------- fetch strategies ---------- */
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Only GET is cacheable — everything else passes through
    if (req.method !== 'GET') return;

    // API requests (same-origin /api or the Railway backend /api)
    if (url.pathname.startsWith('/api') || url.pathname.includes('/api/')) {
        if (url.pathname.includes('/api/auth') || url.pathname.includes('/api/ai')) return; // never cache
        event.respondWith(networkFirst(req, API_CACHE));
        return;
    }

    // Same-origin static + cross-origin CDN libs → cache-first (stale-while-revalidate)
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
});

async function networkFirst(req, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type !== 'opaque') {
            cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
    } catch (err) {
        const cached = await cache.match(req, { ignoreVary: true });
        if (cached) return cached;
        return new Response(JSON.stringify({ success: false, offline: true, message: 'OFFLINE' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

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
        // navigations fall back to the offline page
        if (req.mode === 'navigate') {
            const shell = await caches.open(SHELL_CACHE);
            return (await shell.match(OFFLINE_URL)) || (await shell.match('./dashboard.html')) || Response.error();
        }
        return Response.error();
    }
}

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
});
