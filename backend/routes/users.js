// backend/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { registerValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, requirePermission('users.manage'), paginationValidation, userController.getUsers);
router.post('/', authMiddleware, tenantMiddleware, requirePermission('users.manage'), registerValidation, userController.createUser);
router.get('/:id', authMiddleware, tenantMiddleware, requirePermission('users.manage'), idParamValidation, userController.getUserById);
router.put('/:id', authMiddleware, tenantMiddleware, requirePermission('users.manage'), idParamValidation, userController.updateUser);
router.delete('/:id', authMiddleware, tenantMiddleware, requirePermission('users.manage'), idParamValidation, userController.deleteUser);

module.exports = router;
