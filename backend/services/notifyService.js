// backend/services/notifyService.js
// DZ POS PRO v3 — Unified notification pipeline:
//   1. Persist a Notification document (store-scoped)
//   2. Emit real-time socket event to the store room (in-platform, instant)
//   3. Send Web Push (VAPID) to subscribed devices → works in background,
//      with the screen off, and even when the browser is closed (installed PWA)
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const logger = require('../utils/logger');

/**
 * Create + broadcast a notification.
 * @param {object} opts
 *   storeId     — tenant id (required for store notifications)
 *   type        — info|success|warning|error|ai|alert|backup|anomaly
 *   title, body — strings (already localized by caller)
 *   link        — optional in-app link (e.g. "ai")
 *   data        — optional payload
 *   audienceRoles — optional role filter ['admin','manager']
 *   user        — optional single-user target
 *   push        — send web push? (default true)
 */
async function notifyStore(opts) {
    const {
        storeId, type = 'info', title = '', body = '', link = '', data = {},
        audienceRoles = null, user = null, push = true
    } = opts;

    let doc = null;
    try {
        doc = await Notification.create({
            storeId: storeId || null, type, title, body, link, data,
            audienceRoles: audienceRoles || undefined,
            user: user || undefined
        });
    } catch (err) {
        logger.warn('notifyStore persist failed:', err.message);
    }

    const payload = {
        _id: doc ? doc._id : null,
        type, title, body, link, data,
        createdAt: (doc && doc.createdAt) || new Date().toISOString()
    };

    // ---- 1. real-time socket ----
    try {
        const io = global.__io;
        if (io) {
            if (user) io.to(`user_${user}`).emit('notification', payload);
            else if (storeId) {
                const room = `store_${storeId}`;
                if (audienceRoles && audienceRoles.length) {
                    io.to(room).emit('notification', { ...payload, _audienceRoles: audienceRoles });
                } else {
                    io.to(room).emit('notification', payload);
                }
            } else {
                io.emit('notification', payload);
            }
        }
    } catch (err) {
        logger.warn('notifyStore socket emit failed:', err.message);
    }

    // ---- 2. web push ----
    if (push !== false) {
        try {
            const filter = { };
            if (user) filter.user = user;
            else if (storeId) filter.storeId = storeId;
            if (audienceRoles && audienceRoles.length && !user) {
                // role filtering happens after fetch (subscription docs store userId)
            }
            const subs = await PushSubscription.find(filter).limit(500);
            const pushService = require('./pushService');
            let sent = 0;
            for (const sub of subs) {
                if (audienceRoles && audienceRoles.length) {
                    // resolve role cheaply via user cache on doc population
                    await sub.populate('user', 'role');
                    if (!sub.user || !audienceRoles.includes(sub.user.role)) continue;
                }
                const ok = await pushService.sendToSubscription(sub, {
                    title: title || 'DZ POS PRO',
                    body: body || '',
                    tag: type || 'dzpos',
                    url: link ? `dashboard.html#${link}` : 'dashboard.html'
                });
                if (ok) sent++;
            }
            if (doc) { doc.pushed = sent > 0; await doc.save().catch(() => {}); }
        } catch (err) {
            logger.warn('notifyStore push failed:', err.message);
        }
    }

    return payload;
}

module.exports = { notifyStore };
