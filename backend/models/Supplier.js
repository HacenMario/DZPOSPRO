// backend/models/Supplier.js
const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
    name: {
        ar: { type: String, required: true, trim: true },
        en: { type: String, required: true, trim: true },
        fr: { type: String, required: true, trim: true }
    },
    contactName: { type: String, default: '', trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    address: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    rc: { type: String, default: '', trim: true },
    nif: { type: String, default: '', trim: true },
    nis: { type: String, default: '', trim: true },
    art: { type: String, default: '', trim: true },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

supplierSchema.index({ phone: 1 });

supplierSchema.methods.getName = function (lang = 'ar') {
    return this.name?.[lang] || this.name?.ar;
};
supplierSchema.methods.getAddress = function (lang = 'ar') {
    return this.address?.[lang] || this.address?.ar;
};

module.exports = mongoose.model('Supplier', supplierSchema);
