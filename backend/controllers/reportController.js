// backend/controllers/reportController.js
const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

const parseRange = (query) => {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    let to = query.to ? new Date(query.to) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    // If `to` was provided as a date-only string (midnight), advance to end of that day
    // so the $lt query includes the entire day.
    if (query.to) {
        const parsed = new Date(query.to);
        if (parsed.getHours() === 0 && parsed.getMinutes() === 0 && parsed.getSeconds() === 0 && parsed.getMilliseconds() === 0) {
            to = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
        }
    }
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
            const d = s.saleDate;
            const key = groupBy === 'month'
                ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

/* ============================================================
 * v3 — Executive KPI + Profitability (tenant-scoped)
 * ============================================================ */
const tenantScope = require('../utils/tenantPlugin').tenantScope;

// GET /api/reports/kpi?days=30
const getKpi = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 365);
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);
        const prevSince = new Date(Date.now() - 2 * days * 24 * 3600 * 1000);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const yStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);

        const base = { status: { $nin: ['cancelled'] }, ...tenantScope() };

        const [cur, prev, today, yesterday, series, byHour, byPay, topProd, topCust, lowStock] = await Promise.all([
            Sale.aggregate([{ $match: { ...base, saleDate: { $gte: since } } }, { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }]),
            Sale.aggregate([{ $match: { ...base, saleDate: { $gte: prevSince, $lt: since } } }, { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }]),
            Sale.aggregate([{ $match: { ...base, saleDate: { $gte: todayStart } } }, { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }]),
            Sale.aggregate([{ $match: { ...base, saleDate: { $gte: yStart, $lt: todayStart } } }, { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } }]),
            Sale.aggregate([
                { $match: { ...base, saleDate: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } }, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Sale.aggregate([
                { $match: { ...base, saleDate: { $gte: since } } },
                { $project: { hour: { $hour: '$saleDate' }, total: 1 } },
                { $group: { _id: '$hour', revenue: { $sum: '$total' }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Sale.aggregate([{ $match: { ...base, saleDate: { $gte: since } } }, { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, count: { $sum: 1 } } }]),
            SaleItem.aggregate([
                { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: '_s' } },
                { $unwind: '$_s' },
                { $match: { '_s.status': { $nin: ['cancelled'] }, '_s.saleDate': { $gte: since }, ...(tenantScope().storeId ? { '_s.storeId': tenantScope().storeId } : {}) } },
                { $group: { _id: '$productName', qty: { $sum: '$quantity' }, revenue: { $sum: '$total' } } },
                { $sort: { revenue: -1 } }, { $limit: 8 }
            ]),
            Sale.aggregate([
                { $match: { ...base, saleDate: { $gte: since }, customer: { $ne: null } } },
                { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'c' } },
                { $unwind: '$c' },
                { $group: { _id: '$customer', name: { $first: '$c.name' }, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
                { $sort: { revenue: -1 } }, { $limit: 8 }
            ]),
            Product.countDocuments({ ...tenantScope(), status: 'active', $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] } })
        ]);

        const c = cur[0] || { revenue: 0, count: 0 };
        const p = prev[0] || { revenue: 0, count: 0 };
        const revenueDelta = p.revenue > 0 ? ((c.revenue - p.revenue) / p.revenue) * 100 : (c.revenue > 0 ? 100 : 0);
        const countDelta = p.count > 0 ? ((c.count - p.count) / p.count) * 100 : (c.count > 0 ? 100 : 0);

        // fill missing days in the series
        const seriesMap = new Map(series.map(s => [s._id, s]));
        const fullSeries = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const hit = seriesMap.get(d);
            fullSeries.push({ date: d, revenue: Math.round(((hit && hit.revenue) || 0) * 100) / 100, count: (hit && hit.count) || 0 });
        }

        return successResponse(res, {
            range: { days },
            current: { revenue: Math.round(c.revenue * 100) / 100, count: c.count },
            previous: { revenue: Math.round(p.revenue * 100) / 100, count: p.count },
            deltas: { revenuePct: Math.round(revenueDelta * 10) / 10, countPct: Math.round(countDelta * 10) / 10 },
            today: today[0] || { revenue: 0, count: 0 },
            yesterday: yesterday[0] || { revenue: 0, count: 0 },
            avgBasket: c.count ? Math.round((c.revenue / c.count) * 100) / 100 : 0,
            series: fullSeries,
            byHour: byHour.map(h => ({ hour: h._id, revenue: Math.round(h.revenue * 100) / 100, count: h.count })),
            payments: byPay.map(x => ({ method: x._id, revenue: Math.round(x.revenue * 100) / 100, count: x.count })),
            topProducts: topProd.map(x => ({ name: x._id || '—', qty: x.qty, revenue: Math.round(x.revenue * 100) / 100 })),
            topCustomers: topCust.map(x => ({ name: x.name, revenue: Math.round(x.revenue * 100) / 100, count: x.count })),
            lowStockCount: lowStock,
            lang
        });
    } catch (err) { next(err); }
};

// GET /api/reports/profitability?from&to  — real margin per product
const getProfitability = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { from, to } = parseRange(req.query);
        const rows = await SaleItem.aggregate([
            { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: '_s' } },
            { $unwind: '$_s' },
            { $match: { '_s.status': { $nin: ['cancelled'] }, '_s.saleDate': { $gte: from, $lt: to }, ...(tenantScope().storeId ? { '_s.storeId': tenantScope().storeId } : {}) } },
            { $group: {
                _id: '$product',
                name: { $first: '$productName' },
                qtySold: { $sum: '$quantity' },
                revenue: { $sum: '$total' },
                // cost snapshot at sale time; fallback 0
                cost: { $sum: { $multiply: [{ $ifNull: ['$costPrice', 0] }, '$quantity'] } }
            } },
            { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
            { $addFields: {
                currentCost: { $multiply: [ { $ifNull: [ { $arrayElemAt: ['$p.costPrice', 0] }, 0 ] }, '$qtySold' ] },
                currentPrice: { $arrayElemAt: ['$p.price', 0] }
            } },
            { $addFields: { effCost: { $cond: [{ $gt: ['$cost', 0] }, '$cost', '$currentCost'] } } },
            { $addFields: { profit: { $subtract: ['$revenue', '$effCost'] } } },
            { $addFields: { marginPct: { $cond: [{ $gt: ['$revenue', 0] }, { $round: [{ $multiply: [{ $divide: ['$profit', '$revenue'] }, 100] }, 1] }, null] } } },
            { $sort: { profit: -1 } },
            { $project: { _id: 1, name: { $ifNull: ['$name', { $arrayElemAt: ['$p.name.ar', 0] }] }, qtySold: 1, revenue: { $round: ['$revenue', 2] }, cost: { $round: ['$effCost', 2] }, profit: { $round: ['$profit', 2] }, marginPct: 1, hasCost: { $gt: ['$effCost', 0] } } }
        ]);
        const totals = rows.reduce((acc, r) => {
            acc.revenue += r.revenue || 0; acc.cost += r.cost || 0; acc.profit += r.profit || 0;
            if (!r.hasCost) acc.unknownCost += 1;
            return acc;
        }, { revenue: 0, cost: 0, profit: 0, unknownCost: 0 });
        totals.marginPct = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : null;
        void lang;
        return successResponse(res, { data: rows, totals, from, to });
    } catch (err) { next(err); }
};

// Alert config CRUD are in alertConfigController — keep reports focused.

module.exports = {
    getSummary,
    getSalesReport,
    getProductsReport,
    getCustomersReport,
    getInventoryReport,
    getKpi,
    getProfitability
};
