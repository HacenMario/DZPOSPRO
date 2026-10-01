// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');

router.get('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), settingController.getSettings);
router.put('/', authMiddleware, tenantMiddleware, roleMiddleware('admin'), settingController.updateSetting);

// v3 — AI platform settings
router.post('/gemini-key', authMiddleware, tenantMiddleware, roleMiddleware('admin'), settingController.setGeminiKey);
router.get('/gemini-key-status', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), settingController.getGeminiKeyStatus);

module.exports = router;
