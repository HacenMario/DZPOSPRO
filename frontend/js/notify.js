/* ============================================================
 * js/notify.js — Notification centre (v3)
 * ------------------------------------------------------------
 * In-app notification bell:
 *   • dropdown panel with the latest notifications (paginated)
 *   • unread badge (auto-refresh + real-time via socket)
 *   • mark one / mark all read
 *   • clicking a notification navigates to its link (page hash)
 * Requires: apiFetch (api.js) + Toast. Loaded on dashboard only.
 * Exposes: window.DZNotify = { refresh, openPanel }
 * ============================================================ */

(function (global) {
  'use strict';

  const API = '/api/notifications';
  let panelEl = null;
  let badgeEl = null;
  let page = 1;
  let items = [];

  function t(key, fb) { return (typeof window.t === 'function') ? window.t(key, fb) : fb; }

  const TYPE_ICON = {
    info: 'ℹ️', success: '✅', warning: '⚠️', error: '⛔',
    ai: '🤖', alert: '🚨', backup: '💾', anomaly: '🛡️'
  };

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return t('justNow', 'الآن');
    if (s < 3600) return Math.floor(s / 60) + ' ' + t('minutesShort', 'د');
    if (s < 86400) return Math.floor(s / 3600) + ' ' + t('hourShort', 'س');
    return new Date(iso).toLocaleDateString();
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'notifPanel';
    panelEl.className = 'notif-panel';
    panelEl.innerHTML =
      '<div class="notif-head">' +
        '<strong>' + t('notifications', 'الإشعارات') + '</strong>' +
        '<div class="notif-head-actions">' +
          '<button class="notif-mark-all" id="notifMarkAll">' + t('markAllRead', 'تعليم الكل كمقروء') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="notif-list" id="notifList"><div class="notif-empty">' + t('noNotifications', 'لا إشعارات بعد') + '</div></div>' +
      '<div class="notif-foot">' +
        '<button class="notif-more" id="notifMore">' + t('loadMore', 'تحميل المزيد') + '</button>' +
      '</div>';

    document.body.appendChild(panelEl);

    panelEl.querySelector('#notifMarkAll').addEventListener('click', async () => {
      try {
        await apiFetch.post(API + '/mark-read', { all: true });
        items.forEach(i => { i._read = true; });
        renderList();
        updateBadge(0);
      } catch (_) {}
    });
    panelEl.querySelector('#notifMore').addEventListener('click', async (e) => {
      e.stopPropagation();
      page += 1;
      await load(page, true);
    });

    // close on outside click
    document.addEventListener('click', (e) => {
      if (panelEl && !panelEl.contains(e.target) && !e.target.closest('#notifBtn')) closePanel();
    });
    return panelEl;
  }

  async function load(p = 1, append = false) {
    try {
      const res = await apiFetch.get(API + '?page=' + p + '&limit=15');
      const data = res.data || res;
      const list = data.data || [];
      items = append ? items.concat(list) : list;
      page = p;
      if (typeof data.unread === 'number') updateBadge(data.unread);
      renderList();
      return data;
    } catch (err) {
      console.warn('[notify] load failed', err);
      return null;
    }
  }

  function renderList() {
    const listEl = ensurePanel().querySelector('#notifList');
    if (!items.length) {
      listEl.innerHTML = '<div class="notif-empty">' + t('noNotifications', 'لا إشعارات بعد') + '</div>';
      return;
    }
    listEl.innerHTML = items.map((n, idx) => {
      const icon = TYPE_ICON[n.type] || '🔔';
      const unread = n._read !== undefined ? !n._read : !(n.readBy || []).length;
      return '<div class="notif-item' + (unread ? ' unread' : '') + '" data-idx="' + idx + '">' +
        '<span class="notif-icon">' + icon + '</span>' +
        '<div class="notif-body">' +
          '<div class="notif-title">' + esc(n.title || t('notification', 'إشعار')) + '</div>' +
          '<div class="notif-text">' + esc(n.body || '') + '</div>' +
          '<div class="notif-time">' + timeAgo(n.createdAt) + '</div>' +
        '</div>' +
        (unread ? '<span class="notif-dot"></span>' : '') +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        const n = items[parseInt(el.dataset.idx, 10)];
        if (n && n._id && !(n.readBy || []).length && n._read === undefined) {
          try {
            await apiFetch.post(API + '/mark-read', { ids: [n._id] });
            n.readBy = n.readBy || [];
            n.readBy.push('me');
            el.classList.remove('unread');
            el.querySelector('.notif-dot')?.remove();
            refreshBadgeFromList();
          } catch (_) {}
        }
        if (n && n.link) {
          closePanel();
          if (typeof global.loadPage === 'function') global.loadPage(n.link);
        }
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function refreshBadgeFromList() {
    const unread = items.filter(n => !(n.readBy || []).length && n._read === undefined).length;
    updateBadge(unread);
  }

  function updateBadge(count) {
    const badge = ensureBadge();
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !count || count <= 0;
  }

  function ensureBadge() {
    let badge = document.getElementById('notifBadge');
    if (!badge) {
      const btn = document.getElementById('notifBtn');
      if (!btn) return document.createElement('span');
      badge = document.createElement('span');
      badge.id = 'notifBadge';
      badge.className = 'notif-badge';
      badge.hidden = true;
      btn.style.position = 'relative';
      btn.appendChild(badge);
    }
    return badge;
  }

  function openPanel() {
    const p = ensurePanel();
    p.classList.add('open');
    load(1, false);
  }
  function closePanel() {
    if (panelEl) panelEl.classList.remove('open');
  }

  /* ---------- real-time hook ---------- */
  function handleRealtime(n) {
    if (!n) return;
    // refresh badge + prepend to open list
    if (typeof apiFetch !== 'undefined') {
      apiFetch.get(API + '/unread-count').then(res => {
        const c = res && res.data && res.data.count;
        if (typeof c === 'number') updateBadge(c);
      }).catch(() => {});
    }
    if (panelEl && panelEl.classList.contains('open')) load(1, false);
  }

  function initBell() {
    ensureBadge();
    const btn = document.getElementById('notifBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelEl && panelEl.classList.contains('open')) closePanel();
        else openPanel();
      });
    }
    // initial badge
    if (typeof apiFetch !== 'undefined') {
      apiFetch.get(API + '/unread-count').then(res => {
        const c = res && res.data && res.data.count;
        if (typeof c === 'number') updateBadge(c);
      }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (location.pathname.includes('dashboard.html')) initBell();
  });

  global.DZNotify = { refresh: () => load(1, false), openPanel, closePanel, handleRealtime };
})(window);
