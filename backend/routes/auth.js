// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { loginLimiter } = require('../middleware/rateLimiter');
const { loginValidation, registerValidation, changePasswordValidation } = require('../middleware/validator');
const User = require('../models/User');

// Public
router.post('/login', loginLimiter, loginValidation, authController.login);

// Register: always open. New users get role "cashier" by default.
// Admin/manager accounts can only be created by an admin via the Users page.
router.post('/register', registerValidation, authController.register);

// Check if registration is open — always returns open: true
router.get('/register-status', async (req, res) => {
    try {
        const count = await User.countDocuments();
        res.json({ success: true, data: { open: true, userCount: count } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Authenticated
router.get('/me', authMiddleware, authController.getMe);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, changePasswordValidation, authController.changePassword);
router.post('/refresh', authMiddleware, authController.refresh);
router.post('/logout', authMiddleware, authController.logout);

module.exports = router;
