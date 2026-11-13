// backend/middleware/language.js
// Detects request language and attaches it as req.lang.
// v4.2 priority order:
//   1. ?lang= query param           (explicit per-call override)
//   2. x-dzpos-lang header          (set by the app on every request —
//                                    reflects the language chosen in the UI)
//   3. Accept-Language header       (browser language — LAST resort,
//                                    was the old default which made
//                                    Algerian browsers get French AI texts)
//   4. 'ar' fallback
// Must be registered very early, before any route handler reading req.lang.
const SUPPORTED = ['ar', 'en', 'fr', 'tr', 'es', 'it', 'de', 'ru', 'zh'];

const languageMiddleware = (req, res, next) => {
    let lang = null;

    if (typeof req.query.lang === 'string' && SUPPORTED.includes(req.query.lang)) {
        lang = req.query.lang;
    } else if (req.headers['x-dzpos-lang'] && SUPPORTED.includes(String(req.headers['x-dzpos-lang']).toLowerCase().trim())) {
        lang = String(req.headers['x-dzpos-lang']).toLowerCase().trim();
    } else {
        const header = req.headers['accept-language'] || '';
        const primary = header.split(',')[0]?.split(';')[0]?.trim().slice(0, 2).toLowerCase();
        if (SUPPORTED.includes(primary)) lang = primary;
    }

    req.lang = lang || 'ar';
    next();
};

module.exports = languageMiddleware;
