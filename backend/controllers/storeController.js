// backend/controllers/storeController.js
// DZ POS PRO v3 — Platform (super-admin) store management.
const Store = require('../models/Store');
const User = require('../models/User');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const Setting = require('../models/Setting');
const { successResponse, createdResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');

// GET /api/stores — list all stores with quick stats
const list = async (req, res, next) => {
    try {
        const stores = await Store.find({}).sort({ createdAt: -1 }).lean();
        const stats = await Promise.all(stores.map(async (s) => {
            const [users, products, sales] = await Promise.all([
                User.countDocuments({ storeId: s._id }),
                Product.countDocuments({ storeId: s._id }),
                Sale.aggregate([
                    { $match: { storeId: s._id, status: { $nin: ['cancelled'] } } },
                    { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
                ])
            ]);
            const rev = sales[0] || { revenue: 0, count: 0 };
            return {
                ...s,
                stats: { users, products, revenue: Math.round((rev.revenue || 0) * 100) / 100, salesCount: rev.count || 0 }
            };
        }));
        return successResponse(res, { data: stats, total: stats.length });
    } catch (err) { next(err); }
};

// GET /api/stores/platform-stats — platform KPIs for super-admin home
const platformStats = async (req, res, next) => {
    try {
        const [stores, active, suspended, users, products, salesAgg] = await Promise.all([
            Store.countDocuments({}),
            Store.countDocuments({ status: 'active' }),
            Store.countDocuments({ status: 'suspended' }),
            User.countDocuments({ role: { $ne: 'superadmin' } }),
            Product.countDocuments({}),
            Sale.aggregate([
                { $match: { status: { $nin: ['cancelled'] } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
            ])
        ]);
        const rev = salesAgg[0] || { revenue: 0, count: 0 };
        return successResponse(res, {
            stores: { total: stores, active, suspended },
            users, products,
            revenue: Math.round((rev.revenue || 0) * 100) / 100,
            salesCount: rev.count || 0
        });
    } catch (err) { next(err); }
};

// POST /api/stores — create a store (+ its admin user)
const create = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { name, ownerName, email, password, phone, plan, adminName } = req.body;
        if (!name || !email || !password) return errorResponse(res, 400, getTranslation('missingFields', lang));

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        const store = new Store({
            name, ownerName: ownerName || adminName || '', email, phone: phone || '',
            plan: ['trial', 'basic', 'pro', 'enterprise'].includes(plan) ? plan : 'trial'
        });
        await store.save();

        const admin = new User({
            name: adminName || ownerName || name,
            email, password, phone: phone || '',
            role: 'admin', storeId: store._id
        });
        await admin.save();
        await Setting.create({ storeId: store._id, storeName: name }).catch(() => {});

        return createdResponse(res, { store: store.toPublicInfo(), admin: { id: admin._id, email: admin.email } }, getTranslation('storeCreated', lang));
    } catch (err) { next(err); }
};

// PUT /api/stores/:id — update plan/status/limits
const update = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id);
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const { name, ownerName, phone, plan, status, limits, notes, trialDays } = req.body;
        if (name !== undefined) store.name = name;
        if (ownerName !== undefined) store.ownerName = ownerName;
        if (phone !== undefined) store.phone = phone;
        if (['trial', 'basic', 'pro', 'enterprise'].includes(plan)) store.plan = plan;
        if (['active', 'suspended'].includes(status)) {
            store.status = status;
            store.isActive = status === 'active';
        }
        if (limits && typeof limits === 'object') store.limits = { ...store.limits.toObject(), ...limits };
        if (notes !== undefined) store.notes = notes;
        if (trialDays !== undefined) store.trialEndsAt = new Date(Date.now() + trialDays * 24 * 3600 * 1000);
        await store.save();
        return successResponse(res, store.toPublicInfo(), getTranslation('updated', lang));
    } catch (err) { next(err); }
};

// DELETE /api/stores/:id — purge store + all its data (danger)
const remove = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id);
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const sid = store._id;
        // Purge tenant data (keep platform: stores of others, PlatformSetting, BackupRecord)
        const CleanupModels = [Sale, Product, Customer, Setting, User];
        for (const M of CleanupModels) await M.deleteMany({ storeId: sid });
        for (const name of ['Notification', 'AlertConfig', 'PushSubscription', 'AuditLog', 'AIUsage']) {
            const M = require('../models/' + name);
            await M.deleteMany({ storeId: sid });
        }
        await Store.deleteOne({ _id: sid });
        return successResponse(res, { ok: true }, getTranslation('deleted', lang));
    } catch (err) { next(err); }
};

// POST /api/stores/:id/users — add a user to a store (superadmin convenience)
const addUser = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id);
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) return errorResponse(res, 400, getTranslation('missingFields', lang));
        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));
        const user = new User({
            name, email, password, phone: req.body.phone || '',
            role: ['admin', 'manager', 'cashier'].includes(role) ? role : 'cashier',
            storeId: store._id
        });
        await user.save();
        return createdResponse(res, { user: { id: user._id, email: user.email, role: user.role } }, getTranslation('userCreated', lang));
    } catch (err) { next(err); }
};

module.exports = { list, platformStats, create, update, remove, addUser };
