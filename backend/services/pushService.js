// backend/services/pushService.js
// DZ POS PRO v3 — Web Push (VAPID) sender.
// VAPID keys are auto-generated on first use and stored in PlatformSetting
// ("vapidKeys") so no manual setup is required. They can also be provided
// via env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
const webpush = require('web-push');
const PlatformSetting = require('../models/PlatformSetting');
const logger = require('../utils/logger');

let configured = false;

async function ensureVapidKeys() {
    if (configured) return;
    try {
        let keys = await PlatformSetting.get('vapidKeys');
        if (!keys || !keys.publicKey || !keys.privateKey) {
            if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
                keys = {
                    publicKey: process.env.VAPID_PUBLIC_KEY,
                    privateKey: process.env.VAPID_PRIVATE_KEY
                };
            } else {
                keys = webpush.generateVAPIDKeys();
                logger.info('Generated new VAPID keys for Web Push.');
            }
            await PlatformSetting.set('vapidKeys', keys);
        }
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:contact@dzpospro.com',
            keys.publicKey,
            keys.privateKey
        );
        configured = true;
    } catch (err) {
        logger.error('VAPID init failed:', err.message);
    }
}

async function getPublicKey() {
    await ensureVapidKeys();
    const keys = await PlatformSetting.get('vapidKeys');
    return keys ? keys.publicKey : null;
}

/**
 * Send one push. Returns true on success; removes stale subscriptions (404/410).
 */
async function sendToSubscription(sub, payload) {
    await ensureVapidKeys();
    if (!configured) return false;
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys || {} },
            JSON.stringify(payload),
            { TTL: 3600 * 24 }
        );
        return true;
    } catch (err) {
        const status = err.statusCode;
        if (status === 404 || status === 410) {
            // subscription expired — clean up
            PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
            logger.warn(`Push to ${String(sub.endpoint).slice(0, 60)} failed: ${status || ''} ${err.message}`);
        }
        return false;
    }
}

module.exports = { ensureVapidKeys, getPublicKey, sendToSubscription };
