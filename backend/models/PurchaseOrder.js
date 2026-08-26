// backend/models/PurchaseOrder.js
const mongoose = require('mongoose');

const purchaseOrderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    // Snapshot at order time (so the order stays correct if the product is later edited)
    productName: { type: String, default: '' },
    productBarcode: { type: String, default: '' },
    productUnit: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 }
}, { _id: false });

const purchaseOrderSchema = new mongoose.Schema({
    orderNumber: { type: String, required: true, unique: true, trim: true },
    orderDate: { type: Date, default: Date.now },
    expectedDate: { type: Date, default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    // Snapshot of supplier info at order time
    supplierName: { type: String, default: '' },
    supplierPhone: { type: String, default: '' },
    supplierEmail: { type: String, default: '' },

    items: [purchaseOrderItemSchema],

    subtotal: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },

    status: {
        type: String,
        enum: ['draft', 'sent', 'received', 'cancelled'],
        default: 'draft'
    },
    notes: { type: String, default: '' },

    // When status is 'received', this flag records whether stock was already
    // incremented for each item (prevents double-increment on re-save).
    stockApplied: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

purchaseOrderSchema.index({ orderDate: -1 });
purchaseOrderSchema.index({ supplier: 1 });
purchaseOrderSchema.index({ status: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
