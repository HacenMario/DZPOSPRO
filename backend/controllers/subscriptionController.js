// backend/controllers/subscriptionController.js
// DZ POS PRO v4.3 — Professional subscription lifecycle.
// ------------------------------------------------------------------
// STORE SIDE (admin/manager of the tenant):
//   GET   /api/subscription                → full subscription view
//   GET   /api/subscription/requests       → my request history
//   POST  /api/subscription/requests       → request a change / renewal
//   POST  /api/subscription/requests/:id/cancel
//
// SUPER-ADMIN SIDE (billing console):
//   GET   /api/subscription/admin/overview → KPIs, MRR, revenue series…
//   GET   /api/subscription/admin/requests → all requests (filters)
//   POST  /api/subscription/admin/requests/:id/approve  (payment confirmed)
//   POST  /api/subscription/admin/requests/:id/reject
//   POST  /api/subscription/admin/apply    → direct manual change/renewal
//
// Every APPROVED request is kept as a payment record that powers the
// platform revenue statistics.
const Store = require('../models/Store');
const User = require('../models/User');
const Product = require('../models/Product');
const SubscriptionRequest = require('../models/SubscriptionRequest');
const Notification = require('../models/Notification');
const { successResponse, createdResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');
const plans = require('../config/plans');
const { notifyStore } = require('../services/notifyService');
const { invalidateStoreCache } = require('../middleware/tenant');
const { runWithTenant } = require('../services/tenantContext');
const { GRACE_DAYS } = require('../models/Store');
const logger = require('../utils/logger');

const DAY_MS = 24 * 3600 * 1000;

/* ================= helpers ================= */

// Add N calendar months, clamping overflow (Jan 31 + 1 → Feb 28).
function addMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
}

// Human subscription state used by the frontend badges.
function computeState(store) {
    if (store.status === 'suspended') return 'suspended';
    const now = new Date();
    if (store.plan === 'trial') {
        if (store.trialEndsAt && new Date(store.trialEndsAt) < now) return 'trial_expired';
        return 'trial';
    }
    if (!store.subscriptionEndsAt) return 'active'; // legacy — no enforced expiry
    const end = new Date(store.subscriptionEndsAt);
    if (end < now) {
        const graceEnd = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
        return graceEnd > now ? 'grace' : 'expired';
    }
    return Math.ceil((end - now) / DAY_MS) <= 14 ? 'expiring' : 'active';
}

function daysLeftOf(store) {
    const now = new Date();
    if (store.plan === 'trial') {
        if (!store.trialEndsAt) return null;
        return Math.ceil((new Date(store.trialEndsAt) - now) / DAY_MS);
    }
    if (!store.subscriptionEndsAt) return null;
    return Math.ceil((new Date(store.subscriptionEndsAt) - now) / DAY_MS);
}

function requestTypeFor(currentPlan, requestedPlan) {
    if (currentPlan === 'trial') return 'new';
    return requestedPlan !== currentPlan ? 'change' : 'renewal';
}

function notifySuperAdmins({ title, body, data }) {
    // Platform-level notification (storeId null → visible in the
    // super-admin bell only). Created OUTSIDE the store tenant context so
    // the tenant plugin cannot stamp the store's id onto it.
    return runWithTenant({ storeId: null, isSuper: false }, () =>
        Notification.create({ storeId: null, type: 'info', title, body, link: 'platform', data: data || {} })
    ).catch((err) => logger.warn('super-admin notification failed:', err.message));
}

// Core plan application shared by approve + manual apply.
// Returns the computed { base, newEnd } of the paid period.
async function applyPlanToStore(store, { plan, cycle, months, source }) {
    const now = new Date();
    store.plan = plan;
    store.billingCycle = cycle || 'monthly';
    store.planChangedAt = now;
    store.planSource = source || 'request';
    if (!store.subscriptionStart) store.subscriptionStart = now;
    const base = (store.subscriptionEndsAt && new Date(store.subscriptionEndsAt) > now)
        ? new Date(store.subscriptionEndsAt)
        : now; // renewing before expiry extends from the current end (no lost days)
    store.subscriptionEndsAt = addMonths(base, months);
    store.limits = plans.planLimits(plan);          // professional: plan defaults
    if (store.status === 'suspended') {             // a confirmed payment reactivates
        store.status = 'active';
        store.isActive = true;
        store.suspendedReason = '';
    }
    await store.save();
    invalidateStoreCache(store._id);
    return { base, newEnd: store.subscriptionEndsAt };
}

