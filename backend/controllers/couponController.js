// backend/controllers/couponController.js
const Coupon = require('../models/Coupon');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

const decorate = (c, lang) => {
    const o = c.toObject ? c.toObject() : { ...c };
    o.description = c.description?.[lang] || c.description?.ar || '';
    return o;
};

// GET /api/coupons?page&limit
const getCoupons = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { isActive } = req.query;
        const filter = {};
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const [docs, total] = await Promise.all([
            Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Coupon.countDocuments(filter)
        ]);
        const data = docs.map(c => decorate(c, lang));
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getCoupons error:', err.message);
        next(err);
    }
};

// GET /api/coupons/:id
const getCouponById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const c = await Coupon.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('couponNotFound', lang));
        return successResponse(res, { coupon: decorate(c, lang) });
    } catch (err) {
        logger.error('getCouponById error:', err.message);
        next(err);
    }
};

// POST /api/coupons  (admin)
const createCoupon = async (req, res, next) => {
    try {
        const { code, type, value, minOrder, maxDiscount, validFrom, validUntil, usageLimit, description, isActive } = req.body;
        const lang = req.lang || 'ar';

        if (!code || !type || value === undefined || !validFrom || !validUntil) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }
        const existing = await Coupon.findOne({ code: code.toUpperCase() });
        if (existing) return errorResponse(res, 400, getTranslation('couponCodeExists', lang));

        const c = new Coupon({
            code: code.toUpperCase(),
            type, value,
            minOrder: Number(minOrder) || 0,
            maxDiscount: Number(maxDiscount) || 0,
            validFrom: new Date(validFrom),
            validUntil: new Date(validUntil),
            usageLimit: Number(usageLimit) || 0,
            isActive: isActive !== undefined ? isActive : true,
            description: {
                ar: description?.ar || '',
                en: description?.en || '',
                fr: description?.fr || ''
            },
            createdBy: req.userId
        });
        await c.save();
        return createdResponse(res, { coupon: decorate(c, lang) }, getTranslation('couponCreated', lang));
    } catch (err) {
        logger.error('createCoupon error:', err.message);
        next(err);
    }
};

// PUT /api/coupons/:id  (admin)
const updateCoupon = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const c = await Coupon.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('couponNotFound', lang));

        const { code, type, value, minOrder, maxDiscount, validFrom, validUntil, usageLimit, description, isActive } = req.body;
        if (code && code.toUpperCase() !== c.code) {
            const dup = await Coupon.findOne({ code: code.toUpperCase() });
            if (dup) return errorResponse(res, 400, getTranslation('couponCodeExists', lang));
            c.code = code.toUpperCase();
        }
        if (type !== undefined) c.type = type;
        if (value !== undefined) c.value = value;
        if (minOrder !== undefined) c.minOrder = Number(minOrder);
        if (maxDiscount !== undefined) c.maxDiscount = Number(maxDiscount);
        if (validFrom !== undefined) c.validFrom = new Date(validFrom);
        if (validUntil !== undefined) c.validUntil = new Date(validUntil);
        if (usageLimit !== undefined) c.usageLimit = Number(usageLimit) || 0;
        if (isActive !== undefined) c.isActive = isActive;
        if (description) {
            if (description.ar !== undefined) c.description.ar = description.ar;
            if (description.en !== undefined) c.description.en = description.en;
            if (description.fr !== undefined) c.description.fr = description.fr;
        }

        await c.save();
        return successResponse(res, { coupon: decorate(c, lang) }, getTranslation('couponUpdated', lang));
    } catch (err) {
        logger.error('updateCoupon error:', err.message);
        next(err);
    }
};

// DELETE /api/coupons/:id  (admin)
const deleteCoupon = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const c = await Coupon.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('couponNotFound', lang));
        await c.deleteOne();
        return successResponse(res, null, getTranslation('couponDeleted', lang));
    } catch (err) {
        logger.error('deleteCoupon error:', err.message);
        next(err);
    }
};

// POST /api/coupons/validate  { code, cartTotal } → { valid, discount, coupon }
const validateCoupon = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { code, cartTotal } = req.body;
        if (!code || cartTotal === undefined) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
        if (!coupon) return errorResponse(res, 404, getTranslation('couponInvalid', lang));

        const now = new Date();
        if (now < coupon.validFrom || now > coupon.validUntil) {
            return errorResponse(res, 400, getTranslation('couponExpired', lang));
        }
        if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
            return errorResponse(res, 400, getTranslation('couponUsedUp', lang));
        }
        if (Number(cartTotal) < coupon.minOrder) {
            return errorResponse(res, 400, `${getTranslation('couponMinOrder', lang)} ${coupon.minOrder}`);
        }

        let discount = 0;
        if (coupon.type === 'percentage') {
            discount = (Number(cartTotal) * coupon.value) / 100;
            if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
        } else {
            discount = coupon.value;
        }
        discount = Math.min(discount, Number(cartTotal));

        return successResponse(res, {
            valid: true,
            discount: Math.round(discount),
            newTotal: Number(cartTotal) - Math.round(discount),
            coupon: decorate(coupon, lang)
        }, getTranslation('couponApplied', lang));
    } catch (err) {
        logger.error('validateCoupon error:', err.message);
        next(err);
    }
};

module.exports = {
    getCoupons,
    getCouponById,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    validateCoupon
};
