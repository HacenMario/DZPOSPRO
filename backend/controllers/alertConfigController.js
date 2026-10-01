// backend/controllers/alertConfigController.js — smart alerts configuration.
const AlertConfig = require('../models/AlertConfig');
const { ensureConfigs } = require('../services/alertEngine');
const { successResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');

// GET /api/alerts — list (auto-seeds defaults)
const list = async (req, res, next) => {
    try {
        const data = await ensureConfigs(req.storeId);
        return successResponse(res, { data });
    } catch (err) { next(err); }
};

// PUT /api/alerts/:type  { enabled, threshold, notifyRoles, pushEnabled }
const update = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { type } = req.params;
        const valid = ['lowStock', 'zeroSalesDay', 'dailyTarget', 'anomalyScan', 'dailySummary'];
        if (!valid.includes(type)) return errorResponse(res, 400, getTranslation('missingFields', lang));
        await ensureConfigs(req.storeId);
        const cfg = await AlertConfig.findOne({ storeId: req.storeId, type });
        if (!cfg) return errorResponse(res, 404, getTranslation('notFound', lang));
        const { enabled, threshold, notifyRoles, pushEnabled } = req.body || {};
        if (enabled !== undefined) cfg.enabled = !!enabled;
        if (threshold !== undefined) cfg.threshold = Number(threshold) || 0;
        if (Array.isArray(notifyRoles)) cfg.notifyRoles = notifyRoles.filter(r => ['admin', 'manager', 'cashier'].includes(r));
        if (pushEnabled !== undefined) cfg.pushEnabled = !!pushEnabled;
        await cfg.save();
        return successResponse(res, cfg, getTranslation('saved', lang));
    } catch (err) { next(err); }
};

module.exports = { list, update };
