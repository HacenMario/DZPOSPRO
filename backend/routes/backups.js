// backend/routes/backups.js — super-admin backup management.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const controller = require('../controllers/backupController');

router.use(authMiddleware, roleMiddleware('superadmin'));
router.post('/now', controller.createNow);
router.get('/', controller.list);
router.get('/:filename/download', controller.download);
router.post('/restore', controller.restore);

module.exports = router;
