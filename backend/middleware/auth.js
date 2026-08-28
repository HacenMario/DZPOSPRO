// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
    try {
        const header = req.header('Authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) {
            return res.status(401).json({
                success: false,
                message: getTranslation('unauthorized', req.lang || 'ar')
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: getTranslation('invalidToken', req.lang || 'ar')
            });
        }

        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({
                success: false,
                message: getTranslation('userNotFound', req.lang || 'ar')
            });
        }
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: getTranslation('accountDisabled', req.lang || 'ar')
            });
        }

        req.user = user;
        req.userId = user._id;
        req.userRole = user.role;
        next();
    } catch (error) {
        logger.error('Auth middleware failure:', error.message);
        return res.status(401).json({
            success: false,
            message: getTranslation('unauthorized', req.lang || 'ar')
        });
    }
};

module.exports = authMiddleware;