/* ================= STORE SIDE ================= */

// GET /api/subscription — everything the store's admin needs on one page.
const getMySubscription = async (req, res, next) => {
    try {
        const storeId = req.storeFocus || req.storeId;
        if (!storeId) return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        const store = await Store.findById(storeId).lean();
        if (!store) return errorResponse(res, 404, getTranslation('storeNotFound', req.lang || 'ar'));

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [users, products, aiToday, pending, requests] = await Promise.all([
            User.countDocuments({ storeId: store._id, role: { $ne: 'superadmin' } }),
            Product.countDocuments({ storeId: store._id }),
            (async () => {
                try {
                    const AIUsage = require('../models/AIUsage');
                    return await AIUsage.countDocuments({ storeId: store._id, createdAt: { $gte: startOfDay } });
                } catch (_) { return 0; }
            })(),
            SubscriptionRequest.findOne({ storeId: store._id, status: 'pending' }).sort({ createdAt: -1 }).lean(),
            SubscriptionRequest.find({ storeId: store._id }).sort({ createdAt: -1 }).limit(20).lean()
        ]);

        const catalog = plans.publicCatalog();
        const currentPlan = catalog.find(p => p.key === store.plan) || null;

        return successResponse(res, {
            store: {
                id: store._id, name: store.name, plan: store.plan, status: store.status,
                billingCycle: store.billingCycle || null,
                subscriptionStart: store.subscriptionStart || null,
                subscriptionEndsAt: store.subscriptionEndsAt || null,
                trialEndsAt: store.trialEndsAt || null,
                limits: store.limits || {},
                planSource: store.planSource || 'system',
                planChangedAt: store.planChangedAt || null
            },
            plan: currentPlan,
            state: computeState(store),
            daysLeft: daysLeftOf(store),
            graceDays: GRACE_DAYS,
            usage: { users, products, aiToday },
            pending: pending || null,
            requests,
            catalog,
            currency: plans.CURRENCY
        });
    } catch (err) { next(err); }
};

// GET /api/subscription/requests — my store's request / payment history.
const listMyRequests = async (req, res, next) => {
    try {
        const storeId = req.storeFocus || req.storeId;
        if (!storeId) return errorResponse(res, 400, getTranslation('missingFields', req.lang || 'ar'));
        const requests = await SubscriptionRequest.find({ storeId })
            .sort({ createdAt: -1 }).limit(100).lean();
        return successResponse(res, { data: requests, total: requests.length });
    } catch (err) { next(err); }
};

