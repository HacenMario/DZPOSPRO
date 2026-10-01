// backend/controllers/pushController.js — Web Push subscriptions (VAPID).
const PushSubscription = require('../models/PushSubscription');
const pushService = require('../services/pushService');
const { successResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');

// GET /api/push/public-key
const publicKey = async (req, res) => {
    const key = await pushService.getPublicKey();
    return successResponse(res, { publicKey: key });
};

// POST /api/push/subscribe  { endpoint, keys: {p256dh, auth} }
const subscribe = async (req, res, next) => {
    try {
        const { endpoint, keys } = req.body || {};
        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        }
        await PushSubscription.findOneAndUpdate(
            { endpoint },
            {
                endpoint,
                keys,
                user: req.userId,
                storeId: req.storeId,
                userAgent: (req.headers['user-agent'] || '').slice(0, 250),
                platform: req.body.platform || ''
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return successResponse(res, { ok: true });
    } catch (err) { next(err); }
};

// POST /api/push/unsubscribe  { endpoint }
const unsubscribe = async (req, res, next) => {
    try {
        const { endpoint } = req.body || {};
        if (!endpoint) return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        await PushSubscription.deleteOne({ endpoint, user: req.userId });
        return successResponse(res, { ok: true });
    } catch (err) { next(err); }
};

// POST /api/push/test — send a test push to my devices
const test = async (req, res, next) => {
    try {
        const subs = await PushSubscription.find({ user: req.userId }).limit(10);
        let sent = 0;
        for (const s of subs) {
            const ok = await pushService.sendToSubscription(s, {
                title: 'DZ POS PRO ✓',
                body: 'إشعارات الهاتف تعمل بنجاح / Les notifications fonctionnent !',
                tag: 'test', url: 'dashboard.html'
            });
            if (ok) sent++;
        }
        return successResponse(res, { sent, subscribed: subs.length });
    } catch (err) { next(err); }
};

module.exports = { publicKey, subscribe, unsubscribe, test };
