// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSettingsSchema = new mongoose.Schema({
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    lang: { type: String, enum: ['ar', 'en', 'fr'], default: 'ar' },
    notifications: { type: Boolean, default: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    phone: { type: String, default: '' },
    role: { type: String, enum: ['admin', 'manager', 'cashier'], default: 'cashier' },
    isActive: { type: Boolean, default: true },
    settings: { type: userSettingsSchema, default: () => ({}) },
    lastLogin: { type: Date },
    refreshToken: { type: String, default: null }
}, { timestamps: true });

userSchema.index({ email: 1 });

// Hash password before save (only when changed)
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
