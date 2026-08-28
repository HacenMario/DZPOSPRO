// backend/routes/suppliers.js
const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { supplierValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, paginationValidation, supplierController.getSuppliers);
router.get('/:id', authMiddleware, idParamValidation, supplierController.getSupplierById);
router.post('/', authMiddleware, roleMiddleware('admin', 'manager'), supplierValidation, supplierController.createSupplier);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, supplierController.updateSupplier);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, supplierController.deleteSupplier);

module.exports = router;
