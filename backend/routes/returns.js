// backend/routes/returns.js
const express = require('express');
const router = express.Router();
const returnController = require('../controllers/returnController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, requirePermission('invoices.view'), paginationValidation, returnController.getReturns);
router.get('/:id', authMiddleware, tenantMiddleware, requirePermission('invoices.view'), idParamValidation, returnController.getReturnById);
router.post('/', authMiddleware, tenantMiddleware, requirePermission('returns.create'), returnController.createReturn);
router.delete('/:id', authMiddleware, tenantMiddleware, requirePermission('returns.create'), idParamValidation, returnController.deleteReturn);

module.exports = router;
