// backend/controllers/backupController.js — super-admin backup operations.
const backupService = require('../services/backupService');
const BackupRecord = require('../models/BackupRecord');
const { notifyStore } = require('../services/notifyService');
const { successResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');

// POST /api/backups/now  (superadmin)
const createNow = async (req, res, next) => {
    try {
        const rec = await backupService.createBackup('manual', req.userId);
        await notifyStore({
            type: 'backup', push: false,
            title: '💾 Backup completed', body: `Backup "${rec.filename}" (${(rec.size / 1024).toFixed(1)} KB) created successfully.`
        });
        return successResponse(res, rec, 'Backup created');
    } catch (err) { next(err); }
};

// GET /api/backups  (superadmin)
const list = async (req, res, next) => {
    try {
        const files = backupService.listBackups();
        const records = await BackupRecord.find({}).sort({ createdAt: -1 }).limit(100).lean();
        const byName = new Map(records.map(r => [r.filename, r]));
        const data = files.map(f => ({
            ...f,
            trigger: (byName.get(f.filename) || {}).trigger || 'auto-weekly',
            docsCount: (byName.get(f.filename) || {}).docsCount || null,
            storesCount: (byName.get(f.filename) || {}).storesCount || null
        }));
        return successResponse(res, { data, dir: backupService.BACKUP_DIR });
    } catch (err) { next(err); }
};

// GET /api/backups/:filename/download  (superadmin)
const download = async (req, res) => {
    const p = backupService.backupPath(req.params.filename);
    if (!p) return errorResponse(res, 404, getTranslation('notFound', req.lang || 'ar'));
    res.download(p);
};

// POST /api/backups/restore  { filename, collections? }  (superadmin)
const restore = async (req, res, next) => {
    try {
        const { filename, collections } = req.body || {};
        if (!filename) return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        const result = await backupService.restoreBackup(filename, { collections });
        return successResponse(res, result, 'Restore completed');
    } catch (err) {
        if (err.message === 'BACKUP_NOT_FOUND') return errorResponse(res, 404, 'Backup not found');
        next(err);
    }
};

module.exports = { createNow, list, download, restore };
