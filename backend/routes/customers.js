// backend/routes/customers.js
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { customerValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, paginationValidation, customerController.getCustomers);
router.get('/:id', authMiddleware, idParamValidation, customerController.getCustomerById);
router.post('/', authMiddleware, roleMiddleware('admin', 'manager', 'cashier'), customerValidation, customerController.createCustomer);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, customerController.updateCustomer);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, customerController.deleteCustomer);

module.exports = router;
