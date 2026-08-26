// backend/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { registerValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, roleMiddleware('admin'), paginationValidation, userController.getUsers);
router.post('/', authMiddleware, roleMiddleware('admin'), registerValidation, userController.createUser);
router.get('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, userController.getUserById);
router.put('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, userController.updateUser);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, userController.deleteUser);

module.exports = router;
