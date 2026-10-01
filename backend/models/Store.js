// backend/models/Store.js
// DZ POS PRO v3 — Multi-tenant store (tenant) model.
const mongoose = require('mongoose');

const PLANS = ['trial', 'basic', 'pro', 'enterprise'];
const STATUSES = ['active', 'suspended'];

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
    return true;
};

storeSchema.methods.toPublicInfo = function () {
    return {
        id: this._id,
        name: this.name,
        plan: this.plan,
        status: this.status,
        trialEndsAt: this.trialEndsAt,
        limits: this.limits
    };
};

module.exports = mongoose.model('Store', storeSchema);
module.exports.PLANS = PLANS;
module.exports.STATUSES = STATUSES;
