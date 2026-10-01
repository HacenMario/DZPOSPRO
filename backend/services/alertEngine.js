// backend/services/alertEngine.js
// DZ POS PRO v3 — Smart alerts engine.
// Runs on schedule (hourly checks + daily scans) and on demand.
// All alerts flow through notifyStore → in-app + socket + web push.
const cron = require('node-cron');
const Store = require('../models/Store');
const AlertConfig = require('../models/AlertConfig');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const logger = require('../utils/logger');
const { notifyStore } = require('./notifyService');

const L = {
    lowStock: {
        ar: (n) => ({ title: '📦 مخزون منخفض', body: `${n} منتجاً وصلوا الحد الأدنى للمخزون — يُنصح بإعداد أمر شراء.` }),
        fr: (n) => ({ title: '📦 Stock faible', body: `${n} produit(s) ont atteint le seuil minimum — pensez à un bon de commande.` }),
        en: (n) => ({ title: '📦 Low stock', body: `${n} product(s) reached the minimum stock level — consider a purchase order.` })
    },
    zeroSales: {
        ar: { title: '🌤️ يوم بلا مبيعات', body: 'لم تُسجَّل أي مبيعات حتى الآن اليوم. تأكد من فتح الوردية.' },
        fr: { title: '🌤️ Journée sans ventes', body: 'Aucune vente enregistrée aujourd\'hui. Vérifiez qu\'une session est ouverte.' },
        en: { title: '🌤️ No sales today', body: 'No sales recorded so far today. Make sure a session is open.' }
    },
    target: {
        ar: (pct) => ({ title: '🎯 هدف اليوم', body: pct >= 100 ? `تم تحقيق هدف اليوم (${pct}%) 🎉` : `تحقق ${pct}% من هدف اليوم.` }),
        fr: (pct) => ({ title: '🎯 Objectif du jour', body: pct >= 100 ? `Objectif atteint (${pct}%) 🎉` : `${pct}% de l'objectif du jour réalisé.` }),
        en: (pct) => ({ title: '🎯 Daily target', body: pct >= 100 ? `Daily target reached (${pct}%) 🎉` : `${pct}% of today's target achieved.` })
    },
    summaryTitle: { ar: '🌙 ملخص اليوم الذكي', fr: '🌙 Résumé intelligent du jour', en: '🌙 Smart daily summary' }
};

function pick(lang) { return L[lang] ? lang : 'fr'; }

/** Default configs for a store (created lazily). */
async function ensureConfigs(storeId) {
    const defaults = [
        { type: 'lowStock', threshold: 0 },
        { type: 'zeroSalesDay', threshold: 18 },   // alert if no sale by 18:00
        { type: 'dailyTarget', threshold: 0 },     // 0 = disabled target
        { type: 'anomalyScan', threshold: 2 },
        { type: 'dailySummary', threshold: 20 }    // 20:00
    ];
    for (const d of defaults) {
        await AlertConfig.findOneAndUpdate(
            { storeId, type: d.type },
            { $setOnInsert: { storeId, type: d.type, threshold: d.threshold, enabled: d.type !== 'dailyTarget' } },
            { upsert: true }
        );
    }
    return AlertConfig.find({ storeId }).lean();
}

/** Low-stock check for one store. */
async function checkLowStock(store) {
    const cfg = await AlertConfig.findOne({ storeId: store._id, type: 'lowStock' }).lean();
    if (!cfg || !cfg.enabled) return;
    const products = await Product.find({ storeId: store._id }).lean().select('name stock minStock');
    const low = products.filter(p => p.stock <= (p.minStock || 0));
    if (!low.length) return;
    // avoid spamming: only if last trigger > 20h ago
    if (cfg.lastTriggeredAt && Date.now() - new Date(cfg.lastTriggeredAt).getTime() < 20 * 3600 * 1000) return;
    const lang = pick(store.settingsLang || 'fr');
    const msg = L.lowStock[lang](low.length);
    await notifyStore({ storeId: store._id, type: 'alert', ...msg, link: 'products', audienceRoles: cfg.notifyRoles });
    await AlertConfig.updateOne({ _id: cfg._id }, { lastTriggeredAt: new Date() });
}

