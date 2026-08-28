// backend/controllers/purchaseOrderController.js
const PurchaseOrder = require('../models/PurchaseOrder');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const InventoryMovement = require('../models/InventoryMovement');
const Setting = require('../models/Setting');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

// Generate the next sequential order number: PO-YYYY/MM/00001
const generateOrderNumber = async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    // Find the highest counter used this month
    const prefix = 'PO-' + year + '/' + month + '/';
    const last = await PurchaseOrder.findOne({ orderNumber: new RegExp('^' + prefix) })
        .sort({ orderNumber: -1 })
        .select('orderNumber');
    let counter = 1;
    if (last && last.orderNumber) {
        const parts = last.orderNumber.split('/');
        const prev = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(prev)) counter = prev + 1;
    }
    return prefix + String(counter).padStart(5, '0');
};

// GET /api/purchase-orders?page&limit&status&search
const getPurchaseOrders = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { status, search, supplier } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (supplier) filter.supplier = supplier;
        if (search) {
            const needle = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const r = new RegExp(needle, 'i');
            filter.$or = [
                { orderNumber: r },
                { supplierName: r },
                { supplierPhone: r }
            ];
        }

        const [docs, total] = await Promise.all([
            PurchaseOrder.find(filter)
                .populate('supplier', 'name phone email')
                .sort({ orderDate: -1, createdAt: -1 })
                .skip(skip).limit(limit),
            PurchaseOrder.countDocuments(filter)
        ]);

        return paginatedResponse(res, { data: docs, total, page, limit });
    } catch (err) {
        logger.error('getPurchaseOrders error:', err.message);
        next(err);
    }
};

// GET /api/purchase-orders/:id
const getPurchaseOrderById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const po = await PurchaseOrder.findById(req.params.id)
            .populate('supplier', 'name phone email address rc nif nis art');
        if (!po) return errorResponse(res, 404, getTranslation('purchaseOrderNotFound', lang) || 'Purchase order not found');
        return successResponse(res, { purchaseOrder: po });
    } catch (err) {
        logger.error('getPurchaseOrderById error:', err.message);
        next(err);
    }
};

// POST /api/purchase-orders
const createPurchaseOrder = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const {
            supplier: supplierId, items, expectedDate, orderDate,
            discount = 0, tax = 0, status = 'draft', notes
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return errorResponse(res, 400, getTranslation('missingFields', lang) || 'Items are required');
        }

        // Snapshot supplier info
        let supplierSnapshot = { name: '', phone: '', email: '' };
        if (supplierId) {
            const supplier = await Supplier.findById(supplierId);
            if (!supplier) return errorResponse(res, 400, getTranslation('supplierNotFound', lang) || 'Supplier not found');
            supplierSnapshot = {
                name: supplier.getName?.('ar') || supplier.name?.ar || '',
                phone: supplier.phone || '',
                email: supplier.email || ''
            };
        }

        // Normalize items + compute totals
        let subtotal = 0;
        const normalizedItems = [];
        for (const item of items) {
            const qty = Number(item.quantity);
            const unitPrice = Number(item.unitPrice);
            if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(unitPrice)) {
                return errorResponse(res, 400, 'Invalid item payload');
            }
            let snapshot = { name: '', barcode: '', unit: '' };
            if (item.product) {
                const product = await Product.findById(item.product);
                if (product) {
                    snapshot = {
                        name: product.getName?.('ar') || product.name?.ar || '',
                        barcode: product.barcode || '',
                        unit: product.unit || ''
                    };
                }
            } else if (item.productName) {
                snapshot.name = String(item.productName);
                snapshot.barcode = String(item.productBarcode || '');
                snapshot.unit = String(item.productUnit || '');
            }
            const lineTotal = qty * unitPrice;
            subtotal += lineTotal;
            normalizedItems.push({
                product: item.product || null,
                productName: snapshot.name,
                productBarcode: snapshot.barcode,
                productUnit: snapshot.unit,
                quantity: qty,
                unitPrice: unitPrice,
                total: lineTotal
            });
        }

        const taxAmount = Math.max(0, Number(tax) || 0);
        const discountAmount = Math.max(0, Number(discount) || 0);
        const total = Math.max(0, subtotal - discountAmount + taxAmount);

        const orderNumber = await generateOrderNumber();
        const po = new PurchaseOrder({
            orderNumber,
            orderDate: orderDate ? new Date(orderDate) : new Date(),
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            supplier: supplierId || null,
            supplierName: supplierSnapshot.name,
            supplierPhone: supplierSnapshot.phone,
            supplierEmail: supplierSnapshot.email,
            items: normalizedItems,
            subtotal,
            discount: discountAmount,
            tax: taxAmount,
            total,
            status: status || 'draft',
            notes: notes || '',
            createdBy: req.userId
        });
        await po.save();

        return createdResponse(res, { purchaseOrder: po }, getTranslation('purchaseOrderCreated', lang) || 'Purchase order created');
    } catch (err) {
        logger.error('createPurchaseOrder error:', err.message, err.stack || '');
        next(err);
    }
};

