// backend/models/AIUsage.js — Gemini usage tracking + quota (per store, per day).
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const aiUsageSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    feature: { type: String, enum: ['ask', 'ocr', 'forecast', 'anomaly', 'summary'], default: 'ask' },
    model: { type: String, default: '' },
    ok: { type: Boolean, default: true },
    latencyMs: { type: Number, default: 0 }
}, { timestamps: true });

aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ storeId: 1, createdAt: 1 });
aiUsageSchema.plugin(tenantPlugin);

// Daily usage count helper
aiUsageSchema.statics.countToday = async function (storeId) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return this.countDocuments({ storeId, createdAt: { $gte: start } });
};

module.exports = mongoose.model('AIUsage', aiUsageSchema);
