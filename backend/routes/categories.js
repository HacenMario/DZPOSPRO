// backend/routes/categories.js
const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { categoryValidation, idParamValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, categoryController.getCategories);
router.get('/:id', authMiddleware, tenantMiddleware, idParamValidation, categoryController.getCategoryById);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), categoryValidation, categoryController.createCategory);
router.put('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, categoryController.updateCategory);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, categoryController.deleteCategory);

module.exports = router;
