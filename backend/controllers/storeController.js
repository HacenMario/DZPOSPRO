// backend/controllers/storeController.js
// DZ POS PRO v3.2 — Platform (super-admin) store management.
const Store = require('../models/Store');
const User = require('../models/User');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const AIUsage = require('../models/AIUsage');
const jwt = require('jsonwebtoken');
const { successResponse, createdResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');
const { notifyStore } = require('../services/notifyService');
const { invalidateStoreCache } = require('../middleware/tenant');
const logger = require('../utils/logger');

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
        const { name, ownerName, email, password, phone, plan, adminName, city, address, trialDays, limits } = req.body;
        if (!name || !email || !password) return errorResponse(res, 400, getTranslation('missingFields', lang));
        if (String(password).length < 6) return errorResponse(res, 400, getTranslation('weakPassword', lang) || 'Password too short');

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return errorResponse(res, 400, getTranslation('emailExists', lang));

        const store = new Store({
            name, ownerName: ownerName || adminName || '', email, phone: phone || '',
            city: city || '', address: address || '',
            plan: ['trial', 'basic', 'pro', 'enterprise'].includes(plan) ? plan : 'trial',
            trialEndsAt: trialDays ? new Date(Date.now() + parseInt(trialDays, 10) * 24 * 3600 * 1000) : undefined
        });
        if (limits && typeof limits === 'object') {
            store.limits = { ...store.limits.toObject(), ...limits };
        }
        await store.save();

        const admin = new User({
            name: adminName || ownerName || name,
            email, password, phone: phone || '',
            role: 'admin', storeId: store._id
        });
        await admin.save();
        await Setting.create({ storeId: store._id, storeName: name }).catch(() => {});

        // Welcome notification for the new store's team
        notifyStore({
            storeId: store._id, type: 'success', push: false,
            title: lang === 'fr' ? 'Bienvenue sur DZ POS PRO 🎉' : lang === 'en' ? 'Welcome to DZ POS PRO 🎉' : 'مرحباً بك في DZ POS PRO 🎉',
            body: lang === 'fr' ? `Le magasin "${name}" a été créé. Bonne vente !` : lang === 'en' ? `Store "${name}" has been created. Happy selling!` : `تم إنشاء مخزن "${name}" بنجاح. بيعاً موفقاً!`
        }).catch(() => {});

        return createdResponse(res, { store: store.toPublicInfo(), admin: { id: admin._id, email: admin.email } }, getTranslation('storeCreated', lang));
    } catch (err) { next(err); }
};

// PUT /api/stores/:id — update plan/status/limits
const update = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id);
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const { name, ownerName, phone, email, city, address, plan, status, limits, notes, trialDays, suspendedReason } = req.body;
        if (name !== undefined) store.name = name;
        if (ownerName !== undefined) store.ownerName = ownerName;
        if (phone !== undefined) store.phone = phone;
        if (email !== undefined) store.email = email;
        if (city !== undefined) store.city = city;
        if (address !== undefined) store.address = address;
        const planChanged = plan !== undefined && plan !== store.plan;
        if (['trial', 'basic', 'pro', 'enterprise'].includes(plan)) store.plan = plan;
        const statusChanged = status !== undefined && status !== store.status;
        if (['active', 'suspended'].includes(status)) {
            store.status = status;
            store.isActive = status === 'active';
        }
        if (suspendedReason !== undefined) store.suspendedReason = suspendedReason;
        if (limits && typeof limits === 'object') store.limits = { ...store.limits.toObject(), ...limits };
        if (notes !== undefined) store.notes = notes;
        if (trialDays !== undefined) store.trialEndsAt = new Date(Date.now() + trialDays * 24 * 3600 * 1000);
        await store.save();
        invalidateStoreCache(store._id);

        // Notify the store's team about subscription-level changes
        if (statusChanged || planChanged) {
            const title = statusChanged
                ? (status === 'suspended'
                    ? (lang === 'fr' ? '⚠️ Magasin suspendu' : lang === 'en' ? '⚠️ Store suspended' : '⚠️ تم إيقاف المخزن')
                    : (lang === 'fr' ? '✅ Magasin réactivé' : lang === 'en' ? '✅ Store reactivated' : '✅ تم تفعيل المخزن'))
                : (lang === 'fr' ? `💼 Abonnement: ${plan}` : lang === 'en' ? `💼 Subscription: ${plan}` : `💼 الخطة الجديدة: ${plan}`);
            const body = statusChanged
                ? (status === 'suspended'
                    ? (lang === 'fr' ? 'Contactez la plateforme pour réactiver votre compte.' : lang === 'en' ? 'Contact the platform to reactivate your account.' : 'يرجى التواصل مع إدارة المنصة لإعادة التفعيل.')
                    : (lang === 'fr' ? 'Votre magasin est de nouveau actif.' : lang === 'en' ? 'Your store is active again.' : 'تمت إعادة تفعيل مخزنكم، يمكنكم متابعة العمل.'))
                : (lang === 'fr' ? `Votre magasin est passé au plan "${plan}".` : lang === 'en' ? `Your store was moved to the "${plan}" plan.` : `تم تحديث خطة مخزنكم إلى "${plan}".`);
            notifyStore({ storeId: store._id, type: status === 'suspended' ? 'warning' : 'info', title, body }).catch(() => {});
        }

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
        invalidateStoreCache(sid);
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

