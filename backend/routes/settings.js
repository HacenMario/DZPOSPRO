// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');

router.get('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager', 'cashier'), settingController.getSettings);
// v4.5 — settings stay admin-only by default, but the permission layer lets
// the store admin grant settings.edit to a trusted account.
router.put('/', authMiddleware, tenantMiddleware, requirePermission('settings.edit'), settingController.updateSetting);

// v3 — AI platform settings
router.post('/gemini-key', authMiddleware, tenantMiddleware, requirePermission('settings.edit'), settingController.setGeminiKey);
router.get('/gemini-key-status', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), settingController.getGeminiKeyStatus);

// v4.5 — Controlcaisse cash denominations (admin edits; GET visible to all staff)
router.get('/cash-denominations', authMiddleware, tenantMiddleware, settingController.getCashDenominations);
router.put('/cash-denominations', authMiddleware, tenantMiddleware, requirePermission('settings.edit'), settingController.updateCashDenominations);

module.exports = router;
