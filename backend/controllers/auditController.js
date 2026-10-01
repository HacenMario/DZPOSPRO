// backend/controllers/auditController.js — audit trail queries (admin+).
const AuditLog = require('../models/AuditLog');
const { tenantScope } = require('../utils/tenantPlugin');
const { successResponse } = require('../utils/response');

// GET /api/audit?page&limit&user&action&entity&from&to
const list = async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const filter = {};
        if (req.query.user) filter.user = req.query.user;
        if (req.query.action) filter.action = req.query.action;
        if (req.query.entity) filter.entity = req.query.entity;
        if (req.query.from || req.query.to) {
            filter.createdAt = {};
            if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
            if (req.query.to) filter.createdAt.$lte = new Date(req.query.to + 'T23:59:59.999Z');
        }
        const [data, total] = await Promise.all([
            AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AuditLog.countDocuments(filter)
        ]);
        return successResponse(res, { data, total, page, totalPages: Math.ceil(total / limit) || 1 });
    } catch (err) { next(err); }
};

// GET /api/audit/stats?days=7 — quick activity overview
const stats = async (req, res, next) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);
        const [byAction, byUser, top] = await Promise.all([
            AuditLog.aggregate([
                { $match: { ...tenantScope(), createdAt: { $gte: since } } },
                { $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }
            ]),
            AuditLog.aggregate([
                { $match: { ...tenantScope(), createdAt: { $gte: since } } },
                { $group: { _id: '$userName', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }
            ]),
            AuditLog.aggregate([
                { $match: { ...tenantScope(), createdAt: { $gte: since } } },
                { $group: { _id: '$entity', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }
            ])
        ]);
        return successResponse(res, { byAction, byUser, byEntity: top, days });
    } catch (err) { next(err); }
};

module.exports = { list, stats };
