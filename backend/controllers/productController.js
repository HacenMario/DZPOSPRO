// backend/controllers/productController.js
const Product = require('../models/Product');
const Category = require('../models/Category');
const InventoryMovement = require('../models/InventoryMovement');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { parseCsv, toCsv } = require('../utils/csv');
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
            const r = new RegExp(search, 'i');
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
        const newSet = new Set(imagePaths);
        oldImages.forEach(img => {
            if (!newSet.has(img) && img.startsWith('/uploads/')) deleteImageFile(img);
        });

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

// GET /api/products/export → downloads every product as a CSV file.
// Columns mirror importProducts below (id,name,description,barcode,sku,
// category,price,costPrice,stock,minStock,unit,tax,timbre,status) so an
// exported file can be edited and imported back (round-trip safe via id).
const exportProducts = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const products = await Product.find({}).populate('category', 'name').sort({ createdAt: 1 });

        const headers = ['id', 'name', 'description', 'barcode', 'sku', 'category',
            'price', 'costPrice', 'stock', 'minStock', 'unit', 'tax', 'timbre', 'status'];
        const rows = products.map(p => [
            String(p._id),
            p.getName ? p.getName(lang) : (p.name?.ar || p.name?.en || p.name?.fr || ''),
            p.getDescription ? p.getDescription(lang) : (p.description?.ar || ''),
            p.barcode || '',
            p.sku || '',
            p.category && typeof p.category === 'object'
                ? (p.category.getName ? p.category.getName(lang) : (p.category.name?.ar || ''))
                : '',
            Number(p.price || 0).toFixed(2),
            Number(p.costPrice || 0).toFixed(2),
            String(p.stock || 0),
            String(p.minStock == null ? 5 : p.minStock),
            p.unit || 'pcs',
            Number(p.tax || 0).toFixed(2),
            Number(p.timbre || 0).toFixed(2),
            p.status || 'active'
        ]);

        const csv = '\uFEFF' + toCsv(headers, rows); // BOM so Excel keeps Arabic readable
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="products-${stamp}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        logger.error('exportProducts error:', err.message);
        next(err);
    }
};

// POST /api/products/import  (multipart field: file)
// Accepts a CSV file using the same columns as exportProducts. Existing
// products are matched by id → barcode → sku (updated in place); rows with
// no match are created as new products. Categories are resolved by ObjectId
// or name (any language, case-insensitive) and auto-created when missing.
// Returns a per-row report: { created, updated, skipped, errors[] }.
const CSV_ALIASES = {
    id: ['id', '_id'],
    name: ['name', 'nom', 'الاسم', 'اسم المنتج', 'productname'],
    description: ['description', 'وصف', 'الوصف'],
    barcode: ['barcode', 'codebarre', 'codebarres', 'code-barres', 'الباركود', 'باركود'],
    sku: ['sku', 'رمز المنتج'],
    category: ['category', 'categorie', 'catégorie', 'الفئة', 'التصنيف'],
    price: ['price', 'prix', 'السعر'],
    costPrice: ['costprice', 'cost', 'prixachat', 'prix d’achat', 'سعر الشراء', 'التكلفة'],
    stock: ['stock', 'quantity', 'qty', 'المخزون', 'الكمية'],
    minStock: ['minstock', 'minstocklevel', 'الحد الادنى', 'الحد الأدنى للمخزون'],
    unit: ['unit', 'unite', 'unité', 'الوحدة'],
    tax: ['tax', 'tva', 'الضريبة'],
    timbre: ['timbre', 'stamp', 'الطابع', 'الطابع الجبائي'],
    status: ['status', 'statut', 'الحالة']
};

