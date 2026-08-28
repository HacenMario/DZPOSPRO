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

  // ===== استخدم API_BASE =====
const API_BASE = (function () {
    try {
      const h = location.hostname;
      const isLocal = (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || location.protocol === 'file:');
      if (isLocal) return '';
    } catch (_) {}
    return 'https://dzpospro-production.up.railway.app';
  })();

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

    // ===== الاتصال بـ Railway بدلاً من Vercel =====
    socket = io(API_BASE, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      // Backend joins `user_<id>` room on `join`
      const userId = user.id || user._id;
      if (userId) socket.emit('join', userId);
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err && err.message);
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
    });

    socket.on('notification', (notification) => {
      if (!notification || typeof window.Toast === 'undefined') return;
      const msg = notification.message || '';
      const title = notification.title;
      const type = (notification.type || 'info').toLowerCase();
      const opts = title ? { title } : {};
      if (type === 'success' && Toast.success) Toast.success(msg, opts);
      else if (type === 'error' && Toast.error) Toast.error(msg, opts);
      else if (type === 'warning' && Toast.warning) Toast.warning(msg, opts);
      else if (Toast.info) Toast.info(msg, opts);
    });

    return socket;
  }

  function getSocket() { return socket; }

  global.initSocket = initSocket;
  global.socket = null;          // populated by initSocket via getter
  Object.defineProperty(global, 'socket', {
    configurable: true,
    get: getSocket
  });
})(window);
