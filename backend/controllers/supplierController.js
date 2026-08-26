// backend/controllers/supplierController.js
const Supplier = require('../models/Supplier');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

const decorate = (s, lang) => {
    const o = s.toObject ? s.toObject() : { ...s };
    o.displayName = s.getName?.(lang) || s.name?.ar || '';
    o.displayAddress = s.getAddress?.(lang) || '';
    return o;
};

// Backward-compatible helper: accept either a flat string OR a {ar,en,fr} object.
// The frontend now uses a single input field for `name` and `address`; we fan
// the string out across all three language slots. Object inputs are passed through.
const fanOutString = (val) => (typeof val === 'string') ? { ar: val, en: val, fr: val } : val;

// GET /api/suppliers?page&limit&search
const getSuppliers = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { search, isActive } = req.query;
        const filter = {};
        if (search) {
            const r = new RegExp(search, 'i');
            filter.$or = [{ 'name.ar': r }, { 'name.en': r }, { 'name.fr': r }, { phone: r }, { email: r }];
        }
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const [docs, total] = await Promise.all([
            Supplier.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Supplier.countDocuments(filter)
        ]);
        const data = docs.map(s => decorate(s, lang));
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getSuppliers error:', err.message);
        next(err);
    }
};

// GET /api/suppliers/:id
const getSupplierById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const s = await Supplier.findById(req.params.id);
        if (!s) return errorResponse(res, 404, getTranslation('supplierNotFound', lang));
        return successResponse(res, { supplier: decorate(s, lang) });
    } catch (err) {
        logger.error('getSupplierById error:', err.message);
        next(err);
    }
};

// POST /api/suppliers
const createSupplier = async (req, res, next) => {
    try {
        const { name: rawName, contactName, phone, email, address: rawAddress, rc, nif, nis, art, notes } = req.body;
        const lang = req.lang || 'ar';

        // Accept either a flat string OR {ar,en,fr} for name and address.
        const name = fanOutString(rawName);
        const address = fanOutString(rawAddress);

        if (!name?.ar || !name?.en || !name?.fr || !phone) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const s = new Supplier({
            name: { ar: name.ar, en: name.en, fr: name.fr },
            contactName: contactName || '',
            phone,
            email: email || '',
            address: {
                ar: address?.ar || '',
                en: address?.en || '',
                fr: address?.fr || ''
            },
            rc: rc || '', nif: nif || '', nis: nis || '', art: art || '',
            notes: notes || '',
            createdBy: req.userId
        });
        await s.save();
        return createdResponse(res, { supplier: decorate(s, lang) }, getTranslation('supplierCreated', lang));
    } catch (err) {
        logger.error('createSupplier error:', err.message);
        next(err);
    }
};

// PUT /api/suppliers/:id
const updateSupplier = async (req, res, next) => {
    try {
        const { name: rawName, contactName, phone, email, address: rawAddress, rc, nif, nis, art, notes, isActive } = req.body;
        const lang = req.lang || 'ar';
        const s = await Supplier.findById(req.params.id);
        if (!s) return errorResponse(res, 404, getTranslation('supplierNotFound', lang));

        // Accept either a flat string OR {ar,en,fr} for name and address.
        const name = fanOutString(rawName);
        const address = fanOutString(rawAddress);

        if (name) {
            if (name.ar !== undefined) s.name.ar = name.ar;
            if (name.en !== undefined) s.name.en = name.en;
            if (name.fr !== undefined) s.name.fr = name.fr;
        }
        if (contactName !== undefined) s.contactName = contactName;
        if (phone !== undefined) s.phone = phone;
        if (email !== undefined) s.email = email || '';
        if (address) {
            if (address.ar !== undefined) s.address.ar = address.ar;
            if (address.en !== undefined) s.address.en = address.en;
            if (address.fr !== undefined) s.address.fr = address.fr;
        }
        if (rc !== undefined) s.rc = rc;
        if (nif !== undefined) s.nif = nif;
        if (nis !== undefined) s.nis = nis;
        if (art !== undefined) s.art = art;
        if (notes !== undefined) s.notes = notes;
        if (isActive !== undefined) s.isActive = isActive;

        await s.save();
        return successResponse(res, { supplier: decorate(s, lang) }, getTranslation('supplierUpdated', lang));
    } catch (err) {
        logger.error('updateSupplier error:', err.message);
        next(err);
    }
};

// DELETE /api/suppliers/:id
const deleteSupplier = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const s = await Supplier.findById(req.params.id);
        if (!s) return errorResponse(res, 404, getTranslation('supplierNotFound', lang));
        await s.deleteOne();
        return successResponse(res, null, getTranslation('supplierDeleted', lang));
    } catch (err) {
        logger.error('deleteSupplier error:', err.message);
        next(err);
    }
};

module.exports = {
    getSuppliers,
    getSupplierById,
    createSupplier,
    updateSupplier,
    deleteSupplier
};
