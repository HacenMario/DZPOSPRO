// backend/middleware/validator.js
// express-validator chains + a small `validate` middleware that turns
// validation errors into a 400 with a structured envelope.
const { validationResult, body, param, query } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
        });
    }
    next();
};

// ---- Auth ----
// Email accepts any non-empty string (the user wants to allow usernames/identifiers,
// not strictly RFC emails — e.g. "admin", "cashier1", "store.manager").
const loginValidation = [
    body('email').trim().isLength({ min: 1 }).withMessage('Email is required'),
    body('password').isLength({ min: 1 }).withMessage('Password is required'),
    validate
];

const registerValidation = [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').trim().isLength({ min: 1 }).withMessage('Email is required'),
    body('password')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
        .matches(/[0-9]/).withMessage('Password must contain a number'),
    body('role').optional().isIn(['admin', 'manager', 'cashier']).withMessage('Invalid role'),
    validate
];

const changePasswordValidation = [
    body('oldPassword').isLength({ min: 1 }).withMessage('Old password is required'),
    body('newPassword')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
        .matches(/[0-9]/).withMessage('Password must contain a number'),
    validate
];

// ---- Generic ----
const idParamValidation = [
    param('id').isMongoId().withMessage('Invalid id'),
    validate
];

// For routes whose path param is named :productId (e.g. /api/inventory/product/:productId)
const productIdParamValidation = [
    param('productId').isMongoId().withMessage('Invalid id'),
    validate
];

const paginationValidation = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be 1-200'),
    validate
];

// ---- Product (multipart form, so name.* arrive as strings) ----
// Accepts either a flat `name` string (new single-field frontend) or a {ar,en,fr}
// object (legacy). The controller fans the flat string out to all three slots.
const nameCustomValidator = (value) => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (value && typeof value === 'object' && value.ar && String(value.ar).trim().length > 0) return true;
    return false;
};

const productValidation = [
    body('name').custom(nameCustomValidator).withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('tax').optional().isFloat({ min: 0 }).withMessage('Tax must be a non-negative number'),
    body('timbre').optional().isFloat({ min: 0 }).withMessage('Timbre must be a non-negative number'),
    body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status'),
    validate
];

// ---- Category / Customer / Supplier ----
// Category accepts either a flat `name` string (new single-field frontend)
// or a {ar,en,fr} object (legacy). The controller fans the flat string out
// to all three language slots.
const categoryValidation = [
    body('name').custom(nameCustomValidator).withMessage('Name is required'),
    validate
];

const customerValidation = [
    body('name').custom(nameCustomValidator).withMessage('Name is required'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
    validate
];

const supplierValidation = customerValidation;

// ---- Coupon ----
const couponValidation = [
    body('code').trim().notEmpty().withMessage('Coupon code is required'),
    body('type').isIn(['percentage', 'fixed']).withMessage('Type must be percentage or fixed'),
    body('value').isFloat({ min: 0 }).withMessage('Value must be a non-negative number'),
    body('validFrom').isISO8601().withMessage('validFrom must be a valid date'),
    body('validUntil').isISO8601().withMessage('validUntil must be a valid date'),
    validate
];

const couponValidateValidation = [
    body('code').trim().notEmpty().withMessage('Coupon code is required'),
    body('cartTotal').isFloat({ min: 0 }).withMessage('cartTotal must be a non-negative number'),
    validate
];

module.exports = {
    validate,
    loginValidation,
    registerValidation,
    changePasswordValidation,
    idParamValidation,
    productIdParamValidation,
    paginationValidation,
    productValidation,
    categoryValidation,
    customerValidation,
    supplierValidation,
    couponValidation,
    couponValidateValidation
};
