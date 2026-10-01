// backend/routes/reports.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');

router.get('/summary', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSummary);
router.get('/sales', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSalesReport);
router.get('/products', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), reportController.getProductsReport);
router.get('/customers', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), reportController.getCustomersReport);
router.get('/inventory', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), reportController.getInventoryReport);
router.get('/kpi', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getKpi);
router.get('/profitability', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), reportController.getProfitability);

module.exports = router;
