// backend/routes/inventory.js
const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { paginationValidation } = require('../middleware/validator');

router.get('/movements', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, inventoryController.getAllMovements);
router.get('/summary', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), inventoryController.getInventorySummary);
router.get('/product/:productId', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, inventoryController.getMovementsByProduct);
router.post('/movements', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), inventoryController.createMovement);

module.exports = router;