/** Zero-sales-day check (hourly; only triggers inside [threshold-1h, threshold+3h] window). */
async function checkZeroSales(store) {
    const cfg = await AlertConfig.findOne({ storeId: store._id, type: 'zeroSalesDay' }).lean();
    if (!cfg || !cfg.enabled) return;
    const hour = new Date().getHours();
    const triggerHour = cfg.threshold || 18;
    if (hour < triggerHour || hour > triggerHour + 3) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const count = await Sale.countDocuments({ storeId: store._id, saleDate: { $gte: start }, status: { $nin: ['cancelled'] } });
    if (count > 0) return;
    if (cfg.lastTriggeredAt && Date.now() - new Date(cfg.lastTriggeredAt).getTime() < 12 * 3600 * 1000) return;
    const lang = pick(store.settingsLang || 'fr');
    const msg = L.zeroSales[lang];
    await notifyStore({ storeId: store._id, type: 'warning', ...msg, link: 'sales', audienceRoles: cfg.notifyRoles });
    await AlertConfig.updateOne({ _id: cfg._id }, { lastTriggeredAt: new Date() });
}

/** Daily target progress (evaluated at summary time). */
async function checkDailyTarget(store) {
    const cfg = await AlertConfig.findOne({ storeId: store._id, type: 'dailyTarget' }).lean();
    if (!cfg || !cfg.enabled || !cfg.threshold) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const agg = await Sale.aggregate([
        { $match: { storeId: store._id, saleDate: { $gte: start }, status: { $nin: ['cancelled'] } } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
    ]);
    const revenue = agg[0] ? agg[0].revenue : 0;
    const pct = Math.round((revenue / cfg.threshold) * 100);
    if (pct >= 100) {
        if (cfg.lastTriggeredAt && Date.now() - new Date(cfg.lastTriggeredAt).getTime() < 12 * 3600 * 1000) return;
    }
    const lang = pick(store.settingsLang || 'fr');
    const msg = L.target[lang](Math.min(pct, 999));
    await notifyStore({ storeId: store._id, type: pct >= 100 ? 'success' : 'info', ...msg, link: 'dashboard', audienceRoles: cfg.notifyRoles });
    await AlertConfig.updateOne({ _id: cfg._id }, { lastTriggeredAt: new Date() });
}

/** Run all hour-level checks for all active stores. */
async function runHourlyChecks() {
    try {
        const stores = await Store.find({ status: 'active' }).lean();
        for (const store of stores) {
            try {
                await checkLowStock(store);
                await checkZeroSales(store);
            } catch (err) {
                logger.warn(`Alert checks failed for store ${store._id}: ${err.message}`);
            }
        }
    } catch (err) {
        logger.error('runHourlyChecks failed:', err.message);
    }
}

/** Boot all schedules. Called from server.js after DB connect. */
function startAlertEngine({ onDailySummary }) {
    // Hourly smart checks (minute 7 to avoid the top-of-hour traffic)
    cron.schedule('7 * * * *', runHourlyChecks);

    // Daily summary + target — every hour calls the summary handler which
    // internally decides which stores are due (per-store configurable hour).
    if (onDailySummary) {
        cron.schedule('23 * * * *', async () => {
            try {
                const stores = await Store.find({ status: 'active' }).lean();
                const hour = new Date().getHours();
                for (const store of stores) {
                    const cfg = await AlertConfig.findOne({ storeId: store._id, type: 'dailySummary' }).lean();
                    if (!cfg || !cfg.enabled) continue;
                    const summaryHour = cfg.threshold || 20;
                    if (hour !== summaryHour) continue;
                    await onDailySummary(store);
                    await checkDailyTarget(store);
                }
            } catch (err) {
                logger.error('Daily summary cron failed:', err.message);
            }
        });
    }

    logger.info('Alert engine started (hourly checks + daily summary scheduler).');
}

module.exports = { startAlertEngine, runHourlyChecks, ensureConfigs };
