// backend/models/SaleItem.js
const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },   // unit price at sale time
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    timbre: { type: Number, default: 0, min: 0 },
    // Historical snapshot (so a sale stays correct if the product is later edited)
    productName: { type: String, default: '' },
    productBarcode: { type: String, default: '' },
    productUnit: { type: String, default: '' },
    notes: { type: String, default: '' }
}, { timestamps: true });

saleItemSchema.index({ sale: 1 });
saleItemSchema.index({ product: 1 });
saleItemSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SaleItem', saleItemSchema);
