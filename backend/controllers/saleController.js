// backend/controllers/saleController.js
const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Session = require('../models/Session');
const Setting = require('../models/Setting');
const Coupon = require('../models/Coupon');
const InventoryMovement = require('../models/InventoryMovement');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { mongoose } = require('../config/db');

const DEFAULT_STORE_NAME = 'DZ POS PRO';

// Date-only strings (YYYY-MM-DD) are parsed as UTC instants so date-range
// filters behave identically regardless of the server's local timezone:
// `from` → UTC midnight, `to` → end of that UTC day (used with $lte).
// Full ISO datetime strings parse directly as absolute instants.
const parseDateParam = (value, endOfDay = false) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
    }
    return new Date(value);
};

// Always read store info from the Setting document with a generic fallback.
const getStoreInfo = async () => {
    const s = await Setting.findOne();
    if (!s) {
        return {
            storeName: DEFAULT_STORE_NAME,
            currency: 'DZD', taxRate: 0,
            invoicePrefix: 'INV-', invoiceFooter: '',
            invoiceHeader: '',
            invoiceCustomText: '',
            invoicePrimaryColor: '#10b981',
            companyInfo: { rc: '', nif: '', nis: '', art: '', address: '', phone: '', email: '', whatsapp: '' }
        };
    }
    return {
        storeName: s.storeName || DEFAULT_STORE_NAME,
        currency: s.currency || 'DZD',
        taxRate: s.taxRate || 0,
        invoicePrefix: s.invoicePrefix || 'INV-',
        invoiceFooter: s.invoiceFooter || '',
        invoiceHeader: s.invoiceHeader || '',
        invoiceCustomText: s.invoiceCustomText || '',
        invoicePrimaryColor: s.invoicePrimaryColor || '#10b981',
        companyInfo: {
            rc: s.companyInfo?.rc || '',
            nif: s.companyInfo?.nif || '',
            nis: s.companyInfo?.nis || '',
            art: s.companyInfo?.art || '',
            address: s.companyInfo?.address || '',
            phone: s.companyInfo?.phone || '',
            whatsapp: s.companyInfo?.whatsapp || '',
            email: s.companyInfo?.email || ''
        }
    };
};

// Generates the next monthly invoice number atomically (within the transaction).
// A conditional update resets the counter when the stored period differs, then a
// $inc fetches the incremented value — no read-modify-write race.
const generateInvoiceNumber = async (settings, customDate = new Date(), session = null) => {
    const targetDate = customDate instanceof Date && !isNaN(customDate) ? customDate : new Date();
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;

    // Rollover: reset the counter to 0 only when the stored period mismatches
    // (missing fields covered too), then increment below.
    await Setting.findOneAndUpdate(
        {
            _id: settings._id,
            $or: [
                { currentInvoiceYear: { $ne: year } },
                { currentInvoiceMonth: { $ne: month } },
                { currentInvoiceYear: { $exists: false } },
                { currentInvoiceMonth: { $exists: false } }
            ]
        },
        { $set: { currentInvoiceYear: year, currentInvoiceMonth: month, currentInvoiceCounter: 0 } },
        { session }
    );

    let updated = await Setting.findOneAndUpdate(
        { _id: settings._id },
        { $inc: { currentInvoiceCounter: 1 } },
        { new: true, session }
    );
    if (!updated) {
        // Settings doc not persisted yet (first ever sale) — create it.
        settings.currentInvoiceYear = year;
        settings.currentInvoiceMonth = month;
        settings.currentInvoiceCounter = 1;
        await settings.save({ session });
        updated = settings;
    }

    const yearStr = String(year);
    const monthStr = String(month).padStart(2, '0');
    const counterStr = String(updated.currentInvoiceCounter).padStart(5, '0');
    return `${updated.invoicePrefix || 'INV-'}${yearStr}/${monthStr}/${counterStr}`;
};

