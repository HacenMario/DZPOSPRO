// backend/controllers/productController.js
const Product = require('../models/Product');
const Category = require('../models/Category');
const InventoryMovement = require('../models/InventoryMovement');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const fs = require('fs');
const path = require('path');

const deleteImageFile = (imagePath) => {
    if (!imagePath || !imagePath.startsWith('/uploads/')) return;
    const fullPath = path.join(__dirname, '../../', imagePath);
    try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (e) {
        logger.warn(`Failed to delete image ${imagePath}: ${e.message}`);
    }
};

// Backward-compatible helper: accept either a flat string OR a {ar,en,fr} object.
// The frontend now uses a single input field for `name` and `description`; we
// fan the string out across all three language slots. Object inputs pass through.
const fanOutString = (val) => (typeof val === 'string') ? { ar: val, en: val, fr: val } : val;

const decorate = (p, lang) => {
    const obj = p.toObject ? p.toObject() : { ...p };
    obj.displayName = p.getName?.(lang) || p.name?.ar || '';
    obj.displayDescription = p.getDescription?.(lang) || '';
    if (obj.category && obj.category.name && typeof obj.category.name === 'object') {
        obj.category.displayName = obj.category.name[lang] || obj.category.name.ar;
    }
    if (obj.tax === undefined) obj.tax = 0;
    if (obj.timbre === undefined) obj.timbre = 0;
    return obj;
};

// POST /api/products  (multipart: images[])
const createProduct = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const {
            name: rawName, description: rawDescription, price, costPrice, category,
            barcode, sku, stock, minStock, unit, tax, timbre, status
        } = req.body;

        // Accept either a flat string OR {ar,en,fr} for name and description.
        const name = fanOutString(rawName);
        const description = fanOutString(rawDescription);

        if (!name?.ar || price === undefined || price === null || isNaN(parseFloat(price))) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        if (barcode) {
            const dup = await Product.findOne({ barcode });
            if (dup) return errorResponse(res, 400, getTranslation('barcodeExists', lang));
        }
        if (sku) {
            const dup = await Product.findOne({ sku });
            if (dup) return errorResponse(res, 400, getTranslation('skuExists', lang));
        }
        if (category) {
            const cat = await Category.findById(category);
            if (!cat) return errorResponse(res, 400, getTranslation('categoryNotFound', lang));
        }

        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(f => `/uploads/${f.filename}`);
        } else if (req.body.images) {
            try {
                const parsed = JSON.parse(req.body.images);
                if (Array.isArray(parsed)) images = parsed.filter(s => typeof s === 'string');
            } catch (e) { /* ignore */ }
        }

        const product = new Product({
            name: {
                ar: name.ar,
                en: name?.en || '',
                fr: name?.fr || ''
            },
            description: {
                ar: description?.ar || '',
                en: description?.en || '',
                fr: description?.fr || ''
            },
            price: parseFloat(price),
            costPrice: parseFloat(costPrice) || 0,
            category: category || null,
            barcode: barcode || undefined,
            sku: sku || undefined,
            stock: parseInt(stock, 10) || 0,
            minStock: parseInt(minStock, 10) || 5,
            unit: unit || 'pcs',
            tax: parseFloat(tax) || 0,
            timbre: parseFloat(timbre) || 0,
            images,
            status: status || 'active',
            createdBy: req.userId
        });
        await product.save();

        // Initial stock-in movement when product is created with stock
        if (product.stock > 0) {
            await InventoryMovement.create({
                product: product._id,
                type: 'in',
                quantity: product.stock,
                previousStock: 0,
                newStock: product.stock,
                reason: { ar: 'الرصيد الافتتاحي', en: 'Opening stock', fr: 'Stock initial' },
                reference: 'product-create',
                createdBy: req.userId
            });
        }

        return createdResponse(res, { product: decorate(product, lang) }, getTranslation('productCreated', lang));
    } catch (err) {
        logger.error('createProduct error:', err.message);
        next(err);
    }
};

