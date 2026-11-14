// backend/routes/inventory.js
const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { paginationValidation } = require('../middleware/validator');

router.get('/movements', authMiddleware, tenantMiddleware, requirePermission('inventory.adjust'), paginationValidation, inventoryController.getAllMovements);
router.get('/summary', authMiddleware, tenantMiddleware, requirePermission('inventory.adjust'), inventoryController.getInventorySummary);
router.get('/product/:productId', authMiddleware, tenantMiddleware, requirePermission('inventory.adjust'), paginationValidation, inventoryController.getMovementsByProduct);
router.post('/movements', authMiddleware, tenantMiddleware, requirePermission('inventory.adjust'), inventoryController.createMovement);

module.exports = router;
