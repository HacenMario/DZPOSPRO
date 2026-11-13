// backend/routes/subscription.js
// DZ POS PRO v4.3 — Subscription lifecycle routes.
//   • Store side  : any authenticated member (requests limited to admin/manager)
//   • Admin side  : superadmin only (billing console)
// v4.3.1 — the platform owner can now OPEN the subscription center too:
//   without a store focus he gets the all-stores platform view, and with
//   X-Store-Id (or ?storeId=) he sees one store's full detail. The focus is
//   resolved WITHOUT the suspension/expiry blocks of the full tenant
//   middleware on purpose: an expired store's own admin must still be able
//   to reach this page to request the renewal that un-blocks him.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const ctrl = require('../controllers/subscriptionController');

router.use(authMiddleware);

// v4.3.1 — super-admin store focus (X-Store-Id / ?storeId=). Store users
// already have req.storeId from authMiddleware; this only fills the focus
// for the platform owner, who by default has none.
router.use((req, res, next) => {
    if (req.user && req.user.role === 'superadmin') {
        const focus = (req.get('X-Store-Id') || req.query.storeId || '').toString().trim();
        if (focus && mongoose.Types.ObjectId.isValid(focus)) {
            req.storeFocus = new mongoose.Types.ObjectId(focus); // v4.3.1: new required in mongoose 7
            req.storeId = req.storeFocus;
        }
    }
    next();
});

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
