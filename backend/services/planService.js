// backend/services/planService.js
// DZ POS PRO v4.5 — DB-backed subscription plan catalog with a short-lived
// cache. Every consumer (subscription controller, tenant middleware, AI
// assistant, frontend catalog) reads plans through here, so a price edited
// by the super-admin applies IMMEDIATELY platform-wide.
//
// Resilience contract:
//   • empty collection     → seeded once from config/plans.js defaults
//   • DB read failure      → falls back to the same static defaults so the
//                            platform NEVER loses its price list
//   • every write (CRUD)   → invalidate() clears the cache instantly
const DEFAULTS = require('../config/plans');
const logger = require('../utils/logger');

const Plan = require('../models/Plan');

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 15000; // 15 s safety net; writes invalidate immediately

const CATALOG_DEFAULTS = DEFAULTS.CATALOG;

function defaultDoc(key, i) {
    const p = CATALOG_DEFAULTS[key];
    return {
        key, name: defaultName(key),
        monthly: p.monthly, yearly: p.yearly,
        maxUsers: p.maxUsers, maxProducts: p.maxProducts, aiDailyCalls: p.aiDailyCalls,
        isTrial: key === 'trial',
        active: true,
        badge: p.badge || 'badge-info',
        sortOrder: i,
        description: ''
    };
}

function defaultName(key) {
    const names = { trial: 'التجربة', basic: 'الأساسية', pro: 'الاحترافية', enterprise: 'المؤسسات' };
    return names[key] || key;
}

async function ensureSeeded() {
    try {
        const count = await Plan.countDocuments({});
        if (count > 0) return;
        const keys = Object.keys(CATALOG_DEFAULTS);
        await Plan.insertMany(keys.map((k, i) => defaultDoc(k, i)));
        logger.info('[planService] default plan catalog seeded (' + keys.length + ' plans)');
    } catch (err) {
        logger.warn('[planService] seed failed:', err.message);
    }
}

async function loadCatalog() {
    if (_cache && (Date.now() - _cacheAt) < CACHE_TTL_MS) return _cache;
    try {
        let docs = await Plan.find({}).sort({ sortOrder: 1, monthly: 1 }).lean();
        if (!docs.length) {
            await ensureSeeded();
            docs = await Plan.find({}).sort({ sortOrder: 1, monthly: 1 }).lean();
        }
        if (docs.length) {
            _cache = docs.map(d => Plan.toPublic(d));
            _cacheAt = Date.now();
            return _cache;
        }
    } catch (err) {
        logger.warn('[planService] DB catalog unavailable → static defaults:', err.message);
    }
    // fallback: static defaults (same shape as the DB docs)
    _cache = Object.keys(CATALOG_DEFAULTS).map((k, i) => ({ id: null, ...defaultDoc(k, i) }));
    _cacheAt = Date.now();
    return _cache;
}

function invalidate() { _cache = null; _cacheAt = 0; }

async function getCatalog() { return await loadCatalog(); }

async function getPlan(key) {
    const cat = await loadCatalog();
    return cat.find(p => p.key === String(key)) || null;
}

async function isPlan(key) { return !!(await getPlan(key)); }
async function isPaidPlan(key) { const p = await getPlan(key); return !!(p && !p.isTrial); }
async function isCycle(c) { return DEFAULTS.isCycle(c); }
async function isPaymentMethod(m) { return DEFAULTS.isPaymentMethod(m); }

async function price(key, cycle) {
    const p = await getPlan(key);
    if (!p) return 0;
    return cycle === 'yearly' ? p.yearly : p.monthly;
}

async function planLimits(key) {
    const p = await getPlan(key) || (await loadCatalog()).find(x => x.isTrial) || null;
    if (!p) return { maxUsers: 5, maxProducts: 2000, aiDailyCalls: 200 };
    return { maxUsers: p.maxUsers, maxProducts: p.maxProducts, aiDailyCalls: p.aiDailyCalls };
}

// Sync helpers for the (rare) synchronous consumers — they read the last
// cache and fall back to the static defaults before the first async load.
function syncCatalog() {
    if (_cache) return _cache;
    return Object.keys(CATALOG_DEFAULTS).map((k, i) => ({ id: null, ...defaultDoc(k, i) }));
}
function syncPrice(key, cycle) {
    const p = syncCatalog().find(x => x.key === String(key));
    if (!p) return 0;
    return cycle === 'yearly' ? p.yearly : p.monthly;
}

module.exports = {
    ensureSeeded, getCatalog, getPlan, invalidate,
    isPlan, isPaidPlan, isCycle, isPaymentMethod,
    price, planLimits,
    syncCatalog, syncPrice,
    CYCLES: DEFAULTS.CYCLES, CYCLE_MONTHS: DEFAULTS.CYCLE_MONTHS,
    PAYMENT_METHODS: DEFAULTS.PAYMENT_METHODS, CURRENCY: DEFAULTS.CURRENCY
};
