// backend/scripts/migrate_saas.js
// DZ POS PRO v3 — One-shot migration from single-store to multi-tenant SaaS.
//
// What it does (idempotent):
//   1. Creates the default Store from the existing Setting.storeName
//      (or SEED_STORE_NAME env / "DZ POS PRO").
//   2. Stamps storeId onto every existing business document.
//   3. Promotes SEED_SUPERADMIN_EMAIL (default super@dzpos.pro) to
//      superadmin — creating the account if missing (password printed once
//      if generated, or SEED_SUPERADMIN_PASSWORD).
//   4. Drops obsolete global-unique indexes and creates per-store compound
//      indexes (barcode, sku, saleNumber, phone, code, orderNumber, returnNumber).
//   5. Ensures default alert configs for the store.
//
// Run AFTER deploying v3 code once:  node scripts/migrate_saas.js
require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { runWithTenant } = require('../services/tenantContext');
const { ensureConfigs } = require('../services/alertEngine');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dz_pos_pro';

const {
    User, Product, Category, Customer, Supplier, Sale, SaleItem,
    PurchaseOrder, Return, Coupon, InventoryMovement, Session, Setting,
    Notification, AlertConfig, AuditLog, AIUsage, PushSubscription, Store
} = require('../models');

const SCOPED = [
    ['User', User], ['Product', Product], ['Category', Category],
    ['Customer', Customer], ['Supplier', Supplier], ['Sale', Sale],
    ['SaleItem', SaleItem], ['PurchaseOrder', PurchaseOrder], ['Return', Return],
    ['Coupon', Coupon], ['InventoryMovement', InventoryMovement],
    ['Session', Session], ['Setting', Setting], ['Notification', Notification],
    ['AlertConfig', AlertConfig], ['AuditLog', AuditLog], ['AIUsage', AIUsage],
    ['PushSubscription', PushSubscription]
];

const INDEX_FIXES = [
    { model: Product, drop: 'barcode_1', compound: { storeId: 1, barcode: 1 }, opts: { unique: true, sparse: true } },
    { model: Product, drop: 'sku_1', compound: { storeId: 1, sku: 1 }, opts: { unique: true, sparse: true } },
    { model: Sale, drop: 'saleNumber_1', compound: { storeId: 1, saleNumber: 1 }, opts: { unique: true } },
    { model: Customer, drop: 'phone_1', compound: { storeId: 1, phone: 1 }, opts: { unique: true } },
    { model: Coupon, drop: 'code_1', compound: { storeId: 1, code: 1 }, opts: { unique: true } },
    { model: PurchaseOrder, drop: 'orderNumber_1', compound: { storeId: 1, orderNumber: 1 }, opts: { unique: true } },
    { model: Return, drop: 'returnNumber_1', compound: { storeId: 1, returnNumber: 1 }, opts: { unique: true, sparse: true } }
];

async function main() {
    await mongoose.connect(MONGO_URI);
    logger.info('Connected — starting SaaS migration…');

    // 1) default store
    let store = await Store.findOne({}).sort({ createdAt: 1 });
    if (!store) {
        const setting = await Setting.findOne({}).lean();
        const name = process.env.SEED_STORE_NAME || (setting && setting.storeName) || 'DZ POS PRO';
        store = await Store.create({
            name,
            plan: process.env.SEED_STORE_PLAN || 'pro',
            status: 'active',
            notes: 'Default store created by SaaS migration'
        });
        logger.info(`Created default store: "${store.name}" (${store._id})`);
    } else {
        logger.info(`Using existing store: "${store.name}" (${store._id})`);
    }
    const storeId = store._id;

    // 2) stamp storeId on legacy documents (store-scoped context so plugin also stamps)
    await runWithTenant({ storeId, isSuper: false }, async () => {
        for (const [name, Model] of SCOPED) {
            const r = await Model.updateMany(
                { $or: [{ storeId: { $exists: false } }, { storeId: null }] },
                { $set: { storeId } }
            );
            if (r.modifiedCount) logger.info(`  ${name}: ${r.modifiedCount} doc(s) stamped`);
        }
    });

    // 3) super-admin account
    const superEmail = (process.env.SEED_SUPERADMIN_EMAIL || 'super@dzpos.pro').toLowerCase();
    let superUser = await User.findOne({ email: superEmail });
    if (!superUser) {
        const pwd = process.env.SEED_SUPERADMIN_PASSWORD || ('Super@' + Math.random().toString(36).slice(2, 10) + '1');
        superUser = await User.create({
            name: process.env.SEED_SUPERADMIN_NAME || 'Platform Super Admin',
            email: superEmail,
            password: pwd,
            role: 'superadmin',
            storeId: null
        });
        logger.info('=========================================================');
        logger.info(`SUPER-ADMIN CREATED — email: ${superEmail}  password: ${pwd}`);
        logger.info('(change this password after first login)');
        logger.info('=========================================================');
    } else if (superUser.role !== 'superadmin') {
        superUser.role = 'superadmin';
        await superUser.save();
        logger.info(`Promoted ${superEmail} to superadmin.`);
    } else {
        logger.info(`Super-admin ${superEmail} already exists.`);
    }

    // 4) index fixes (drop obsolete global uniques, add per-store compounds)
    for (const fix of INDEX_FIXES) {
        try {
            await fix.model.collection.dropIndex(fix.drop).catch(() => {});
        } catch (_) {}
        try {
            await fix.model.collection.createIndex(fix.compound, fix.opts);
            logger.info(`Index ensured: ${fix.model.collection.name} ${JSON.stringify(fix.compound)}`);
        } catch (err) {
            logger.warn(`Index ${JSON.stringify(fix.compound)} on ${fix.model.collection.name}: ${err.message}`);
        }
    }

    // 5) default alert configs
    try {
        await ensureConfigs(storeId);
        logger.info('Alert configs ensured.');
    } catch (err) {
        logger.warn('Alert config bootstrap:', err.message);
    }

    logger.info('✅ SaaS migration complete.');
    await mongoose.disconnect();
}

main().catch(async (err) => {
    logger.error('Migration failed:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
