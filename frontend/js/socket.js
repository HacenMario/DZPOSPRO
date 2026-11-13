/* ============================================================
 * js/socket.js — Real-time socket.io client
 * ------------------------------------------------------------
 * Connects to the Railway backend via API_BASE.
 * Emits `join` with the current user's id on connect.
 * Listens for `notification` events and routes them through
 * the global Toast helper.
 *
 * Exposes:
 *   window.initSocket()  — call once after auth (dashboard.js)
 *   window.socket        — the live socket instance (or null)
 * ============================================================ */

(function (global) {
  'use strict';

  // ===== v4.2: LIVE API base (js/config.js resolves + heals) =====
  function API_BASE() {
    return (typeof window.dzposApiBase === 'function'
      ? window.dzposApiBase()
      : (window.DZPOS_API_BASE || '')).replace(/\/+$/, '');
  }

  let socket = null;

  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  }

  function initSocket() {
    if (socket) return socket;
    if (typeof io === 'undefined') {
      console.warn('[socket] socket.io client not loaded');
      return null;
    }
    const token = localStorage.getItem('token');
    const user = getCurrentUser();
    if (!token || !user) return null;

    // ===== الاتصال بالخادم (v4.2: base لحظية + تبديل تلقائي) =====
    socket = io(API_BASE(), {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      // Backend joins `user_<id>` room on `join` (+ `store_<storeId>` in v3)
      const userId = user.id || user._id;
      const storeId = user.storeId || null;
      if (userId) socket.emit('join', { userId, storeId });
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err && err.message);
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
    });

    socket.on('notification', (notification) => {
      // v3 — route through the notification centre (badge + panel refresh)
      if (window.DZNotify && window.DZNotify.handleRealtime) {
        try { window.DZNotify.handleRealtime(notification); } catch (_) {}
      }
      if (!notification || typeof window.Toast === 'undefined') return;
      const msg = notification.message || notification.body || '';
      const title = notification.title;
      const type = (notification.type || 'info').toLowerCase();
      const opts = title ? { title } : {};
      if (!msg) return;
      if (type === 'success' && Toast.success) Toast.success(msg, opts);
      else if (type === 'error' && Toast.error) Toast.error(msg, opts);
      else if (type === 'warning' && Toast.warning) Toast.warning(msg, opts);
      else if (type === 'ai' && Toast.info) Toast.info(msg, { title: title || '🤖' });
      else if (Toast.info) Toast.info(msg, opts);
    });

    return socket;
  }

  function getSocket() { return socket; }

  // v4.2 — when the API base heals/changes, drop the old socket so the next
  // initSocket() reconnects to the right server.
  global.addEventListener('dzpos:apibase-changed', function () {
    if (socket) {
      try { socket.removeAllListeners(); socket.disconnect(); } catch (_) {}
      socket = null;
      try { initSocket(); } catch (_) {}
    }
  });

  global.initSocket = initSocket;
  global.socket = null;          // populated by initSocket via getter
  Object.defineProperty(global, 'socket', {
    configurable: true,
    get: getSocket
  });
})(window);
