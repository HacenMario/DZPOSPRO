// backend/middleware/role.js
const { getTranslation } = require('../config/i18n');

const roleMiddleware = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: getTranslation('unauthorized', req.lang || 'ar')
            });
        }
        // v3.2 — super-admin owns the platform: allowed EVERYWHERE.
        if (req.user.role === 'superadmin') return next();
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: getTranslation('forbidden', req.lang || 'ar')
            });
        }
        next();
    };
};

module.exports = roleMiddleware;
