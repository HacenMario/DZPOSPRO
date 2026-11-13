// backend/controllers/auditController.js — audit trail queries (admin+).
// v4.2 — adds `search` (userName/userEmail/entity/entityId/method/path/ip),
// `method` filter and `device`-aware listing (userAgent already stored).
const AuditLog = require('../models/AuditLog');
const { tenantScope } = require('../utils/tenantPlugin');
const { successResponse } = require('../utils/response');

// GET /api/audit?page&limit&user&action&entity&method&search&from&to
const list = async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const filter = {};
        if (req.query.user) filter.user = req.query.user;
        if (req.query.action) filter.action = req.query.action;
        if (req.query.entity) filter.entity = req.query.entity;
        if (req.query.method) filter.method = String(req.query.method).toUpperCase();
        if (req.query.from || req.query.to) {
            filter.createdAt = {};
            if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
            if (req.query.to) filter.createdAt.$lte = new Date(req.query.to + 'T23:59:59.999Z');
        }
        // v4.2 — free-text search across the common text fields
        if (req.query.search && String(req.query.search).trim()) {
            const rx = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [
                { userName: rx }, { userEmail: rx }, { entity: rx },
                { entityId: rx }, { method: rx }, { path: rx }, { ip: rx }
            ];
        }
        const [data, total] = await Promise.all([
            AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AuditLog.countDocuments(filter)
        ]);
        return successResponse(res, { data, total, page, totalPages: Math.ceil(total / limit) || 1 });
    } catch (err) { next(err); }
};

// GET /api/audit/stats?days=7 — quick activity overview
// v4.2 — adds unique users, hourly activity heat and device split.
const stats = async (req, res, next) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);
        const match = { ...tenantScope(), createdAt: { $gte: since } };
        const [byAction, byUser, top, totals, byHour] = await Promise.all([
            AuditLog.aggregate([
                { $match: match },
                { $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }
            ]),
            AuditLog.aggregate([
                { $match: match },
                { $group: { _id: '$userName', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }
            ]),
            AuditLog.aggregate([
                { $match: match },
                { $group: { _id: '$entity', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }
            ]),
            AuditLog.aggregate([
                { $match: match },
                { $group: { _id: null, total: { $sum: 1 }, users: { $addToSet: '$userName' }, entities: { $addToSet: '$entity' } } },
                { $project: { total: 1, users: { $size: '$users' }, entities: { $size: '$entities' } } }
            ]),
            // last 24 h activity per hour (for the mini bar strip)
            AuditLog.aggregate([
                { $match: { ...tenantScope(), createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } } },
                { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
                { $sort: { '_id': 1 } }
            ])
        ]);
        const t = totals[0] || { total: 0, users: 0, entities: 0 };
        return successResponse(res, {
            byAction, byUser, byEntity: top, byHour, days,
            total: t.total, uniqueUsers: t.users, uniqueEntities: t.entities
        });
    } catch (err) { next(err); }
};

module.exports = { list, stats };
