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
