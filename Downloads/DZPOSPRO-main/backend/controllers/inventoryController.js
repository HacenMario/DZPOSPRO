// backend/controllers/inventoryController.js
const InventoryMovement = require('../models/InventoryMovement');
const Product = require('../models/Product');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { mongoose } = require('../config/db');

const decorateProduct = (p, lang) => {
    const obj = p.toObject ? p.toObject() : { ...p };
    obj.displayName = p.getName?.(lang) || p.name?.ar || '';
    obj.displayDescription = p.getDescription?.(lang) || '';
    return obj;
};

// GET /api/inventory/movements?page&limit&type&product&from&to
const getAllMovements = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { type, product, from, to } = req.query;

        const filter = {};
        if (type) filter.type = type;
        if (product) filter.product = product;
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        const [docs, total] = await Promise.all([
            InventoryMovement.find(filter)
                .populate('product', 'name price barcode')
                .populate('createdBy', 'name')
                .sort({ createdAt: -1 })
                .skip(skip).limit(limit),
            InventoryMovement.countDocuments(filter)
        ]);

        const data = docs.map(m => {
            const o = m.toObject();
            o.reason = m.reason?.[lang] || m.reason?.ar || '';
            o.productName = m.product?.getName?.(lang) || m.product?.name?.ar || '';
            return o;
        });

        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getAllMovements error:', err.message);
        next(err);
    }
};

// GET /api/inventory/product/:productId
const getMovementsByProduct = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);

        const product = await Product.findById(req.params.productId);
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));

        const filter = { product: product._id };
        const [docs, total] = await Promise.all([
            InventoryMovement.find(filter)
                .populate('createdBy', 'name')
                .sort({ createdAt: -1 })
                .skip(skip).limit(limit),
            InventoryMovement.countDocuments(filter)
        ]);

        const data = docs.map(m => {
            const o = m.toObject();
            o.reason = m.reason?.[lang] || m.reason?.ar || '';
            return o;
        });

        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getMovementsByProduct error:', err.message);
        next(err);
    }
};

// POST /api/inventory/movements  { product, type: in|out|adjust, quantity, reason }
const createMovement = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { product: productId, type, quantity, reason } = req.body;

        if (!productId || !type || quantity === undefined) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }
        if (!['in', 'out', 'adjust'].includes(type)) {
            return errorResponse(res, 400, getTranslation('invalidMovementType', lang));
        }
        const qtyNum = Number(quantity);
        if (!Number.isInteger(qtyNum) || qtyNum < 1) {
            return errorResponse(res, 400, getTranslation('invalidData', lang));
        }

        // Transaction with fallback for standalone MongoDB (no replica set).
        const txnBody = async (session) => {
            const product = await Product.findById(productId).session(session);
            if (!product) {
                throw Object.assign(new Error(getTranslation('productNotFound', lang)), { statusCode: 404, expose: true });
            }

            let newStock = product.stock;
            if (type === 'in') newStock += qtyNum;
            else if (type === 'out') {
                if (product.stock < qtyNum) {
                    throw Object.assign(new Error(getTranslation('insufficientStock', lang)), { statusCode: 400, expose: true });
                }
                newStock -= qtyNum;
            } else if (type === 'adjust') {
                if (qtyNum === product.stock) {
                    throw Object.assign(new Error('No stock change — adjust value equals current stock'), { statusCode: 400, expose: true });
                }
                newStock = qtyNum; // absolute target
            }

            const prev = product.stock;
            product.stock = Math.max(0, newStock);
            await product.save({ session });

            const [mov] = await InventoryMovement.create([{
                product: product._id,
                type,
                quantity: type === 'adjust' ? Math.abs(newStock - prev) : qtyNum,
                previousStock: prev,
                newStock: product.stock,
                reason: {
                    ar: typeof reason === 'string' ? reason : (reason?.ar || ''),
                    en: typeof reason === 'object' ? (reason?.en || '') : '',
                    fr: typeof reason === 'object' ? (reason?.fr || '') : ''
                },
                reference: 'manual',
                createdBy: req.userId
            }], { session });
            return mov;
        };

        let movement;
        let session = null;
        try {
            session = await mongoose.startSession();
            movement = await session.withTransaction(() => txnBody(session));
        } catch (err) {
            if (session) { try { session.endSession(); } catch (_) {} session = null; }
            const isTxnUnsupported = err && /replica set|Transaction numbers are only allowed|transactions are not supported/i.test(err.message || '');
            if (isTxnUnsupported) {
                logger.warn('MongoDB transactions not supported (standalone) — running movement without transaction.');
                movement = await txnBody(null);
            } else {
                throw err;
            }
        } finally {
            if (session) try { session.endSession(); } catch (_) {}
        }

        return createdResponse(res, { movement }, getTranslation('movementLogged', lang));
    } catch (err) {
        logger.error('createMovement error:', err.message);
        if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
        next(err);
    }
};

// GET /api/inventory/summary  → { lowStock[], totalStockValue, totalItems }
const getInventorySummary = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const lowStockProducts = await Product.find({
            status: 'active',
            $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] }
        }).populate('category', 'name');

        const agg = await Product.aggregate([
            { $match: { status: 'active' } },
            { $group: {
                _id: null,
                totalStockValue: { $sum: { $multiply: ['$stock', '$costPrice'] } },
                totalItems: { $sum: 1 }
            } }
        ]);

        const data = {
            lowStock: lowStockProducts.map(p => decorateProduct(p, lang)),
            totalStockValue: agg[0]?.totalStockValue || 0,
            totalItems: agg[0]?.totalItems || 0
        };
        return successResponse(res, data);
    } catch (err) {
        logger.error('getInventorySummary error:', err.message);
        next(err);
    }
};

module.exports = {
    getAllMovements,
    getMovementsByProduct,
    createMovement,
    getInventorySummary
};
