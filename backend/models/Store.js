// backend/models/Store.js
// DZ POS PRO v3 — Multi-tenant store (tenant) model.
const mongoose = require('mongoose');

const PLANS = ['trial', 'basic', 'pro', 'enterprise'];
const STATUSES = ['active', 'suspended'];

// v4.3 — paid-plan expiry enforcement grace period (days). A paid plan
// whose subscriptionEndsAt has passed keeps working for GRACE_DAYS before
// the tenant middleware starts blocking, so a late renewal never locks
// a real store out at midnight.
const GRACE_DAYS = 7;

const storeSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    ownerName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    address: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },

    plan: { type: String, enum: PLANS, default: 'trial' },
    status: { type: String, enum: STATUSES, default: 'active' },
    trialEndsAt: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 3600 * 1000) },

    // v4.3 — professional subscription lifecycle (paid plans)
    billingCycle: { type: String, enum: ['monthly', 'yearly', null], default: null },
    subscriptionStart: { type: Date, default: null },   // first paid activation
    subscriptionEndsAt: { type: Date, default: null },  // current paid period end
    planChangedAt: { type: Date, default: null },       // last plan/billing change
    planSource: { type: String, enum: ['system', 'request', 'manual'], default: 'system' },

    // Soft quotas (enforced by rate limiters / UI hints, not hard DB limits)
    limits: {
        maxUsers: { type: Number, default: 5, min: 1 },
        maxProducts: { type: Number, default: 2000, min: 1 },
        aiDailyCalls: { type: Number, default: 200, min: 0 }
    },

    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true }, // quick flag kept in sync with status
    suspendedReason: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

storeSchema.index({ name: 1 });
storeSchema.index({ status: 1 });

storeSchema.methods.isSubscriptionActive = function () {
    if (this.status === 'suspended') return false;
    if (this.plan === 'trial' && this.trialEndsAt && this.trialEndsAt < new Date()) return false;
    // v4.3 — paid plans expire after their period + grace window.
    // Legacy stores (no subscriptionEndsAt) are never blocked.
    if (this.plan !== 'trial' && this.subscriptionEndsAt) {
        const graceEnd = new Date(this.subscriptionEndsAt.getTime() + GRACE_DAYS * 24 * 3600 * 1000);
        if (graceEnd < new Date()) return false;
    }
    return true;
};

// v4.3 — days left in the current paid period (null when not applicable).
storeSchema.methods.daysLeft = function () {
    if (this.plan === 'trial') {
        if (!this.trialEndsAt) return null;
        return Math.ceil((this.trialEndsAt.getTime() - Date.now()) / 86400000);
    }
    if (!this.subscriptionEndsAt) return null; // legacy — no enforced expiry
    return Math.ceil((this.subscriptionEndsAt.getTime() - Date.now()) / 86400000);
};

storeSchema.methods.toPublicInfo = function () {
    return {
        id: this._id,
        name: this.name,
        plan: this.plan,
        status: this.status,
        trialEndsAt: this.trialEndsAt,
        limits: this.limits,
        // v4.3 — subscription details
        billingCycle: this.billingCycle || null,
        subscriptionStart: this.subscriptionStart || null,
        subscriptionEndsAt: this.subscriptionEndsAt || null,
        planChangedAt: this.planChangedAt || null,
        planSource: this.planSource || 'system',
        daysLeft: this.daysLeft()
    };
};

module.exports = mongoose.model('Store', storeSchema);
module.exports.PLANS = PLANS;
module.exports.STATUSES = STATUSES;
module.exports.GRACE_DAYS = GRACE_DAYS;
