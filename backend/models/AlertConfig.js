// backend/models/AlertConfig.js — configurable smart alerts (per store).
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const alertConfigSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    type: {
        type: String,
        enum: ['lowStock', 'zeroSalesDay', 'dailyTarget', 'anomalyScan', 'dailySummary'],
        required: true
    },
    enabled: { type: Boolean, default: true },
    // Generic threshold meaning depends on type:
    //   lowStock → stock level trigger (0 = use per-product minStock)
    //   zeroSalesDay → hours after last sale before alerting
    //   dailyTarget → target revenue in DZD per day
    //   anomalyScan → sensitivity 1..3 (1 = low, 3 = high)
    //   dailySummary → hour of day (0-23) to send the AI summary
    threshold: { type: Number, default: 0 },
    notifyRoles: { type: [String], enum: ['admin', 'manager', 'cashier'], default: ['admin', 'manager'] },
    pushEnabled: { type: Boolean, default: true },
    lastTriggeredAt: { type: Date, default: null }
}, { timestamps: true });

alertConfigSchema.index({ storeId: 1, type: 1 }, { unique: true });
alertConfigSchema.plugin(tenantPlugin);

module.exports = mongoose.model('AlertConfig', alertConfigSchema);
