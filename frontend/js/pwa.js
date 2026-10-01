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

  // ===== v3.1: smart API base (mirrors config.js) =====
  const API_BASE = (function () {
    var o = '';
    try { o = localStorage.getItem('dzpos_api_base') || window.DZPOS_API_BASE || ''; } catch (e) {}
    if (o) return String(o).replace(/\/+$/, '');
    if (location.protocol === 'file:') return 'https://dzpospro-production.up.railway.app';
    if (/(^|\.)vercel\.app$/i.test(location.hostname || '')) return 'https://dzpospro-production.up.railway.app';
    return '';
  })();
  const SW_PATH = './sw.js';

  let deferredPrompt = null;
  let swRegistration = null;

  /* ---------- helpers ---------- */
  function toast(type, msg) {
    if (typeof Toast !== 'undefined' && Toast[type]) Toast[type](msg);
    else console.log('[pwa]', msg);
  }
  function t(key, fb) { return (typeof window.t === 'function') ? window.t(key, fb) : fb; }

  /* ---------- service worker ---------- */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });
      console.log('[pwa] SW registered');
      navigator.serviceWorker.addEventListener('message', onSWMessage);
    } catch (err) {
      console.warn('[pwa] SW registration failed:', err.message);
    }
  }

  function onSWMessage(event) {
    if (event.data && event.data.type === 'SYNC_PENDING_OPS') {
      replayQueue();
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
    await global.OfflineDB.replayPending(token, API_BASE);
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

  async function enablePush(silent) {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!silent) toast('warning', t('pushUnsupported', 'إشعارات الهاتف غير مدعومة في هذا المتصفح'));
        return false;
      }
      if (!swRegistration) swRegistration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (!silent) toast('warning', t('pushDenied', 'تم رفض صلاحية الإشعارات — فعّلها من إعدادات المتصفح'));
        return false;
      }

      const token = localStorage.getItem('token');
      if (!token) return false;

      const keyRes = await fetch(API_BASE + '/api/push/public-key');
      const keyJson = await keyRes.json();
      const publicKey = keyJson && keyJson.data && keyJson.data.publicKey;
      if (!publicKey) { if (!silent) toast('error', t('pushServerUnavailable', 'خدمة الإشعارات غير مهيأة على الخادم')); return false; }

      const existing = await swRegistration.pushManager.getSubscription();
      let sub = existing;
      if (!sub) {
        sub = await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      const subJson = sub.toJSON();
      await fetch(API_BASE + '/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          platform: /Android/i.test(navigator.userAgent) ? 'Android'
                  : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : 'Desktop'
        })
      });
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

  /* ---------- auto-enable push for logged-in dashboard users ---------- */
  async function autoInitPush() {
    if (!location.pathname.includes('dashboard.html')) return;
    if (!localStorage.getItem('token')) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) await enablePush(true); // silent subscribe on first dashboard visit
    } catch (_) {}
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
    autoInitPush();

    global.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (!isStandalone()) showInstallBanner();
    });

    global.addEventListener('online', () => {
      replayQueue();
    });
    global.addEventListener('offlinequeue:changed', updateSyncChip);
    global.addEventListener('offlinequeue:replay', updateSyncChip);

    // periodic queue check (some browsers miss the online event)
    setInterval(replayQueue, 60000);
  });

  global.DZPWA = { enablePush, replayQueue, isStandalone, updateSyncChip };
})(window);
