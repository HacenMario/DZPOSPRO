// backend/services/pushService.js
// DZ POS PRO v3 — Web Push (VAPID) sender.
// VAPID keys are auto-generated on first use and stored in PlatformSetting
// ("vapidKeys") so no manual setup is required. They can also be provided
// via env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
const webpush = require('web-push');
const PlatformSetting = require('../models/PlatformSetting');
// v4.2.1b — REQUIRED: the stale-subscription cleanup (404/410) below calls
// PushSubscription.deleteOne; without this import it threw a ReferenceError
// that bubbled up as HTTP 500 "Server error" on POST /api/push/test.
const PushSubscription = require('../models/PushSubscription');
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
 * Send one push. Returns true on success; removes stale subscriptions.
 * v4.3.1 — cleanup covers EVERY permanent failure, not only 404/410:
 *   404/410 → subscription gone (expired/uninstalled)
 *   401     → VAPID auth rejected (keys rotated on the server)
 *   403     → registration no longer valid / sender mismatch (permanent)
 *   400     → malformed subscription (invalid keys)
 * Keeping those rows alive made every future broadcast waste time on
 * doomed endpoints — a real part of "notifications stopped working".
 * Transient failures (429 rate-limit, 5xx, network) are retried later and
 * the subscription is kept.
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
        if ([400, 401, 403, 404, 410].includes(status)) {
            // permanently dead subscription — clean up so it never blocks again
            PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
            logger.info(`Push subscription removed (${status}): ${String(sub.endpoint).slice(0, 60)}`);
        } else {
            logger.warn(`Push to ${String(sub.endpoint).slice(0, 60)} failed: ${status || ''} ${err.message}`);
        }
        return false;
    }
}

module.exports = { ensureVapidKeys, getPublicKey, sendToSubscription };
