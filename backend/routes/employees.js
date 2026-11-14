// backend/routes/employees.js
// DZ POS PRO v4.5 — Employees & attendance (الدوام).
// Gate: employees.manage permission (admin/manager by role default,
// grantable to any account from the Users page).
const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

const GATE = [authMiddleware, tenantMiddleware, requirePermission('employees.manage')];

router.get('/', ...GATE, paginationValidation, employeeController.listEmployees);
router.post('/', ...GATE, employeeController.createEmployee);
router.put('/:id', ...GATE, idParamValidation, employeeController.updateEmployee);
router.delete('/:id', ...GATE, idParamValidation, employeeController.deleteEmployee);

// attendance (month-grid route MUST be declared before /:id)
router.get('/attendance/summary', ...GATE, employeeController.getAttendanceSummary);
router.get('/attendance', ...GATE, employeeController.getAttendanceDay);
router.post('/attendance', ...GATE, employeeController.markAttendance);
router.get('/:id/attendance', ...GATE, idParamValidation, employeeController.getEmployeeMonth);

module.exports = router;
