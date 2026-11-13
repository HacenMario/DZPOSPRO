// backend/config/plans.js
// DZ POS PRO v4.3 — Single source of truth for subscription plans.
// ------------------------------------------------------------------
// The store-facing subscription page and the super-admin billing console
// both read their prices / limits from here, so a price change only
// ever happens in ONE file.
//
// Currency: DZD (Algerian Dinars).
//  • monthly  → price for a 1-month period
//  • yearly   → price for a 12-month period (2 months free ≈ -17%)
// Limits are soft quotas: they surface in the UI, warn the store, and are
// applied automatically when a plan change is approved.

const CATALOG = {
    trial: {
        key: 'trial',
        monthly: 0,
        yearly: 0,
        maxUsers: 3,
        maxProducts: 500,
        aiDailyCalls: 50,
        badge: 'badge-warning'
    },
    basic: {
        key: 'basic',
        monthly: 2500,
        yearly: 25000,
        maxUsers: 3,
        maxProducts: 1000,
        aiDailyCalls: 60,
        badge: 'badge-info'
    },
    pro: {
        key: 'pro',
        monthly: 5000,
        yearly: 50000,
        maxUsers: 10,
        maxProducts: 5000,
        aiDailyCalls: 200,
        badge: 'badge-success'
    },
    enterprise: {
        key: 'enterprise',
        monthly: 10000,
        yearly: 100000,
        maxUsers: 30,
        maxProducts: 20000,
        aiDailyCalls: 1000,
        badge: 'badge-super'
    }
};

const PLAN_KEYS = Object.keys(CATALOG);              // ['trial','basic','pro','enterprise']
const PAID_PLAN_KEYS = PLAN_KEYS.filter(k => k !== 'trial');
const CYCLES = ['monthly', 'yearly'];
const CYCLE_MONTHS = { monthly: 1, yearly: 12 };
const PAYMENT_METHODS = ['ccp', 'baridimob', 'cash', 'bank_transfer', 'other', 'manual'];
const CURRENCY = 'DZD';

const isPlan = (k) => PLAN_KEYS.includes(k);
const isPaidPlan = (k) => PAID_PLAN_KEYS.includes(k);
const isCycle = (c) => CYCLES.includes(c);
const isPaymentMethod = (m) => PAYMENT_METHODS.includes(m);

// Price of a plan for a billing cycle (DZD). Unknown → 0.
function price(planKey, cycle) {
    const p = CATALOG[planKey];
    if (!p) return 0;
    return cycle === 'yearly' ? p.yearly : p.monthly;
}

// Public catalog for the frontend (safe to expose — no secrets).
function publicCatalog() {
    return PLAN_KEYS.map(k => ({ ...CATALOG[k] }));
}

// Default limits of a plan (fresh object each call).
function planLimits(planKey) {
    const p = CATALOG[planKey] || CATALOG.trial;
    return { maxUsers: p.maxUsers, maxProducts: p.maxProducts, aiDailyCalls: p.aiDailyCalls };
}

module.exports = {
    CATALOG, PLAN_KEYS, PAID_PLAN_KEYS, CYCLES, CYCLE_MONTHS,
    PAYMENT_METHODS, CURRENCY,
    isPlan, isPaidPlan, isCycle, isPaymentMethod,
    price, publicCatalog, planLimits
};
