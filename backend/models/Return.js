// backend/models/Return.js
const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
    saleItem: { type: mongoose.Schema.Types.ObjectId, ref: 'SaleItem' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    reason: { type: String, default: '' }
}, { _id: false });

const returnSchema = new mongoose.Schema({
    returnNumber: { type: String, unique: true, sparse: true },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    items: [returnItemSchema],
    reason: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    totalRefund: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

returnSchema.index({ sale: 1 });
returnSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Return', returnSchema);
