// backend/models/Category.js
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        ar: { type: String, required: true, trim: true },
        en: { type: String, required: true, trim: true },
        fr: { type: String, required: true, trim: true }
    },
    description: {
        ar: { type: String, default: '' },
        en: { type: String, default: '' },
        fr: { type: String, default: '' }
    },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

categorySchema.index({ parentId: 1 });
categorySchema.index({ 'name.ar': 1 });

categorySchema.methods.getName = function (lang = 'ar') {
    return this.name?.[lang] || this.name?.ar;
};
categorySchema.methods.getDescription = function (lang = 'ar') {
    return this.description?.[lang] || this.description?.ar;
};

module.exports = mongoose.model('Category', categorySchema);
