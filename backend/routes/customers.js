// backend/routes/customers.js
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { customerValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, paginationValidation, customerController.getCustomers);
router.get('/:id', authMiddleware, tenantMiddleware, idParamValidation, customerController.getCustomerById);
router.post('/', authMiddleware, tenantMiddleware, requirePermission('customers.manage'), customerValidation, customerController.createCustomer);
router.put('/:id', authMiddleware, tenantMiddleware, requirePermission('customers.manage'), idParamValidation, customerController.updateCustomer);
router.delete('/:id', authMiddleware, tenantMiddleware, requirePermission('customers.manage'), idParamValidation, customerController.deleteCustomer);

module.exports = router;
