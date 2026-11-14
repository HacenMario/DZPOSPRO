// backend/controllers/employeeController.js
// DZ POS PRO v4.5 — Employee registry + attendance (الدوام).
// Permission: employees.manage (admin/manager by default; grantable).
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

function isObjectId(v) { return !!v && String(v).length === 24 && /^[a-f0-9]+$/i.test(String(v)); }

// ---------- Employees ----------
const listEmployees = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const filter = {};
        if (req.query.active === 'true') filter.active = true;
        if (req.query.active === 'false') filter.active = false;
        if (req.query.search) {
            const r = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [{ name: r }, { phone: r }, { jobTitle: r }];
        }
        const [data, total] = await Promise.all([
            Employee.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
            Employee.countDocuments(filter)
        ]);
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) { logger.error('listEmployees:', err.message); next(err); }
};

const createEmployee = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { name, phone, jobTitle, address, monthlySalary, hiredAt, weeklyRestDay, notes } = req.body;
        if (!name || !String(name).trim()) return errorResponse(res, 400, getTranslation('missingFields', lang));
        const doc = await Employee.create({
            name: String(name).trim(),
            phone: String(phone || '').trim(),
            jobTitle: String(jobTitle || '').trim(),
            address: String(address || '').trim(),
            monthlySalary: Math.max(0, Number(monthlySalary) || 0),
            hiredAt: hiredAt && !isNaN(new Date(hiredAt)) ? new Date(hiredAt) : null,
            weeklyRestDay: Number.isInteger(Number(weeklyRestDay)) ? Math.min(6, Math.max(0, Number(weeklyRestDay))) : 5,
            notes: String(notes || '').trim(),
            createdBy: req.userId
        });
        return createdResponse(res, doc, getTranslation('saved', lang));
    } catch (err) { logger.error('createEmployee:', err.message); next(err); }
};

const updateEmployee = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const doc = await Employee.findById(req.params.id);
        if (!doc) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const b = req.body || {};
        if (b.name !== undefined && String(b.name).trim()) doc.name = String(b.name).trim();
        if (b.phone !== undefined) doc.phone = String(b.phone || '').trim();
        if (b.jobTitle !== undefined) doc.jobTitle = String(b.jobTitle || '').trim();
        if (b.address !== undefined) doc.address = String(b.address || '').trim();
        if (b.monthlySalary !== undefined) doc.monthlySalary = Math.max(0, Number(b.monthlySalary) || 0);
        if (b.hiredAt !== undefined) doc.hiredAt = b.hiredAt && !isNaN(new Date(b.hiredAt)) ? new Date(b.hiredAt) : null;
        if (b.weeklyRestDay !== undefined) doc.weeklyRestDay = Math.min(6, Math.max(0, Number(b.weeklyRestDay) || 0));
        if (b.active !== undefined) doc.active = !!b.active;
        if (b.notes !== undefined) doc.notes = String(b.notes || '').trim();
        await doc.save();
        return successResponse(res, doc, getTranslation('saved', lang));
    } catch (err) { logger.error('updateEmployee:', err.message); next(err); }
};

const deleteEmployee = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const doc = await Employee.findById(req.params.id);
        if (!doc) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        await doc.deleteOne();
        await Attendance.deleteMany({ employee: doc._id });
        return successResponse(res, { deleted: true }, getTranslation('saved', lang));
    } catch (err) { logger.error('deleteEmployee:', err.message); next(err); }
};