// GET /api/products?page&limit&search&category&status
const getProducts = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { search, category, status, lowStock, sortBy, sortOrder } = req.query;

        const filter = {};
        if (search) {
            const r = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [
                { 'name.ar': r }, { 'name.en': r }, { 'name.fr': r },
                { 'description.ar': r }, { 'description.en': r }, { 'description.fr': r },
                { barcode: r }, { sku: r }
            ];
        }
        if (category) filter.category = category;
        if (status) filter.status = status;
        if (lowStock === 'true') {
            filter.$expr = { $lte: ['$stock', '$minStock'] };
        }

        const sort = {};
        sort[sortBy || 'createdAt'] = sortOrder === 'asc' ? 1 : -1;

        const [docs, total] = await Promise.all([
            Product.find(filter).populate('category', 'name').sort(sort).skip(skip).limit(limit),
            Product.countDocuments(filter)
        ]);
        const data = docs.map(p => decorate(p, lang));
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getProducts error:', err.message);
        next(err);
    }
};

// GET /api/products/:id
const getProductById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const product = await Product.findById(req.params.id).populate('category', 'name');
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));
        return successResponse(res, { product: decorate(product, lang) });
    } catch (err) {
        logger.error('getProductById error:', err.message);
        next(err);
    }
};

// GET /api/products/barcode/:code
const getProductByBarcode = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const product = await Product.findOne({ barcode: req.params.code }).populate('category', 'name');
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));
        return successResponse(res, { product: decorate(product, lang) });
    } catch (err) {
        logger.error('getProductByBarcode error:', err.message);
        next(err);
    }
};

// PUT /api/products/:id  (multipart)
const updateProduct = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const {
            name: rawName, description: rawDescription, price, costPrice, category,
            barcode, sku, stock, minStock, unit, tax, timbre, status,
            existingImages
        } = req.body;

        // Accept either a flat string OR {ar,en,fr} for name and description.
        const name = fanOutString(rawName);
        const description = fanOutString(rawDescription);

        const product = await Product.findById(req.params.id);
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));

        // ----- image diff: always unlink removed images -----
        // existingImages may arrive as: an array (JSON body / FormData repeated fields),
        // a JSON string, or undefined.
        let imagePaths = [];
        if (existingImages) {
            if (Array.isArray(existingImages)) {
                imagePaths = existingImages.filter(s => typeof s === 'string');
            } else if (typeof existingImages === 'string') {
                try {
                    const parsed = JSON.parse(existingImages);
                    if (Array.isArray(parsed)) imagePaths = parsed.filter(s => typeof s === 'string');
                    else imagePaths = [existingImages];
                } catch (e) { imagePaths = [existingImages]; }
            }
        }
        if (req.files && req.files.length > 0) {
            imagePaths = imagePaths.concat(req.files.map(f => `/uploads/${f.filename}`));
        }
        if (req.body.images && !req.body.existingImages) {
            try {
                const parsed = JSON.parse(req.body.images);
                if (Array.isArray(parsed)) imagePaths = parsed.filter(s => typeof s === 'string');
            } catch (e) { /* ignore */ }
        }

        const oldImages = product.images || [];

        if (barcode && barcode !== product.barcode) {
            const dup = await Product.findOne({ barcode });
            if (dup) return errorResponse(res, 400, getTranslation('barcodeExists', lang));
        }
        if (sku && sku !== product.sku) {
            const dup = await Product.findOne({ sku });
            if (dup) return errorResponse(res, 400, getTranslation('skuExists', lang));
        }
        if (category !== undefined && category) {
            const cat = await Category.findById(category);
            if (!cat) return errorResponse(res, 400, getTranslation('categoryNotFound', lang));
        }

        if (name) {
            if (name.ar !== undefined) product.name.ar = name.ar;
            if (name.en !== undefined) product.name.en = name.en;
            if (name.fr !== undefined) product.name.fr = name.fr;
        }
        if (description) {
            if (description.ar !== undefined) product.description.ar = description.ar;
            if (description.en !== undefined) product.description.en = description.en;
            if (description.fr !== undefined) product.description.fr = description.fr;
        }
        if (price !== undefined) product.price = parseFloat(price);
        if (costPrice !== undefined) product.costPrice = parseFloat(costPrice);
        if (category !== undefined) product.category = category || null;
        if (barcode !== undefined) product.barcode = barcode || undefined;
        if (sku !== undefined) product.sku = sku || undefined;
        if (minStock !== undefined) product.minStock = parseInt(minStock, 10);
        if (unit !== undefined) product.unit = unit;
        if (tax !== undefined) product.tax = parseFloat(tax) || 0;
        if (timbre !== undefined) product.timbre = parseFloat(timbre) || 0;
        if (status !== undefined) product.status = status;
        if (stock !== undefined) {
            const newStock = parseInt(stock, 10);
            if (newStock !== product.stock) {
                const prev = product.stock;
                product.stock = newStock;
                await InventoryMovement.create({
                    product: product._id,
                    type: 'adjust',
                    quantity: Math.abs(newStock - prev),
                    previousStock: prev,
                    newStock,
                    reason: { ar: 'تعديل يدوي للمخزون', en: 'Manual stock adjustment', fr: 'Ajustement manuel du stock' },
                    reference: 'product-update',
                    createdBy: req.userId
                });
            }
        }
        if (imagePaths.length > 0 || req.body.images !== undefined || req.body.existingImages !== undefined) {
            product.images = imagePaths;
        }

        product.updatedBy = req.userId;
        await product.save();

        // Image cleanup runs only after validation + save succeeded, so a
        // rejected update can no longer delete files that are still referenced.
        const newSet = new Set(product.images || []);
        oldImages.forEach(img => {
            if (!newSet.has(img) && img.startsWith('/uploads/')) deleteImageFile(img);
        });

        return successResponse(res, { product: decorate(product, lang) }, getTranslation('productUpdated', lang));
    } catch (err) {
        logger.error('updateProduct error:', err.message);
        next(err);
    }
};

