// backend/models/Employee.js
// DZ POS PRO v4.5 — Employee registry + attendance (دوام).
// Employees are store-scoped records managed by the store admin/manager
// (permission employees.manage). They may optionally be linked to a User
// account, but that is NOT required — a worker without a login can still
// be tracked for attendance and payroll purposes.
const mongoose = require('mongoose');
const { tenantPlugin } = require('../utils/tenantPlugin');

const employeeSchema = new mongoose.Schema({
    storeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true, default: null },
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // optional link
    name:     { type: String, required: true, trim: true, maxlength: 120 },
    phone:    { type: String, default: '', trim: true, maxlength: 30 },
    jobTitle: { type: String, default: '', trim: true, maxlength: 80 },
    address:  { type: String, default: '', trim: true, maxlength: 200 },
    // Salary basis kept informational (not used in payroll calculations)
    monthlySalary: { type: Number, default: 0, min: 0 },
    hiredAt:  { type: Date, default: null },
    weeklyRestDay: { type: Number, min: 0, max: 6, default: 5 }, // 0=Sunday … 5=Friday, 6=Saturday
    active:   { type: Boolean, default: true },
    notes:    { type: String, default: '', maxlength: 500 },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

employeeSchema.index({ name: 1 });
employeeSchema.index({ active: 1 });

employeeSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Employee', employeeSchema);
