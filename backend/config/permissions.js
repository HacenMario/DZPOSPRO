// backend/config/permissions.js
// DZ POS PRO v4.5 — Granular permission system.
// ------------------------------------------------------------------
// The store owner (admin) and the platform owner (superadmin) can grant
// extra permissions to any account (manager / cashier …) from the Users
// page. Every route that used to be a hard role-gate is now expressed as
// a permission with a ROLE DEFAULT, so behaviour is 100% backwards
// compatible by default: an account WITHOUT explicit grants keeps exactly
// the access it always had, and grants only ever ADD access.
//
// Effective permission check (middleware/permissions.js):
//   superadmin            → always allowed
//   admin (store owner)   → allowed for every STORE permission
//   otherwise             → roleDefaults[role] ∪ user.permissions
// ------------------------------------------------------------------

const CATALOG = [
    // ---- Sales / POS ----
    { key: 'sales.create',       group: 'sales',      label: 'تسجيل مبيعة جديدة',       labelFr: 'Créer une vente',           labelEn: 'Create sales' },
    { key: 'sales.cancel',       group: 'sales',      label: 'إلغاء مبيعة / فاتورة',    labelFr: 'Annuler une vente',          labelEn: 'Cancel sales' },
    { key: 'sales.discount',     group: 'sales',      label: 'تطبيق تخفيضات',           labelFr: 'Appliquer des remises',      labelEn: 'Apply discounts' },

    // ---- Invoices / returns ----
    { key: 'invoices.view',      group: 'sales',      label: 'عرض الفواتير',            labelFr: 'Voir les factures',          labelEn: 'View invoices' },
    { key: 'returns.create',     group: 'sales',      label: 'تسجيل مرتجع',             labelFr: 'Créer un retour',            labelEn: 'Create returns' },

    // ---- Inventory ----
    { key: 'products.view',      group: 'inventory',  label: 'عرض المنتجات',            labelFr: 'Voir les produits',          labelEn: 'View products' },
    { key: 'products.manage',    group: 'inventory',  label: 'إضافة وتعديل المنتجات',   labelFr: 'Gérer les produits',         labelEn: 'Manage products' },
    { key: 'inventory.adjust',   group: 'inventory',  label: 'تعديل المخزون',           labelFr: 'Ajuster le stock',           labelEn: 'Adjust stock' },
    { key: 'categories.manage',  group: 'inventory',  label: 'إدارة الفئات',            labelFr: 'Gérer les catégories',       labelEn: 'Manage categories' },
    { key: 'suppliers.manage',   group: 'inventory',  label: 'إدارة الموردين',          labelFr: 'Gérer les fournisseurs',     labelEn: 'Manage suppliers' },
    { key: 'purchaseOrders.manage', group: 'inventory', label: 'إدارة أوامر الشراء',    labelFr: 'Gérer les bons de commande', labelEn: 'Manage purchase orders' },

    // ---- Customers / loyalty ----
    { key: 'customers.manage',   group: 'customers',  label: 'إدارة العملاء',           labelFr: 'Gérer les clients',          labelEn: 'Manage customers' },
    { key: 'coupons.manage',     group: 'customers',  label: 'إدارة الكوبونات',         labelFr: 'Gérer les coupons',          labelEn: 'Manage coupons' },

    // ---- Reports / intelligence ----
    { key: 'reports.view',       group: 'insights',   label: 'عرض التقارير',            labelFr: 'Voir les rapports',          labelEn: 'View reports' },
    { key: 'ai.use',             group: 'insights',   label: 'استخدام الذكاء الاصطناعي', labelFr: 'Utiliser l\'IA',            labelEn: 'Use AI assistant' },

    // ---- Cash register ----
    { key: 'sessions.open',      group: 'cash',       label: 'فتح جلسة صندوق',          labelFr: 'Ouvrir une session caisse',  labelEn: 'Open cash session' },
    { key: 'sessions.close',     group: 'cash',       label: 'إغلاق جلسة الصندوق',      labelFr: 'Clôturer la session',        labelEn: 'Close cash session' },
    { key: 'sessions.viewAll',   group: 'cash',       label: 'عرض جلسات الجميع',        labelFr: 'Voir toutes les sessions',   labelEn: 'View all sessions' },

    // ---- Staff ----
    { key: 'employees.manage',   group: 'staff',      label: 'إدارة الموظفين والدوام',  labelFr: 'Gérer employés & pointage',  labelEn: 'Manage employees & attendance' },
    { key: 'users.manage',       group: 'staff',      label: 'إدارة الحسابات والصلاحيات', labelFr: 'Gérer comptes & droits',   labelEn: 'Manage accounts & permissions' },

    // ---- Administration ----
    { key: 'settings.edit',      group: 'admin',      label: 'تعديل الإعدادات',         labelFr: 'Modifier les paramètres',    labelEn: 'Edit settings' },
    { key: 'audit.view',         group: 'admin',      label: 'عرض سجل العمليات',        labelFr: 'Voir le journal d\'audit',   labelEn: 'View audit log' }
];

const PERM_KEYS = CATALOG.map(p => p.key);
const GROUPS = [...new Set(CATALOG.map(p => p.group))];

// Role defaults reproduce EXACTLY the pre-v4.5 role gates, so enabling the
// permission layer changes nothing until an admin starts granting extras.
const ROLE_DEFAULTS = {
    superadmin: PERM_KEYS,
    admin:      PERM_KEYS,
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

const DEFAULT_KEYS = { manager: new Set(ROLE_DEFAULTS.manager), cashier: new Set(ROLE_DEFAULTS.cashier) };

function roleHas(role, perm) {
    if (role === 'superadmin' || role === 'admin') return true;
    return DEFAULT_KEYS[role] ? DEFAULT_KEYS[role].has(perm) : false;
}

// Effective permissions of a user document (role defaults ∪ explicit grants).
function effectivePermissions(user) {
    const role = user && user.role;
    if (role === 'superadmin' || role === 'admin') return PERM_KEYS;
    const granted = Array.isArray(user && user.permissions) ? user.permissions : [];
    const set = new Set();
    for (const p of granted) if (PERM_KEYS.includes(p)) set.add(p);
    return PERM_KEYS.filter(p => set.has(p) || roleHas(role, p));
}

function isAllowed(user, perm) {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'admin') return true;
    if (!PERM_KEYS.includes(perm)) return true; // unknown permission → never block legacy flows
    const granted = Array.isArray(user.permissions) ? user.permissions : [];
    return granted.includes(perm) || roleHas(user.role, perm);
}

// Map old roleMiddleware lists to their equivalent permission — used to
// convert routes one-to-one without changing behaviour.
const ROUTE_PERMS = {
    salesCreate:      'sales.create',
    salesCancel:      'sales.cancel',
    invoicesView:     'invoices.view',
    returnsCreate:    'returns.create',
    productsManage:   'products.manage',
    productsView:     'products.view',
    inventoryAdjust:  'inventory.adjust',
    categoriesManage: 'categories.manage',
    suppliersManage:  'suppliers.manage',
    purchaseOrders:   'purchaseOrders.manage',
    customersManage:  'customers.manage',
    couponsManage:    'coupons.manage',
    reportsView:      'reports.view',
    aiUse:            'ai.use',
    sessionsViewAll:  'sessions.viewAll',
    employeesManage:  'employees.manage',
    usersManage:      'users.manage',
    settingsEdit:     'settings.edit',
    auditView:        'audit.view'
};

module.exports = {
    CATALOG, PERM_KEYS, GROUPS, ROLE_DEFAULTS, ROUTE_PERMS,
    roleHas, effectivePermissions, isAllowed
};
