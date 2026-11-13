// backend/routes/subscription.js
// DZ POS PRO v4.3 — Subscription lifecycle routes.
//   • Store side  : any authenticated member (requests limited to admin/manager)
//   • Admin side  : superadmin only (billing console)
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const ctrl = require('../controllers/subscriptionController');

router.use(authMiddleware);

// ---------- store side ----------
router.get('/', ctrl.getMySubscription);
router.get('/requests', ctrl.listMyRequests);
router.post('/requests', roleMiddleware('admin', 'manager'), ctrl.createRequest);
router.post('/requests/:id/cancel', roleMiddleware('admin', 'manager'), ctrl.cancelRequest);

// ---------- super-admin billing console ----------
router.get('/admin/overview', roleMiddleware('superadmin'), ctrl.adminOverview);
router.get('/admin/requests', roleMiddleware('superadmin'), ctrl.adminListRequests);
router.post('/admin/requests/:id/approve', roleMiddleware('superadmin'), ctrl.approveRequest);
router.post('/admin/requests/:id/reject', roleMiddleware('superadmin'), ctrl.rejectRequest);
router.post('/admin/apply', roleMiddleware('superadmin'), ctrl.adminApplyManual);

module.exports = router;
