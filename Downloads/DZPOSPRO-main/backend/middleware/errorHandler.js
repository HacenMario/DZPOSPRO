// backend/middleware/errorHandler.js
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');

// 404 — unknown route
const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: getTranslation('notFound', req.lang || 'ar')
    });
};

// Central error handler (must have 4 args)
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    logger.error(`[errorHandler] ${err.message}`, err.stack || '');

    // Mongoose CastError — invalid ObjectId in a param/query → 400, not 500
    if (err.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'Invalid id format' });
    }

    // Mongoose ValidationError → 400 with the first field message
    if (err.name === 'ValidationError' && err.errors) {
        const first = Object.values(err.errors)[0];
        return res.status(400).json({
            success: false,
            message: first ? first.message : getTranslation('invalidData', req.lang || 'ar')
        });
    }

    // Multer upload errors → 400
    if (err.name === 'MulterError' || (typeof err.code === 'string' && err.code.startsWith('LIMIT_'))) {
        return res.status(400).json({ success: false, message: err.message });
    }

    const statusCode = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    const message = err.expose ? err.message : (statusCode === 500 ? getTranslation('serverError', req.lang || 'ar') : err.message);

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

// Wrap async controllers so rejections are forwarded to errorHandler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, notFound, asyncHandler };
