// backend/routes/coupons.js
const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { couponValidation, couponValidateValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

router.get('/', authMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, couponController.getCoupons);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, couponController.getCouponById);
router.post('/', authMiddleware, roleMiddleware('admin'), couponValidation, couponController.createCoupon);
router.post('/validate', authMiddleware, couponValidateValidation, couponController.validateCoupon);
router.put('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, couponController.updateCoupon);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, couponController.deleteCoupon);

module.exports = router;
