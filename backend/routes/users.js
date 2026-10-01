// backend/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { registerValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, roleMiddleware('admin'), paginationValidation, userController.getUsers);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin'), registerValidation, userController.createUser);
router.get('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, userController.getUserById);
router.put('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, userController.updateUser);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, userController.deleteUser);

module.exports = router;
