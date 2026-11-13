// backend/models/SubscriptionRequest.js
// DZ POS PRO v4.3 — Subscription change / renewal requests.
// ------------------------------------------------------------------
// Lifecycle:  pending → approved | rejected | cancelled
//   • Store admin creates a request (plan + billing cycle + payment info)
//   • Super-admin confirms the payment → approves → the plan and the new
//     period are applied to the Store atomically
//   • Every APPROVED request doubles as a PAYMENT RECORD, which powers the
//     platform revenue statistics (collected / MRR / monthly series).
const mongoose = require('mongoose');

const TYPES = ['new', 'change', 'renewal'];
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const CYCLES = ['monthly', 'yearly'];
const PAYMENT_METHODS = ['ccp', 'baridimob', 'cash', 'bank_transfer', 'other', 'manual'];

const subscriptionRequestSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },          // denormalised for history

    type: { type: String, enum: TYPES, default: 'change' },   // new | change | renewal
    currentPlan: { type: String, default: '' },
    requestedPlan: { type: String, required: true },
    billingCycle: { type: String, enum: CYCLES, default: 'monthly' },
    amount: { type: Number, default: 0 },              // DZD — snapshot of plan price

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'other' },
    paymentReference: { type: String, default: '', trim: true },  // CCP / BaridiMob ref…
    storeNote: { type: String, default: '', trim: true, maxlength: 500 },

    status: { type: String, enum: STATUSES, default: 'pending', index: true },
    adminNote: { type: String, default: '', trim: true, maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    // filled on approval — payment record + applied period
    paidAmount: { type: Number, default: null },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    appliedPlan: { type: String, default: null }
}, { timestamps: true });

subscriptionRequestSchema.index({ status: 1, createdAt: -1 });
subscriptionRequestSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionRequest', subscriptionRequestSchema);
module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
module.exports.CYCLES = CYCLES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
