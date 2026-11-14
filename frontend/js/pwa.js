/* ============================================================
 * js/pwa.js — PWA bootstrap (v3)
 * ------------------------------------------------------------
 * Loaded on every page. Responsibilities:
 *   • register the service worker (offline shell + push)
 *   • install-prompt banner (Add to Home Screen)
 *   • Web Push subscription (VAPID) — notifications arrive in the
 *     background, screen off, and app closed (installed PWA)
 *   • offline queue replay: on 'online' event + SW background sync
 *   • sync-status chip (pending ops count)
 * Exposes: window.DZPWA = { enablePush, requestSync, isStandalone }
 * ============================================================ */

(function (global) {
  'use strict';

  // ===== v4.2: LIVE API base (js/config.js resolves + heals) =====
  function API_BASE() {
    return (typeof window.dzposApiBase === 'function'
      ? window.dzposApiBase()
      : (window.DZPOS_API_BASE || '')).replace(/\/+$/, '');
  }
  const SW_PATH = './sw.js';

  let deferredPrompt = null;
  let swRegistration = null;

  /* ---------- helpers ---------- */
  function toast(type, msg) {
    if (typeof Toast !== 'undefined' && Toast[type]) Toast[type](msg);
    else console.log('[pwa]', msg);
  }
  function t(key, fb) { return (typeof window.t === 'function') ? window.t(key, fb) : fb; }

  /* v4.2 — attach the app language to direct fetch() calls */
  function langFetchOpts(extra) {
    extra = extra || {};
    var lang = 'ar';
    try { lang = (window.currentLang || localStorage.getItem('lang') || 'ar').slice(0, 2); } catch (_) {}
    var h = Object.assign({
      'Accept-Language': lang,
      'x-dzpos-lang': lang
    }, extra.headers || {});
    return Object.assign({}, extra, { headers: h });
  }

  /* ---------- service worker ---------- */
  let reloadedForNewSW = false;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });
      console.log('[pwa] SW registered');
      navigator.serviceWorker.addEventListener('message', onSWMessage);

      // ===== v4.1 — reliable update flow =====
      // 1) If a NEW service worker is already waiting (e.g. the update was
      //    downloaded while the tab was in the background), take it over
      //    immediately and reload — the user never sees stale code.
      // 2) When a new worker takes control ('controllerchange'), reload ONCE.
      // 3) Re-check for updates whenever the tab becomes visible again.
      if (swRegistration.waiting && navigator.serviceWorker.controller) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      swRegistration.addEventListener('updatefound', () => {
        const nw = swRegistration.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedForNewSW) return;
        reloadedForNewSW = true;
        try {
          if (sessionStorage.getItem('dzpos_sw_reload') !== '1') {
            sessionStorage.setItem('dzpos_sw_reload', '1');
            window.location.reload();
          }
        } catch (_) { window.location.reload(); }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && swRegistration) {
          swRegistration.update().catch(() => {});
        }
      });

      // ===== v4.2 — STALE WORKER DETECTION (mobile "Offline" killer) =====
      // A phone can keep an OLD service worker in control for days. It then
      // serves an old app shell + old offline envelopes → empty pages +
      // "Offline" even though the network is fine (clearing history does
      // NOT remove service workers). We now ask the controlling worker for
      // its version and force-unregister it when it doesn't match this build.
      verifySWVersion(swRegistration);
    } catch (err) {
      console.warn('[pwa] SW registration failed:', err.message);
    }
  }

  // v4.3.1 — the expected worker version comes from config.js (ONE source of
  // truth, bumped every release). This used to be a hardcoded 'v4.2.0' that
  // was NEVER updated: since v4.2.1 the check treated the CURRENT worker as
  // "stale" on every load and unregistered it + deleted its caches —
  // which silently KILLED Web Push notifications in the background.
  function expectedSWVersion() {
    try {
      var v = (window.DZPOS_VERSION || '').toString().trim();
      if (v) return v.charAt(0).toLowerCase() === 'v' ? v.slice(1) : v;
    } catch (_) {}
    return '4.5.0';
  }
  function normVersion(v) {
    var s = String(v || '').trim().toLowerCase();
    return s.charAt(0) === 'v' ? s.slice(1) : s;
  }
  let swVersionChecked = false;

  function verifySWVersion(registration) {
    if (swVersionChecked) return;
    const ctrl = (registration && registration.active) || navigator.serviceWorker.controller;
    if (!ctrl) return;
    let settled = false;
    const chan = new MessageChannel();
    chan.port1.onmessage = (ev) => {
      settled = true;
      const v = ev && ev.data && ev.data.version;
      if (v && normVersion(v) !== expectedSWVersion()) {
        console.warn('[pwa] stale SW detected (' + v + ' ≠ ' + expectedSWVersion() + ') → unregister + reload');
        unregisterStaleWorkers(true);
      }
    };
    try { ctrl.postMessage({ type: 'GET_VERSION' }, [chan.port2]); } catch (_) { settled = true; }
    // No answer within 3 s → worker is too old to answer → replace it.
    setTimeout(() => { if (!settled) unregisterStaleWorkers(true); }, 3000);
    swVersionChecked = true;
  }

  async function unregisterStaleWorkers(reload) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch (_) {} }
      if ('caches' in window) {
        const cur = expectedSWVersion();
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('dzpos-') && k.indexOf(cur) === -1).map(k => caches.delete(k)));
      }
    } catch (_) {}
    if (reload && sessionStorage.getItem('dzpos_sw_purge') !== '1') {
      try { sessionStorage.setItem('dzpos_sw_purge', '1'); } catch (_) {}
      window.location.reload();
    }
  }

  function onSWMessage(event) {
    if (event.data && event.data.type === 'SYNC_PENDING_OPS') {
      replayQueue();
    }
    if (event.data && event.data.type === 'VERSION') {
      // handled via MessageChannel in verifySWVersion; kept for completeness
      if (event.data.version && normVersion(event.data.version) !== expectedSWVersion()) unregisterStaleWorkers(true);
    }
  }

  /* ---------- offline queue ---------- */
  async function updateSyncChip() {
    if (!global.OfflineDB) return;
    try {
      const count = await global.OfflineDB.pendingCount();
      document.querySelectorAll('.sync-chip').forEach(chip => {
        chip.hidden = count === 0;
        chip.textContent = '⏳ ' + (t('pendingSync', 'بانتظار المزامنة') + ': ' + count);
      });
      const badge = document.getElementById('offlineQueueBadge');
      if (badge) { badge.textContent = count; badge.hidden = count === 0; }
    } catch (_) {}
  }

  async function replayQueue() {
    if (!global.OfflineDB) return;
    const token = localStorage.getItem('token');
    await global.OfflineDB.replayPending(token, API_BASE());
    updateSyncChip();
  }

  /* ---------- push notifications ---------- */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // v4.3.1 — applicationServerKey of an existing subscription, base64url.
  // Comparing it with the SERVER's current VAPID public key detects the
  // classic "push silently stopped after a server redeploy / DB reset"
  // (new keys → every old subscription gets 403 forever, browser keeps it).
  function subAppServerKeyB64(sub) {
    try {
      const raw = sub && sub.options && sub.options.applicationServerKey;
      if (!raw) return '';
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer || raw);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (_) { return ''; }
  }

  async function fetchServerPublicKey() {
    const keyRes = await fetch(API_BASE() + '/api/push/public-key', langFetchOpts());
    const keyJson = await keyRes.json();
    return (keyJson && keyJson.data && keyJson.data.publicKey) || null;
  }

  // v4.3.1 — send the CURRENT subscription to the server (upsert). Keeping
  // the server DB in sync on every dashboard visit is what makes push work
  // "always, even in the background": a device that re-subscribed (new SW,
  // re-install, key rotation) is re-registered without any user action.
  async function pushSubscribeToServer(subJson) {
    const token = localStorage.getItem('token');
    if (!token || !subJson || !subJson.endpoint) return;
    try {
      await fetch(API_BASE() + '/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          platform: /Android/i.test(navigator.userAgent) ? 'Android'
                  : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : 'Desktop'
        })
      });
    } catch (_) {}
  }

  async function enablePush(silent) {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!silent) toast('warning', t('pushUnsupported', 'إشعارات الهاتف غير مدعومة في هذا المتصفح'));
        return false;
      }
      if (!swRegistration) swRegistration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });
      // v4.3.1 — make sure the worker is ACTIVE before subscribing: a
      // subscription created on an "installing" worker is lost when the
      // worker takes over (classic "enabled once, then never again").
      if (swRegistration.active == null && swRegistration.installing) {
        await new Promise((resolve) => {
          const w = swRegistration.installing;
          w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(); });
          setTimeout(resolve, 4000);
        });
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (!silent) toast('warning', t('pushDenied', 'تم رفض صلاحية الإشعارات — فعّلها من إعدادات المتصفح'));
        return false;
      }

      const token = localStorage.getItem('token');
      if (!token) return false;

      const publicKey = await fetchServerPublicKey();
      if (!publicKey) { if (!silent) toast('error', t('pushServerUnavailable', 'خدمة الإشعارات غير مهيأة على الخادم')); return false; }
      const wantKey = urlBase64ToUint8Array(publicKey);

      const existing = await swRegistration.pushManager.getSubscription();
      let sub = existing;
      // v4.3.1 — heal a stale/mismatched subscription instead of keeping a
      // dead one: different VAPID key → unsubscribe + subscribe fresh.
      if (sub) {
        const curKey = subAppServerKeyB64(sub);
        if (curKey && curKey !== publicKey) {
          try { await sub.unsubscribe(); } catch (_) {}
          sub = null;
        }
      }
      if (!sub) {
        sub = await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: wantKey
        });
      }

      await pushSubscribeToServer(sub.toJSON());
      if (!silent) toast('success', t('pushEnabled', 'تم تفعيل إشعارات الهاتف ✓ تعمل حتى لو كان التطبيق مغلقاً'));
      return true;
    } catch (err) {
      console.warn('[pwa] push enable failed:', err);
      if (!silent) toast('error', t('pushFailed', 'تعذر تفعيل الإشعارات'));
      return false;
    }
  }

  /* ---------- install prompt ---------- */
  function showInstallBanner() {
    if (document.getElementById('installBanner')) return;
    if (localStorage.getItem('pwaInstallDismissed') === '1') return;
    const banner = document.createElement('div');
    banner.id = 'installBanner';
    banner.className = 'install-banner';
    banner.innerHTML =
      '<span class="install-text">📲 ' + t('installPrompt', 'ثبّت DZ POS PRO على هاتفك للعمل أوفلاين واستقبال الإشعارات') + '</span>' +
      '<button class="btn btn-sm install-ok">' + t('installNow', 'تثبيت') + '</button>' +
      '<button class="install-close" aria-label="Close">✕</button>';
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
    banner.querySelector('.install-ok').addEventListener('click', async () => {
      banner.classList.remove('show');
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null;
      }
      banner.remove();
    });
    banner.querySelector('.install-close').addEventListener('click', () => {
      try { localStorage.setItem('pwaInstallDismissed', '1'); } catch (_) {}
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 300);
    });
  }

  /* ---------- auto-keep push alive for logged-in dashboard users ----------
   * v4.3.1 — this is the "notifications ALWAYS work" contract:
   *   • no subscription              → silent re-subscribe
   *   • subscription w/ old VAPID key → unsubscribe + fresh subscribe
   *   • healthy subscription          → re-POST to the server (upsert) so the
   *     backend always has the device, even after a Railway DB reset
   * Runs on every dashboard load, when the tab becomes visible again, and
   * every 30 minutes while the app is open. All failures stay silent — the
   * user never gets spammed; the next run simply retries.
   */
  let pushHealthBusy = false;
  async function keepPushAlive() {
    if (!location.pathname.includes('dashboard.html')) return;
    if (!localStorage.getItem('token')) return;
    if (pushHealthBusy) return;
    pushHealthBusy = true;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (!swRegistration) swRegistration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return; // never nag; the settings toggle asks explicitly

      const publicKey = await fetchServerPublicKey();
      if (!publicKey) return;

      let sub = await swRegistration.pushManager.getSubscription();
      if (sub) {
        const curKey = subAppServerKeyB64(sub);
        if (curKey && curKey !== publicKey) {
          try { await sub.unsubscribe(); } catch (_) {}
          sub = null;
        }
      }
      if (!sub) {
        try {
          sub = await swRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
        } catch (_) { return; } // subscribe can throw when the browser blocks silent push — settings toggle still works
      }
      await pushSubscribeToServer(sub.toJSON());
    } catch (_) {
      // silent — retried on the next visibility/interval tick
    } finally {
      pushHealthBusy = false;
    }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    // offline queue init
    if (global.OfflineDB) {
      try { await global.OfflineDB.init(); updateSyncChip(); } catch (e) { console.warn('[pwa] OfflineDB init', e); }
    }

    await registerSW();
    keepPushAlive();

    // v4.3.1 — keep push healthy whenever the app is used again or every
    // 30 min: heals key rotation, re-registers re-subscribed devices.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) keepPushAlive(); });
    setInterval(keepPushAlive, 30 * 60 * 1000);

    global.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (!isStandalone()) showInstallBanner();
    });

    global.addEventListener('online', () => {
      replayQueue();
    });
    // v4.1 — the api.js layer detected that the backend is reachable again
    global.addEventListener('dzpos:api-online', () => { replayQueue(); });
    global.addEventListener('offlinequeue:changed', updateSyncChip);
    global.addEventListener('offlinequeue:replay', updateSyncChip);

    // periodic queue check (some browsers miss the online event)
    setInterval(replayQueue, 60000);
  });

  global.DZPWA = { enablePush, replayQueue, isStandalone, updateSyncChip, keepPushAlive };
})(window);
