// backend/models/PlatformSetting.js — platform-wide key/value settings
// (NOT tenant-scoped): VAPID keys, Gemini API key, cron overrides…
const mongoose = require('mongoose');

const platformSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

platformSettingSchema.statics.get = async function (key, fallback = null) {
    const doc = await this.findOne({ key });
    return doc ? doc.value : fallback;
};

platformSettingSchema.statics.set = async function (key, value) {
    return this.findOneAndUpdate({ key }, { value }, { new: true, upsert: true });
};

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
