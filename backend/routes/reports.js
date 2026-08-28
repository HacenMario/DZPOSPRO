// backend/routes/reports.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');

router.get('/summary', authMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSummary);
router.get('/sales', authMiddleware, roleMiddleware('admin', 'manager', 'cashier'), reportController.getSalesReport);
router.get('/products', authMiddleware, roleMiddleware('admin', 'manager'), reportController.getProductsReport);
router.get('/customers', authMiddleware, roleMiddleware('admin', 'manager'), reportController.getCustomersReport);
router.get('/inventory', authMiddleware, roleMiddleware('admin', 'manager'), reportController.getInventoryReport);

module.exports = router;
