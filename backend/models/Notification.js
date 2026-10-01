// backend/models/Notification.js — in-app + push notification centre (per store).
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const notificationSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    // null audience = everyone in the store; otherwise restrict by roles/user
    audienceRoles: [{ type: String, enum: ['admin', 'manager', 'cashier'] }],
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // targeted single user

    type: { type: String, enum: ['info', 'success', 'warning', 'error', 'ai', 'alert', 'backup', 'anomaly'], default: 'info' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // optional payload (link, ids…)
    link: { type: String, default: '' },                       // e.g. "#/ai"

    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pushed: { type: Boolean, default: false }
}, { timestamps: true });

notificationSchema.index({ createdAt: -1 });
notificationSchema.plugin(tenantPlugin);

notificationSchema.methods.isReadBy = function (userId) {
    return this.readBy.some(id => String(id) === String(userId));
};

module.exports = mongoose.model('Notification', notificationSchema);
