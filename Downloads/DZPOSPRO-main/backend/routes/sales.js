// backend/routes/sales.js
const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, paginationValidation, saleController.getSales);
router.get('/:id', authMiddleware, idParamValidation, saleController.getSaleById);
router.post('/', authMiddleware, roleMiddleware('admin', 'manager', 'cashier'), saleController.createSale);
router.patch('/:id/status', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, saleController.updateSaleStatus);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, saleController.cancelSale);

module.exports = router;