// POST /api/subscription/requests — ask the platform for a plan change /
// first subscription / renewal. The super-admin confirms the payment.
const createRequest = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const storeId = req.storeFocus || req.storeId;
        if (!storeId) return errorResponse(res, 400, getTranslation('missingFields', lang));
        const { requestedPlan, billingCycle, paymentMethod, paymentReference, storeNote } = req.body;

        if (!plans.isPlan(requestedPlan) || !plans.isPaidPlan(requestedPlan)) {
            return errorResponse(res, 400, getTranslation('subscriptionInvalidPlan', lang));
        }
        const cycle = billingCycle || 'monthly';
        if (!plans.isCycle(cycle)) return errorResponse(res, 400, getTranslation('subscriptionInvalidCycle', lang));
        const method = paymentMethod || 'other';
        if (!plans.isPaymentMethod(method)) return errorResponse(res, 400, getTranslation('subscriptionInvalidMethod', lang));

        const store = await Store.findById(storeId);
        if (!store) return errorResponse(res, 404, getTranslation('storeNotFound', lang));

        // one pending request at a time keeps the queue clean
        const existing = await SubscriptionRequest.findOne({ storeId: store._id, status: 'pending' });
        if (existing) return errorResponse(res, 400, getTranslation('subscriptionRequestExists', lang));

        const request = await SubscriptionRequest.create({
            storeId: store._id,
            requestedBy: req.user._id,
            userName: req.user.name || '',
            type: requestTypeFor(store.plan, requestedPlan),
            currentPlan: store.plan,
            requestedPlan,
            billingCycle: cycle,
            amount: plans.price(requestedPlan, cycle),
            paymentMethod: method,
            paymentReference: String(paymentReference || '').trim(),
            storeNote: String(storeNote || '').trim()
        });

        notifyStore({
            storeId: store._id, type: 'info', push: false,
            audienceRoles: ['admin', 'manager'],
            title: lang === 'fr' ? '💼 Demande d\u2019abonnement envoyée' : lang === 'en' ? '💼 Subscription request sent' : '💼 تم إرسال طلب الاشتراك',
            body: lang === 'fr' ? `Votre demande (${requestedPlan} · ${cycle}) attend la confirmation du paiement par la plateforme.` : lang === 'en' ? `Your request (${requestedPlan} · ${cycle}) is waiting for payment confirmation by the platform.` : `طلبكم (${requestedPlan} · ${cycle === 'yearly' ? 'سنوي' : 'شهري'}) في انتظار تأكيد الدفع من إدارة المنصة.`
        }).catch(() => {});

        notifySuperAdmins({
            title: lang === 'fr' ? '💼 Nouvelle demande d\u2019abonnement' : lang === 'en' ? '💼 New subscription request' : '💼 طلب اشتراك جديد',
            body: `${store.name} → ${requestedPlan} · ${cycle} · ${plans.price(requestedPlan, cycle)} DZD`,
            data: { requestId: request._id, storeId: store._id }
        });

        return createdResponse(res, request, getTranslation('subscriptionRequestCreated', lang));
    } catch (err) { next(err); }
};

// POST /api/subscription/requests/:id/cancel — the store withdraws its own
// pending request.
const cancelRequest = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const storeId = req.storeFocus || req.storeId;
        const request = await SubscriptionRequest.findOne({ _id: req.params.id, storeId });
        if (!request) return errorResponse(res, 404, getTranslation('subscriptionRequestNotFound', lang));
        if (request.status !== 'pending') return errorResponse(res, 400, getTranslation('subscriptionAlreadyProcessed', lang));
        request.status = 'cancelled';
        await request.save();
        return successResponse(res, request, getTranslation('subscriptionCancelled', lang));
    } catch (err) { next(err); }
};

/* ================= SUPER-ADMIN SIDE ================= */

// GET /api/subscription/admin/requests?status=&storeId=
const adminListRequests = async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status && SubscriptionRequest.STATUSES.includes(req.query.status)) filter.status = req.query.status;
        if (req.query.storeId) filter.storeId = req.query.storeId;
        const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
        const requests = await SubscriptionRequest.find(filter)
            .sort({ createdAt: -1 }).limit(limit).lean();
        const storeDocs = await Store.find({ _id: { $in: requests.map(r => r.storeId) } })
            .select('name plan status billingCycle subscriptionEndsAt').lean();
        const storeMap = new Map(storeDocs.map(s => [String(s._id), s]));
        return successResponse(res, {
            data: requests.map(r => ({
                ...r,
                store: storeMap.get(String(r.storeId)) || null
            })),
            total: requests.length
        });
    } catch (err) { next(err); }
};

