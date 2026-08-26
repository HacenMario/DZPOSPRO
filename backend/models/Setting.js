// backend/models/Setting.js
// Singleton document (query with findOne()). Generic placeholders — real
// company data is loaded by scripts/seed.js.
const mongoose = require('mongoose');

const companyInfoSchema = new mongoose.Schema({
    rc: { type: String, default: '' },
    nif: { type: String, default: '' },
    nis: { type: String, default: '' },
    art: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    email: { type: String, default: '' }
}, { _id: false });

const settingSchema = new mongoose.Schema({
    storeName: { type: String, default: 'DZ POS PRO', trim: true },
    currency: { type: String, default: 'DZD' },
    taxRate: { type: Number, default: 0, min: 0 },
    language: { type: String, enum: ['ar', 'en', 'fr'], default: 'ar' },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    enableNotifications: { type: Boolean, default: true },
    defaultPaymentMethod: { type: String, enum: ['cash', 'card', 'transfer'], default: 'cash' },

    invoicePrefix: { type: String, default: 'INV-' },
    invoiceFooter: { type: String, default: '' },
    // ✅ النص الترويسي للفاتورة (يظهر تحت معلومات الشركة)
    invoiceHeader: { type: String, default: '' },
    // Free-form text shown on the invoice PDF right below the "Arrêté la présente facture..."
    // line (e.g. a legal notice, bank details, payment terms).
    invoiceCustomText: { type: String, default: '' },

    // Primary brand color used on the invoice PDF (header band, totals, accents).
    // Admins can override this from the settings page. Default = emerald-500.
    invoicePrimaryColor: { type: String, default: '#10b981', trim: true },

    // Generic placeholders; replaced by seed.js or via PUT /settings.
    companyInfo: { type: companyInfoSchema, default: () => ({}) },

    // Monthly invoice counter (year/month/counter)
    currentInvoiceYear: { type: Number, default: 0 },
    currentInvoiceMonth: { type: Number, default: 0 },
    currentInvoiceCounter: { type: Number, default: 0 },
    lastInvoiceNumber: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Setting', settingSchema);