// ===== v3.2 — professional platform management =====

// GET /api/stores/platform-overview — super-admin home: KPIs + recent activity
const platformOverview = async (req, res, next) => {
    try {
        const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
        const [stores, active, suspended, trial, trialEndingSoon, users, products, salesAgg, aiToday, recentStores, recentAudit] = await Promise.all([
            Store.countDocuments({}),
            Store.countDocuments({ status: 'active' }),
            Store.countDocuments({ status: 'suspended' }),
            Store.countDocuments({ plan: 'trial', status: 'active' }),
            Store.countDocuments({ plan: 'trial', status: 'active', trialEndsAt: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) } }),
            User.countDocuments({ role: { $ne: 'superadmin' } }),
            Product.countDocuments({}),
            Sale.aggregate([
                { $match: { status: { $nin: ['cancelled'] } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
            ]),
            AIUsage.countDocuments({ createdAt: { $gte: dayAgo } }),
            Store.find({}).sort({ createdAt: -1 }).limit(5).select('name plan status trialEndsAt createdAt').lean(),
            AuditLog.find({}).sort({ createdAt: -1 }).limit(8).select('userName action entity summary createdAt').lean()
        ]);
        const rev = salesAgg[0] || { revenue: 0, count: 0 };
        return successResponse(res, {
            stores: { total: stores, active, suspended, trial, trialEndingSoon },
            users, products,
            revenue: Math.round((rev.revenue || 0) * 100) / 100,
            salesCount: rev.count || 0,
            aiCallsToday: aiToday,
            recentStores, recentAudit
        });
    } catch (err) { next(err); }
};

// GET /api/stores/:id — one store + full stats
const getDetails = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id).lean();
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const [users, products, customers, salesAgg, monthAgg] = await Promise.all([
            User.countDocuments({ storeId: store._id }),
            Product.countDocuments({ storeId: store._id }),
            Customer.countDocuments({ storeId: store._id }),
            Sale.aggregate([
                { $match: { storeId: store._id, status: { $nin: ['cancelled'] } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
            ]),
            Sale.aggregate([
                { $match: { storeId: store._id, status: { $nin: ['cancelled'] }, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
            ])
        ]);
        const rev = salesAgg[0] || { revenue: 0, count: 0 };
        const m = monthAgg[0] || { revenue: 0, count: 0 };
        return successResponse(res, {
            store,
            stats: {
                users, products, customers,
                revenue: Math.round((rev.revenue || 0) * 100) / 100,
                salesCount: rev.count || 0,
                revenue30d: Math.round((m.revenue || 0) * 100) / 100,
                salesCount30d: m.count || 0
            }
        });
    } catch (err) { next(err); }
};

// GET /api/stores/:id/users — accounts of a store
const listUsers = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id).select('name').lean();
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const users = await User.find({ storeId: req.params.id })
            .select('name email phone role isActive createdAt lastLogin')
            .sort({ role: 1, createdAt: -1 }).lean();
        return successResponse(res, { store, users });
    } catch (err) { next(err); }
};

