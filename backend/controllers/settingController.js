// backend/controllers/settingController.js
const Setting = require('../models/Setting');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

// GET /api/settings
const getSettings = async (req, res, next) => {
    try {
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

        const setting = await Setting.findOneAndUpdate(
            {},
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

module.exports.setGeminiKey = setGeminiKey;
module.exports.getGeminiKeyStatus = getGeminiKeyStatus;
