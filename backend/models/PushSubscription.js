// backend/models/PushSubscription.js — Web Push endpoints (VAPID) per user.
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const pushSubscriptionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    keys: {
        p256dh: { type: String, default: '' },
        auth: { type: String, default: '' }
    },
    userAgent: { type: String, default: '' },
    platform: { type: String, default: '' }   // Android / iOS / desktop…
}, { timestamps: true });

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.plugin(tenantPlugin);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
