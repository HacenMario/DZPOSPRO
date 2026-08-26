// backend/models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    userRole: { type: String, default: 'cashier' },

    openingBalance: { type: Number, default: 0, min: 0 },
    closingBalance: { type: Number, default: 0, min: 0 },

    totalSales: { type: Number, default: 0 },
    totalDiscount: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    saleCount: { type: Number, default: 0 },

    cashSales: { type: Number, default: 0 },
    cardSales: { type: Number, default: 0 },
    transferSales: { type: Number, default: 0 },

    expectedCash: { type: Number, default: 0 },
    actualCash: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },

    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date },

    notes: { type: String, default: '' }
}, { timestamps: true });

sessionSchema.index({ user: 1, status: 1 });
sessionSchema.index({ openedAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);
