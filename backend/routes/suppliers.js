// backend/routes/suppliers.js
const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { supplierValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, paginationValidation, supplierController.getSuppliers);
router.get('/:id', authMiddleware, tenantMiddleware, idParamValidation, supplierController.getSupplierById);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), supplierValidation, supplierController.createSupplier);
router.put('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, supplierController.updateSupplier);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, supplierController.deleteSupplier);

module.exports = router;