// Validate + compute discount for a coupon, returns { coupon, discount }
const applyCouponInternal = async (code, cartTotal) => {
    const coupon = await Coupon.findOne({ code: (code || '').toUpperCase(), isActive: true });
    if (!coupon) return { coupon: null, discount: 0, error: 'couponInvalid' };

    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validUntil) return { coupon, discount: 0, error: 'couponExpired' };
    // usageLimit 0 = unlimited
    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return { coupon, discount: 0, error: 'couponUsedUp' };
    if (cartTotal < coupon.minOrder) return { coupon, discount: 0, error: 'couponMinOrder' };

    let discount = 0;
    if (coupon.type === 'percentage') {
        discount = (cartTotal * coupon.value) / 100;
        if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
    } else {
        discount = coupon.value;
    }
    discount = Math.min(discount, cartTotal);
    return { coupon, discount: Math.round(discount), error: null };
};

// POST /api/sales
const createSale = async (req, res, next) => {
    const lang = req.lang || 'ar';
    let session = null;
    let createdSaleId = null;

    try {
        const {
            customer: customerId,
            session: sessionId,
            items,
            discount = 0,
            tax: _ignoredTax,
            paymentMethod = 'cash',
            splitPayment,
            couponCode,
            notes,
            invoiceNumber: customInvoiceNumber,
            invoiceDate: customInvoiceDate
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        if (!req.userId) {
            return errorResponse(res, 401, getTranslation('unauthorized', lang));
        }

        // Only the session owner (or an admin/manager) may sell against a session.
        const canUseSession = (doc) => String(doc.user) === String(req.userId)
            || ['admin', 'manager'].includes(req.userRole || '');

        let sessionDoc = null;
        if (sessionId) {
            sessionDoc = await Session.findById(sessionId);
            if (!sessionDoc || sessionDoc.status !== 'open') {
                return errorResponse(res, 403, getTranslation('sessionRequired', lang));
            }
            if (!canUseSession(sessionDoc)) {
                return errorResponse(res, 403, getTranslation('forbidden', lang));
            }
        } else {
            sessionDoc = await Session.findOne({ user: req.userId, status: 'open' });
            if (!sessionDoc) return errorResponse(res, 403, getTranslation('sessionRequired', lang));
        }

        let settings = await Setting.findOne();
        if (!settings) { settings = new Setting(); }

        let saleNumber;
        if (customInvoiceNumber && customInvoiceNumber.trim()) {
            saleNumber = customInvoiceNumber.trim();
            const exists = await Sale.findOne({ saleNumber });
            if (exists) return errorResponse(res, 400, getTranslation('invoiceNumberExists', lang));
        }

        const saleDate = (customInvoiceDate && !isNaN(new Date(customInvoiceDate).getTime()))
            ? new Date(customInvoiceDate)
            : new Date();

        const performSale = async (txnSession) => {
            if (!saleNumber) {
                saleNumber = await generateInvoiceNumber(settings, saleDate, txnSession);
            }

            let subtotal = 0;
            let totalItemDiscounts = 0;
            let totalTimbre = 0;
            const saleItemIds = [];
            const seenProducts = new Set();
            const movementsData = [];

            for (const item of items) {
                const productId = item.product || item.productId;
                const qty = Number(item.quantity);
                if (!productId || !Number.isFinite(qty) || qty < 1) {
                    throw Object.assign(new Error('Invalid item payload'), { statusCode: 400, expose: true });
                }
                const product = await Product.findById(productId).session(txnSession);
                if (!product) {
                    throw Object.assign(new Error(`${getTranslation('productNotFound', lang)}: ${productId}`), { statusCode: 404, expose: true });
                }
                if (product.stock < qty) {
                    throw Object.assign(new Error(`${product.getName(lang)}: ${getTranslation('insufficientStock', lang)}`), { statusCode: 400, expose: true });
                }
                // Unit price is always the server-side product price — the POS
                // never edits prices, so the client-sent item.price is ignored.
                const unitPrice = Number(product.price) || 0;
                if (!Number.isFinite(unitPrice)) {
                    throw Object.assign(new Error('Invalid item payload'), { statusCode: 400, expose: true });
                }

                const itemDiscount = Number(item.discount) || 0;
                const itemGross = qty * unitPrice;
                const itemTotal = Math.max(0, itemGross - itemDiscount);
                subtotal += itemGross;
                totalItemDiscounts += itemDiscount;

                const pTimbre = product.timbre || 0;
                if (pTimbre > 0 && !seenProducts.has(product._id.toString())) {
                    totalTimbre += pTimbre;
                    seenProducts.add(product._id.toString());
                }

                const [saleItem] = await SaleItem.create([{
                    product: product._id,
                    quantity: qty,
                    price: unitPrice,
                    discount: Number(item.discount) || 0,
                    total: itemTotal,
                    timbre: pTimbre,
                    productName: product.getName('ar'),
                    productBarcode: product.barcode || '',
                    productUnit: product.unit || '',
                    notes: ''
                }], { session: txnSession });
                saleItemIds.push(saleItem._id);

                product.stock -= qty;
                await product.save({ session: txnSession });

                movementsData.push({
                    product: product._id,
                    type: 'out',
                    quantity: qty,
                    previousStock: product.stock + qty,
                    newStock: product.stock,
                    reason: { ar: 'بيع', en: 'Sale', fr: 'Vente' },
                    reference: saleNumber,
                    createdBy: req.userId
                });
            }

            let couponDoc = null;
            let couponDiscount = 0;
            if (couponCode) {
                const r = await applyCouponInternal(couponCode, subtotal);
                if (r.error) {
                    throw Object.assign(new Error(getTranslation(r.error, lang)), { statusCode: 400, expose: true });
                }
                couponDoc = r.coupon;
                couponDiscount = r.discount;
                // Atomically consume one use — the filter re-checks the limit so
                // concurrent checkouts can never exceed it. usageLimit 0 = unlimited.
                if (couponDoc) {
                    const inc = await Coupon.updateOne(
                        { _id: couponDoc._id, $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
                        { $inc: { usedCount: 1 } },
                        { session: txnSession }
                    );
                    if (inc.modifiedCount !== 1) {
                        throw Object.assign(new Error(getTranslation('couponUsedUp', lang)), { statusCode: 400, expose: true });
                    }
                }
            }

            const afterDiscount = Math.max(0, subtotal - totalItemDiscounts - (Number(discount) || 0) - couponDiscount);
            const taxRate = Number(settings.taxRate || 0);
            const taxAmount = Math.round(afterDiscount * (taxRate / 100) * 100) / 100;
            const total = Math.max(0, afterDiscount + taxAmount + totalTimbre);

            if (customerId) {
                const customer = await Customer.findById(customerId).session(txnSession);
                if (customer) {
                    customer.totalSpent = (customer.totalSpent || 0) + total;
                    customer.loyaltyPoints = (customer.loyaltyPoints || 0) + Math.floor(total / 100);
                    await customer.save({ session: txnSession });
                }
            }

            const [sale] = await Sale.create([{
                saleNumber,
                saleDate,
                customer: customerId || null,
                session: sessionDoc._id,
                items: saleItemIds,
                subtotal,
                discount: Number(discount) || 0,
                tax: taxAmount,
                timbre: totalTimbre,
                couponDiscount,
                coupon: couponDoc ? couponDoc._id : null,
                total,
                paymentMethod,
                splitPayment: splitPayment || { cash: paymentMethod === 'cash' ? total : 0, card: 0, transfer: 0 },
                status: 'completed',
                notes: {
                    ar: notes?.ar || (typeof notes === 'string' ? notes : '') || '',
                    en: notes?.en || '',
                    fr: notes?.fr || ''
                },
                createdBy: req.userId
            }], { session: txnSession });

            createdSaleId = sale._id;

            await SaleItem.updateMany(
                { _id: { $in: saleItemIds } },
                { $set: { sale: sale._id } },
                { session: txnSession }
            );

            if (movementsData.length > 0) {
                await InventoryMovement.insertMany(movementsData, { session: txnSession });
            }

            return sale;
        };

        try {
            session = await mongoose.startSession();
            await session.withTransaction(async (txnSession) => {
                await performSale(txnSession);
            });
        } catch (err) {
            if (session) { try { session.endSession(); } catch (_) {} session = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — running sale without transaction.');
                await performSale(null);
            } else {
                throw err;
            }
        }

        if (!createdSaleId) {
            throw new Error('فشل في إنشاء البيع - لم يتم الحصول على معرف');
        }

        const populated = await Sale.findById(createdSaleId)
            .populate('customer', 'name phone email address rc nif nis art')
            .populate({ path: 'items', populate: { path: 'product', select: 'name price barcode timbre unit' } })
            .populate('session', 'userName openingBalance')
            .populate('coupon', 'code type value');

        if (!populated) {
            throw new Error(`البيع بالرقم ${createdSaleId} غير موجود بعد الإنشاء`);
        }

        const storeInfo = await getStoreInfo();
        const saleObj = populated.toObject ? populated.toObject() : populated;
        saleObj.notes = populated.notes?.[lang] || populated.notes?.ar || '';
        saleObj.storeInfo = storeInfo;

        if (saleObj.customer && saleObj.customer.name) {
            const c = saleObj.customer;
            const cname = (typeof c.name === 'string') ? c.name
                : (c.name && (c.name[lang] || c.name.ar || c.name.en || c.name.fr)) || '';
            const caddr = (c.address && typeof c.address === 'object')
                ? (c.address[lang] || c.address.ar || c.address.en || c.address.fr || '')
                : (typeof c.address === 'string' ? c.address : '');
            saleObj.customerInfo = {
                name: cname,
                phone: c.phone || '',
                email: c.email || '',
                address: caddr,
                rc: c.rc || '', nif: c.nif || '', nis: c.nis || '', art: c.art || ''
            };
        } else {
            saleObj.customerInfo = null;
        }

        return createdResponse(res, { sale: saleObj }, getTranslation('saleCreated', lang));

    } catch (err) {
        logger.error('createSale error:', err.message, err.stack || '');
        if (err.statusCode) {
            return errorResponse(res, err.statusCode, err.message);
        }
        next(err);
    } finally {
        if (session) { 
            try { session.endSession(); } catch (_) {} 
        }
    }
};

// GET /api/sales
const getSales = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { status, from, to, customer, session, search } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (customer) filter.customer = customer;
        if (session) filter.session = session;
        if (from || to) {
            filter.saleDate = {};
            if (from) filter.saleDate.$gte = parseDateParam(from);
            if (to) filter.saleDate.$lte = parseDateParam(to, true);
        }

        let matchedCustomerIds = null;
        if (search) {
            const trimmed = String(search).trim();
            const isExact = /^".*"$/.test(trimmed);
            const needle = isExact ? trimmed.slice(1, -1) : trimmed;
            const r = isExact ? new RegExp('^' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
                              : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

            const Customer = require('../models/Customer');
            const matched = await Customer.find({
                $or: [
                    { 'name.ar': r }, { 'name.en': r }, { 'name.fr': r },
                    { phone: r }, { email: r }
                ]
            }).select('_id').lean();
            matchedCustomerIds = matched.map(c => c._id);

            filter.$or = [
                { saleNumber: r }
            ];
            if (matchedCustomerIds.length) {
                filter.$or.push({ customer: { $in: matchedCustomerIds } });
            }
        }

        const [docs, total] = await Promise.all([
            Sale.find(filter)
                .populate('customer', 'name phone')
                .populate({ path: 'items', select: 'product quantity returnedQuantity price total timbre discount productName productUnit productBarcode', populate: { path: 'product', select: 'name price barcode timbre unit' } })
                .populate('session', 'userName openingBalance')
                .sort({ saleDate: -1, createdAt: -1 })
                .skip(skip).limit(limit),
            Sale.countDocuments(filter)
        ]);

        const data = docs.map(s => {
            const o = s.toObject();
            o.notes = s.notes?.[lang] || s.notes?.ar || '';
            return o;
        });

        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getSales error:', err.message);
        next(err);
    }
};

// GET /api/sales/:id
const getSaleById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const sale = await Sale.findById(req.params.id)
            .populate('customer', 'name phone email address rc nif nis art')
            .populate({ path: 'items', populate: { path: 'product', select: 'name price barcode timbre unit' } })
            .populate('session', 'userName openingBalance')
            .populate('coupon', 'code type value');

        if (!sale) return errorResponse(res, 404, getTranslation('saleNotFound', lang));

        const storeInfo = await getStoreInfo();
        const obj = sale.toObject();
        obj.notes = sale.notes?.[lang] || sale.notes?.ar || '';
        obj.storeInfo = storeInfo;

        if (obj.customer && obj.customer.name) {
            obj.customerInfo = {
                name: obj.customer.name?.[lang] || obj.customer.name?.ar || '',
                phone: obj.customer.phone || '',
                email: obj.customer.email || '',
                address: obj.customer.address?.[lang] || obj.customer.address?.ar || '',
                rc: obj.customer.rc || '',
                nif: obj.customer.nif || '',
                nis: obj.customer.nis || '',
                art: obj.customer.art || ''
            };
        }

        return successResponse(res, { sale: obj });
    } catch (err) {
        logger.error('getSaleById error:', err.message);
        next(err);
    }
};