// PATCH /api/stores/:id/users/:userId — role / active / password (super-admin)
const patchStoreUser = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findOne({ _id: req.params.userId, storeId: req.params.id });
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        const { role, isActive, password } = req.body;
        if (role !== undefined) {
            if (!['admin', 'manager', 'cashier'].includes(role)) return errorResponse(res, 400, getTranslation('invalidRole', lang) || 'Invalid role');
            user.role = role;
        }
        if (isActive !== undefined) user.isActive = !!isActive;
        if (password !== undefined) {
            if (String(password).length < 6) return errorResponse(res, 400, 'Password too short');
            user.password = password;
        }
        await user.save();
        return successResponse(res, { id: user._id, role: user.role, isActive: user.isActive }, getTranslation('updated', lang));
    } catch (err) { next(err); }
};

// DELETE /api/stores/:id/users/:userId — remove a store account (guard: last active admin)
const removeStoreUser = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const user = await User.findOne({ _id: req.params.userId, storeId: req.params.id });
        if (!user) return errorResponse(res, 404, getTranslation('userNotFound', lang));
        if (user.role === 'admin' && user.isActive !== false) {
            const activeAdmins = await User.countDocuments({ storeId: req.params.id, role: 'admin', isActive: { $ne: false } });
            if (activeAdmins <= 1) return errorResponse(res, 400, getTranslation('lastAdmin', lang) || 'Cannot remove the last active admin');
        }
        await User.deleteOne({ _id: user._id });
        return successResponse(res, { ok: true }, getTranslation('deleted', lang));
    } catch (err) { next(err); }
};

// POST /api/stores/:id/extend-trial { days } — extend trial from now/max-end
const extendTrial = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id);
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const days = Math.min(365, Math.max(1, parseInt(req.body.days, 10) || 14));
        const base = store.trialEndsAt && store.trialEndsAt > new Date() ? store.trialEndsAt : new Date();
        store.trialEndsAt = new Date(base.getTime() + days * 24 * 3600 * 1000);
        if (store.status === 'suspended' && (store.plan === 'trial')) store.status = 'active';
        await store.save();
        invalidateStoreCache(store._id);
        notifyStore({
            storeId: store._id, type: 'success', push: true,
            title: lang === 'fr' ? '⏳ Période d\u2019essai étendue' : lang === 'en' ? '⏳ Trial extended' : '⏳ تم تمديد فترة التجربة',
            body: lang === 'fr' ? `Votre essai est prolongé de ${days} jours.` : lang === 'en' ? `Your trial was extended by ${days} days.` : `تم تمديد تجربتكم ${days} يوماً إضافية.`
        }).catch(() => {});
        return successResponse(res, { trialEndsAt: store.trialEndsAt, days }, getTranslation('updated', lang));
    } catch (err) { next(err); }
};

// POST /api/stores/:id/login-as — impersonate the store's active admin (2h token)
const loginAs = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const store = await Store.findById(req.params.id).lean();
        if (!store) return errorResponse(res, 404, getTranslation('notFound', lang));
        const admin = await User.findOne({ storeId: req.params.id, role: 'admin', isActive: { $ne: false } })
            .sort({ createdAt: 1 }).select('-password');
        if (!admin) return errorResponse(res, 400, getTranslation('userNotFound', lang));
        const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '2h' });
        return successResponse(res, {
            token,
            user: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, storeId: admin.storeId },
            store: { id: store._id, name: store.name },
            expiresInHours: 2
        }, lang === 'fr' ? 'Session temporaire créée' : lang === 'en' ? 'Temporary session created' : 'تم إنشاء جلسة مؤقتة');
    } catch (err) { next(err); }
};

module.exports = { list, platformStats, platformOverview, getDetails, listUsers, patchStoreUser, removeStoreUser, extendTrial, loginAs, create, update, remove, addUser };
