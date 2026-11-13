// backend/middleware/tenant.js
// DZ POS PRO v3 — Tenant middleware.
// Runs AFTER authMiddleware. Wraps the whole request handler chain in an
// AsyncLocalStorage tenant context so the mongoose tenant plugin can
// transparently scope every query/mutation to the user's store.
//
//  • superadmin users → context { isSuper: true } (platform-wide access)
//  • superadmin + X-Store-Id header → scoped to that store (store focus)
//  • suspended store  → 403 unless the request is from a super-admin
//  • normal users     → context { storeId: user.storeId }
const { runWithTenant } = require('../services/tenantContext');
const mongoose = require('mongoose');
const Store = require('../models/Store');
const { GRACE_DAYS } = require('../models/Store');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');

// Cache store status for 60s to avoid a DB hit on every request.
const storeCache = new Map(); // id -> { status, plan, ts }
const CACHE_TTL = 60 * 1000;

async function getStoreDoc(storeId) {
    const key = String(storeId);
    const hit = storeCache.get(key);
    if (hit && (Date.now() - hit.ts) < CACHE_TTL) return hit.doc;
    let doc = null;
    try { doc = await Store.findById(storeId).select('status plan name limits trialEndsAt subscriptionEndsAt').lean(); } catch (_) {}
    storeCache.set(key, { doc, ts: Date.now() });
    return doc;
}

// v3.2 — call whenever a store's status/plan changes so suspensions apply instantly
function invalidateStoreCache(storeId) {
    if (storeId != null) storeCache.delete(String(storeId));
}

const tenantMiddleware = (req, res, next) => {
    const user = req.user;

    // No authenticated user yet (public routes) — neutral context.
    if (!user) return runWithTenant({ storeId: null, isSuper: false }, () => next());

    // Super-admin — platform context, no filtering.
    if (user.role === 'superadmin') {
        // v4 — OPTIONAL store focus: when the platform owner browses a specific
        // store (store switcher), the frontend sends X-Store-Id. Every query
        // then runs scoped to that store so pages behave exactly like they do
        // for the store's own team — while keeping full platform rights.
        const focus = (req.get('X-Store-Id') || req.query.storeId || '').toString().trim();
        if (focus && mongoose.Types.ObjectId.isValid(focus)) {
            req.storeId = mongoose.Types.ObjectId(focus);
            req.isSuper = true;
            req.storeFocus = req.storeId;
            return runWithTenant({ storeId: req.storeId, isSuper: true }, () => next());
        }
        req.storeId = null;
        req.isSuper = true;
        return runWithTenant({ storeId: null, isSuper: true }, () => next());
    }

    const storeId = user.storeId || null;

    if (!storeId) {
        // Legacy account not yet migrated — treat as single-store (null tenant)
        // so the app keeps working; migration assigns a store later.
        req.storeId = null;
        return runWithTenant({ storeId: null, isSuper: false }, () => next());
    }

    getStoreDoc(storeId)
        .then((store) => {
            if (!store) {
                logger.warn(`Tenant middleware: store ${storeId} not found`);
                return res.status(403).json({
                    success: false,
                    message: getTranslation('storeNotFound', req.lang || 'ar')
                });
            }
            if (store.status === 'suspended') {
                return res.status(403).json({
                    success: false,
                    message: getTranslation('storeSuspended', req.lang || 'ar')
                });
            }
            // v4.3 — paid-plan expiry enforcement after the grace window.
            // Legacy stores (no subscriptionEndsAt) and trials keep the old behaviour.
            if (store.plan !== 'trial' && store.subscriptionEndsAt) {
                const graceEnd = new Date(new Date(store.subscriptionEndsAt).getTime() + GRACE_DAYS * 24 * 3600 * 1000);
                if (graceEnd < new Date()) {
                    return res.status(403).json({
                        success: false,
                        message: getTranslation('subscriptionExpired', req.lang || 'ar')
                    });
                }
            }
            req.storeId = storeId;
            req.store = store;
            runWithTenant({ storeId, isSuper: false }, () => next());
        })
        .catch((err) => {
            logger.error('Tenant middleware error:', err.message);
            res.status(500).json({ success: false, message: getTranslation('serverError', req.lang || 'ar') });
        });
};

module.exports = tenantMiddleware;
module.exports.invalidateStoreCache = invalidateStoreCache;
