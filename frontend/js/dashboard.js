/* ============================================================
 * js/dashboard.js — Dashboard shell controller
 * ------------------------------------------------------------
 * Loaded only on dashboard.html. Responsibilities:
 *   • Auth guard (redirect to index.html when no token)
 *   • Restore theme + language + sidebar state
 *   • Wire topbar / sidebar / theme / language / logout
 *   • loadPage(page) — dynamic import + render any of the 14
 *     modules. Modules another agent owns are referenced via
 *     dynamic import and gracefully degrade if missing.
 *   • Keyboard shortcuts: F1 = help, F2 = POS (sales), Esc = close modal
 *   • Initialize socket
 * ============================================================ */

(function () {
  'use strict';

  // ===== استخدم API_BASE =====
const API_BASE = 'https://dzpospro-production.up.railway.app';

  /* ---------- Auth guard ---------- */
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'index.html?reason=session';
    return;
  }
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user') || 'null'); } catch (_) {}
  if (!currentUser) {
    window.location.href = 'index.html?reason=session';
    return;
  }

  let currentPage = 'dashboard';
  let currentPageRender = null;   // promise of in-flight render
  const SIDEBAR_BREAKPOINT = 1024;

  /* ---------- Theme ---------- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (_) {}
    updateThemeIcon(theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }
  function updateThemeIcon(theme) {
    document.querySelectorAll('#themeToggle').forEach(btn => {
      const sun = btn.querySelector('.icon-sun');
      const moon = btn.querySelector('.icon-moon');
      if (!sun || !moon) return;
      sun.style.display = theme === 'dark' ? 'none' : 'block';
      moon.style.display = theme === 'dark' ? 'block' : 'none';
    });
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------- Sidebar (mobile drawer) ---------- */
  function openSidebar() {
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sb) sb.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  function closeSidebar() {
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sb) sb.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    if (sb.classList.contains('open')) closeSidebar(); else openSidebar();
  }

  /* ---------- User chip ---------- */
  function renderUserChip() {
    const name = currentUser.name || currentUser.email || 'User';
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    const role = currentUser.role || '';
    const avatars = document.querySelectorAll('#sidebarAvatar, #topbarAvatar');
    avatars.forEach(a => { if (a) a.textContent = initial; });
    const nameEls = document.querySelectorAll('#sidebarUserName, #topbarUserName');
    nameEls.forEach(n => { if (n) n.textContent = name; });
    const roleEl = document.getElementById('sidebarUserRole');
    if (roleEl && role) roleEl.textContent = role;
  }

  /* ---------- Page title + icon ---------- */
  const PAGE_ICONS = {
    dashboard:  '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    products:   '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    categories: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    customers:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    sales:      '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    tickets:    '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4z"/><line x1="13" y1="7" x2="13" y2="17" stroke-dasharray="2 2"/>',
    invoices:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    reports:    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    coupons:    '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="14" y1="14" x2="20" y2="8"/>',
    suppliers:  '<rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    purchaseOrders: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    returns:    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    inventory:  '<line x1="16.5" y1="5.5" x2="7.5" y2="14.5"/><polyline points="21 2 12 11 7 6"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/>',
    users:      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="17" cy="6" r="2" fill="currentColor"/>',
    sessions:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
  };

  function updatePageTitle(page) {
    const titleEl = document.getElementById('pageTitle');
    if (!titleEl) return;
    const span = titleEl.querySelector('.page-title-text');
    const icon = titleEl.querySelector('#pageTitleIcon');
    const label = (typeof window.t === 'function') ? window.t(page, page) : page;
    if (span) span.textContent = label;
    if (icon) {
      const path = PAGE_ICONS[page];
      if (path) icon.innerHTML = path;
    }
  }

  /* ---------- Mobile table-card labels ----------
   * At ≤480px pages.css converts every table into stacked cards using
   * td::before { content: attr(data-label) }. Most module tables never
   * set data-label, so the cards rendered WITHOUT labels (wide, ugly,
   * unusable). This observer copies each <th> text into the matching
   * <td data-label="…"> so EVERY table in the app becomes a clean,
   * labelled card list on phones — no per-module changes needed.
   */
  function applyTableCardLabels(root) {
    (root || document).querySelectorAll('table').forEach(table => {
      if (table.dataset.labelsApplied === '1') return;
      const headCells = Array.from(table.querySelectorAll('thead th'));
      if (!headCells.length) return;
      table.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.closest('thead')) return;
        Array.from(tr.children).forEach((td, i) => {
          if (i >= headCells.length) return;
          const th = headCells[i];
          const label = (th.textContent || '').trim();
          if (label && !td.dataset.label) td.setAttribute('data-label', label);
        });
      });
      table.dataset.labelsApplied = '1';
    });
  }

  // Re-apply labels whenever the page content changes (each module renders
  // its tables dynamically). MutationObserver is cheap: it only walks new
  // tables and skips already-labelled ones via the dataset guard.
  let labelObserver = null;
  function initTableCardLabels() {
    if (labelObserver || !('MutationObserver' in window)) return;
    const content = document.getElementById('pageContent');
    if (!content) return;
    applyTableCardLabels(content);
    labelObserver = new MutationObserver(() => applyTableCardLabels(content));
    labelObserver.observe(content, { childList: true, subtree: true });
  }

  /* ---------- Loading placeholder ---------- */
  function showLoading() {
    const content = document.getElementById('pageContent');
    if (!content) return;
    content.innerHTML =
      '<div class="loading-state">' +
        '<div class="spinner" role="status" aria-live="polite"></div>' +
        '<span>' + (window.t ? window.t('loading', 'جاري التحميل...') : 'Loading...') + '</span>' +
      '</div>';
  }

  /* ---------- Module loaders ---------- */
  // Map page -> [modulePath, exportName]
  // Modules owned by another agent are listed too; dynamic import
  // will fail gracefully if the file does not exist yet.
  const MODULE_MAP = {
    dashboard:      { path: './modules/dashboard.js',       fn: 'renderDashboardPage'     },
    products:        { path: './modules/products.js',        fn: 'renderProductsPage'      },
    categories:      { path: './modules/categories.js',      fn: 'renderCategoriesPage'    },
    customers:       { path: './modules/customers.js',       fn: 'renderCustomersPage'     },
    sales:           { path: './modules/sales.js',           fn: 'renderSalesPage'         },
    tickets:         { path: './modules/tickets.js',         fn: 'renderTicketsPage'       },
    invoices:        { path: './modules/invoices.js',        fn: 'renderInvoicesPage'      },
    reports:         { path: './modules/reports.js',         fn: 'renderReportsPage'       },
    coupons:         { path: './modules/coupons.js',         fn: 'renderCouponsPage'       },
    suppliers:       { path: './modules/suppliers.js',       fn: 'renderSuppliersPage'     },
    purchaseOrders:  { path: './modules/purchaseOrders.js',  fn: 'renderPurchaseOrdersPage' },
    returns:         { path: './modules/returns.js',         fn: 'renderReturnsPage'       },
    inventory:       { path: './modules/inventory.js',       fn: 'renderInventoryPage'     },
    users:           { path: './modules/users.js',           fn: 'renderUsersPage'         },
    sessions:        { path: './modules/sessions.js',        fn: 'renderSessionsPage'      },
    settings:        { path: './modules/settings.js',        fn: 'renderSettingsPage'      }
  };

