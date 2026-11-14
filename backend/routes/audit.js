// backend/routes/audit.js — audit trail (admin + manager read).
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const controller = require('../controllers/auditController');

router.use(authMiddleware, tenantMiddleware, requirePermission('audit.view'));
router.get('/', controller.list);
router.get('/stats', controller.stats);

module.exports = router;