// PUT /api/purchase-orders/:id
const updatePurchaseOrder = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return errorResponse(res, 404, getTranslation('purchaseOrderNotFound', lang) || 'Purchase order not found');
        // Received orders are immutable (stock was already applied).
        if (po.status === 'received') {
            return errorResponse(res, 400, 'Received purchase orders cannot be edited');
        }

        const {
            supplier: supplierId, items, expectedDate, orderDate,
            discount = 0, tax = 0, status, notes
        } = req.body;

        if (supplierId !== undefined) {
            if (supplierId) {
                const supplier = await Supplier.findById(supplierId);
                if (!supplier) return errorResponse(res, 400, getTranslation('supplierNotFound', lang) || 'Supplier not found');
                po.supplier = supplierId;
                po.supplierName = supplier.getName?.('ar') || supplier.name?.ar || '';
                po.supplierPhone = supplier.phone || '';
                po.supplierEmail = supplier.email || '';
            } else {
                po.supplier = null;
                po.supplierName = '';
                po.supplierPhone = '';
                po.supplierEmail = '';
            }
        }

        if (expectedDate !== undefined) po.expectedDate = expectedDate ? new Date(expectedDate) : null;
        if (orderDate !== undefined) po.orderDate = orderDate ? new Date(orderDate) : po.orderDate;
        if (notes !== undefined) po.notes = notes || '';
        if (status !== undefined && ['draft', 'sent', 'received', 'cancelled'].includes(status)) {
            po.status = status;
        }

        if (items && Array.isArray(items)) {
            let subtotal = 0;
            const normalizedItems = [];
            for (const item of items) {
                const qty = Number(item.quantity);
                const unitPrice = Number(item.unitPrice);
                if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(unitPrice)) continue;
                let snapshot = { name: '', barcode: '', unit: '' };
                if (item.product) {
                    const product = await Product.findById(item.product);
                    if (product) {
                        snapshot = {
                            name: product.getName?.('ar') || product.name?.ar || '',
                            barcode: product.barcode || '',
                            unit: product.unit || ''
                        };
                    }
                } else if (item.productName) {
                    snapshot.name = String(item.productName);
                    snapshot.barcode = String(item.productBarcode || '');
                    snapshot.unit = String(item.productUnit || '');
                }
                const lineTotal = qty * unitPrice;
                subtotal += lineTotal;
                normalizedItems.push({
                    product: item.product || null,
                    productName: snapshot.name,
                    productBarcode: snapshot.barcode,
                    productUnit: snapshot.unit,
                    quantity: qty,
                    unitPrice: unitPrice,
                    total: lineTotal
                });
            }
            po.items = normalizedItems;
            po.subtotal = subtotal;
            const taxAmount = Math.max(0, Number(tax) || 0);
            const discountAmount = Math.max(0, Number(discount) || 0);
            po.tax = taxAmount;
            po.discount = discountAmount;
            po.total = Math.max(0, subtotal - discountAmount + taxAmount);
        }

        await po.save();

        // If status was changed to 'received', apply stock increments + audit log.
        if (po.status === 'received' && !po.stockApplied) {
            for (const it of po.items) {
                if (it.product) {
                    const product = await Product.findById(it.product);
                    if (product) {
                        const prev = product.stock;
                        product.stock = (product.stock || 0) + it.quantity;
                        await product.save();
                        await InventoryMovement.create({
                            product: product._id,
                            type: 'in',
                            quantity: it.quantity,
                            previousStock: prev,
                            newStock: product.stock,
                            reason: { ar: 'أمر شراء', en: 'Purchase order', fr: 'Bon de commande' },
                            reference: po.orderNumber,
                            createdBy: req.userId
                        });
                    }
                }
            }
            po.stockApplied = true;
            await po.save();
        }

        return successResponse(res, { purchaseOrder: po }, getTranslation('updated', lang));
    } catch (err) {
        logger.error('updatePurchaseOrder error:', err.message);
        next(err);
    }
};

// DELETE /api/purchase-orders/:id
const deletePurchaseOrder = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return errorResponse(res, 404, getTranslation('purchaseOrderNotFound', lang) || 'Purchase order not found');
        // Prevent deleting received orders (stock was already incremented).
        if (po.status === 'received' && po.stockApplied) {
            return errorResponse(res, 400, 'Cannot delete a received purchase order (stock was already incremented). Cancel it instead.');
        }
        await po.deleteOne();
        return successResponse(res, null, getTranslation('purchaseOrderDeleted', lang) || 'Purchase order deleted');
    } catch (err) {
        logger.error('deletePurchaseOrder error:', err.message);
        next(err);
    }
};

module.exports = {
    getPurchaseOrders,
    getPurchaseOrderById,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder
};
