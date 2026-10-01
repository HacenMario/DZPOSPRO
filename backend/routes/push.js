// backend/routes/push.js — Web Push (VAPID) subscriptions.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const controller = require('../controllers/pushController');

router.get('/public-key', pushKey);
function pushKey(req, res, next) { return controller.publicKey(req, res, next); }

router.post('/subscribe', authMiddleware, tenantMiddleware, controller.subscribe);
router.post('/unsubscribe', authMiddleware, controller.unsubscribe);
router.post('/test', authMiddleware, tenantMiddleware, controller.test);

module.exports = router;
