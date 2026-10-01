// backend/routes/notifications.js — in-app notification centre.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const controller = require('../controllers/notificationController');

router.use(authMiddleware, tenantMiddleware);
router.get('/', controller.list);
router.get('/unread-count', controller.unreadCount);
router.post('/mark-read', controller.markRead);
router.delete('/:id', controller.remove);

module.exports = router;
