// backend/middleware/audit.js
// DZ POS PRO v3 — Global audit trail middleware.
// Logs every successful mutating API call (POST/PUT/PATCH/DELETE) with the
// actor, entity, and a sanitized payload summary. Never blocks the request:
// logging failures are swallowed (audit must not break business flow).
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const SKIP_PREFIXES = [
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/register',
    '/api/push/subscribe',
    '/api/push/unsubscribe',
    '/api/health'
];

const SENSITIVE_KEYS = ['password', 'newPassword', 'oldPassword', 'confirmPassword', 'token', 'refreshToken', 'keys'];

function sanitize(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 2) return undefined;
    if (Array.isArray(obj)) return obj.length > 20 ? `[${obj.length} items]` : obj.map(v => sanitize(v, depth + 1));
    const out = {};
    let count = 0;
    for (const k of Object.keys(obj)) {
        if (count > 25) { out._truncated = true; break; }
        if (SENSITIVE_KEYS.includes(k)) { out[k] = '[redacted]'; continue; }
        const v = obj[k];
        if (typeof v === 'string' && v.length > 300) out[k] = v.slice(0, 300) + '…';
        else if (typeof v === 'object') { const s = sanitize(v, depth + 1); if (s !== undefined) out[k] = s; }
        else out[k] = v;
        count++;
    }
    return out;
}

function classify(method, path) {
    if (path.includes('/auth/login')) return 'login';
    if (path.includes('/auth/logout')) return 'logout';
    if (path.includes('/export') || path.includes('/download')) return 'export';
    if (path.includes('/restore')) return 'restore';
    if (path.includes('/ai/')) return 'ai';
    if (method === 'POST') return 'create';
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'other';
}

const auditMiddleware = (req, res, next) => {
    // Only audit mutations on the API (skip GET and skipped prefixes)
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!isMutation || SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();

    res.on('finish', () => {
        try {
            if (res.statusCode >= 400) return; // audit only successful ops
            // Derive entity from path: /api/<entity>/...
            const parts = (req.path || '').split('/').filter(Boolean); // ['api','products','123']
            const entity = parts[1] || '';
            const entityId = /^[0-9a-fA-F]{24}$/.test(parts[2] || '') ? parts[2] : '';

            const bodySummary = sanitize(req.body);
            const querySummary = sanitize(req.query);

            AuditLog.create({
                storeId: (req.user && req.user.role !== 'superadmin') ? (req.user.storeId || null) : null,
                user: req.userId || null,
                userName: (req.user && req.user.name) || '',
                userEmail: (req.user && req.user.email) || '',
                action: classify(req.method, req.path),
                entity,
                entityId,
                method: req.method,
                path: req.originalUrl ? req.originalUrl.slice(0, 300) : req.path,
                summary: { body: bodySummary, query: querySummary },
                ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim(),
                userAgent: (req.headers['user-agent'] || '').slice(0, 250)
            }).catch(err => logger.warn('Audit write failed:', err.message));
        } catch (err) {
            logger.warn('Audit middleware error:', err.message);
        }
    });

    next();
};

module.exports = auditMiddleware;
