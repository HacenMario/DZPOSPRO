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
        if (sale.status === 'returned') return errorResponse(res, 400, getTranslation('saleAlreadyReturned', lang));

        // Falls back to no-transaction mode on standalone MongoDB (no replica set).
        const txnBody = async () => {
            const returnItems = [];
            let totalRefund = 0;
            const movementsData = [];

            for (const item of items) {
                const productId = item.product || item.productId;
                const qty = Number(item.quantity);
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

                // Cumulative cap across multiple return requests
                const previouslyReturned = saleItem.returnedQuantity || 0;
                const remaining = saleItem.quantity - previouslyReturned;
                if (qty > remaining) {
                    throw Object.assign(
                        new Error(`${getTranslation('returnQtyExceeded', lang)} (${Math.max(0, remaining)})`),
                        { statusCode: 400, expose: true }
                    );
                }

                // Refund at the recorded sale-time unit price — client-sent prices
                // are never trusted.
                const price = saleItem.price;
                const refundAmount = price * qty;
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
                    price,
                    total: refundAmount,
                    reason: typeof item.reason === 'string' ? item.reason : ''
                });

                // Track cumulative returned quantity on the sale item
                saleItem.returnedQuantity = previouslyReturned + qty;
                await saleItem.save({ session });
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

            // Only mark the sale fully 'returned' when every line item has been
            // returned in full; partial returns keep it 'completed' so existing
            // revenue/report filters stay intact — the Return records document refunds.
            const allItems = await SaleItem.find({ sale: sale._id }).session(session);
            const fullyReturned = allItems.length > 0 && allItems.every(it => (it.returnedQuantity || 0) >= it.quantity);
            sale.status = fullyReturned ? 'returned' : 'completed';
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

        let result;
        try {
            session = await mongoose.startSession();
            result = await session.withTransaction(txnBody);
        } catch (err) {
            if (session) { try { session.endSession(); } catch (_) {} session = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — running return without transaction.');
                result = await txnBody();
            } else {
                throw err;
            }
        }

        const populated = await Return.findById(result._id)
            .populate('sale', 'saleNumber total')
            .populate('items.product', 'name price barcode')
            .populate('createdBy', 'name');

        return createdResponse(res, { return: decorate(populated, lang), totalRefund: result.totalRefund }, getTranslation('saleReturned', lang));
    } catch (err) {
        logger.error('createReturn error:', err.message, err.stack || '');
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

module.exports = { createReturn, getReturns, getReturnById };