const importProducts = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        if (!req.file || !req.file.buffer || !req.file.buffer.length) {
            return errorResponse(res, 400, getTranslation('csvFileRequired', lang));
        }

        const rows = parseCsv(req.file.buffer.toString('utf8'));
        if (!rows.length || !rows[0].length) {
            return errorResponse(res, 400, getTranslation('csvEmpty', lang));
        }

        // Map header names (case-insensitive, BOM-safe) to column indexes.
        const headerRow = rows[0].map(h => String(h || '').replace(/\uFEFF/g, '').trim().toLowerCase());
        const col = {};
        for (const [key, aliases] of Object.entries(CSV_ALIASES)) {
            const idx = headerRow.findIndex(h => aliases.includes(h));
            if (idx !== -1) col[key] = idx;
        }
        if (col.name === undefined || col.price === undefined) {
            return errorResponse(res, 400, getTranslation('csvMissingColumns', lang));
        }

        const cell = (cells, key) =>
            (col[key] !== undefined && cells[col[key]] !== undefined) ? String(cells[col[key]]).trim() : '';
        const num = s => parseFloat(String(s || '').replace(',', '.'));
        const norm = s => String(s || '').trim().toLowerCase();

        const categories = await Category.find({});
        const findCategory = (val) => categories.find(c =>
            String(c._id) === val ||
            norm(c.name?.ar) === norm(val) ||
            norm(c.name?.en) === norm(val) ||
            norm(c.name?.fr) === norm(val));

        let created = 0, updated = 0, skipped = 0;
        const errors = [];
        const rowError = (rowNum, key, extra) =>
            errors.push({ row: rowNum, message: `${getTranslation('csvRow', lang)} ${rowNum}: ${getTranslation(key, lang)}${extra ? ' (' + extra + ')' : ''}` });

        for (let r = 1; r < rows.length; r++) {
            const cells = rows[r];
            if (!cells || cells.every(c => !String(c || '').trim())) continue; // blank line
            const rowNum = r + 1;
            try {
                const name = cell(cells, 'name');
                if (!name) { rowError(rowNum, 'csvNameRequired'); skipped++; continue; }

                const price = num(cell(cells, 'price'));
                if (isNaN(price) || price < 0) { rowError(rowNum, 'csvPriceInvalid'); skipped++; continue; }

                const stockRaw = cell(cells, 'stock');
                let stock = null;
                if (stockRaw !== '') {
                    stock = parseInt(stockRaw, 10);
                    if (isNaN(stock) || stock < 0) { rowError(rowNum, 'csvStockInvalid'); skipped++; continue; }
                }

                const statusRaw = norm(cell(cells, 'status'));
                let status = 'active';
                if (statusRaw && statusRaw !== 'active' && statusRaw !== 'inactive') {
                    rowError(rowNum, 'csvStatusInvalid'); skipped++; continue;
                } else if (statusRaw) {
                    status = statusRaw;
                }

                const description = cell(cells, 'description');
                const barcode = cell(cells, 'barcode');
                const sku = cell(cells, 'sku');
                const categoryVal = cell(cells, 'category');
                const costPrice = num(cell(cells, 'costPrice')) || 0;
                const minStockRaw = parseInt(cell(cells, 'minStock'), 10);
                const minStock = isNaN(minStockRaw) ? null : minStockRaw;
                const unit = cell(cells, 'unit');
                const tax = num(cell(cells, 'tax')) || 0;
                const timbre = num(cell(cells, 'timbre')) || 0;

                // Resolve (or auto-create) the category
                let categoryId = null;
                if (categoryVal) {
                    let cat = findCategory(categoryVal);
                    if (!cat) {
                        cat = await Category.create({
                            name: { ar: categoryVal, en: categoryVal, fr: categoryVal },
                            createdBy: req.userId
                        });
                        categories.push(cat);
                    }
                    categoryId = cat._id;
                }

                // Find the target product: id → barcode → sku
                let product = null;
                const idVal = cell(cells, 'id');
                if (idVal && /^[0-9a-fA-F]{24}$/.test(idVal)) {
                    product = await Product.findById(idVal);
                }
                if (!product && barcode) product = await Product.findOne({ barcode });
                if (!product && sku) product = await Product.findOne({ sku });

                // Duplicate guards: never steal barcode/sku from another product
                if (barcode) {
                    const dup = await Product.findOne({ barcode });
                    if (dup && (!product || String(dup._id) !== String(product._id))) {
                        rowError(rowNum, 'barcodeExists', barcode);
                        skipped++; continue;
                    }
                }
                if (sku) {
                    const dup = await Product.findOne({ sku });
                    if (dup && (!product || String(dup._id) !== String(product._id))) {
                        rowError(rowNum, 'skuExists', sku);
                        skipped++; continue;
                    }
                }

                if (product) {
                    // ----- update (only columns present in the file) -----
                    product.name = { ar: name, en: name, fr: name };
                    product.price = price;
                    if (col.description !== undefined) product.description = { ar: description, en: description, fr: description };
                    if (col.costPrice !== undefined) product.costPrice = costPrice;
                    if (col.category !== undefined) product.category = categoryId;
                    if (col.barcode !== undefined) product.barcode = barcode || undefined;
                    if (col.sku !== undefined) product.sku = sku || undefined;
                    if (col.minStock !== undefined && minStock !== null) product.minStock = minStock;
                    if (col.unit !== undefined && unit) product.unit = unit;
                    if (col.tax !== undefined) product.tax = tax;
                    if (col.timbre !== undefined) product.timbre = timbre;
                    if (col.status !== undefined) product.status = status;
                    if (stock !== null && stock !== product.stock) {
                        const prev = product.stock;
                        product.stock = stock;
                        await InventoryMovement.create({
                            product: product._id,
                            type: 'adjust',
                            quantity: Math.abs(stock - prev),
                            previousStock: prev,
                            newStock: stock,
                            reason: { ar: 'استيراد CSV', en: 'CSV import', fr: 'Importation CSV' },
                            reference: 'csv-import',
                            createdBy: req.userId
                        });
                    }
                    product.updatedBy = req.userId;
                    await product.save();
                    updated++;
                } else {
                    // ----- create -----
                    const newProduct = new Product({
                        name: { ar: name, en: name, fr: name },
                        description: { ar: description, en: description, fr: description },
                        price,
                        costPrice,
                        category: categoryId,
                        barcode: barcode || undefined,
                        sku: sku || undefined,
                        stock: stock || 0,
                        minStock: minStock == null ? 5 : minStock,
                        unit: unit || 'pcs',
                        tax,
                        timbre,
                        status,
                        createdBy: req.userId
                    });
                    await newProduct.save();
                    if (newProduct.stock > 0) {
                        await InventoryMovement.create({
                            product: newProduct._id,
                            type: 'in',
                            quantity: newProduct.stock,
                            previousStock: 0,
                            newStock: newProduct.stock,
                            reason: { ar: 'الرصيد الافتتاحي', en: 'Opening stock', fr: 'Stock initial' },
                            reference: 'csv-import',
                            createdBy: req.userId
                        });
                    }
                    created++;
                }
            } catch (rowErr) {
                logger.warn(`importProducts row ${rowNum}: ${rowErr.message}`);
                errors.push({ row: rowNum, message: `${getTranslation('csvRow', lang)} ${rowNum}: ${rowErr.message}` });
                skipped++;
            }
        }

        return successResponse(res, {
            total: created + updated + skipped,
            created, updated, skipped,
            errors: errors.slice(0, 100)
        }, getTranslation('importCompleted', lang));
    } catch (err) {
        logger.error('importProducts error:', err.message);
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
    getLowStockProducts,
    exportProducts,
    importProducts
};