// DELETE /api/products/:id
const deleteProduct = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const product = await Product.findById(req.params.id);
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));

        (product.images || []).forEach(deleteImageFile);
        await product.deleteOne();
        return successResponse(res, null, getTranslation('productDeleted', lang));
    } catch (err) {
        logger.error('deleteProduct error:', err.message);
        next(err);
    }
};

// PATCH /api/products/:id/stock  { adjustment: +/-number, reason }
const updateStock = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { adjustment, reason } = req.body;

        if (adjustment === undefined || isNaN(parseInt(adjustment, 10))) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const product = await Product.findById(req.params.id);
        if (!product) return errorResponse(res, 404, getTranslation('productNotFound', lang));

        const delta = parseInt(adjustment, 10);
        const newStock = product.stock + delta;
        if (newStock < 0) return errorResponse(res, 400, getTranslation('insufficientStock', lang));

        const prev = product.stock;
        product.stock = newStock;
        await product.save();

        await InventoryMovement.create({
            product: product._id,
            type: delta >= 0 ? 'in' : 'out',
            quantity: Math.abs(delta),
            previousStock: prev,
            newStock,
            reason: {
                ar: typeof reason === 'string' ? reason : (reason?.ar || ''),
                en: typeof reason === 'object' ? (reason?.en || '') : '',
                fr: typeof reason === 'object' ? (reason?.fr || '') : ''
            },
            reference: 'stock-adjust',
            createdBy: req.userId
        });

        return successResponse(res, { product: decorate(product, lang) }, getTranslation('stockUpdated', lang));
    } catch (err) {
        logger.error('updateStock error:', err.message);
        next(err);
    }
};

// GET /api/products/low-stock
const getLowStockProducts = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const threshold = parseInt(req.query.threshold, 10);
        const filter = {
            status: 'active',
            $expr: { $lte: ['$stock', { $ifNull: ['$minStock', threshold || 5] }] }
        };
        if (Number.isFinite(threshold)) {
            filter.$expr = { $lte: ['$stock', threshold] };
        }
        const products = await Product.find(filter).populate('category', 'name');
        const data = products.map(p => decorate(p, lang));
        return successResponse(res, { products: data });
    } catch (err) {
        logger.error('getLowStockProducts error:', err.message);
        next(err);
    }
};

module.exports = {
    createProduct,
    getProducts,
    getProductById,
    getProductByBarcode,
    updateProduct,
    deleteProduct,
    updateStock,
    getLowStockProducts
};
