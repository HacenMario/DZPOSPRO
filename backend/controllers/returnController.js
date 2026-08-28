// backend/controllers/returnController.js
const Return = require('../models/Return');
const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const InventoryMovement = require('../models/InventoryMovement');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { mongoose } = require('../config/db');

const decorate = (r, lang) => {
    const o = r.toObject ? r.toObject() : { ...r };
    o.reason = r.reason?.[lang] || r.reason?.ar || '';
    if (Array.isArray(o.items)) {
        o.items = o.items.map(it => ({
            ...it,
            productName: it.product?.getName?.(lang) || (it.product && it.product.name && (it.product.name[lang] || it.product.name.ar)) || it.productName || ''
        }));
    }
    return o;
};

// Per-item returned-quantity map for a sale: { "<saleItemId|productId>": qty }.
// Keys fall back to the product id when an old Return doc lacks the saleItem ref.
const buildReturnedMap = (returnDocs) => {
    const map = {};
    (returnDocs || []).forEach(r => (r.items || []).forEach(it => {
        const k = String(it.saleItem || it.product);
        map[k] = (map[k] || 0) + Number(it.quantity || 0);
    }));
    return map;
};

// A sale is FULLY returned only when every sale item has been returned
// completely. Partial returns must NOT lock the remaining items.
const isSaleFullyReturned = async (saleId, session) => {
    const [saleItems, rets] = await Promise.all([
        SaleItem.find({ sale: saleId }).select('quantity product').session(session),
        Return.find({ sale: saleId }).select('items').session(session)
    ]);
    if (!saleItems.length) return false;
    const map = buildReturnedMap(rets);
    return saleItems.every(si => {
        const returned = map[String(si._id)] != null ? map[String(si._id)] : (map[String(si.product)] || 0);
        return returned >= Number(si.quantity || 0);
    });
};