// POST /api/subscription/admin/requests/:id/approve
// The super-admin CONFIRMS the payment → the plan + period are applied.
const approveRequest = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const request = await SubscriptionRequest.findById(req.params.id);
        if (!request) return errorResponse(res, 404, getTranslation('subscriptionRequestNotFound', lang));
        if (request.status !== 'pending') return errorResponse(res, 400, getTranslation('subscriptionAlreadyProcessed', lang));
        const store = await Store.findById(request.storeId);
        if (!store) return errorResponse(res, 404, getTranslation('storeNotFound', lang));

        const months = Math.min(36, Math.max(1, parseInt(req.body.periodMonths, 10) || plans.CYCLE_MONTHS[request.billingCycle] || 1));
        const paidAmount = (req.body.paidAmount != null && !isNaN(Number(req.body.paidAmount)))
            ? Math.max(0, Number(req.body.paidAmount))
            : request.amount;
        if (req.body.paymentMethod && plans.isPaymentMethod(req.body.paymentMethod)) request.paymentMethod = req.body.paymentMethod;
        if (req.body.paymentReference !== undefined) request.paymentReference = String(req.body.paymentReference).trim();

        const { base, newEnd } = await applyPlanToStore(store, {
            plan: request.requestedPlan,
            cycle: request.billingCycle,
            months,
            source: 'request'
        });

        request.status = 'approved';
        request.paidAmount = paidAmount;
        request.periodStart = base;
        request.periodEnd = newEnd;
        request.appliedPlan = store.plan;
        request.adminNote = String(req.body.adminNote || '').trim();
        request.reviewedBy = req.user._id;
        request.reviewedAt = new Date();
        await request.save();

        notifyStore({
            storeId: store._id, type: 'success', push: true,
            title: lang === 'fr' ? '✅ Abonnement activé' : lang === 'en' ? '✅ Subscription activated' : '✅ تم تفعيل الاشتراك',
            body: lang === 'fr'
                ? `Paiement confirmé — plan « ${store.plan} » (${request.billingCycle === 'yearly' ? 'annuel' : 'mensuel'}) actif jusqu'au ${new Date(newEnd).toLocaleDateString('fr-FR')}.`
                : lang === 'en'
                    ? `Payment confirmed — the "${store.plan}" plan (${request.billingCycle === 'yearly' ? 'yearly' : 'monthly'}) is active until ${new Date(newEnd).toLocaleDateString('en-GB')}.`
                    : `تم تأكيد الدفع — خطّة «${store.plan}» (${request.billingCycle === 'yearly' ? 'سنوية' : 'شهرية'}) مفعّلة حتى ${new Date(newEnd).toLocaleDateString('ar-DZ')}.`
        }).catch(() => {});

        return successResponse(res, { request, store: store.toPublicInfo() }, getTranslation('subscriptionApproved', lang));
    } catch (err) { next(err); }
};

// POST /api/subscription/admin/requests/:id/reject
const rejectRequest = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const request = await SubscriptionRequest.findById(req.params.id);
        if (!request) return errorResponse(res, 404, getTranslation('subscriptionRequestNotFound', lang));
        if (request.status !== 'pending') return errorResponse(res, 400, getTranslation('subscriptionAlreadyProcessed', lang));
        request.status = 'rejected';
        request.adminNote = String(req.body.adminNote || '').trim();
        request.reviewedBy = req.user._id;
        request.reviewedAt = new Date();
        await request.save();

        notifyStore({
            storeId: request.storeId, type: 'warning', push: true,
            title: lang === 'fr' ? '⚠️ Demande d\u2019abonnement refusée' : lang === 'en' ? '⚠️ Subscription request rejected' : '⚠️ تم رفض طلب الاشتراك',
            body: (request.adminNote
                ? (lang === 'fr' ? `Motif : ${request.adminNote}` : lang === 'en' ? `Reason: ${request.adminNote}` : `السبب: ${request.adminNote}`)
                : (lang === 'fr' ? 'Contactez la plateforme pour plus de détails.' : lang === 'en' ? 'Contact the platform for details.' : 'يرجى التواصل مع إدارة المنصة لمزيد من التفاصيل.'))
        }).catch(() => {});

        return successResponse(res, request, getTranslation('subscriptionRejected', lang));
    } catch (err) { next(err); }
};

