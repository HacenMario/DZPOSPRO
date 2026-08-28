// backend/controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse } = require('../utils/response');

const signToken = (user) => jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
);

const publicUser = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    settings: user.settings,
    lastLogin: user.lastLogin
});

// POST /api/auth/login
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const lang = req.lang || 'ar';

        // Email/identifier is case-insensitive but stored as-is
        const user = await User.findOne({ email: { $regex: new RegExp('^' + (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }).select('+password');
        if (!user) return errorResponse(res, 401, getTranslation('loginFailed', lang));

        const isMatch = await user.comparePassword(password || '');
        if (!isMatch) return errorResponse(res, 401, getTranslation('loginFailed', lang));
        if (!user.isActive) return errorResponse(res, 403, getTranslation('accountDisabled', lang));

        user.lastLogin = new Date();
        await user.save();

        const token = signToken(user);
        return successResponse(res, { token, user: publicUser(user) }, getTranslation('loginSuccess', lang));
    } catch (err) {
        logger.error('Login error:', err.message);
        next(err);
    }
};

// POST /api/auth/register  (open registration — new users are ALWAYS cashiers)
const register = async (req, res, next) => {
    try {
        const { name, email, password, phone } = req.body;
        const lang = req.lang || 'ar';

        const existing = await User.findOne({ email: { $regex: new RegExp('^' + (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        // Client-supplied role/settings are intentionally ignored: public open
        // registration must never grant admin/manager. Admins are created via
        // POST /api/users (admin-only).
        const user = new User({
            name,
            email: (email || '').trim(),
            password,
            phone: phone || '',
            role: 'cashier'
        });
        await user.save();

        return createdResponse(res, { user: publicUser(user) }, getTranslation('userCreated', lang));
    } catch (err) {
        logger.error('Register error:', err.message);
        next(err);
    }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findById(req.userId).select('-password');
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        return successResponse(res, { user: publicUser(user) });
    } catch (err) {
        logger.error('getMe error:', err.message);
        next(err);
    }
};

// PUT /api/auth/profile
const updateProfile = async (req, res, next) => {
    try {
        const { name, phone, settings } = req.body;
        const lang = req.lang || 'ar';

        const user = await User.findById(req.userId);
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));

        if (name !== undefined) user.name = name;
        if (phone !== undefined) user.phone = phone;
        if (settings) user.settings = { ...user.settings.toObject?.() || user.settings, ...settings };

        await user.save();
        return successResponse(res, { user: publicUser(user) }, getTranslation('updated', lang));
    } catch (err) {
        logger.error('updateProfile error:', err.message);
        next(err);
    }
};

// PUT /api/auth/change-password
const changePassword = async (req, res, next) => {
    try {
        const newPassword = req.body.newPassword;
        // Tolerate both field names (frontend sends currentPassword)
        const oldPassword = req.body.oldPassword || req.body.currentPassword;
        const lang = req.lang || 'ar';

        if (!oldPassword || !newPassword) return errorResponse(res, 400, getTranslation('missingFields', lang));
        if (newPassword.length < 8) return errorResponse(res, 400, getTranslation('passwordTooShort', lang));
        if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return errorResponse(res, 400, getTranslation('passwordWeak', lang));
        if (oldPassword === newPassword) return errorResponse(res, 400, getTranslation('passwordSameAsOld', lang));

        const user = await User.findById(req.userId).select('+password');
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) return errorResponse(res, 400, getTranslation('passwordMismatch', lang));

        user.password = newPassword;
        await user.save();

        return successResponse(res, null, getTranslation('passwordChanged', lang));
    } catch (err) {
        logger.error('changePassword error:', err.message);
        next(err);
    }
};

// POST /api/auth/refresh — requires a valid token (auth middleware on the route)
const refresh = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findById(req.userId).select('-password');
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        const token = signToken(user);
        return successResponse(res, { token, user: publicUser(user) }, getTranslation('tokenRefreshed', lang));
    } catch (err) {
        logger.error('refresh error:', err.message);
        next(err);
    }
};

// POST /api/auth/logout — client-side removes token; server returns success.
const logout = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        return successResponse(res, null, getTranslation('logoutSuccess', lang));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    login,
    register,
    getMe,
    updateProfile,
    changePassword,
    refresh,
    logout
};