// POST /api/returns  { sale, items[{ saleItem, product, quantity, reason }], reason }
const createReturn = async (req, res, next) => {
    const lang = req.lang || 'ar';
    let session = null;
    try {
        const { sale: saleId, items, reason } = req.body;
        if (!saleId || !items || !Array.isArray(items) || items.length === 0) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const sale = await Sale.findById(saleId);
        if (!sale) return errorResponse(res, 404, getTranslation('saleNotFound', lang));

        // NOTE: the sale status is NOT a blocking condition anymore. The old
        // check (status === 'returned' → reject) locked a sale after its FIRST
        // return — even a partial one — so returning any other item of the
        // same sale failed with "saleAlreadyReturned". Validation is now done
        // PER ITEM against the quantities already returned (see txnBody).

        // Falls back to no-transaction mode on standalone MongoDB (no replica set).
        // NOTE: session.withTransaction() resolves to the COMMIT RESULT (or
        // undefined) — NOT to the callback's return value — so the created
        // document and its totals are captured here, inside the closure.
        let createdId = null;
        let refundedTotal = 0;
        const txnBody = async () => {
            const returnItems = [];
            let totalRefund = 0;
            const movementsData = [];
            const requestedQty = {}; // per saleItem/product key: qty requested in THIS call

            // Quantities already returned by previous Return docs of this sale.
            const priorReturns = await Return.find({ sale: sale._id }).select('items').session(session);
            const alreadyReturned = buildReturnedMap(priorReturns);

            for (const item of items) {
                const productId = item.product || item.productId;
                const qty = Number(item.quantity);
                const price = Number(item.price);
                if (!productId || !Number.isFinite(qty) || qty < 1) {
                    throw Object.assign(new Error(getTranslation('missingFields', lang)), { statusCode: 400, expose: true });
                }

                const saleItem = await SaleItem.findOne({
                    _id: item.saleItem ? item.saleItem : { $exists: true },
                    sale: sale._id,
                    product: productId
                }).session(session);

                if (!saleItem) {
                    throw Object.assign(new Error(getTranslation('saleItemNotFound', lang)), { statusCode: 400, expose: true });
                }

                // Per-item remaining quantity check: previously returned
                // (earlier returns) + qty requested now (this call) must not
                // exceed the purchased quantity.
                const itemKey = String(saleItem._id);
                const productKey = String(productId);
                const prior = alreadyReturned[itemKey] != null ? alreadyReturned[itemKey] : (alreadyReturned[productKey] || 0);
                const inThisCall = requestedQty[itemKey] || 0;
                if (prior + inThisCall + qty > Number(saleItem.quantity)) {
                    throw Object.assign(new Error(getTranslation('returnQtyExceeded', lang)), { statusCode: 400, expose: true });
                }
                requestedQty[itemKey] = inThisCall + qty;

                const refundAmount = (Number.isFinite(price) ? price : saleItem.price) * qty;
                totalRefund += refundAmount;

                const product = await Product.findById(productId).session(session);
                if (product) {
                    const prev = product.stock;
                    product.stock += qty;
                    await product.save({ session });
                    movementsData.push({
                        product: product._id,
                        type: 'in',
                        quantity: qty,
                        previousStock: prev,
                        newStock: product.stock,
                        reason: { ar: 'إرجاع', en: 'Return', fr: 'Retour' },
                        reference: sale.saleNumber,
                        createdBy: req.userId
                    });
                }

                returnItems.push({
                    saleItem: saleItem._id,
                    product: productId,
                    quantity: qty,
                    price: Number.isFinite(price) ? price : saleItem.price,
                    total: refundAmount,
                    reason: typeof item.reason === 'string' ? item.reason : ''
                });
            }

            const [returnDoc] = await Return.create([{
                sale: sale._id,
                items: returnItems,
                reason: {
                    ar: reason?.ar || (typeof reason === 'string' ? reason : '') || '',
                    en: reason?.en || '',
                    fr: reason?.fr || ''
                },
                totalRefund,
                createdBy: req.userId
            }], { session });
            createdId = returnDoc._id;
            refundedTotal = totalRefund;

            // Mark the sale 'returned' ONLY when every item has been fully
            // returned. Partial returns keep the sale usable so the remaining
            // items can still be returned later.
            if (await isSaleFullyReturned(sale._id, session)) {
                sale.status = 'returned';
            }
            await sale.save({ session });

            if (sale.customer) {
                const customer = await Customer.findById(sale.customer).session(session);
                if (customer) {
                    customer.totalSpent = Math.max(0, (customer.totalSpent || 0) - totalRefund);
                    customer.loyaltyPoints = Math.max(0, (customer.loyaltyPoints || 0) - Math.floor(totalRefund / 100));
                    await customer.save({ session });
                }
            }

            if (movementsData.length > 0) {
                await InventoryMovement.insertMany(movementsData, { session });
            }

            return returnDoc;
        };

        try {
            session = await mongoose.startSession();
            await session.withTransaction(txnBody);
        } catch (err) {
            if (session) { try { session.endSession(); } catch (_) {} session = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — running return without transaction.');
                await txnBody();
            } else {
                throw err;
            }
        }

        const populated = await Return.findById(createdId)
            .populate('sale', 'saleNumber total')
            .populate('items.product', 'name price barcode')
            .populate('createdBy', 'name');

        return createdResponse(res, { return: decorate(populated, lang), totalRefund: refundedTotal }, getTranslation('saleReturned', lang));
    } catch (err) {
        logger.error('createReturn error:', err.message, err.stack || '');
        if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
        next(err);
    } finally {
        if (session) session.endSession();
    }
};

