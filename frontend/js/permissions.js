/* ============================================================
 * js/permissions.js — v4.5 client-side permission layer
 * ------------------------------------------------------------
 * MIRRORS backend/config/permissions.js (the backend remains the
 * single enforcement point — this copy only hides UI the account
 * cannot use). Role defaults reproduce the pre-v4.5 gates exactly,
 * so nothing changes until the admin grants extras from the Users
 * page.
 *
 * Exposes: window.DZPOS_PERMS = { isAllowed, effective, CATALOG }
 * ============================================================ */

(function (global) {
  'use strict';

  const CATALOG = [
    'sales.create', 'sales.cancel', 'sales.discount',
    'invoices.view', 'returns.create',
    'products.view', 'products.manage', 'inventory.adjust', 'categories.manage',
    'suppliers.manage', 'purchaseOrders.manage',
    'customers.manage', 'coupons.manage',
    'reports.view', 'ai.use',
    'sessions.open', 'sessions.close', 'sessions.viewAll',
    'employees.manage', 'users.manage',
    'settings.edit', 'audit.view'
  ];

  const GROUPS = {
    sales: ['sales.create', 'sales.cancel', 'sales.discount', 'invoices.view', 'returns.create'],
    inventory: ['products.view', 'products.manage', 'inventory.adjust', 'categories.manage', 'suppliers.manage', 'purchaseOrders.manage'],
    customers: ['customers.manage', 'coupons.manage'],
    insights: ['reports.view', 'ai.use'],
    cash: ['sessions.open', 'sessions.close', 'sessions.viewAll'],
    staff: ['employees.manage', 'users.manage'],
    admin: ['settings.edit', 'audit.view']
  };

  const ROLE_DEFAULTS = {
    manager: [
      'sales.create', 'sales.cancel', 'sales.discount',
      'invoices.view', 'returns.create',
      'products.view', 'products.manage', 'inventory.adjust', 'categories.manage',
      'suppliers.manage', 'purchaseOrders.manage',
      'customers.manage', 'coupons.manage',
      'reports.view', 'ai.use',
      'sessions.open', 'sessions.close', 'sessions.viewAll',
      'employees.manage'
    ],
    cashier: [
      'sales.create', 'sales.discount',
      'invoices.view',
      'products.view', 'customers.manage',
      'sessions.open', 'sessions.close'
    ]
  };

  const DEFAULT_SETS = { manager: new Set(ROLE_DEFAULTS.manager), cashier: new Set(ROLE_DEFAULTS.cashier) };

  function isAllowed(user, perm) {
    if (!user) return false;
    const role = user.role;
    if (role === 'superadmin' || role === 'admin') return true;
    const granted = Array.isArray(user.permissions) ? user.permissions : [];
    return granted.includes(perm) || (DEFAULT_SETS[role] ? DEFAULT_SETS[role].has(perm) : false);
  }

  function effective(user) {
    if (!user) return [];
    if (user.role === 'superadmin' || user.role === 'admin') return CATALOG.slice();
    const granted = Array.isArray(user.permissions) ? user.permissions : [];
    return CATALOG.filter(p => granted.includes(p) || (DEFAULT_SETS[user.role] ? DEFAULT_SETS[user.role].has(p) : false));
  }

  // Refresh the cached account (so grants made by the admin show up after
  // a reload even if the login payload was older).
  async function refreshMe() {
    try {
      if (!global.apiFetch || !localStorage.getItem('token')) return;
      const res = await global.apiFetch.get('/api/auth/me');
      const u = res && res.data && res.data.user;
      if (u && u.email) {
        const cached = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify(Object.assign({}, cached, u)));
      }
    } catch (_) { /* silent — offline or session */ }
  }

  global.DZPOS_PERMS = { isAllowed, effective, CATALOG, GROUPS, ROLE_DEFAULTS, refreshMe };
})(window);
