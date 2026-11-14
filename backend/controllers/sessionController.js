// backend/controllers/sessionController.js
const Session = require('../models/Session');
const Sale = require('../models/Sale');
const Setting = require('../models/Setting');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

// v4.5 — Controlcaisse helpers ------------------------------------------
// The counted cash value is ALWAYS derived server-side from the
// per-denomination piece counts — the client only sends counts.
function computeAmountFromCounts(counts, denominations) {
    if (!counts || typeof counts !== 'object') return null;
    let total = 0;
    let anyKey = false;
    for (const d of denominations || []) {
        const k = String(d.value);
        const c = Number(counts[k]);
        if (Number.isFinite(c) && c > 0) { total += d.value * c; anyKey = true; }
    }
    return anyKey || Object.keys(counts).length ? Math.max(0, Math.round(total * 100) / 100) : 0;
}

function normalizeCounts(counts) {
    if (!counts || typeof counts !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(counts)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) out[String(k)] = n;
    }
    return Object.keys(out).length ? out : null;
}

// The store's configured cash denominations (from its Setting document).
async function storeDenominations() {
    try {
        const s = await Setting.findOne({}).select('cashDenominations').lean();
        const list = (s && Array.isArray(s.cashDenominations)) ? s.cashDenominations : [];
        return list.filter(d => Number(d.value) > 0).map(d => ({ value: Number(d.value), type: d.type || 'bill' }));
    } catch (_) { return []; }
}

// POST /api/sessions  { openingCash | openingCounts, notes }
const openSession = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { openingCash = 0, notes = '' } = req.body;

        const existing = await Session.findOne({ user: req.userId, status: 'open' });
        if (existing) return errorResponse(res, 400, getTranslation('sessionAlreadyOpen', lang));

        // v4.5 — strict Controlcaisse: when the store has cash denominations
        // configured, a per-denomination count is REQUIRED at open. The
        // opening balance is computed server-side from the counts.
        const denominations = await storeDenominations();
        let openingBalance = parseFloat(openingCash) || 0;
        let openingCounts = normalizeCounts((req.body || {}).openingCounts);
        if (denominations.length) {
            if (!openingCounts) {
                return errorResponse(res, 400, getTranslation('sessionCountsRequired', lang));
            }
            openingBalance = computeAmountFromCounts(openingCounts, denominations) || 0;
        }

        const lastSession = await Session.findOne({ user: req.userId, status: 'closed' }).sort({ closedAt: -1 });

        const session = new Session({
            user: req.userId,
            userName: req.user.name || 'Cashier',
            userRole: req.user.role || 'cashier',
            openingBalance,
            openingCounts: openingCounts || undefined,
            status: 'open',
            notes: notes || '',
            openedAt: new Date()
        });
        await session.save();

        const data = session.toObject();
        data.lastSession = lastSession ? {
            closedAt: lastSession.closedAt,
            totalSales: lastSession.totalSales,
            closingBalance: lastSession.closingBalance,
            saleCount: lastSession.saleCount
        } : null;

        return createdResponse(res, { session: data }, getTranslation('sessionOpened', lang));
    } catch (err) {
        logger.error('openSession error:', err.message);
        next(err);
    }
};

// GET /api/sessions/current
const getCurrentSession = async (req, res, next) => {
    try {
        const session = await Session.findOne({ user: req.userId, status: 'open' }).populate('user', 'name email');
        let stats = null;
        if (session) {
            const sales = await Sale.find({ session: session._id, status: 'completed' });
            const totalSales = sales.reduce((s, x) => s + x.total, 0);
            const totalDiscount = sales.reduce((s, x) => s + (x.discount || 0), 0);
            const saleCount = sales.length;
            const cashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + x.total, 0);
            const cardSales = sales.filter(s => s.paymentMethod === 'card').reduce((s, x) => s + x.total, 0);
            const transferSales = sales.filter(s => s.paymentMethod === 'transfer').reduce((s, x) => s + x.total, 0);
            stats = {
                totalSales, totalDiscount, saleCount, cashSales, cardSales, transferSales,
                expectedCash: (session.openingBalance || 0) + cashSales
            };
        }
        return successResponse(res, { session, stats });
    } catch (err) {
        logger.error('getCurrentSession error:', err.message);
        next(err);
    }
};

