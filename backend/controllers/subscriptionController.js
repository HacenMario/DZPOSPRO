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
const mongoose = require('mongoose'); // v4.4 — isObjectId() helper below
const Store = require('../models/Store');
const User = require('../models/User');
const Product = require('../models/Product');
const SubscriptionRequest = require('../models/SubscriptionRequest');
const Notification = require('../models/Notification');
const { successResponse, createdResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');
const plans = require('../config/plans');
const planService = require('../services/planService'); // v4.5 — dynamic DB-backed catalog
const { notifyStore } = require('../services/notifyService');
const { invalidateStoreCache } = require('../middleware/tenant');
const { runWithTenant } = require('../services/tenantContext');
const { GRACE_DAYS } = require('../models/Store');
const logger = require('../utils/logger');

const DAY_MS = 24 * 3600 * 1000;

// v4.4 — the production "Server error" guard: a malformed :id / storeId
// used to surface as an ugly mongoose CastError → 500. Cast it cleanly and
// let every handler bail out with a precise 400 + a traceable server log.
function isObjectId(v) {
    return !!v && mongoose.Types.ObjectId.isValid(String(v));
}
function castOrLog(place, value, err) {
    logger.error(`[subscription:${place}] failed`, {
        message: err && err.message,
        stack: err && err.stack,
        value: value === undefined ? 'undefined' : String(value).slice(0, 80)
    });
    throw err;
}

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
    store.limits = await planService.planLimits(plan);   // v4.5 — dynamic plan defaults
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

// v4.3.1 — platform view payload for the super-admin (no store focus):
// every store with its live subscription state, newest pending requests
// first. Powers the store picker on the subscription page.
async function platformStoreList() {
    const [stores, pendingReqs] = await Promise.all([
        Store.find({}).select('name plan status billingCycle subscriptionStart subscriptionEndsAt trialEndsAt limits planSource planChangedAt createdAt').sort({ name: 1 }).lean(),
        SubscriptionRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(200).lean()
    ]);
    const pendingByStore = new Map();
    for (const r of pendingReqs) {
        const key = String(r.storeId);
        if (!pendingByStore.has(key)) pendingByStore.set(key, r);
    }
    return stores.map(s => {
        const plain = { ...s, status: s.status || 'active' };
        const pending = pendingByStore.get(String(s._id)) || null;
        return {
            id: s._id,
            name: s.name,
            status: s.status || 'active',
            plan: s.plan,
            billingCycle: s.billingCycle || null,
            subscriptionStart: s.subscriptionStart || null,
            subscriptionEndsAt: s.subscriptionEndsAt || null,
            trialEndsAt: s.trialEndsAt || null,
            state: computeState(plain),
            daysLeft: daysLeftOf(plain),
            pending: pending
                ? { id: pending._id, type: pending.type, requestedPlan: pending.requestedPlan,
                    billingCycle: pending.billingCycle, amount: pending.amount,
                    paymentMethod: pending.paymentMethod, createdAt: pending.createdAt }
                : null,
            createdAt: s.createdAt || null
        };
    });
}

// GET /api/subscription — everything the store's admin needs on one page.
// v4.3.1 — role-aware:
//   • super-admin WITHOUT focus  → 200 { isPlatform: true, stores: [...] }
//     (the frontend renders the all-stores picker — no more 400)
//   • super-admin WITH focus     → that store's full detail (isPlatformFocus)
//   • store user without storeId (legacy single-store) → the only store
//     when the platform has exactly one, otherwise a clear 400
const getMySubscription = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        let storeId = req.storeFocus || req.storeId;

        const isSuper = req.userRole === 'superadmin' || (req.user && req.user.role === 'superadmin');
        if (!storeId && isSuper) {
            // platform owner browsing all stores
            const stores = await platformStoreList();
            return successResponse(res, {
                isPlatform: true,
                isPlatformFocus: false,
                stores,
                catalog: await planService.getCatalog(),
                currency: plans.CURRENCY
            });
        }

        if (!storeId) {
            // legacy account (no storeId): fall back to the single store when
            // the platform hosts exactly one — mirrors the tenant plugin's
            // single-store compatibility mode.
            const count = await Store.countDocuments({});
            if (count === 1) {
                const only = await Store.findOne({}).select('_id').lean();
                if (only) storeId = only._id;
            }
        }
        if (!storeId) return errorResponse(res, 400, getTranslation('missingFields', lang));
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

        const catalog = (await planService.getCatalog()).filter(p => p.active);
        const currentPlan = catalog.find(p => p.key === store.plan) || null;

        return successResponse(res, {
            isPlatform: false,
            isPlatformFocus: !!isSuper,
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
        const isSuper = req.userRole === 'superadmin' || (req.user && req.user.role === 'superadmin');
        if (!storeId && isSuper) return successResponse(res, { isPlatform: true, data: [], total: 0 });
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

        if (!requestedPlan || !(await planService.isPlan(requestedPlan)) || !(await planService.isPaidPlan(requestedPlan))) {
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

        const amount = await planService.price(requestedPlan, cycle);
        const request = await SubscriptionRequest.create({
            storeId: store._id,
            requestedBy: req.user._id,
            userName: req.user.name || '',
            type: requestTypeFor(store.plan, requestedPlan),
            currentPlan: store.plan,
            requestedPlan,
            billingCycle: cycle,
            amount,
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
            body: `${store.name} → ${requestedPlan} · ${cycle} · ${amount} DZD`,
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
        if (!isObjectId(req.params.id)) return errorResponse(res, 400, getTranslation('subscriptionRequestNotFound', lang));
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
        // v4.5 — keep the request's plan snapshot in sync with the (possibly
        // renamed) catalog so the payment history always shows real names.
        request.appliedPlan = store.plan;

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
    } catch (err) {
        castOrLog('approve', req.params.id, err);
        next(err);
    }
};

// POST /api/subscription/admin/requests/:id/reject
const rejectRequest = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        if (!isObjectId(req.params.id)) return errorResponse(res, 400, getTranslation('subscriptionRequestNotFound', lang));
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
        if (!isObjectId(storeId)) return errorResponse(res, 400, getTranslation('subscriptionInvalidPlan', lang));
        if (!plan || !(await planService.isPaidPlan(plan))) return errorResponse(res, 400, getTranslation('subscriptionInvalidPlan', lang));
        const cycle = billingCycle || 'monthly';
        if (!plans.isCycle(cycle)) return errorResponse(res, 400, getTranslation('subscriptionInvalidCycle', lang));
        const months = Math.min(36, Math.max(1, parseInt(req.body.months, 10) || plans.CYCLE_MONTHS[cycle] || 1));
        const store = await Store.findById(storeId);
        if (!store) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const prevPlan = store.plan;
        const prevCycle = store.billingCycle || null;

        const paidAmount = (req.body.paidAmount != null && !isNaN(Number(req.body.paidAmount)))
            ? Math.max(0, Number(req.body.paidAmount))
            : (await planService.price(plan, cycle)) * (months / plans.CYCLE_MONTHS[cycle]);

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
    } catch (err) {
        castOrLog('apply', (req.body || {}).storeId, err);
        next(err);
    }
};

// GET /api/subscription/admin/overview — billing KPIs + revenue statistics.
const adminOverview = async (req, res, next) => {
    try {
        const now = new Date();
        const catalog = await planService.getCatalog();          // v4.5 — dynamic prices
        const planMap = new Map(catalog.map(p => [p.key, p]));
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
            const p = planMap.get(s.plan) || planMap.get('basic');
            return sum + (s.billingCycle === 'yearly' ? (p ? p.yearly : 0) / 12 : (p ? p.monthly : 0));
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
            catalog,
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

/* ================= v4.5 — PLAN CATALOG CRUD (super-admin) =================
 * Full platform control over the subscription catalogue: name, prices,
 * durations (monthly/yearly), limits, visibility. Every change applies
 * INSTANTLY platform-wide (planService cache invalidation).
 */
const adminListPlans = async (req, res) => {
    const Plan = require('../models/Plan');
    const docs = await Plan.find({}).sort({ sortOrder: 1, monthly: 1 }).lean();
    return successResponse(res, { data: docs.map(d => Plan.toPublic(d)), currency: plans.CURRENCY });
};

const adminCreatePlan = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const Plan = require('../models/Plan');
        const { key, name, monthly, yearly, maxUsers, maxProducts, aiDailyCalls, isTrial, active, badge, sortOrder, description } = req.body;
        const slug = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!slug || !name) return errorResponse(res, 400, getTranslation('missingFields', lang));
        const exists = await Plan.findOne({ key: slug });
        if (exists) return errorResponse(res, 400, getTranslation('subscriptionRequestExists', lang));
        const doc = await Plan.create({
            key: slug, name: String(name).trim(),
            monthly: Math.max(0, Number(monthly) || 0),
            yearly: Math.max(0, Number(yearly) || Math.max(0, Number(monthly) || 0) * 12),
            maxUsers: Math.max(1, Number(maxUsers) || 5),
            maxProducts: Math.max(1, Number(maxProducts) || 2000),
            aiDailyCalls: Math.max(0, Number(aiDailyCalls) || 0),
            isTrial: !!isTrial, active: active !== false,
            badge: badge || (isTrial ? 'badge-warning' : 'badge-info'),
            sortOrder: Number(sortOrder) || 100,
            description: String(description || '').trim()
        });
        planService.invalidate();
        return createdResponse(res, Plan.toPublic(doc), getTranslation('saved', lang));
    } catch (err) { next(err); }
};

const adminUpdatePlan = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const Plan = require('../models/Plan');
        const doc = await Plan.findById(req.params.id);
        if (!doc) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const b = req.body || {};
        if (b.name !== undefined) doc.name = String(b.name).trim() || doc.name;
        if (b.monthly !== undefined) doc.monthly = Math.max(0, Number(b.monthly) || 0);
        if (b.yearly !== undefined) doc.yearly = Math.max(0, Number(b.yearly) || 0);
        if (b.maxUsers !== undefined) doc.maxUsers = Math.max(1, Number(b.maxUsers) || doc.maxUsers);
        if (b.maxProducts !== undefined) doc.maxProducts = Math.max(1, Number(b.maxProducts) || doc.maxProducts);
        if (b.aiDailyCalls !== undefined) doc.aiDailyCalls = Math.max(0, Number(b.aiDailyCalls) || 0);
        if (b.isTrial !== undefined) doc.isTrial = !!b.isTrial;
        if (b.active !== undefined) doc.active = !!b.active;
        if (b.badge !== undefined) doc.badge = String(b.badge);
        if (b.sortOrder !== undefined) doc.sortOrder = Number(b.sortOrder) || doc.sortOrder;
        if (b.description !== undefined) doc.description = String(b.description || '').trim();
        await doc.save();
        planService.invalidate();
        return successResponse(res, Plan.toPublic(doc), getTranslation('saved', lang));
    } catch (err) { next(err); }
};

const adminDeletePlan = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const Plan = require('../models/Plan');
        const doc = await Plan.findById(req.params.id);
        if (!doc) return errorResponse(res, 404, getTranslation('storeNotFound', lang));
        const inUse = await Store.countDocuments({ plan: doc.key });
        if (inUse > 0) {
            doc.active = false;               // soft-retire a plan still used by stores
            await doc.save();
            planService.invalidate();
            return successResponse(res, Plan.toPublic(doc), getTranslation('saved', lang));
        }
        await doc.deleteOne();
        planService.invalidate();
        return successResponse(res, { deleted: true }, getTranslation('saved', lang));
    } catch (err) { next(err); }
};

module.exports = {
    getMySubscription, listMyRequests, createRequest, cancelRequest,
    adminListRequests, approveRequest, rejectRequest, adminApplyManual, adminOverview,
    adminListPlans, adminCreatePlan, adminUpdatePlan, adminDeletePlan
};