// ---------- Attendance ----------
function parseDay(v) {
    if (!v) return dayFloor(new Date());
    const d = new Date(v);
    return isNaN(d.getTime()) ? dayFloor(new Date()) : dayFloor(d);
}
function dayFloor(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// GET /api/employees/attendance?date=YYYY-MM-DD        → day sheet
const getAttendanceDay = async (req, res, next) => {
    try {
        const day = parseDay(req.query.date);
        const employees = await Employee.find({ active: true }).sort({ name: 1 }).lean();
        const sheets = await Attendance.find({ day }).lean();
        const map = new Map(sheets.map(s => [String(s.employee), s]));
        return successResponse(res, {
            day,
            data: employees.map(e => ({
                employee: { id: e._id, name: e.name, jobTitle: e.jobTitle, phone: e.phone, weeklyRestDay: e.weeklyRestDay },
                sheet: map.get(String(e._id)) || null
            }))
        });
    } catch (err) { logger.error('getAttendanceDay:', err.message); next(err); }
};

// POST /api/employees/attendance  { employeeId, date, status, checkIn, checkOut, notes }  (upsert)
const markAttendance = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { employeeId, date, status, checkIn, checkOut, notes } = req.body;
        if (!isObjectId(employeeId)) return errorResponse(res, 400, getTranslation('missingFields', lang));
        const employee = await Employee.findById(employeeId);
        if (!employee) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const day = parseDay(date);
        const allowed = Attendance.STATUSES || ['present', 'absent', 'leave', 'half_day', 'late'];
        const st = allowed.includes(status) ? status : 'present';

        const inAt = checkIn && !isNaN(new Date(checkIn)) ? new Date(checkIn) : null;
        const outAt = checkOut && !isNaN(new Date(checkOut)) ? new Date(checkOut) : null;
        let worked = 0;
        if (inAt && outAt && outAt > inAt) worked = Math.round((outAt - inAt) / 60000);

        const doc = await Attendance.findOneAndUpdate(
            { employee: employee._id, day },
            {
                $set: {
                    status: st, checkIn: inAt, checkOut: outAt,
                    workedMinutes: worked,
                    notes: String(notes || '').trim(),
                    markedBy: req.userId
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        return successResponse(res, doc, getTranslation('saved', lang));
    } catch (err) { logger.error('markAttendance:', err.message); next(err); }
};

// GET /api/employees/attendance/summary?month=YYYY-MM   → monthly totals per employee
const getAttendanceSummary = async (req, res, next) => {
    try {
        const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ''));
        const now = new Date();
        const year = m ? Number(m[1]) : now.getFullYear();
        const month = m ? Number(m[2]) : now.getMonth() + 1;
        const from = new Date(year, month - 1, 1);
        const to = new Date(year, month, 1);

        const employees = await Employee.find({ active: true }).sort({ name: 1 }).lean();
        const sheets = await Attendance.find({ day: { $gte: from, $lt: to } }).lean();

        const summary = employees.map(e => {
            const rows = sheets.filter(s => String(s.employee) === String(e._id));
            const counts = { present: 0, absent: 0, leave: 0, half_day: 0, late: 0 };
            let minutes = 0;
            for (const r of rows) {
                if (counts[r.status] !== undefined) counts[r.status]++;
                minutes += r.workedMinutes || 0;
            }
            return {
                employee: { id: e._id, name: e.name, jobTitle: e.jobTitle, monthlySalary: e.monthlySalary },
                days: counts, workedHours: Math.round(minutes / 60),
                marked: rows.length
            };
        });
        return successResponse(res, { month: `${year}-${String(month).padStart(2, '0')}`, data: summary });
    } catch (err) { logger.error('getAttendanceSummary:', err.message); next(err); }
};

// GET /api/employees/:id/attendance?month=YYYY-MM       → one employee's month grid
const getEmployeeMonth = async (req, res, next) => {
    try {
        const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ''));
        const now = new Date();
        const year = m ? Number(m[1]) : now.getFullYear();
        const month = m ? Number(m[2]) : now.getMonth() + 1;
        const from = new Date(year, month - 1, 1);
        const to = new Date(year, month, 1);
        const sheets = await Attendance.find({ employee: req.params.id, day: { $gte: from, $lt: to } })
            .sort({ day: 1 }).lean();
        return successResponse(res, { month: `${year}-${String(month).padStart(2, '0')}`, data: sheets });
    } catch (err) { logger.error('getEmployeeMonth:', err.message); next(err); }
};

module.exports = {
    listEmployees, createEmployee, updateEmployee, deleteEmployee,
    getAttendanceDay, markAttendance, getAttendanceSummary, getEmployeeMonth
};
