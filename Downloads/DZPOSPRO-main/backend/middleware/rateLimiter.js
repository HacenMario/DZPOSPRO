// backend/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Strict limiter for login (5 attempts / 15 min per IP)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many login attempts. Please try again in 15 minutes.'
    }
});

// General limiter applied globally to /api
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests. Please slow down.'
    }
});

module.exports = { loginLimiter, generalLimiter };
