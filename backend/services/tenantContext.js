// backend/services/tenantContext.js
// DZ POS PRO v3 — AsyncLocalStorage-based tenant context.
// The tenant middleware stores { storeId, isSuper } for every authenticated
// request; the mongoose tenant plugin (utils/tenantPlugin.js) reads this
// context and automatically:
//   • filters every query by storeId (find / findOne / update / delete / count)
//   • stamps storeId onto every document created inside the context
// Super-admins run with isSuper = true → no filtering applied (platform view).
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** Run `fn` within a tenant context. */
function runWithTenant(ctx, fn) {
    return als.run(ctx || { storeId: null, isSuper: false }, fn);
}

/** Get the current tenant context (or null when outside a request). */
function getTenantContext() {
    return als.getStore() || null;
}

/** Current storeId or null (super-admin / no context). */
function currentStoreId() {
    const ctx = als.getStore();
    return ctx ? ctx.storeId : null;
}

/** True when the current request belongs to a super-admin (no tenant filter). */
function isSuperContext() {
    const ctx = als.getStore();
    return !!(ctx && ctx.isSuper);
}

module.exports = { runWithTenant, getTenantContext, currentStoreId, isSuperContext };