// PATCH /api/sales/:id/status
const updateSaleStatus = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { status } = req.body;
        const allowed = ['completed', 'pending'];
        if (!allowed.includes(status)) {
            if (status === 'cancelled') {
                // Cancelling via PATCH loses stock — DELETE (cancelSale) restores it.
                return errorResponse(res, 400, 'Use DELETE /api/sales/:id to cancel a sale — stock must be restored');
            }
            return errorResponse(res, 400, getTranslation('invalidSaleStatus', lang));
        }

        const sale = await Sale.findById(req.params.id);
        if (!sale) return errorResponse(res, 404, getTranslation('saleNotFound', lang));
        if (sale.status === 'returned') {
            return errorResponse(res, 400, getTranslation('saleCannotCancel', lang));
        }

        sale.status = status;
        await sale.save();
        return successResponse(res, { sale }, getTranslation('updated', lang));
    } catch (err) {
        logger.error('updateSaleStatus error:', err.message);
        next(err);
    }
};

// DELETE /api/sales/:id
const cancelSale = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const sale = await Sale.findById(req.params.id);
        if (!sale) return errorResponse(res, 404, getTranslation('saleNotFound', lang));
        if (sale.status === 'returned') {
            return errorResponse(res, 400, getTranslation('saleCannotCancel', lang));
        }
        if (sale.status === 'cancelled') {
            return successResponse(res, { sale }, getTranslation('saleCancelled', lang));
        }

        const cancelBody = async (session) => {
            const items = await SaleItem.find({ sale: sale._id }).session(session);
            for (const item of items) {
                const product = await Product.findById(item.product).session(session);
                if (product) {
                    const prev = product.stock;
                    product.stock += item.quantity;
                    await product.save({ session });
                    await InventoryMovement.create([{
                        product: product._id,
                        type: 'in',
                        quantity: item.quantity,
                        previousStock: prev,
                        newStock: product.stock,
                        reason: { ar: 'إلغاء فاتورة', en: 'Invoice cancellation', fr: 'Annulation de facture' },
                        reference: sale.saleNumber,
                        createdBy: req.userId
                    }], { session });
                }
            }

            // Revert customer aggregates (clamped at 0 to avoid negative drift)
            if (sale.customer) {
                const customer = await Customer.findById(sale.customer).session(session);
                if (customer) {
                    customer.totalSpent = Math.max(0, (customer.totalSpent || 0) - (sale.total || 0));
                    customer.loyaltyPoints = Math.max(0, (customer.loyaltyPoints || 0) - Math.floor((sale.total || 0) / 100));
                    await customer.save({ session });
                }
            }

            // Release one coupon usage (clamped at 0)
            if (sale.coupon) {
                const coupon = await Coupon.findById(sale.coupon).session(session);
                if (coupon && (coupon.usedCount || 0) > 0) {
                    coupon.usedCount = coupon.usedCount - 1;
                    await coupon.save({ session });
                }
            }

            sale.status = 'cancelled';
            await sale.save({ session });
        };
        let cancelSession = null;
        try {
            cancelSession = await mongoose.startSession();
            await cancelSession.withTransaction(() => cancelBody(cancelSession));
        } catch (err) {
            if (cancelSession) { try { cancelSession.endSession(); } catch (_) {} cancelSession = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — running cancel without transaction.');
                await cancelBody(null);
            } else {
                throw err;
            }
        } finally {
            if (cancelSession) try { cancelSession.endSession(); } catch (_) {}
        }

        return successResponse(res, { sale }, getTranslation('saleCancelled', lang));
    } catch (err) {
        logger.error('cancelSale error:', err.message);
        next(err);
    }
};

module.exports = {
    createSale,
    getSales,
    getSaleById,
    updateSaleStatus,
    cancelSale,
    getStoreInfo,
    applyCouponInternal
};
