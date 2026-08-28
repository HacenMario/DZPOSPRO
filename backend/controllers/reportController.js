// backend/controllers/reportController.js
const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Date-only strings (YYYY-MM-DD) are interpreted as UTC instants so ranges are
// identical regardless of the server's local timezone: `from` → UTC midnight,
// `to` → end of that UTC day. Full ISO datetime strings parse as absolute instants.
const parseInstant = (value, endOfDay = false) => {
    if (DATE_ONLY.test(value)) {
        return new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
    }
    return new Date(value); // full ISO datetime — absolute instant
};

const parseRange = (query) => {
    const now = new Date();
    const from = query.from ? parseInstant(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? parseInstant(query.to, true) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to };
};

const productName = (p, lang) => {
    if (!p) return '';
    if (typeof p.getName === 'function') return p.getName(lang);
    if (p.name && typeof p.name === 'object') return p.name[lang] || p.name.ar || '';
    return p.name || '';
};

// GET /api/reports/summary?from&to
const getSummary = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { from, to } = parseRange(req.query);

        const [sales, totalProducts, totalCustomers, lowStockProducts] = await Promise.all([
            Sale.find({ saleDate: { $gte: from, $lt: to }, status: 'completed' })
                .populate('customer', 'name phone')
                .populate({ path: 'items', populate: { path: 'product', select: 'name costPrice price' } }),
            Product.countDocuments({ status: 'active' }),
            Customer.countDocuments({ isActive: true }),
            Product.find({ status: 'active', $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] } })
        ]);

        const totalSales = sales.length;
        const totalRevenue = sales.reduce((s, x) => s + (x.total || 0), 0);
        const totalProfit = sales.reduce((sum, s) => {
            return sum + (s.items || []).reduce((acc, it) => {
                const cost = it.product?.costPrice || 0;
                return acc + (it.total - cost * it.quantity);
            }, 0);
        }, 0);

        // Top products
        const productMap = {};
        sales.forEach(s => (s.items || []).forEach(it => {
            if (!it.product) return;
            const id = it.product._id.toString();
            if (!productMap[id]) productMap[id] = { product: it.product, quantity: 0, revenue: 0 };
            productMap[id].quantity += it.quantity;
            productMap[id].revenue += it.total || 0;
        }));
        const topProducts = Object.values(productMap).sort((a, b) => b.quantity - a.quantity).slice(0, 10)
            .map(p => ({ id: p.product._id, name: productName(p.product, lang), quantity: p.quantity, revenue: p.revenue }));

        // Top customers
        const custMap = {};
        sales.forEach(s => {
            if (!s.customer) return;
            const id = s.customer._id.toString();
            if (!custMap[id]) custMap[id] = { customer: s.customer, total: 0, count: 0 };
            custMap[id].total += s.total || 0;
            custMap[id].count += 1;
        });
        const topCustomers = Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 10)
            .map(c => ({
                id: c.customer._id,
                name: c.customer.getName?.(lang) || c.customer.name?.[lang] || c.customer.name?.ar || '',
                phone: c.customer.phone,
                total: c.total,
                count: c.count
            }));

        // Sales by day
        const dayMap = {};
        sales.forEach(s => {
            const d = s.saleDate.toISOString().slice(0, 10);
            if (!dayMap[d]) dayMap[d] = { date: d, count: 0, revenue: 0 };
            dayMap[d].count += 1;
            dayMap[d].revenue += s.total || 0;
        });
        const salesByDay = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

        // Sales by category
        const catMap = {};
        sales.forEach(s => (s.items || []).forEach(async (it) => {
            if (!it.product) return;
            // populate category lazily — group by productId aggregation is expensive; keep simple
        }));
        // For category breakdown, run an aggregation
        const salesByCategoryAgg = await Sale.aggregate([
            { $match: { saleDate: { $gte: from, $lt: to }, status: 'completed' } },
            { $lookup: { from: 'saleitems', localField: 'items', foreignField: '_id', as: 'items' } },
            { $unwind: '$items' },
            { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'categories', localField: 'product.category', foreignField: '_id', as: 'category' } },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            { $group: {
                _id: '$category._id',
                categoryId: { $first: '$category._id' },
                categoryName: { $first: '$category.name' },
                revenue: { $sum: '$items.total' },
                quantity: { $sum: '$items.quantity' }
            } }
        ]);
        const salesByCategory = salesByCategoryAgg.map(c => ({
            categoryId: c.categoryId,
            name: c.categoryName?.[lang] || c.categoryName?.ar || 'Uncategorized',
            revenue: c.revenue,
            quantity: c.quantity
        }));

        // Sales by payment method
        const payMap = {};
        sales.forEach(s => {
            payMap[s.paymentMethod] = (payMap[s.paymentMethod] || 0) + (s.total || 0);
        });
        const salesByPaymentMethod = Object.entries(payMap).map(([method, total]) => ({ method, total }));

        const data = {
            totalSales,
            totalRevenue,
            totalProfit,
            totalCustomers,
            totalProducts,
            lowStockCount: lowStockProducts.length,
            topProducts,
            topCustomers,
            salesByDay,
            salesByCategory,
            salesByPaymentMethod
        };

        return successResponse(res, data);
    } catch (err) {
        logger.error('getSummary error:', err.message);
        next(err);
    }
};

