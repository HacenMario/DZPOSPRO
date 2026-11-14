// backend/controllers/settingController.js
const Setting = require('../models/Setting');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

// GET /api/settings
const getSettings = async (req, res, next) => {
    try {
        // v4.4 — the platform owner is INDEPENDENT of any store: without a
        // store focus he reads the PLATFORM settings document (storeId null)
        // explicitly, never a random store's document; with a focus (via
        // X-Store-Id) he reads exactly that store's settings.
        if (req.user && req.user.role === 'superadmin') {
            const focusId = req.storeFocus || null;
            let setting = await Setting.findOne({ storeId: focusId || null });
            if (!setting) setting = await Setting.create({ storeId: focusId || null });
            return successResponse(res, { settings: setting });
        }
        let setting = await Setting.findOne();
        if (!setting) {
            setting = await Setting.create({});
        }
        return successResponse(res, { settings: setting });
    } catch (err) {
        logger.error('getSettings error:', err.message);
        next(err);
    }
};

// PUT /api/settings  (admin)
const updateSetting = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const updates = { ...req.body };

        // Strip protected fields
        ['_id', '__v', 'createdAt', 'updatedAt'].forEach(k => delete updates[k]);

        // Normalize the invoice primary color (defensive — schema also trims).
        // Accept either with or without the leading '#'; we store as-is.
        if ('invoicePrimaryColor' in updates && typeof updates.invoicePrimaryColor === 'string') {
            updates.invoicePrimaryColor = updates.invoicePrimaryColor.trim();
        }

        if (Object.keys(updates).length === 0) {
            return errorResponse(res, 400, getTranslation('noUpdateData', lang));
        }

        // Flatten nested companyInfo into $set keys
        const setOps = {};
        Object.entries(updates).forEach(([k, v]) => {
            if (k === 'companyInfo' && v && typeof v === 'object') {
                Object.entries(v).forEach(([sub, val]) => {
                    setOps[`companyInfo.${sub}`] = val;
                });
            } else {
                setOps[k] = v;
            }
        });

        // v4.4 — super-admin writes target the PLATFORM settings document
        // (storeId null) or the focused store's document, never a random one.
        // Store users keep the tenant-plugin scoped behaviour untouched.
        const filter = (req.user && req.user.role === 'superadmin')
            ? { storeId: (req.storeFocus && String(req.storeFocus)) || null }
            : {};
        const setting = await Setting.findOneAndUpdate(
            filter,
            { $set: setOps },
            { new: true, upsert: true, runValidators: true }
        );

        return successResponse(res, { settings: setting }, getTranslation('settingsSaved', lang));
    } catch (err) {
        logger.error('updateSetting error:', err.message);
        next(err);
    }
};

module.exports = { getSettings, updateSetting };

/* ============================================================
 * v3 — Platform AI settings (super-admin / store admin)
 * ============================================================ */
const PlatformSetting = require('../models/PlatformSetting');

// POST /api/settings/gemini-key  { key }
const setGeminiKey = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const key = String((req.body && req.body.key) || '').trim();
        if (!key) return errorResponse(res, 400, getTranslation('missingFields', lang));
        await PlatformSetting.set('geminiApiKey', key);
        return successResponse(res, { ok: true }, getTranslation('saved', lang));
    } catch (err) { next(err); }
};

// GET /api/settings/gemini-key-status
const getGeminiKeyStatus = async (req, res, next) => {
    try {
        const key = await PlatformSetting.get('geminiApiKey');
        return successResponse(res, { configured: !!key, source: key ? 'platform' : (process.env.GEMINI_API_KEY ? 'env' : 'none') });
    } catch (err) { next(err); }
};

/* ============================================================
 * v4.5 — Controlcaisse cash denominations
 *   GET  /api/settings/cash-denominations
 *        → the effective list for THIS store (or the platform doc for
 *          the super-admin without focus).
 *   PUT  /api/settings/cash-denominations { denominations:[{value,type}], applyToAll }
 *        • store admin → saves into HIS store's settings
 *        • super-admin → saves into the platform document, and with
 *          applyToAll:true ALSO writes the same list into EVERY store's
 *          settings (automatic platform-wide push after save).
 * ============================================================ */
const getCashDenominations = async (req, res, next) => {
    try {
        const filter = (req.user && req.user.role === 'superadmin')
            ? { storeId: (req.storeFocus && String(req.storeFocus)) || null }
            : {};
        let setting = await Setting.findOne(filter).select('cashDenominations').lean();
        if (!setting) {
            const created = await Setting.create({ storeId: (req.user && req.user.role === 'superadmin') ? (req.storeFocus || null) : undefined });
            setting = { cashDenominations: created.cashDenominations || [] };
        }
        return successResponse(res, { denominations: (setting.cashDenominations || []).map(d => ({ value: d.value, type: d.type })) });
    } catch (err) { next(err); }
};

const updateCashDenominations = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const raw = (req.body && req.body.denominations) || [];
        // normalize + validate: positive values, dedup, sorted desc
        const seen = new Set();
        const list = [];
        for (const d of Array.isArray(raw) ? raw : []) {
            const value = Math.round(Number(d && d.value));
            if (!Number.isFinite(value) || value <= 0) continue;
            if (seen.has(value)) continue;
            seen.add(value);
            list.push({ value, type: d.type === 'coin' ? 'coin' : 'bill' });
        }
        list.sort((a, b) => b.value - a.value);

        const isSuper = req.user && req.user.role === 'superadmin';
        const applyToAll = !!(req.body && req.body.applyToAll);

        if (isSuper) {
            // platform document (storeId null) or the focused store
            const focus = req.storeFocus || null;
            await Setting.findOneAndUpdate(
                { storeId: focus ? String(focus) : null },
                { $set: { cashDenominations: list } },
                { new: true, upsert: true, runValidators: true }
            );
            let appliedStores = 0;
            if (applyToAll && !focus) {
                // v4.5 — one save → ALL stores get the same denominations
                const resAll = await Setting.updateMany(
                    { storeId: { $ne: null } },
                    { $set: { cashDenominations: list } }
                );
                appliedStores = resAll.modifiedCount || resAll.nModified || 0;
            }
            return successResponse(res, { denominations: list, appliedToAllStores: applyToAll ? appliedStores : null }, getTranslation('saved', lang));
        }

        // store admin — his own (tenant plugin scopes the query automatically)
        await Setting.findOneAndUpdate(
            {},
            { $set: { cashDenominations: list } },
            { new: true, upsert: true, runValidators: true }
        );
        return successResponse(res, { denominations: list }, getTranslation('saved', lang));
    } catch (err) { next(err); }
};

module.exports.setGeminiKey = setGeminiKey;
module.exports.getGeminiKeyStatus = getGeminiKeyStatus;
module.exports.getCashDenominations = getCashDenominations;
module.exports.updateCashDenominations = updateCashDenominations;
