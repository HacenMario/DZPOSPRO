// backend/routes/purchaseOrders.js
const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrderController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/',     authMiddleware, tenantMiddleware, paginationValidation, poController.getPurchaseOrders);
router.get('/:id',  authMiddleware, tenantMiddleware, idParamValidation,    poController.getPurchaseOrderById);
router.post('/',    authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), poController.createPurchaseOrder);
router.put('/:id',  authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, poController.updatePurchaseOrder);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, poController.deletePurchaseOrder);

module.exports = router;
