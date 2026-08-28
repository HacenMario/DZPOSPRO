// backend/models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        ar: { type: String, required: true, trim: true },
        en: { type: String, default: '', trim: true },
        fr: { type: String, default: '', trim: true }
    },
    description: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    barcode: { type: String, unique: true, sparse: true, trim: true },
    sku: { type: String, unique: true, sparse: true, trim: true },

    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    minStock: { type: Number, default: 5, min: 0 },
    unit: { type: String, default: 'pcs' },

    // Algerian fiscal stamp ("timbre") — fixed per-product amount
    timbre: { type: Number, default: 0, min: 0 },
    // Per-product tax rate (overrides Setting.taxRate when present)
    tax: { type: Number, default: 0, min: 0 },

    images: [{ type: String }],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

productSchema.index({ barcode: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ 'name.ar': 'text', 'name.en': 'text', 'name.fr': 'text' });
productSchema.index({ price: 1 });
productSchema.index({ stock: 1 });
productSchema.index({ status: 1 });

// Localized helpers (used by controllers — fixes the missing getName/getDescription bug).
productSchema.methods.getName = function (lang = 'ar') {
    return this.name?.[lang] || this.name?.ar || '';
};
productSchema.methods.getDescription = function (lang = 'ar') {
    return this.description?.[lang] || this.description?.ar || '';
};

module.exports = mongoose.model('Product', productSchema);
