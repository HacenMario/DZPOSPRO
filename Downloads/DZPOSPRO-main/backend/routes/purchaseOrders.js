// backend/routes/purchaseOrders.js
const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrderController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/',     authMiddleware, paginationValidation, poController.getPurchaseOrders);
router.get('/:id',  authMiddleware, idParamValidation,    poController.getPurchaseOrderById);
router.post('/',    authMiddleware, roleMiddleware('admin', 'manager'), poController.createPurchaseOrder);
router.put('/:id',  authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, poController.updatePurchaseOrder);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, poController.deletePurchaseOrder);

module.exports = router;
