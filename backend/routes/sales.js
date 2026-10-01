// backend/routes/sales.js
const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, paginationValidation, saleController.getSales);
router.get('/:id', authMiddleware, tenantMiddleware, idParamValidation, saleController.getSaleById);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), saleController.createSale);
router.patch('/:id/status', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, saleController.updateSaleStatus);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, saleController.cancelSale);

module.exports = router;
