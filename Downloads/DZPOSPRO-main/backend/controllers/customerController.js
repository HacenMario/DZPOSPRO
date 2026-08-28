// backend/controllers/customerController.js
const Customer = require('../models/Customer');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');
const { successResponse, createdResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

const decorate = (c, lang) => {
    const obj = c.toObject ? c.toObject() : c;
    obj.displayName = c.getName?.(lang) || c.name?.ar;
    obj.displayAddress = c.getAddress?.(lang) || '';
    return obj;
};

// Backward-compatible helper: accept either a flat string OR a {ar,en,fr} object.
// The frontend now uses a single input field for `name` and `address`; we fan
// the string out across all three language slots. Object inputs are passed through.
const fanOutString = (val) => (typeof val === 'string') ? { ar: val, en: val, fr: val } : val;

// GET /api/customers?page&limit&search
const getCustomers = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const { page, limit, skip } = parsePagination(req.query);
        const { search } = req.query;
        const filter = {};
        if (search) {
            const r = new RegExp(search, 'i');
            filter.$or = [
                { 'name.ar': r }, { 'name.en': r }, { 'name.fr': r },
                { phone: r }, { email: r }
            ];
        }
        const [docs, total] = await Promise.all([
            Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Customer.countDocuments(filter)
        ]);
        const data = docs.map(c => decorate(c, lang));
        return paginatedResponse(res, { data, total, page, limit });
    } catch (err) {
        logger.error('getCustomers error:', err.message);
        next(err);
    }
};

// GET /api/customers/:id
const getCustomerById = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const c = await Customer.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('customerNotFound', lang));
        return successResponse(res, { customer: decorate(c, lang) });
    } catch (err) {
        logger.error('getCustomerById error:', err.message);
        next(err);
    }
};

// POST /api/customers
const createCustomer = async (req, res, next) => {
    try {
        const { name: rawName, phone, email, address: rawAddress, rc, nif, nis, art, notes } = req.body;
        const lang = req.lang || 'ar';

        // Accept either a flat string OR {ar,en,fr} for name and address.
        const name = fanOutString(rawName);
        const address = fanOutString(rawAddress);

        if (!name?.ar || !name?.en || !name?.fr || !phone) {
            return errorResponse(res, 400, getTranslation('missingFields', lang));
        }

        const existing = await Customer.findOne({ phone });
        if (existing) return errorResponse(res, 400, getTranslation('customerPhoneExists', lang));

        const c = new Customer({
            name: { ar: name.ar, en: name.en, fr: name.fr },
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
        await c.save();
        return createdResponse(res, { customer: decorate(c, lang) }, getTranslation('customerCreated', lang));
    } catch (err) {
        logger.error('createCustomer error:', err.message);
        next(err);
    }
};

// PUT /api/customers/:id
const updateCustomer = async (req, res, next) => {
    try {
        const { name: rawName, phone, email, address: rawAddress, rc, nif, nis, art, notes, isActive } = req.body;
        const lang = req.lang || 'ar';

        // Accept either a flat string OR {ar,en,fr} for name and address.
        const name = fanOutString(rawName);
        const address = fanOutString(rawAddress);

        const c = await Customer.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('customerNotFound', lang));

        if (phone && phone !== c.phone) {
            const existing = await Customer.findOne({ phone });
            if (existing) return errorResponse(res, 400, getTranslation('customerPhoneExists', lang));
            c.phone = phone;
        }
        if (name) {
            if (name.ar !== undefined) c.name.ar = name.ar;
            if (name.en !== undefined) c.name.en = name.en;
            if (name.fr !== undefined) c.name.fr = name.fr;
        }
        if (email !== undefined) c.email = email || '';
        if (address) {
            if (address.ar !== undefined) c.address.ar = address.ar;
            if (address.en !== undefined) c.address.en = address.en;
            if (address.fr !== undefined) c.address.fr = address.fr;
        }
        if (rc !== undefined) c.rc = rc;
        if (nif !== undefined) c.nif = nif;
        if (nis !== undefined) c.nis = nis;
        if (art !== undefined) c.art = art;
        if (notes !== undefined) c.notes = notes;
        if (isActive !== undefined) c.isActive = isActive;

        await c.save();
        return successResponse(res, { customer: decorate(c, lang) }, getTranslation('customerUpdated', lang));
    } catch (err) {
        logger.error('updateCustomer error:', err.message);
        next(err);
    }
};

// DELETE /api/customers/:id
const deleteCustomer = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const c = await Customer.findById(req.params.id);
        if (!c) return errorResponse(res, 404, getTranslation('customerNotFound', lang));
        await c.deleteOne();
        return successResponse(res, null, getTranslation('customerDeleted', lang));
    } catch (err) {
        logger.error('deleteCustomer error:', err.message);
        next(err);
    }
};

module.exports = {
    getCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer
};
