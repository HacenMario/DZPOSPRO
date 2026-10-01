// backend/models/BackupRecord.js — weekly backups registry (platform-level).
const mongoose = require('mongoose');

const backupRecordSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    size: { type: Number, default: 0 },
    collections: [{ type: String }],
    storesCount: { type: Number, default: 0 },
    docsCount: { type: Number, default: 0 },
    trigger: { type: String, enum: ['auto-weekly', 'manual'], default: 'auto-weekly' },
    status: { type: String, enum: ['done', 'failed'], default: 'done' },
    error: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

backupRecordSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BackupRecord', backupRecordSchema);
