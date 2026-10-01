// backend/routes/returns.js
const express = require('express');
const router = express.Router();
const returnController = require('../controllers/returnController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, returnController.getReturns);
router.get('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, returnController.getReturnById);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), returnController.createReturn);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, returnController.deleteReturn);

module.exports = router;
