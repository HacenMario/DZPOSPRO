// backend/models/Plan.js
// DZ POS PRO v4.5 — Dynamic subscription plan catalog.
// The super-admin edits EVERYTHING from the platform console: plan name,
// monthly / yearly price, limits, visibility. Seeded from config/plans.js
// on first boot (planService.ensureSeeded). Currency stays DZD.
const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    key:        { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
    name:       { type: String, required: true, trim: true, maxlength: 60 },   // display name (any language)
    monthly:    { type: Number, required: true, min: 0, default: 0 },          // price for 1 month (DZD)
    yearly:     { type: Number, required: true, min: 0, default: 0 },          // price for 12 months (DZD)
    maxUsers:   { type: Number, min: 1, default: 5 },
    maxProducts:{ type: Number, min: 1, default: 2000 },
    aiDailyCalls:{ type: Number, min: 0, default: 200 },
    isTrial:    { type: Boolean, default: false },                              // trial → no payment flow
    active:     { type: Boolean, default: true },                               // hidden from the store catalog when false
    badge:      { type: String, default: 'badge-info', trim: true },
    sortOrder:  { type: Number, default: 0 },
    description:{ type: String, default: '', trim: true, maxlength: 300 }
}, { timestamps: true });

planSchema.statics.toPublic = function (doc) {
    if (!doc) return null;
    return {
        id: doc._id, key: doc.key, name: doc.name,
        monthly: doc.monthly, yearly: doc.yearly,
        maxUsers: doc.maxUsers, maxProducts: doc.maxProducts, aiDailyCalls: doc.aiDailyCalls,
        isTrial: !!doc.isTrial, active: !!doc.active,
        badge: doc.badge || 'badge-info', sortOrder: doc.sortOrder || 0,
        description: doc.description || ''
    };
};

module.exports = mongoose.model('Plan', planSchema);
