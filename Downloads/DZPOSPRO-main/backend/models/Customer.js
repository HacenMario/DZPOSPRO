// backend/models/Customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: {
        ar: { type: String, required: true, trim: true },
        en: { type: String, required: true, trim: true },
        fr: { type: String, required: true, trim: true }
    },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: '', trim: true },
    address: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    // Algerian fiscal IDs
    rc: { type: String, default: '', trim: true },
    nif: { type: String, default: '', trim: true },
    nis: { type: String, default: '', trim: true },
    art: { type: String, default: '', trim: true },
    notes: { type: String, default: '' },

    loyaltyPoints: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

customerSchema.index({ phone: 1 });
customerSchema.index({ 'name.ar': 'text' });

customerSchema.methods.getName = function (lang = 'ar') {
    return this.name?.[lang] || this.name?.ar;
};
customerSchema.methods.getAddress = function (lang = 'ar') {
    return this.address?.[lang] || this.address?.ar;
};

module.exports = mongoose.model('Customer', customerSchema);
