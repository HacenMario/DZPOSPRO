// backend/controllers/userController.js
const User = require('../models/User');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

// GET /api/users?page&limit
const getUsers = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const filter = {};
        if (req.query.search) {
            const r = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [{ name: r }, { email: r }, { phone: r }];
        }
        if (req.query.role) filter.role = req.query.role;

        const [data, total] = await Promise.all([
            User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter)
        ]);
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getUsers error:', err.message);
        next(err);
    }
};

// GET /api/users/:id
const getUserById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        return successResponse(res, { user });
    } catch (err) {
        logger.error('getUserById error:', err.message);
        next(err);
    }
};

// POST /api/users  (admin)
const createUser = async (req, res, next) => {
    try {
        const { name, email, password, phone, role, isActive, settings } = req.body;
        const lang = req.lang || 'ar';

        const existing = await User.findOne({ email: { $regex: new RegExp('^' + (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        const user = new User({
            name, email: (email || '').trim(), password,
            phone: phone || '', role: role || 'cashier',
            isActive: isActive !== undefined ? isActive : true,
            settings: settings || undefined
        });
        await user.save();
        return createdResponse(res, { user: { id: user._id, name: user.name, email: user.email, role: user.role } }, getTranslation('userCreated', lang));
    } catch (err) {
        logger.error('createUser error:', err.message);
        next(err);
    }
};

// PUT /api/users/:id  (admin)
const updateUser = async (req, res, next) => {
    try {
        const { name, email, phone, role, isActive, settings, password } = req.body;
        const lang = req.lang || 'ar';

        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));

        if (name !== undefined) user.name = name;
        if (email !== undefined) {
            const trimmedEmail = String(email).trim();
            if (!trimmedEmail) return errorResponse(res, 400, getTranslation('missingFields', lang));
            // Uniqueness check (case-insensitive), excluding this user
            if (trimmedEmail.toLowerCase() !== String(user.email || '').toLowerCase()) {
                const dup = await User.findOne({ email: { $regex: new RegExp('^' + trimmedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }, _id: { $ne: user._id } });
                if (dup) return errorResponse(res, 400, getTranslation('emailExists', lang));
            }
            user.email = trimmedEmail;
        }
        if (phone !== undefined) user.phone = phone;
        if (role !== undefined) user.role = role;
        if (isActive !== undefined) user.isActive = isActive;
        if (settings) user.settings = { ...(user.settings.toObject?.() || user.settings), ...settings };

        // Password reset (optional field — same rules as change-password:
        // min 8 chars with at least one letter and one number)
        if (password && typeof password === 'string' && password.trim() !== '') {
            const pw = password.trim();
            if (pw.length < 8) return errorResponse(res, 400, getTranslation('passwordTooShort', lang));
            if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return errorResponse(res, 400, getTranslation('passwordWeak', lang));
            user.password = pw;
        }

        await user.save();
        return successResponse(res, { user: { ...user.toObject(), password: undefined } }, getTranslation('userUpdated', lang));
    } catch (err) {
        logger.error('updateUser error:', err.message);
        next(err);
    }
};

// DELETE /api/users/:id  (admin)
const deleteUser = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        if (user.role === 'admin') return errorResponse(res, 400, getTranslation('cannotDeleteAdmin', lang));

        await user.deleteOne();
        return successResponse(res, null, getTranslation('userDeleted', lang));
    } catch (err) {
        logger.error('deleteUser error:', err.message);
        next(err);
    }
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
