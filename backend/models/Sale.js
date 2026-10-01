// backend/models/Sale.js
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const saleSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    saleNumber: { type: String, required: true },
    saleDate: { type: Date, default: Date.now },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SaleItem' }],

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    timbre: { type: Number, default: 0, min: 0 },
    couponDiscount: { type: Number, default: 0, min: 0 },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    total: { type: Number, required: true, min: 0 },

    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'transfer', 'split'],
        default: 'cash'
    },
    splitPayment: {
        cash: { type: Number, default: 0 },
        card: { type: Number, default: 0 },
        transfer: { type: Number, default: 0 }
    },

    // 'returned' is added to the enum so the return flow can mark a sale as such.
    status: {
        type: String,
        enum: ['completed', 'pending', 'cancelled', 'returned'],
        default: 'completed'
    },
    notes: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

saleSchema.index({ session: 1, status: 1 });
saleSchema.index({ saleDate: -1 });
saleSchema.index({ customer: 1 });
saleSchema.index({ status: 1 });

saleSchema.index({ storeId: 1, saleNumber: 1 });

saleSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Sale', saleSchema);
