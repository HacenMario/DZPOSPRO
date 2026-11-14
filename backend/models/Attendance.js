// backend/models/Attendance.js
// DZ POS PRO v4.5 — Daily attendance sheet (الدوام) per employee.
// One document per (employee, day). `day` is always the LOCAL day floor
// (00:00) as provided by the client; checkIn/checkOut are full timestamps.
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const STATUSES = ['present', 'absent', 'leave', 'half_day', 'late'];

const attendanceSchema = new mongoose.Schema({
    storeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    employee:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    day:       { type: Date, required: true },                 // 00:00 of the local day
    status:    { type: String, enum: STATUSES, default: 'present' },
    checkIn:   { type: Date, default: null },
    checkOut:  { type: Date, default: null },
    lateMinutes:    { type: Number, default: 0, min: 0 },
    workedMinutes:  { type: Number, default: 0, min: 0 },
    overtimeMinutes:{ type: Number, default: 0, min: 0 },
    notes:     { type: String, default: '', maxlength: 300 },
    markedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

// one sheet per employee per day
attendanceSchema.index({ employee: 1, day: 1 }, { unique: true });

attendanceSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.STATUSES = STATUSES;