// PUT /api/sessions/:id/close  { closingCash | closingCounts, notes }
const closeSession = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { closingCash = 0, notes = '' } = req.body;

        const session = await Session.findById(req.params.id);
        if (!session) return errorResponse(res, 404, getTranslation('sessionNotFound', lang));
        if (session.status === 'closed') return errorResponse(res, 400, getTranslation('sessionNotFound', lang));
        // only the owner of the session (or an admin/manager) may close it
        const canClose = String(session.user) === String(req.userId) || ['admin', 'manager', 'superadmin'].includes(req.user.role);
        if (!canClose) return errorResponse(res, 403, getTranslation('forbidden', lang));

        const denominations = await storeDenominations();
        const closingCounts = normalizeCounts((req.body || {}).closingCounts);
        let actualCash = parseFloat(closingCash) || 0;
        if (denominations.length) {
            if (!closingCounts) {
                return errorResponse(res, 400, getTranslation('sessionCountsRequired', lang));
            }
            actualCash = computeAmountFromCounts(closingCounts, denominations) || 0;
        }

        const sales = await Sale.find({ session: session._id, status: 'completed' });
        const totalSales = sales.reduce((s, x) => s + x.total, 0);
        const totalDiscount = sales.reduce((s, x) => s + (x.discount || 0), 0);
        const totalTax = sales.reduce((s, x) => s + (x.tax || 0), 0);
        const saleCount = sales.length;
        const cashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + x.total, 0);
        const cardSales = sales.filter(s => s.paymentMethod === 'card').reduce((s, x) => s + x.total, 0);
        const transferSales = sales.filter(s => s.paymentMethod === 'transfer').reduce((s, x) => s + x.total, 0);

        const expectedCash = (session.openingBalance || 0) + cashSales;
        const difference = actualCash - expectedCash;

        session.closingBalance = totalSales;
        session.totalSales = totalSales;
        session.totalDiscount = totalDiscount;
        session.totalTax = totalTax;
        session.saleCount = saleCount;
        session.cashSales = cashSales;
        session.cardSales = cardSales;
        session.transferSales = transferSales;
        session.expectedCash = expectedCash;
        session.actualCash = actualCash;
        session.difference = difference;
        if (closingCounts) session.closingCounts = closingCounts;
        session.status = 'closed';
        session.closedAt = new Date();
        if (notes) session.notes = notes;

        await session.save();

        const data = session.toObject();
        data.summary = {
            totalSales, totalDiscount, totalTax, saleCount,
            cashSales, cardSales, transferSales,
            expectedCash, actualCash, difference
        };

        return successResponse(res, { session: data }, getTranslation('sessionClosed', lang));
    } catch (err) {
        logger.error('closeSession error:', err.message);
        next(err);
    }
};

// GET /api/sessions?status=open|closed&page&limit
const getSessions = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const { status, user: userId } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (userId) filter.user = userId;

        const [docs, total] = await Promise.all([
            Session.find(filter).populate('user', 'name email').sort({ openedAt: -1 }).skip(skip).limit(limit),
            Session.countDocuments(filter)
        ]);
        return paginatedResponse(res, { data: docs, total, page, limit });
    } catch (err) {
        logger.error('getSessions error:', err.message);
        next(err);
    }
};

// GET /api/sessions/:id
const getSessionById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const session = await Session.findById(req.params.id).populate('user', 'name email');
        if (!session) return errorResponse(res, 404, getTranslation('sessionNotFound', lang));

        // Fetch all completed sales for this session, with items + customer populated.
        // Used by the frontend sessions detail modal + PDF download of the session report.
        const sales = await Sale.find({ session: session._id, status: 'completed' })
            .populate('customer', 'name phone email')
            .populate('items', 'product quantity price total discount timbre productName')
            .sort({ saleDate: -1 });

        const totalSales = sales.reduce((s, x) => s + x.total, 0);
        const totalDiscount = sales.reduce((s, x) => s + (x.discount || 0), 0);
        const totalTax = sales.reduce((s, x) => s + (x.tax || 0), 0);
        const saleCount = sales.length;
        const cashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + x.total, 0);
        const cardSales = sales.filter(s => s.paymentMethod === 'card').reduce((s, x) => s + x.total, 0);
        const transferSales = sales.filter(s => s.paymentMethod === 'transfer').reduce((s, x) => s + x.total, 0);
        const expectedCash = (session.openingBalance || 0) + cashSales;

        const summary = session.status === 'closed'
            ? {
                totalSales: session.totalSales, totalDiscount: session.totalDiscount,
                totalTax: session.totalTax, saleCount: session.saleCount,
                cashSales: session.cashSales, cardSales: session.cardSales,
                transferSales: session.transferSales,
                expectedCash: session.expectedCash, actualCash: session.actualCash,
                difference: session.difference
              }
            : { totalSales, totalDiscount, totalTax, saleCount, cashSales, cardSales, transferSales, expectedCash };

        return successResponse(res, { session, sales, summary });
    } catch (err) {
        logger.error('getSessionById error:', err.message);
        next(err);
    }
};

module.exports = {
    openSession,
    getCurrentSession,
    closeSession,
    getSessions,
    getSessionById
};
