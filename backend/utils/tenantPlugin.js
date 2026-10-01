// backend/utils/tenantPlugin.js
// DZ POS PRO v3 — Mongoose multi-tenant plugin.
//
// Apply to every schema that contains a `storeId` field:
//   schema.plugin(require('./utils/tenantPlugin'));
//
// Behaviour:
//   • When a tenant context exists (normal store user):
//       - All find/findOne/findById/count/distinct queries get
//         `storeId` injected into the filter automatically.
//       - updateOne/updateMany/findOneAndUpdate/deleteOne/deleteMany
//         are also scoped, so cross-tenant mutations are impossible.
//       - New documents (save / insertMany) are stamped with the
//         current storeId when the field is missing.
//       - Populated sub-queries run inside the same async context and
//         are therefore filtered too (no cross-tenant data leaks).
//   • When the context is a super-admin (`isSuper`) or absent
//     (public routes like login), queries run unfiltered — exactly like
//     the pre-SaaS behaviour.
//
// Aggregates are NOT auto-filtered (they take raw pipelines); aggregate
// call sites add `$match: tenantScope()` explicitly (see reportController).
const { getTenantContext } = require('../services/tenantContext');

function tenantPlugin(schema) {
    const hasField = schema.pathType('storeId') !== 'adhocOrMissing' || !!schema.obj.storeId;
    if (!hasField) return; // model opted out (e.g. platform-level collections)

    const STORE_ID_PATH = 'storeId';

    // ---------- helpers ----------
    function ctxFilter() {
        const ctx = getTenantContext();
        if (!ctx || ctx.isSuper || !ctx.storeId) return null;
        return { [STORE_ID_PATH]: ctx.storeId };
    }

    function injectFilter(query) {
        const extra = ctxFilter();
        if (!extra) return;
        const current = query.getFilter() || {};
        if (current[STORE_ID_PATH] === undefined) {
            query.where(STORE_ID_PATH).equals(extra[STORE_ID_PATH]);
        }
    }

    // ---------- query middleware: reads ----------
    for (const op of ['find', 'findOne', 'findOneAndDelete', 'findOneAndRemove', 'findOneAndReplace', 'findOneAndUpdate', 'count', 'countDocuments', 'estimatedDocumentCount', 'distinct']) {
        schema.pre(op, function (next) {
            injectFilter(this);
            next();
        });
    }
    schema.pre(['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne'], function (next) {
        injectFilter(this);
        next();
    });

    // ---------- document middleware: writes ----------
    // NOTE: storeId has schema default `null`, so it is NEVER undefined on a
    // hydrated doc — the check must treat null as "not yet stamped" too.
    schema.pre('validate', function (next) {
        if (this.isNew && (this[STORE_ID_PATH] === undefined || this[STORE_ID_PATH] === null)) {
            const ctx = getTenantContext();
            if (ctx && ctx.storeId) this[STORE_ID_PATH] = ctx.storeId;
        }
        next();
    });

    schema.pre('insertMany', function (next, docs) {
        const ctx = getTenantContext();
        if (ctx && ctx.storeId && Array.isArray(docs)) {
            docs.forEach(d => {
                if (d && (d[STORE_ID_PATH] === undefined || d[STORE_ID_PATH] === null)) d[STORE_ID_PATH] = ctx.storeId;
            });
        }
        next();
    });
}

/**
 * Build a `$match` stage (or plain filter object) honouring the current
 * tenant context. Use at the start of aggregate pipelines and for
 * hand-rolled queries:
 *   Sale.aggregate([{ $match: { ...tenantScope(), saleDate: { $gte: from } } }, ...])
 */
function tenantScope() {
    const ctx = getTenantContext();
    if (!ctx || ctx.isSuper || !ctx.storeId) return {};
    return { storeId: ctx.storeId };
}

module.exports = tenantPlugin;
module.exports.tenantPlugin = tenantPlugin;
module.exports.tenantScope = tenantScope;