// GET /api/reports/sales?from&to&group_by=day|month  → chart-friendly
const getSalesReport = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { from, to } = parseRange(req.query);
        const groupBy = req.query.group_by === 'month' ? 'month' : 'day';

        const sales = await Sale.find({ saleDate: { $gte: from, $lt: to }, status: 'completed' });
        const buckets = {};
        sales.forEach(s => {
            // Bucket keys are always UTC so day/month grouping matches the
            // UTC date-range filtering above.
            const d = s.saleDate;
            const key = groupBy === 'month'
                ? d.toISOString().slice(0, 7)
                : d.toISOString().slice(0, 10);
            if (!buckets[key]) buckets[key] = { label: key, count: 0, revenue: 0 };
            buckets[key].count += 1;
            buckets[key].revenue += s.total || 0;
        });
        const data = Object.values(buckets).sort((a, b) => a.label.localeCompare(b.label));
        return successResponse(res, { labels: data.map(d => d.label), datasets: [{ count: data.map(d => d.count), revenue: data.map(d => d.revenue) }], data });
    } catch (err) {
        logger.error('getSalesReport error:', err.message);
        next(err);
    }
};

// GET /api/reports/products?from&to&limit
const getProductsReport = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { from, to } = parseRange(req.query);
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

        const sales = await Sale.find({ saleDate: { $gte: from, $lt: to }, status: 'completed' })
            .populate({ path: 'items', populate: { path: 'product', select: 'name price costPrice' } });

        const map = {};
        sales.forEach(s => (s.items || []).forEach(it => {
            if (!it.product) return;
            const id = it.product._id.toString();
            if (!map[id]) map[id] = { product: it.product, quantity: 0, revenue: 0, profit: 0 };
            map[id].quantity += it.quantity;
            map[id].revenue += it.total || 0;
            map[id].profit += (it.total || 0) - (it.product.costPrice || 0) * it.quantity;
        }));

        const data = Object.values(map).sort((a, b) => b.quantity - a.quantity).slice(0, limit)
            .map(p => ({
                id: p.product._id,
                name: productName(p.product, lang),
                quantity: p.quantity,
                revenue: p.revenue,
                profit: p.profit
            }));

        return successResponse(res, { topProducts: data });
    } catch (err) {
        logger.error('getProductsReport error:', err.message);
        next(err);
    }
};

// GET /api/reports/customers?from&to&limit
const getCustomersReport = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { from, to } = parseRange(req.query);
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

        const sales = await Sale.find({ saleDate: { $gte: from, $lt: to }, status: 'completed' })
            .populate('customer', 'name phone');

        const map = {};
        sales.forEach(s => {
            if (!s.customer) return;
            const id = s.customer._id.toString();
            if (!map[id]) map[id] = { customer: s.customer, total: 0, count: 0 };
            map[id].total += s.total || 0;
            map[id].count += 1;
        });

        const data = Object.values(map).sort((a, b) => b.total - a.total).slice(0, limit)
            .map(c => ({
                id: c.customer._id,
                name: c.customer.getName?.(lang) || c.customer.name?.[lang] || c.customer.name?.ar || '',
                phone: c.customer.phone,
                total: c.total,
                count: c.count
            }));

        return successResponse(res, { topCustomers: data });
    } catch (err) {
        logger.error('getCustomersReport error:', err.message);
        next(err);
    }
};

// GET /api/reports/inventory  → { lowStock[], totalStockValue, totalItems }
const getInventoryReport = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const [lowStock, agg] = await Promise.all([
            Product.find({ status: 'active', $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] } })
                .populate('category', 'name'),
            Product.aggregate([
                { $match: { status: 'active' } },
                { $group: {
                    _id: null,
                    totalStockValue: { $sum: { $multiply: ['$stock', '$costPrice'] } },
                    totalItems: { $sum: 1 }
                } }
            ])
        ]);

        const data = {
            lowStock: lowStock.map(p => ({
                id: p._id,
                name: p.getName?.(lang) || p.name?.ar || '',
                stock: p.stock,
                minStock: p.minStock,
                price: p.price,
                category: p.category?.getName?.(lang) || p.category?.name?.[lang] || p.category?.name?.ar || ''
            })),
            totalStockValue: agg[0]?.totalStockValue || 0,
            totalItems: agg[0]?.totalItems || 0
        };

        return successResponse(res, data);
    } catch (err) {
        logger.error('getInventoryReport error:', err.message);
        next(err);
    }
};

module.exports = {
    getSummary,
    getSalesReport,
    getProductsReport,
    getCustomersReport,
    getInventoryReport
};