// POST /api/subscription/admin/apply — full manual control: change plan /
// record a renewal / comp a store, all recorded in the payment history.
const adminApplyManual = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { storeId, plan, billingCycle } = req.body;
        if (!storeId || !plans.isPaidPlan(plan)) return errorResponse(res, 400, getTranslation('subscriptionInvalidPlan', lang));
        const cycle = billingCycle || 'monthly';
        if (!plans.isCycle(cycle)) return errorResponse(res, 400, getTranslation('subscriptionInvalidCycle', lang));
        const months = Math.min(36, Math.max(1, parseInt(req.body.months, 10) || plans.CYCLE_MONTHS[cycle] || 1));
        const store = await Store.findById(storeId);
        if (!store) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const prevPlan = store.plan;
        const prevCycle = store.billingCycle || null;

        const paidAmount = (req.body.paidAmount != null && !isNaN(Number(req.body.paidAmount)))
            ? Math.max(0, Number(req.body.paidAmount))
            : plans.price(plan, cycle) * (months / plans.CYCLE_MONTHS[cycle]);

        const { base, newEnd } = await applyPlanToStore(store, { plan, cycle, months, source: 'manual' });

        const record = await SubscriptionRequest.create({
            storeId: store._id,
            requestedBy: null,
            userName: 'Super Admin',
            type: requestTypeFor(prevPlan, plan),
            currentPlan: prevPlan,
            requestedPlan: plan,
            billingCycle: cycle,
            amount: paidAmount,
            paymentMethod: plans.isPaymentMethod(req.body.paymentMethod) ? req.body.paymentMethod : 'manual',
            paymentReference: String(req.body.paymentReference || '').trim(),
            storeNote: String(req.body.adminNote || '').trim(),
            status: 'approved',
            paidAmount,
            periodStart: base,
            periodEnd: newEnd,
            appliedPlan: plan,
            adminNote: String(req.body.adminNote || '').trim(),
            reviewedBy: req.user._id,
            reviewedAt: new Date()
        });

        notifyStore({
            storeId: store._id, type: 'success', push: true,
            title: lang === 'fr' ? '💼 Abonnement mis à jour' : lang === 'en' ? '💼 Subscription updated' : '💼 تم تحديث الاشتراك',
            body: lang === 'fr'
                ? `Plan « ${plan} » (${cycle === 'yearly' ? 'annuel' : 'mensuel'}) actif jusqu'au ${new Date(newEnd).toLocaleDateString('fr-FR')}.`
                : lang === 'en'
                    ? `The "${plan}" plan (${cycle === 'yearly' ? 'yearly' : 'monthly'}) is active until ${new Date(newEnd).toLocaleDateString('en-GB')}.`
                    : `خطّة «${plan}» (${cycle === 'yearly' ? 'سنوية' : 'شهرية'}) مفعّلة حتى ${new Date(newEnd).toLocaleDateString('ar-DZ')}.`
        }).catch(() => {});

        return successResponse(res, { record, store: store.toPublicInfo() }, getTranslation('subscriptionApplied', lang));
    } catch (err) { next(err); }
};

