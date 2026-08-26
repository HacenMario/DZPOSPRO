// backend/scripts/seed.js
// Idempotent seed script:
//   1. Creates the initial admin user (if none exists).
//   2. Creates default Settings document (if none exists).
//   3. Adds a few sample categories/products/customers ONLY when the DB is empty.
// Run: npm run seed   (or: node scripts/seed.js)
require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const User = require('../models/User');
const Setting = require('../models/Setting');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Session = require('../models/Session');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dz_pos_pro';

const ADMIN = {
    name: process.env.SEED_ADMIN_NAME || 'System Administrator',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@dzpos.pro',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123456',
    role: 'admin',
    phone: ''
};

const DEFAULT_SETTINGS = {
    storeName: 'DZ POS PRO',
    currency: 'DZD',
    taxRate: 0,
    language: 'ar',
    theme: 'light',
    lowStockThreshold: 5,
    enableNotifications: true,
    defaultPaymentMethod: 'cash',
    invoicePrefix: 'INV-',
    invoiceFooter: 'Thank you for your business',
    companyInfo: {
        rc: '', nif: '', nis: '', art: '',
        address: '', phone: '', email: ''
    }
};

const SAMPLE_CATEGORIES = [
    { name: { ar: 'مواد غذائية', en: 'Food', fr: 'Alimentation' }, description: { ar: '', en: '', fr: '' } },
    { name: { ar: 'مشروبات', en: 'Drinks', fr: 'Boissons' }, description: { ar: '', en: '', fr: '' } },
    { name: { ar: 'منظفات', en: 'Cleaning', fr: 'Nettoyage' }, description: { ar: '', en: '', fr: '' } }
];

const SAMPLE_CUSTOMERS = [
    { name: { ar: 'عميل نقدي', en: 'Walk-in Customer', fr: 'Client comptant' }, phone: '0500000000' },
    { name: { ar: 'مؤسسة تجارية', en: 'Trading Co.', fr: 'Société commerciale' }, phone: '0511111111', rc: '00000000', nif: '00000000000000000000' }
];

const SAMPLE_SUPPLIERS = [
    { name: { ar: 'مورد عام', en: 'General Supplier', fr: 'Fournisseur général' }, phone: '0522222222' }
];

async function seed() {
    logger.info(`Connecting to MongoDB: ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI);
    logger.info('MongoDB connected.');

    // 1) Admin user
    const userCount = await User.countDocuments();
    let adminUser = null;
    if (userCount === 0) {
        adminUser = new User({
            name: ADMIN.name,
            email: ADMIN.email.toLowerCase(),
            password: ADMIN.password,
            role: ADMIN.role,
            phone: ADMIN.phone,
            isActive: true,
            settings: { theme: 'light', lang: 'ar', notifications: true }
        });
        await adminUser.save();
        logger.info(`Initial admin created — email: ${ADMIN.email} password: ${ADMIN.password}`);
    } else {
        adminUser = await User.findOne({ role: 'admin' });
        logger.info(`Users already exist (${userCount}). Skipping admin seed.`);
    }

    // 2) Settings
    const settingCount = await Setting.countDocuments();
    if (settingCount === 0) {
        await Setting.create(DEFAULT_SETTINGS);
        logger.info('Default settings document created.');
    } else {
        logger.info(`Settings already exist (${settingCount}). Skipping.`);
    }

    // 3) Sample data only if DB is empty
    const catCount = await Category.countDocuments();
    const prodCount = await Product.countDocuments();
    const custCount = await Customer.countDocuments();
    const supCount = await Supplier.countDocuments();

    if (catCount === 0 && prodCount === 0 && custCount === 0 && supCount === 0 && adminUser) {
        // Categories
        const categories = await Category.create(
            SAMPLE_CATEGORIES.map(c => ({ ...c, isActive: true, createdBy: adminUser._id }))
        );
        logger.info(`Created ${categories.length} sample categories.`);

        // Products
        const products = [
            { name: { ar: 'ماء معدني 1.5 لتر', en: 'Mineral Water 1.5L', fr: 'Eau minérale 1.5L' }, price: 50, costPrice: 35, stock: 100, minStock: 20, category: categories[1]._id, barcode: '6111234500011' },
            { name: { ar: 'خبز', en: 'Bread', fr: 'Pain' }, price: 10, costPrice: 6, stock: 50, minStock: 10, category: categories[0]._id, barcode: '6111234500028' },
            { name: { ar: 'صابون', en: 'Soap', fr: 'Savon' }, price: 60, costPrice: 40, stock: 8, minStock: 10, category: categories[2]._id, barcode: '6111234500035' }
        ];
        await Product.create(products.map(p => ({
            ...p,
            unit: 'pcs', tax: 0, timbre: 0, status: 'active', createdBy: adminUser._id
        })));
        logger.info('Created 3 sample products (one low-stock).');

        // Customers
        await Customer.create(
            SAMPLE_CUSTOMERS.map(c => ({
                ...c,
                email: '', address: { ar: '', en: '', fr: '' },
                rc: c.rc || '', nif: c.nif || '', nis: '', art: '',
                notes: '', loyaltyPoints: 0, totalSpent: 0, isActive: true,
                createdBy: adminUser._id
            }))
        );
        logger.info('Created 2 sample customers.');

        // Suppliers
        await Supplier.create(
            SAMPLE_SUPPLIERS.map(s => ({
                ...s,
                contactName: '', email: '', address: { ar: '', en: '', fr: '' },
                rc: '', nif: '', nis: '', art: '', notes: '', isActive: true,
                createdBy: adminUser._id
            }))
        );
        logger.info('Created 1 sample supplier.');
    } else {
        logger.info(`Existing data (cats=${catCount} prods=${prodCount} customers=${custCount} suppliers=${supCount}). Skipping sample seed.`);
    }

    // 4) Optional: open an initial session for the admin
    const openSession = await Session.findOne({ user: adminUser._id, status: 'open' });
    if (!openSession) {
        await Session.create({
            user: adminUser._id,
            userName: adminUser.name,
            userRole: adminUser.role,
            openingBalance: 0,
            status: 'open',
            openedAt: new Date()
        });
        logger.info('Opened an initial session for the admin user.');
    } else {
        logger.info('Admin already has an open session.');
    }

    logger.info('Seed completed successfully.');
    await mongoose.disconnect();
    process.exit(0);
}

seed().catch((err) => {
    logger.error('Seed failed:', err.message);
    logger.error(err.stack || '');
    process.exit(1);
});
