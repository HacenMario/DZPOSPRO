// backend/routes/categories.js
const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { categoryValidation, idParamValidation } = require('../middleware/validator');

router.get('/', authMiddleware, categoryController.getCategories);
router.get('/:id', authMiddleware, idParamValidation, categoryController.getCategoryById);
router.post('/', authMiddleware, roleMiddleware('admin', 'manager'), categoryValidation, categoryController.createCategory);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, categoryController.updateCategory);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, categoryController.deleteCategory);

module.exports = router;
