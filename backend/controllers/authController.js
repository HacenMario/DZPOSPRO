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

const publicUser = (user, store = null) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    settings: user.settings,
    lastLogin: user.lastLogin,
    storeId: user.storeId || null,
    store: store || null
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

        // Load tenant store (SaaS) and verify it is active
        let store = null;
        if (user.storeId && user.role !== 'superadmin') {
            try {
                const Store = require('../models/Store');
                const storeDoc = await Store.findById(user.storeId).lean();
                if (storeDoc) {
                    if (storeDoc.status === 'suspended') {
                        return errorResponse(res, 403, getTranslation('storeSuspended', lang));
                    }
                    store = { id: storeDoc._id, name: storeDoc.name, plan: storeDoc.plan, status: storeDoc.status };
                }
            } catch (e) { logger.warn('Store lookup on login failed:', e.message); }
        }

        const token = signToken(user);
        return successResponse(res, { token, user: publicUser(user, store) }, getTranslation('loginSuccess', lang));
    } catch (err) {
        logger.error('Login error:', err.message);
        next(err);
    }
};

// POST /api/auth/register  (always open — new users can select role)
const register = async (req, res, next) => {
    try {
        const { name, email, password, phone, role, settings } = req.body;
        const lang = req.lang || 'ar';

        const existing = await User.findOne({ email: { $regex: new RegExp('^' + (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        // Validate role (default to cashier if not provided or invalid)
        const validRoles = ['admin', 'manager', 'cashier'];
        const userRole = validRoles.includes(role) ? role : 'cashier';

        const user = new User({
            name,
            email: (email || '').trim(),
            password,
            phone: phone || '',
            role: userRole,
            settings: settings || undefined
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
        const { oldPassword, newPassword } = req.body;
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

// POST /api/auth/register-store — public self-signup (SaaS onboarding).
// Creates a Store (14-day trial) + its first admin user atomically.
const registerStore = async (req, res, next) => {
    try {
        const { storeName, ownerName, name, email, password, phone, address, lang: langBody } = req.body;
        const lang = langBody || req.lang || 'ar';

        if (!storeName || !name || !email || !password) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const existing = await User.findOne({ email: { $regex: new RegExp('^' + (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        const Store = require('../models/Store');
        const store = new Store({
            name: String(storeName).trim().slice(0, 120),
            ownerName: ownerName || name,
            email: (email || '').trim(),
            phone: phone || '',
            address: address || '',
            plan: 'trial',
            status: 'active',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000)
        });
        await store.save();

        const user = new User({
            name,
            email: (email || '').trim(),
            password,
            phone: phone || '',
            role: 'admin',
            storeId: store._id
        });
        await user.save();

        // Give the store its own settings document
        try {
            const Setting = require('../models/Setting');
            await Setting.create({ storeId: store._id, storeName: store.name });
        } catch (e) { logger.warn('Store settings bootstrap failed:', e.message); }

        const token = signToken(user);
        return createdResponse(res, {
            token,
            user: publicUser(user, store.toPublicInfo()),
            store: store.toPublicInfo()
        }, getTranslation('storeCreated', lang));
    } catch (err) {
        logger.error('registerStore error:', err.message);
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
    logout,
    registerStore
};