async function loadPage(page) {
    if (!MODULE_MAP[page]) page = 'dashboard';
    currentPage = page;
    updatePageTitle(page);
    setActiveNav(page);
    showLoading();

    const spec = MODULE_MAP[page];
    const content = document.getElementById('pageContent');

    try {
      // ===== تمرير API_BASE إلى الموديولات =====
      const mod = await import(spec.path);
      const fn = mod[spec.fn] || mod.default;
      if (typeof fn !== 'function') {
        throw new Error('Module "' + spec.path + '" does not export "' + spec.fn + '"');
      }
      // ===== استدعاء الدالة مع API_BASE =====
      await fn.call(mod, { apiBase: API_BASE });
    } catch (err) {
      console.error('[dashboard] loadPage failed:', page, err);
      if (content) {
        const title = window.t ? window.t('moduleLoadError', 'تعذّر تحميل الوحدة') : 'Module load error';
        const sub = (err && err.message) ? err.message : String(err);
        content.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
            '<div class="empty-title">' + title + '</div>' +
            '<div class="empty-subtitle">' + sub + '</div>' +
            '<div class="empty-action"><button class="btn btn-secondary btn-sm" onclick="window.loadPage(\'' + page + '\')">' + (window.t ? window.t('retry', 'إعادة المحاولة') : 'Retry') + '</button></div>' +
          '</div>';
      }
    }
  }

  function setActiveNav(page) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(a => {
      if (a.dataset.page === page) a.classList.add('active');
      else a.classList.remove('active');
    });
  }

  /* ---------- Help modal ---------- */
  function openHelpModal() {
    if (typeof Swal === 'undefined') return;
    const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
    const labels = {
      ar: { title: 'اختصارات لوحة المفاتيح', close: 'إغلاق',
            shortcuts: [
              ['F1', 'عرض هذه النافذة'],
              ['F2', 'الانتقال إلى نقطة البيع'],
              ['Esc', 'إغلاق النافذة المنبثقة'],
              ['Ctrl + K', 'تركيز البحث (في الصفحات الداعمة)']
            ] },
      en: { title: 'Keyboard shortcuts', close: 'Close',
            shortcuts: [
              ['F1', 'Show this dialog'],
              ['F2', 'Go to POS'],
              ['Esc', 'Close modal'],
              ['Ctrl + K', 'Focus search (where supported)']
            ] },
      fr: { title: 'Raccourcis clavier', close: 'Fermer',
            shortcuts: [
              ['F1', 'Afficher cette fenêtre'],
              ['F2', 'Aller au point de vente'],
              ['Esc', 'Fermer la modale'],
              ['Ctrl + K', 'Rechercher (si pris en charge)']
            ] }
    };
    const f = labels[lang] || labels.ar;
    const rows = f.shortcuts.map(([k, v]) =>
      '<div class="shortcut-row"><span class="shortcut-label">' + v + '</span><span class="shortcut-keys"><span class="kbd">' + k + '</span></span></div>'
    ).join('');
    Swal.fire({
      title: f.title,
      html: '<div class="shortcut-list">' + rows + '</div>',
      confirmButtonText: f.close,
      confirmButtonColor: '#10b981',
      width: 480
    });
  }

  /* ---------- Keyboard shortcuts ---------- */
  function onKeydown(e) {
    // Ignore when typing in form fields (except Esc and F-keys)
    const tag = (e.target && e.target.tagName) || '';
    const inField = /INPUT|TEXTAREA|SELECT/.test(tag);
    if (e.key === 'F1') { e.preventDefault(); openHelpModal(); return; }
    if (e.key === 'F2') { e.preventDefault(); loadPage('sales'); return; }
    if (e.key === 'Escape') {
      // Close topmost modal (custom .modal-overlay or SweetAlert2)
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays.length) {
        const top = overlays[overlays.length - 1];
        const closeBtn = top.querySelector('.modal-close');
        if (closeBtn) closeBtn.click();
        else top.remove();
        return;
      }
      if (typeof Swal !== 'undefined' && Swal.isVisible()) { Swal.close(); return; }
      // Close mobile sidebar
      const sb = document.getElementById('sidebar');
      if (sb && sb.classList.contains('open')) { closeSidebar(); return; }
      return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const sb = document.querySelector('.search-box input, #productSearch, #categorySearch, #customerSearch');
      if (sb) sb.focus();
    }
  }

  /* ---------- Logout ---------- */
  async function logout() {
    const ok = await (window.Toast && window.Toast.confirm
      ? window.Toast.confirm(window.t ? window.t('logoutConfirm', 'هل تريد تسجيل الخروج؟') : 'Logout?')
      : Promise.resolve(true));
    if (!ok) return;
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (_) {}
    window.location.href = 'index.html';
  }

  /* ---------- Wire up on DOM ready ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    // Restore theme
    const savedTheme = (function () { try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; } })();
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    renderUserChip();

    // Topbar
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const hamburger = document.getElementById('hamburger');
    if (hamburger) hamburger.addEventListener('click', toggleSidebar);
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) helpBtn.addEventListener('click', openHelpModal);
    const notifBtn = document.getElementById('notifBtn');
    if (notifBtn) notifBtn.addEventListener('click', () => {
      if (window.Toast) window.Toast.info(window.t ? window.t('noNewNotifications', 'لا إشعارات جديدة') : 'No new notifications');
    });

    // Language selector
    const langSel = document.getElementById('langSelect');
    if (langSel) {
      try { langSel.value = localStorage.getItem('lang') || 'ar'; } catch (_) {}
      langSel.addEventListener('change', () => {
        if (typeof window.setLanguage === 'function') window.setLanguage(langSel.value);
      });
    }

    // Sidebar nav links
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        if (!page) return;
        loadPage(page);
        // On mobile, close drawer after navigation
        if (window.innerWidth <= SIDEBAR_BREAKPOINT) closeSidebar();
      });
      // Keyboard activate
      link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          link.click();
        }
      });
    });

    // Window resize: auto-close drawer on desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > SIDEBAR_BREAKPOINT) closeSidebar();
    });

    // Offline banner
    const offlineBanner = document.getElementById('offlineBanner');
    function updateOnline() {
      if (offlineBanner) offlineBanner.classList.toggle('show', !navigator.onLine);
    }
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeydown);

    // Init socket (same-origin)
    if (typeof window.initSocket === 'function') {
      try { window.initSocket(); } catch (e) { console.warn('[socket] init failed', e); }
    }

    // Listen for language changes (i18n dispatches 'languagechange')
    // — re-render handled inside setLanguage via window.loadPage, but
    // we still need to refresh nav titles + page title here.
    window.addEventListener('languagechange', () => {
      updatePageTitle(currentPage);
    });

    // Expose loadPage + currentPage globally for modules & shortcuts
    window.loadPage = loadPage;
    window.currentPage = currentPage;
    Object.defineProperty(window, 'currentPage', {
      configurable: true,
      get: () => currentPage,
      set: (v) => { currentPage = v; }
    });

    // Initial render
    initTableCardLabels();
    loadPage('dashboard');
  });
})();
