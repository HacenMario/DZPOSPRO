// backend/routes/purchaseOrders.js
const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrderController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/',     authMiddleware, tenantMiddleware, paginationValidation, poController.getPurchaseOrders);
router.get('/:id',  authMiddleware, tenantMiddleware, idParamValidation,    poController.getPurchaseOrderById);
router.post('/',    authMiddleware, tenantMiddleware, requirePermission('purchaseOrders.manage'), poController.createPurchaseOrder);
router.put('/:id',  authMiddleware, tenantMiddleware, requirePermission('purchaseOrders.manage'), idParamValidation, poController.updatePurchaseOrder);
router.delete('/:id', authMiddleware, tenantMiddleware, requirePermission('purchaseOrders.manage'), idParamValidation, poController.deletePurchaseOrder);

module.exports = router;
