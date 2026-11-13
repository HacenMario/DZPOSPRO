/* ============================================================
 * js/commandPalette.js — DZ POS PRO v4.1
 * ------------------------------------------------------------
 * World-class quick navigation (Ctrl/⌘ + K or the ⌘K topbar
 * button): instantly jump to ANY page of the app or run quick
 * actions (toggle theme, refresh, logout). Works on desktop AND
 * phones, fully localised through window.t().
 *
 * Exposes: window.DZPalette = { open, close, toggle, isOpen }
 * ============================================================ */

(function (global) {
  'use strict';

  let overlay = null;
  let input = null;
  let listEl = null;
  let items = [];
  let activeIndex = 0;

  function t(key, fb) {
    return (typeof global.t === 'function') ? global.t(key, fb) : (fb || key);
  }

  /* ---------- command catalogue ---------- */
  function buildCommands() {
    const pages = [
      ['dashboard', 'dashboard'], ['products', 'products'], ['categories', 'categories'],
      ['sales', 'sales'], ['invoices', 'invoices'], ['tickets', 'tickets'],
      ['customers', 'customers'], ['returns', 'returns'], ['inventory', 'inventory'],
      ['suppliers', 'suppliers'], ['purchaseOrders', 'purchaseOrders'],
      ['reports', 'reports'], ['ai', 'ai'], ['coupons', 'coupons'],
      ['sessions', 'sessions'], ['users', 'users'], ['settings', 'settings'],
      ['audit', 'audit'], ['platform', 'platform']
    ];
    const cmds = [];
    // pages → navigation commands (hidden-role pages are still filtered by
    // applyRoleNavVisibility at runtime; keep the palette simple and safe)
    pages.forEach(([page]) => {
      const role = (function () { try { return (JSON.parse(localStorage.getItem('user') || 'null') || {}).role; } catch (_) { return ''; } })();
      if (role === 'superadmin' && page === 'dashboard') { /* allowed too */ }
      if (role !== 'superadmin' && page === 'platform') return;
      if (role !== 'superadmin' && ['audit', 'ai'].indexOf(page) !== -1
          && ['admin', 'manager'].indexOf(role) === -1) return;
      cmds.push({
        icon: 'page',
        label: t(page, page),
        hint: t('cpPage', 'صفحة'),
        run: function () { if (typeof global.loadPage === 'function') global.loadPage(page); }
      });
    });
    // quick actions
    cmds.push({
      icon: 'refresh',
      label: t('cpRefreshPage', 'تحديث الصفحة الحالية'),
      hint: t('cpAction', 'إجراء'),
      run: function () { if (typeof global.loadPage === 'function') global.loadPage(global.currentPage || 'dashboard'); }
    });
    cmds.push({
      icon: 'theme',
      label: t('cpToggleTheme', 'تبديل المظهر (فاتح/داكن)'),
      hint: t('cpAction', 'إجراء'),
      run: function () { const b = document.getElementById('themeToggle'); if (b) b.click(); }
    });
    cmds.push({
      icon: 'pos',
      label: t('cpGoPos', 'فتح نقطة البيع'),
      hint: t('cpAction', 'إجراء'),
      run: function () { if (typeof global.loadPage === 'function') global.loadPage('sales'); }
    });
    cmds.push({
      icon: 'logout',
      label: t('logout', 'تسجيل الخروج'),
      hint: t('cpAction', 'إجراء'),
      run: function () { const b = document.getElementById('logoutBtn'); if (b) b.click(); }
    });
    return cmds;
  }

  /* ---------- icons ---------- */
  function iconSvg(kind) {
    const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const paths = {
      page: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
      refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
      theme: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
      pos: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
    };
    return '<svg viewBox="0 0 24 24" ' + stroke + ' aria-hidden="true">' + (paths[kind] || paths.page) + '</svg>';
  }

  /* ---------- filtering ---------- */
  function filterCommands(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items.filter(c => (c.label || '').toLowerCase().indexOf(q) !== -1 || (c.hint || '').toLowerCase().indexOf(q) !== -1);
  }

  function renderList(query) {
    if (!listEl) return;
    const results = filterCommands(query);
    if (!results.length) {
      listEl.innerHTML = '<div class="cp-empty">' + t('cpNoResults', 'لا توجد نتائج مطابقة') + '</div>';
      activeIndex = -1;
      return;
    }
    if (activeIndex >= results.length) activeIndex = 0;
    listEl.innerHTML = results.map((c, i) =>
      '<button type="button" class="cp-item' + (i === activeIndex ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="cp-item-icon">' + iconSvg(c.icon) + '</span>' +
        '<span class="cp-item-label">' + escapeH(c.label) + '</span>' +
        '<span class="cp-item-hint">' + escapeH(c.hint || '') + '</span>' +
      '</button>'
    ).join('');
    listEl.querySelectorAll('.cp-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i) || 0;
        choose(results[i]);
      });
      btn.addEventListener('mousemove', () => {
        const i = Number(btn.dataset.i) || 0;
        if (i !== activeIndex) {
          activeIndex = i;
          listEl.querySelectorAll('.cp-item').forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    listEl._results = results;
  }

  function escapeH(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function choose(cmd) {
    close();
    if (cmd && typeof cmd.run === 'function') {
      try { cmd.run(); } catch (e) { console.warn('[palette] command failed', e); }
    }
  }

  /* ---------- open / close ---------- */
  function open() {
    if (overlay) { overlay.classList.add('open'); if (input) { input.value = ''; activeIndex = 0; renderList(''); setTimeout(() => input.focus(), 30); } return; }
    items = buildCommands();
    overlay = document.createElement('div');
    overlay.className = 'cp-overlay';
    overlay.innerHTML =
      '<div class="cp-panel" role="dialog" aria-modal="true" aria-label="' + escapeH(t('cpTitle', 'البحث السريع')) + '">' +
        '<div class="cp-input-row">' +
          '<span class="cp-search-icon">' + iconSvg('page') + '</span>' +
          '<input class="cp-input" type="text" placeholder="' + escapeH(t('cpPlaceholder', 'اكتب اسم صفحة أو إجراء…')) + '" />' +
          '<span class="cp-esc">Esc</span>' +
        '</div>' +
        '<div class="cp-list"></div>' +
        '<div class="cp-foot">↑↓ ' + escapeH(t('cpNavigate', 'تنقل')) + ' · Enter ' + escapeH(t('cpSelect', 'اختيار')) + ' · Esc ' + escapeH(t('cpClose', 'إغلاق')) + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('.cp-input');
    listEl = overlay.querySelector('.cp-list');
    activeIndex = 0;
    renderList('');

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => { activeIndex = 0; renderList(input.value); });
    input.addEventListener('keydown', (e) => {
      const results = (listEl && listEl._results) || [];
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { activeIndex = (activeIndex + 1) % results.length; highlight(results); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { activeIndex = (activeIndex - 1 + results.length) % results.length; highlight(results); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (results.length && activeIndex >= 0) choose(results[activeIndex]); }
    });
    requestAnimationFrame(() => { overlay.classList.add('open'); if (input) input.focus(); });
  }

  function highlight(results) {
    if (!listEl) return;
    listEl.querySelectorAll('.cp-item').forEach(x => {
      const i = Number(x.dataset.i) || 0;
      x.classList.toggle('active', i === activeIndex);
      if (i === activeIndex && x.scrollIntoView) x.scrollIntoView({ block: 'nearest' });
    });
    void results;
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    const el = overlay;
    overlay = null; input = null; listEl = null;
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 180);
  }

  /* ---------- global wiring ---------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if (overlay) close(); else open();
    }
  });
  // let dashboard.js's existing Ctrl+K handler coexist — ours runs first and
  // stops nothing; the shell handler focuses in-page search only when the
  // palette is not open (palette swallows the keypress above).

  const cmdBtn = document.getElementById('cmdBtn');
  if (cmdBtn) cmdBtn.addEventListener('click', () => toggle());

  global.DZPalette = {
    open: open,
    close: close,
    toggle: function () { if (overlay) close(); else open(); },
    isOpen: function () { return !!overlay; }
  };
})(window);
