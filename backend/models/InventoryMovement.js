// backend/models/InventoryMovement.js
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const inventoryMovementSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: ['in', 'out', 'adjust'], required: true },
    quantity: { type: Number, required: true, min: 1 },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    reason: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    reference: { type: String, default: '' }, // e.g. sale number / return id
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

// Compound index — most queries filter by product and sort by date.
inventoryMovementSchema.index({ product: 1, createdAt: -1 });
inventoryMovementSchema.index({ type: 1 });
inventoryMovementSchema.index({ createdAt: -1 });

inventoryMovementSchema.plugin(tenantPlugin);

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);
