// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');

router.get('/', authMiddleware, roleMiddleware('admin', 'manager', 'cashier'), settingController.getSettings);
router.put('/', authMiddleware, roleMiddleware('admin'), settingController.updateSetting);

module.exports = router;
