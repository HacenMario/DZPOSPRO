// backend/routes/reports.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');

router.get('/summary', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSummary);
router.get('/sales', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSalesReport);
router.get('/products', authMiddleware, tenantMiddleware, requirePermission('reports.view'), reportController.getProductsReport);
router.get('/customers', authMiddleware, tenantMiddleware, requirePermission('reports.view'), reportController.getCustomersReport);
router.get('/inventory', authMiddleware, tenantMiddleware, requirePermission('reports.view'), reportController.getInventoryReport);
router.get('/kpi', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getKpi);
router.get('/profitability', authMiddleware, tenantMiddleware, requirePermission('reports.view'), reportController.getProfitability);
// v4 — unified chart pack (revenue/profit trend, categories, payments, top products)
router.get('/charts', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getCharts);

module.exports = router;