// DELETE /api/returns/:id — deletes a return and rolls back its effects:
// stock restored to pre-return level, customer totals restored, and the
// sale status recomputed (back to 'completed' if some items are no longer
// fully returned).
const deleteReturn = async (req, res, next) => {
    const lang = req.lang || 'ar';
    let session = null;
    try {
        const existing = await Return.findById(req.params.id);
        if (!existing) return errorResponse(res, 404, getTranslation('notFound', lang));

        const txnBody = async () => {
            const ret = await Return.findById(req.params.id)
                .populate('sale', 'saleNumber customer status')
                .session(session);
            if (!ret) {
                throw Object.assign(new Error(getTranslation('notFound', lang)), { statusCode: 404, expose: true });
            }

            // 1) Roll back stock (+ movements) for every returned item
            const movementsData = [];
            for (const it of (ret.items || [])) {
                const qty = Number(it.quantity || 0);
                if (!it.product || qty < 1) continue;
                const product = await Product.findById(it.product).session(session);
                if (product) {
                    const prev = product.stock;
                    product.stock = Math.max(0, prev - qty);
                    await product.save({ session });
                    movementsData.push({
                        product: product._id,
                        type: 'out',
                        quantity: qty,
                        previousStock: prev,
                        newStock: product.stock,
                        reason: { ar: 'حذف إرجاع', en: 'Return deleted', fr: 'Retour supprimé' },
                        reference: (ret.sale && ret.sale.saleNumber) || '',
                        createdBy: req.userId
                    });
                }
            }
            if (movementsData.length > 0) {
                await InventoryMovement.insertMany(movementsData, { session });
            }

            // 2) Roll back customer totals
            if (ret.sale && ret.sale.customer) {
                const customer = await Customer.findById(ret.sale.customer).session(session);
                if (customer) {
                    customer.totalSpent = (customer.totalSpent || 0) + (ret.totalRefund || 0);
                    customer.loyaltyPoints = (customer.loyaltyPoints || 0) + Math.floor((ret.totalRefund || 0) / 100);
                    await customer.save({ session });
                }
            }

            // 3) Delete the return document
            await Return.deleteOne({ _id: ret._id }).session(session);

            // 4) Recompute the sale status (the deleted return is no longer
            //    visible to isSaleFullyReturned inside this transaction)
            if (ret.sale && ret.sale._id) {
                const sale = await Sale.findById(ret.sale._id).session(session);
                if (sale) {
                    sale.status = await isSaleFullyReturned(sale._id, session) ? 'returned' : 'completed';
                    await sale.save({ session });
                }
            }

            return ret;
        };

        let result;
        try {
            session = await mongoose.startSession();
            result = await session.withTransaction(txnBody);
        } catch (err) {
            if (session) { try { session.endSession(); } catch (_) {} session = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — deleting return without transaction.');
                result = await txnBody();
            } else {
                throw err;
            }
        }

        return successResponse(res, { id: req.params.id }, getTranslation('returnDeleted', lang));
    } catch (err) {
        logger.error('deleteReturn error:', err.message, err.stack || '');
        if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
        next(err);
    } finally {
        if (session) session.endSession();
    }
};

// GET /api/returns?page&limit
const getReturns = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const [docs, total] = await Promise.all([
            Return.find()
                .populate('sale', 'saleNumber total')
                .populate('items.product', 'name')
                .populate('createdBy', 'name')
                .sort({ createdAt: -1 })
                .skip(skip).limit(limit),
            Return.countDocuments({})
        ]);
        const data = docs.map(r => decorate(r, lang));
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getReturns error:', err.message);
        next(err);
    }
};

// GET /api/returns/:id
const getReturnById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const r = await Return.findById(req.params.id)
            .populate('sale', 'saleNumber total')
            .populate('items.product', 'name price barcode')
            .populate('createdBy', 'name');
        if (!r) return errorResponse(res, 404, getTranslation('notFound', lang));
        return successResponse(res, { return: decorate(r, lang) });
    } catch (err) {
        logger.error('getReturnById error:', err.message);
        next(err);
    }
};

module.exports = { createReturn, getReturns, getReturnById, deleteReturn };
