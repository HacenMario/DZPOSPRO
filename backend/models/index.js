// backend/models/index.js — central model registry + shared setup.
const mongoose = require('mongoose');
const tenantPlugin = require('../utils/tenantPlugin');

// Register every model once; apply the tenant plugin to business models.
const register = (name, schema) => {
    if (!schema.plugins.some(p => p.fn === tenantPlugin) && schema.pathType('storeId') !== 'adhocOrMissing') {
        schema.plugin(tenantPlugin);
    }
    return mongoose.models[name] || mongoose.model(name, schema);
};

const Store = require('./Store');
const User = require('./User');
const Setting = require('./Setting');
const Product = require('./Product');
const Category = require('./Category');
const Customer = require('./Customer');
const Supplier = require('./Supplier');
const Sale = require('./Sale');
const SaleItem = require('./SaleItem');
const PurchaseOrder = require('./PurchaseOrder');
const Return = require('./Return');
const Coupon = require('./Coupon');
const InventoryMovement = require('./InventoryMovement');
const Session = require('./Session');
const Notification = require('./Notification');
const AlertConfig = require('./AlertConfig');
const AuditLog = require('./AuditLog');
const AIUsage = require('./AIUsage');
const PushSubscription = require('./PushSubscription');
const BackupRecord = require('./BackupRecord');
const PlatformSetting = require('./PlatformSetting');

module.exports = {
    Store, User, Setting, Product, Category, Customer, Supplier, Sale, SaleItem,
    PurchaseOrder, Return, Coupon, InventoryMovement, Session, Notification,
    AlertConfig, AuditLog, AIUsage, PushSubscription, BackupRecord, PlatformSetting
};
