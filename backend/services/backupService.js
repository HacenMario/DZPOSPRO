// backend/services/backupService.js
// DZ POS PRO v3 — Database backup system (weekly schedule + manual ops).
// Exports every collection as JSON inside a single .json archive file
// (gzip-compressed) under <project>/backups/. Retention keeps the newest
// N archives (default 12). Restore replaces collections' contents.
//
// NOTE (Railway): the filesystem is ephemeral — after a redeploy the local
// archives are gone. For durable storage, set BACKUP_UPLOAD_URL (POST the
// gzip file as multipart "file") or mount a volume and set BACKUP_DIR.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP, 10) || 12;

function ensureDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Collections exported for backups (platform + tenant data). */
function collectionNames() {
    return [
        'stores', 'users', 'settings', 'products', 'categories', 'customers',
        'suppliers', 'sales', 'saleitems', 'sessions', 'purchasesorders',
        'returns', 'coupons', 'inventorymovements', 'notifications',
        'alertconfigs', 'auditlogs', 'aiusages', 'platformsettings', 'backuprecords'
    ];
}

function modelFor(name) {
    const map = {
        stores: 'Store', users: 'User', settings: 'Setting', products: 'Product',
        categories: 'Category', customers: 'Customer', suppliers: 'Supplier',
        sales: 'Sale', saleitems: 'SaleItem', sessions: 'Session',
        purchasesorders: 'PurchaseOrder', returns: 'Return', coupons: 'Coupon',
        inventorymovements: 'InventoryMovement', notifications: 'Notification',
        alertconfigs: 'AlertConfig', auditlogs: 'AuditLog', aiusages: 'AIUsage',
        platformsettings: 'PlatformSetting', backuprecords: 'BackupRecord'
    };
    const m = map[name];
    return m ? mongoose.models[m] || mongoose.model(m) : null;
}

/** Create a full backup. Returns BackupRecord doc. */
async function createBackup(trigger = 'auto-weekly', userId = null) {
    ensureDir();
    const started = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `dzpospro-backup-${stamp}.json.gz`;
    const outPath = path.join(BACKUP_DIR, filename);

    const dump = { meta: { app: 'DZ POS PRO', version: 3, createdAt: new Date().toISOString(), trigger }, collections: {} };
    const names = collectionNames();
    let docsCount = 0;
    const usedNames = [];

    for (const name of names) {
        const Model = modelFor(name);
        if (!Model) continue;
        try {
            const docs = await Model.find({}).lean().maxTimeMS(120000);
            if (docs.length) {
                dump.collections[name] = docs;
                usedNames.push(name);
                docsCount += docs.length;
            }
        } catch (err) {
            logger.warn(`Backup: skip ${name}: ${err.message}`);
        }
    }

    const json = JSON.stringify(dump);
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));
    fs.writeFileSync(outPath, gz);

    // optional off-site upload
    let uploadInfo = null;
    if (process.env.BACKUP_UPLOAD_URL) {
        try {
            let FormData = null;
            try { FormData = require('form-data'); } catch (_) {}
            if (!FormData) throw new Error('form-data package not installed');
            const axios = require('axios');
            const form = new FormData();
            form.append('file', fs.createReadStream(outPath));
            const resp = await axios.post(process.env.BACKUP_UPLOAD_URL, form, { headers: form.getHeaders(), timeout: 120000 });
            uploadInfo = { status: resp.status };
        } catch (err) {
            uploadInfo = { error: err.message };
            logger.warn('Backup upload failed:', err.message);
        }
    }

    const BackupRecord = require('../models/BackupRecord');
    const rec = await BackupRecord.create({
        filename,
        size: gz.length,
        collections: usedNames,
        docsCount,
        storesCount: (dump.collections.stores || []).length,
        trigger,
        status: 'done',
        createdBy: userId
    });

    logger.info(`Backup created: ${filename} (${(gz.length / 1024).toFixed(1)} KB, ${docsCount} docs, ${Date.now() - started}ms)`);
    await enforceRetention();
    return rec;
}

/** Keep only the newest KEEP backups. */
async function enforceRetention() {
    ensureDir();
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('dzpospro-backup-') && f.endsWith('.json.gz'))
        .sort().reverse();
    for (const f of files.slice(KEEP)) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
    }
}

function listBackups() {
    ensureDir();
    return fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('dzpospro-backup-') && f.endsWith('.json.gz'))
        .map(f => {
            const st = fs.statSync(path.join(BACKUP_DIR, f));
            return { filename: f, size: st.size, createdAt: st.mtime };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

function backupPath(filename) {
    const safe = path.basename(filename); // prevent traversal
    const p = path.join(BACKUP_DIR, safe);
    if (!fs.existsSync(p)) return null;
    return p;
}

/**
 * Restore from a backup file. DANGEROUS — replaces collection contents.
 * @param {string} filename backup filename in the backups dir
 * @param {object} opts { collections: [..] } optional subset
 */
async function restoreBackup(filename, opts = {}) {
    const p = backupPath(filename);
    if (!p) throw new Error('BACKUP_NOT_FOUND');
    const gz = fs.readFileSync(p);
    const json = zlib.gunzipSync(gz).toString('utf8');
    const dump = JSON.parse(json);
    const wanted = opts.collections && opts.collections.length ? opts.collections : Object.keys(dump.collections || {});
    const restored = {};
    for (const name of wanted) {
        const docs = dump.collections[name];
        if (!docs) continue;
        const Model = modelFor(name);
        if (!Model) continue;
        try {
            await Model.deleteMany({});
            if (docs.length) await Model.insertMany(docs, { ordered: false });
            restored[name] = docs.length;
        } catch (err) {
            logger.error(`Restore ${name} failed:`, err.message);
            restored[name] = `error: ${err.message}`;
        }
    }
    return { restored, meta: dump.meta };
}

module.exports = { createBackup, listBackups, backupPath, restoreBackup, BACKUP_DIR };
