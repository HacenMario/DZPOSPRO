// backend/middleware/language.js
// Detects request language from the Accept-Language header (or ?lang=) and
// attaches it as req.lang. Defaults to 'ar'. Must be registered very early,
// before any route handler that reads req.lang.
const SUPPORTED = ['ar', 'en', 'fr'];

const languageMiddleware = (req, res, next) => {
    let lang = null;

    if (typeof req.query.lang === 'string' && SUPPORTED.includes(req.query.lang)) {
        lang = req.query.lang;
    } else {
        const header = req.headers['accept-language'] || '';
        const primary = header.split(',')[0]?.split(';')[0]?.trim().slice(0, 2).toLowerCase();
        if (SUPPORTED.includes(primary)) lang = primary;
    }

    req.lang = lang || 'ar';
    next();
};

module.exports = languageMiddleware;
