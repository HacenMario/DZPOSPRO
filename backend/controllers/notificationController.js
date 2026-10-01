// backend/controllers/notificationController.js
// DZ POS PRO v3 — notification centre (list / unread count / mark read).
const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');

function audienceFilter(req) {
    // Notifications visible to me: store-scoped, targeted to my role or to me
    const base = { storeId: req.storeId };
    const roles = ['admin', 'manager', 'cashier'];
    const mine = req.userRole === 'superadmin'
        ? base
        : { ...base, $and: [
            { $or: [ { user: null }, { user: req.userId } ] },
            { $or: [ { audienceRoles: { $exists: false } }, { audienceRoles: { $size: 0 } }, { audienceRoles: req.userRole } ] }
        ] };
    void roles;
    return mine;
}

// GET /api/notifications?page=1&limit=20
const list = async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);
        const filter = audienceFilter(req);
        const [items, total, unreadDocs] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Notification.countDocuments(filter),
            Notification.find({ ...filter, readBy: { $ne: req.userId } }).distinct('_id')
        ]);
        return successResponse(res, {
            data: items, total, page, totalPages: Math.ceil(total / limit) || 1,
            unread: unreadDocs.length
        });
    } catch (err) { next(err); }
};

// GET /api/notifications/unread-count
const unreadCount = async (req, res, next) => {
    try {
        const ids = await Notification.find({ ...audienceFilter(req), readBy: { $ne: req.userId } }).distinct('_id');
        return successResponse(res, { count: ids.length });
    } catch (err) { next(err); }
};

// POST /api/notifications/mark-read  { ids: [...] } or { all: true }
const markRead = async (req, res, next) => {
    try {
        const { ids, all } = req.body || {};
        if (all) {
            await Notification.updateMany(
                { ...audienceFilter(req), readBy: { $ne: req.userId } },
                { $addToSet: { readBy: req.userId } }
            );
        } else if (Array.isArray(ids) && ids.length) {
            await Notification.updateMany(
                { ...audienceFilter(req), _id: { $in: ids }, readBy: { $ne: req.userId } },
                { $addToSet: { readBy: req.userId } }
            );
        } else {
            return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        }
        return successResponse(res, { ok: true });
    } catch (err) { next(err); }
};

// DELETE /api/notifications/:id  (admin)
const remove = async (req, res, next) => {
    try {
        await Notification.deleteOne({ _id: req.params.id, storeId: req.storeId });
        return successResponse(res, { ok: true });
    } catch (err) { next(err); }
};

module.exports = { list, unreadCount, markRead, remove };
