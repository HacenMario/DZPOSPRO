// backend/models/AuditLog.js — DZ POS PRO v3 audit trail (per store).
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const auditLogSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    action: { type: String, enum: ['create', 'update', 'delete', 'login', 'logout', 'export', 'restore', 'ai', 'other'], default: 'other', index: true },
    entity: { type: String, default: '', index: true },     // e.g. "products", "sales"
    entityId: { type: String, default: '' },
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} }, // sanitized compact diff/summary
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.plugin(tenantPlugin);

module.exports = mongoose.model('AuditLog', auditLogSchema);
