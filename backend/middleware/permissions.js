// backend/middleware/permissions.js
// DZ POS PRO v4.5 — permission gate replacing/augmenting the hard role gate.
//   requirePermission('sales.create')      → one permission
//   requirePermission(['a', 'b'], true)    → ANY of the list
// Superadmin + store admin always pass. Everyone else passes when the
// permission is in their role defaults OR explicitly granted
// (User.permissions — editable from the Users page).
const { isAllowed, PERM_KEYS } = require('../config/permissions');
const { getTranslation } = require('../config/i18n');

const requirePermission = (perms, anyOf = false) => {
    const list = Array.isArray(perms) ? perms : [perms];
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: getTranslation('unauthorized', req.lang || 'ar')
            });
        }
        const ok = anyOf
            ? list.some(p => isAllowed(req.user, p))
            : isAllowed(req.user, list[0]);
        if (!ok) {
            return res.status(403).json({
                success: false,
                message: getTranslation('forbidden', req.lang || 'ar')
            });
        }
        next();
    };
};

// GET /api/permissions — catalog for the frontend permission editor.
const listPermissions = (req, res) => {
    const CATALOG = require('../config/permissions').CATALOG;
    const { ROLE_DEFAULTS } = require('../config/permissions');
    return res.json({ success: true, data: { catalog: CATALOG, roleDefaults: ROLE_DEFAULTS } });
};

module.exports = { requirePermission, listPermissions };