// GET /api/subscription/admin/overview — billing KPIs + revenue statistics.
const adminOverview = async (req, res, next) => {
    try {
        const now = new Date();
        const stores = await Store.find({})
            .select('name email ownerName phone city plan status billingCycle subscriptionStart subscriptionEndsAt trialEndsAt limits createdAt')
            .lean();

        const isPaid = (s) => s.plan && s.plan !== 'trial';
        const isRunning = (s) => s.status !== 'suspended';
        const activePaid = [];
        let expired = 0, suspendedCount = 0, trialActive = 0;

        for (const s of stores) {
            if (s.status === 'suspended') suspendedCount++;
            if (s.plan === 'trial') {
                if (s.status === 'active') trialActive++;
                continue;
            }
            if (!s.subscriptionEndsAt) { if (isRunning(s)) activePaid.push(s); continue; } // legacy
            const end = new Date(s.subscriptionEndsAt);
            if (end >= now) { if (isRunning(s)) activePaid.push(s); }
            else expired++;
        }

        // MRR — monthly recurring revenue of running paid stores (DZD)
        const mrr = activePaid.reduce((sum, s) => {
            const p = plans.CATALOG[s.plan] || plans.CATALOG.basic;
            return sum + (s.billingCycle === 'yearly' ? p.yearly / 12 : p.monthly);
        }, 0);

        // requests + payments
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const [pendingCount, approvedTotals, approvedThisMonthAgg, monthlySeriesRaw, paidPerStoreRaw, recentPaymentsRaw] = await Promise.all([
            SubscriptionRequest.countDocuments({ status: 'pending' }),
            SubscriptionRequest.aggregate([
                { $match: { status: 'approved' } },
                { $group: { _id: null, total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } }, count: { $sum: 1 } } }
            ]),
            SubscriptionRequest.aggregate([
                { $match: { status: 'approved', reviewedAt: { $gte: monthStart } } },
                { $group: { _id: null, total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } }, count: { $sum: 1 } } }
            ]),
            SubscriptionRequest.aggregate([
                { $match: { status: 'approved', reviewedAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
                { $group: { _id: { y: { $year: '$reviewedAt' }, m: { $month: '$reviewedAt' } }, total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } }, count: { $sum: 1 } } }
            ]),
            SubscriptionRequest.aggregate([
                { $match: { status: 'approved' } },
                { $group: { _id: '$storeId', total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } }, payments: { $sum: 1 }, lastAt: { $max: '$reviewedAt' } } }
            ]),
            SubscriptionRequest.find({ status: 'approved' }).sort({ reviewedAt: -1 }).limit(10).lean()
        ]);

        // 12-month dense series (missing months = 0)
        const series = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const hit = monthlySeriesRaw.find(x => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1);
            series.push({
                month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                total: Math.round((hit ? hit.total : 0) * 100) / 100,
                count: hit ? hit.count : 0
            });
        }

        const storeMap = new Map(stores.map(s => [String(s._id), s]));
        const paidMap = new Map(paidPerStoreRaw.map(p => [String(p._id), p]));

        // per-store subscription table
        const perStore = stores.map(s => {
            const paid = paidMap.get(String(s._id));
            return {
                id: s._id, name: s.name, email: s.email, ownerName: s.ownerName, city: s.city,
                plan: s.plan, status: s.status,
                billingCycle: s.billingCycle || null,
                subscriptionStart: s.subscriptionStart || null,
                subscriptionEndsAt: s.subscriptionEndsAt || null,
                trialEndsAt: s.trialEndsAt || null,
                daysLeft: daysLeftOf(s),
                state: computeState(s),
                paidTotal: paid ? Math.round(paid.total * 100) / 100 : 0,
                paymentsCount: paid ? paid.payments : 0,
                lastPaymentAt: paid ? paid.lastAt : null
            };
        });

        // paid stores expiring within 14 days
        const expiringSoon = activePaid
            .filter(s => s.subscriptionEndsAt && (new Date(s.subscriptionEndsAt) - now) <= 14 * DAY_MS)
            .map(s => ({
                id: s._id, name: s.name, email: s.email, plan: s.plan,
                billingCycle: s.billingCycle || null,
                subscriptionEndsAt: s.subscriptionEndsAt,
                daysLeft: Math.ceil((new Date(s.subscriptionEndsAt) - now) / DAY_MS)
            }))
            .sort((a, b) => a.daysLeft - b.daysLeft);

        const planDist = {};
        stores.forEach(s => { planDist[s.plan] = (planDist[s.plan] || 0) + 1; });

        const recentStoreIds = [...new Set(recentPaymentsRaw.map(p => String(p.storeId)))];
        const recentStoreDocs = await Store.find({ _id: { $in: recentStoreIds } }).select('name').lean();
        const recentNameMap = new Map(recentStoreDocs.map(s => [String(s._id), s.name]));

        return successResponse(res, {
            stores: {
                total: stores.length,
                activePaid: activePaid.length,
                trialActive,
                expired,
                suspended: suspendedCount
            },
            requests: { pending: pendingCount },
            revenue: {
                mrr: Math.round(mrr * 100) / 100,
                collectedTotal: Math.round((approvedTotals[0] ? approvedTotals[0].total : 0) * 100) / 100,
                collectedThisMonth: Math.round((approvedThisMonthAgg[0] ? approvedThisMonthAgg[0].total : 0) * 100) / 100,
                paymentsCount: approvedTotals[0] ? approvedTotals[0].count : 0,
                paymentsThisMonth: approvedThisMonthAgg[0] ? approvedThisMonthAgg[0].count : 0,
                currency: plans.CURRENCY
            },
            monthlySeries: series,
            planDistribution: planDist,
            expiringSoon,
            perStore,
            recentPayments: recentPaymentsRaw.map(p => ({
                id: p._id, storeId: p.storeId, storeName: recentNameMap.get(String(p.storeId)) || '—',
                plan: p.appliedPlan || p.requestedPlan, billingCycle: p.billingCycle,
                amount: p.paidAmount != null ? p.paidAmount : p.amount,
                paymentMethod: p.paymentMethod, reviewedAt: p.reviewedAt
            }))
        });
    } catch (err) { next(err); }
};

module.exports = {
    getMySubscription, listMyRequests, createRequest, cancelRequest,
    adminListRequests, approveRequest, rejectRequest, adminApplyManual, adminOverview
};
