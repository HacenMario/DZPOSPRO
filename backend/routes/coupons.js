// backend/routes/coupons.js
const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { requirePermission } = require('../middleware/permissions');
const { couponValidation, couponValidateValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, tenantMiddleware, requirePermission('coupons.manage'), paginationValidation, couponController.getCoupons);
router.get('/:id', authMiddleware, tenantMiddleware, requirePermission('coupons.manage'), idParamValidation, couponController.getCouponById);
router.post('/', authMiddleware, tenantMiddleware, roleMiddleware('admin'), couponValidation, couponController.createCoupon);
router.post('/validate', authMiddleware, tenantMiddleware, couponValidateValidation, couponController.validateCoupon);
router.put('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, couponController.updateCoupon);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, couponController.deleteCoupon);

module.exports = router;
