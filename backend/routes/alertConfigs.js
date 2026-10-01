// backend/routes/alertConfigs.js — smart alerts settings.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const controller = require('../controllers/alertConfigController');

router.use(authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'));
router.get('/', controller.list);
router.put('/:type', controller.update);

module.exports = router;
