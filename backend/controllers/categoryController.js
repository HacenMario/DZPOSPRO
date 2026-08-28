// backend/controllers/categoryController.js
const Category = require('../models/Category');
const Product = require('../models/Product');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

const decorate = (cat, lang) => {
    const obj = cat.toObject ? cat.toObject() : cat;
    obj.displayName = cat.getName?.(lang) || cat.name?.ar;
    obj.displayDescription = cat.getDescription?.(lang) || '';
    return obj;
};

// Backward-compatible helper: accept either a flat string OR a {ar,en,fr} object.
// The frontend now uses a single input field for `name` and `description`; we
// fan the string out across all three language slots. Object inputs pass through.
const fanOutString = (val) => (typeof val === 'string') ? { ar: val, en: val, fr: val } : val;

// GET /api/categories  (tree — returns ALL categories, no pagination, for parent pickers)
const getCategories = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { search } = req.query;
        const filter = {};
        if (search) {
            const r = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$or = [{ 'name.ar': r }, { 'name.en': r }, { 'name.fr': r }];
        }
        // Note: include inactive categories too — the parent picker needs them.
        const cats = await Category.find(filter).populate('parentId', 'name').sort({ createdAt: 1 });
        const data = cats.map(c => decorate(c, lang));
        return successResponse(res, { categories: data });
    } catch (err) {
        logger.error('getCategories error:', err.message);
        next(err);
    }
};

// GET /api/categories/:id
const getCategoryById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const cat = await Category.findById(req.params.id).populate('parentId', 'name');
        if (!cat) return errorResponse(res, 404, getTranslation('categoryNotFound', lang));
        return successResponse(res, { category: decorate(cat, lang) });
    } catch (err) {
        logger.error('getCategoryById error:', err.message);
        next(err);
    }
};

// POST /api/categories
const createCategory = async (req, res, next) => {
    try {
        const { name: rawName, description: rawDescription, parentId, isActive } = req.body;
        const lang = req.lang || 'ar';

        // Accept either a flat string OR {ar,en,fr} for name and description.
        const name = fanOutString(rawName);
        const description = fanOutString(rawDescription);

        if (!name?.ar) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const existing = await Category.findOne({ 'name.ar': name.ar });
        if (existing) return errorResponse(res, 400, getTranslation('categoryNameExists', lang));

        if (parentId) {
            const parent = await Category.findById(parentId);
            if (!parent) return errorResponse(res, 400, getTranslation('categoryNotFound', lang));
        }

        const cat = new Category({
            name: { ar: name.ar, en: name.en || name.ar, fr: name.fr || name.ar },
            description: {
                ar: description?.ar || '',
                en: description?.en || description?.ar || '',
                fr: description?.fr || description?.ar || ''
            },
            parentId: parentId || null,
            isActive: isActive !== undefined ? isActive : true,
            createdBy: req.userId
        });
        await cat.save();
        return createdResponse(res, { category: decorate(cat, lang) }, getTranslation('categoryCreated', lang));
    } catch (err) {
        logger.error('createCategory error:', err.message);
        next(err);
    }
};

// PUT /api/categories/:id
const updateCategory = async (req, res, next) => {
    try {
        const { name: rawName, description: rawDescription, parentId, isActive } = req.body;
        const lang = req.lang || 'ar';
        const cat = await Category.findById(req.params.id);
        if (!cat) return errorResponse(res, 404, getTranslation('categoryNotFound', lang));

        // Accept either a flat string OR {ar,en,fr} for name and description.
        const name = fanOutString(rawName);
        const description = fanOutString(rawDescription);

        if (name) {
            if (name.ar !== undefined) cat.name.ar = name.ar;
            if (name.en !== undefined) cat.name.en = name.en;
            if (name.fr !== undefined) cat.name.fr = name.fr;
        }
        if (description) {
            if (description.ar !== undefined) cat.description.ar = description.ar;
            if (description.en !== undefined) cat.description.en = description.en;
            if (description.fr !== undefined) cat.description.fr = description.fr;
        }
        if (parentId !== undefined) cat.parentId = parentId || null;
        if (isActive !== undefined) cat.isActive = isActive;

        await cat.save();
        return successResponse(res, { category: decorate(cat, lang) }, getTranslation('categoryUpdated', lang));
    } catch (err) {
        logger.error('updateCategory error:', err.message);
        next(err);
    }
};

// DELETE /api/categories/:id
const deleteCategory = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const cat = await Category.findById(req.params.id);
        if (!cat) return errorResponse(res, 404, getTranslation('categoryNotFound', lang));

        const hasProducts = await Product.findOne({ category: cat._id });
        if (hasProducts) return errorResponse(res, 400, getTranslation('categoryHasProducts', lang));

        await cat.deleteOne();
        return successResponse(res, null, getTranslation('categoryDeleted', lang));
    } catch (err) {
        logger.error('deleteCategory error:', err.message);
        next(err);
    }
};

module.exports = {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory
};
