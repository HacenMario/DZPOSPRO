// backend/config/i18n.js
// Trilingual translations (ar / en / fr). Used by controllers via getTranslation(key, lang).
const translations = {
    ar: {
        // General
        welcome: 'DZ POS PRO API is running',
        serverError: 'حدث خطأ في الخادم',
        notFound: 'المسار غير موجود',
        unauthorized: 'غير مصرح',
        forbidden: 'لا تملك صلاحية تنفيذ هذه العملية',
        invalidToken: 'رمز المصادقة غير صالح',
        missingFields: 'الحقول المطلوبة غير مكتملة',
        invalidData: 'البيانات غير صالحة',
        success: 'تمت العملية بنجاح',
        created: 'تم الإنشاء بنجاح',
        updated: 'تم التحديث بنجاح',
        deleted: 'تم الحذف بنجاح',
        noUpdateData: 'لا توجد بيانات للتحديث',

        // Auth
        loginSuccess: 'تم تسجيل الدخول بنجاح',
        loginFailed: 'بيانات الدخول غير صحيحة',
        userNotFound: 'المستخدم غير موجود',
        emailExists: 'البريد الإلكتروني مسجل مسبقاً',
        accountDisabled: 'الحساب معطل، يرجى التواصل مع الإدارة',
        passwordChanged: 'تم تغيير كلمة المرور بنجاح',
        passwordMismatch: 'كلمة المرور الحالية غير صحيحة',
        passwordTooShort: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل',
        passwordWeak: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام',
        passwordSameAsOld: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن القديمة',
        tokenRefreshed: 'تم تجديد الرمز بنجاح',
        logoutSuccess: 'تم تسجيل الخروج بنجاح',

        // Products
        productCreated: 'تم إنشاء المنتج بنجاح',
        productUpdated: 'تم تحديث المنتج بنجاح',
        productDeleted: 'تم حذف المنتج بنجاح',
        productNotFound: 'المنتج غير موجود',
        barcodeExists: 'هذا الباركود مسجل مسبقاً',
        skuExists: 'هذا SKU مسجل مسبقاً',
        stockUpdated: 'تم تحديث المخزون بنجاح',
        insufficientStock: 'الكمية غير متوفرة',
        invalidMovementType: 'نوع الحركة غير صحيح (in/out/adjust)',

        // Categories
        categoryCreated: 'تم إنشاء الفئة بنجاح',
        categoryUpdated: 'تم تحديث الفئة بنجاح',
        categoryDeleted: 'تم حذف الفئة بنجاح',
        categoryNotFound: 'الفئة غير موجودة',
        categoryNameExists: 'اسم الفئة مسجل مسبقاً',
        categoryHasProducts: 'لا يمكن حذف الفئة لأنها تحتوي على منتجات',

        // Customers
        customerCreated: 'تم إنشاء العميل بنجاح',
        customerUpdated: 'تم تحديث العميل بنجاح',
        customerDeleted: 'تم حذف العميل بنجاح',
        customerNotFound: 'العميل غير موجود',
        customerPhoneExists: 'رقم الهاتف مسجل مسبقاً',

        // Sales
        saleCreated: 'تم إنشاء الفاتورة بنجاح',
        saleNotFound: 'الفاتورة غير موجودة',
        saleReturned: 'تم إرجاع المنتجات بنجاح',
        saleAlreadyReturned: 'هذه الفاتورة تم إرجاعها مسبقاً',

        returnDeleted: 'تم حذف الإرجاع بنجاح',        saleCancelled: 'تم إلغاء الفاتورة بنجاح',
        saleCannotCancel: 'لا يمكن إلغاء فاتورة مرتجعة',
        sessionRequired: 'لا يمكن إجراء عملية بيع بدون جلسة مفتوحة',
        saleItemNotFound: 'المنتج غير موجود في هذه الفاتورة',
        returnQtyExceeded: 'الكمية المرتجعة أكبر من الكمية المشتراة',
        invoiceNumberExists: 'رقم الفاتورة مكرر، يرجى اختيار رقم آخر',
        invalidSaleStatus: 'حالة الفاتورة غير صالحة',

        // Inventory
        movementLogged: 'تم تسجيل حركة المخزون بنجاح',

        // Users
        userCreated: 'تم إنشاء المستخدم بنجاح',
        userUpdated: 'تم تحديث المستخدم بنجاح',
        userDeleted: 'تم حذف المستخدم بنجاح',
        cannotDeleteAdmin: 'لا يمكن حذف حساب المدير الرئيسي',

        // Settings
        settingsSaved: 'تم حفظ الإعدادات بنجاح',
        settingsRetrieved: 'تم جلب الإعدادات بنجاح',

        // Sessions
        sessionOpened: 'تم فتح الجلسة بنجاح',
        sessionAlreadyOpen: 'لديك جلسة مفتوحة بالفعل. يجب إغلاقها أولاً',
        sessionClosed: 'تم إغلاق الجلسة بنجاح',
        sessionNotFound: 'لا توجد جلسة مفتوحة لإغلاقها',

        // Coupons
        couponCreated: 'تم إنشاء الكوبون بنجاح',
        couponUpdated: 'تم تحديث الكوبون بنجاح',
        couponDeleted: 'تم حذف الكوبون بنجاح',
        couponNotFound: 'الكوبون غير موجود',
        couponCodeExists: 'هذا الكود مسجل مسبقاً',
        couponInvalid: 'كوبون غير صالح',
        couponExpired: 'انتهت صلاحية الكوبون',
        couponUsedUp: 'تم استخدام الكوبون بالكامل',
        couponMinOrder: 'الحد الأدنى للطلب هو',
        couponApplied: 'تم تطبيق الكوبون بنجاح',

        // Suppliers
        supplierCreated: 'تم إنشاء المورد بنجاح',
        supplierUpdated: 'تم تحديث المورد بنجاح',
        supplierDeleted: 'تم حذف المورد بنجاح',
        supplierNotFound: 'المورد غير موجود',

        // Purchase orders
        purchaseOrderCreated: 'تم إنشاء أمر الشراء بنجاح',
        purchaseOrderUpdated: 'تم تحديث أمر الشراء بنجاح',
        purchaseOrderDeleted: 'تم حذف أمر الشراء بنجاح',
        purchaseOrderNotFound: 'أمر الشراء غير موجود'
    },
    en: {
        // General
        welcome: 'DZ POS PRO API is running',
        serverError: 'Server error',
        notFound: 'Route not found',
        unauthorized: 'Unauthorized',
        forbidden: 'You do not have permission to perform this action',
        invalidToken: 'Invalid token',
        missingFields: 'Required fields are missing',
        invalidData: 'Invalid data',
        success: 'Operation successful',
        created: 'Created successfully',
        updated: 'Updated successfully',
        deleted: 'Deleted successfully',
        noUpdateData: 'No data to update',

        // Auth
        loginSuccess: 'Login successful',
        loginFailed: 'Invalid credentials',
        userNotFound: 'User not found',
        emailExists: 'Email already registered',
        accountDisabled: 'Account is disabled, please contact administration',
        passwordChanged: 'Password changed successfully',
        passwordMismatch: 'Current password is incorrect',
        passwordTooShort: 'Password must be at least 8 characters',
        passwordWeak: 'Password must contain both letters and numbers',
        passwordSameAsOld: 'New password must be different from the old one',
        tokenRefreshed: 'Token refreshed successfully',
        logoutSuccess: 'Logged out successfully',

        // Products
        productCreated: 'Product created successfully',
        productUpdated: 'Product updated successfully',
        productDeleted: 'Product deleted successfully',
        productNotFound: 'Product not found',
        barcodeExists: 'This barcode is already registered',
        skuExists: 'This SKU is already registered',
        stockUpdated: 'Stock updated successfully',
        insufficientStock: 'Insufficient stock',
        invalidMovementType: 'Invalid movement type (in/out/adjust)',

        // Categories
        categoryCreated: 'Category created successfully',
        categoryUpdated: 'Category updated successfully',
        categoryDeleted: 'Category deleted successfully',
        categoryNotFound: 'Category not found',
        categoryNameExists: 'Category name already exists',
        categoryHasProducts: 'Cannot delete category because it has products',

        // Customers
        customerCreated: 'Customer created successfully',
        customerUpdated: 'Customer updated successfully',
        customerDeleted: 'Customer deleted successfully',
        customerNotFound: 'Customer not found',
        customerPhoneExists: 'Phone number already registered',

        // Sales
        saleCreated: 'Invoice created successfully',
        saleNotFound: 'Invoice not found',
        saleReturned: 'Products returned successfully',
        saleAlreadyReturned: 'This invoice has already been returned',

        returnDeleted: 'Return deleted successfully',        saleCancelled: 'Invoice cancelled successfully',
        saleCannotCancel: 'Cannot cancel a returned invoice',
        sessionRequired: 'Cannot perform a sale without an open session',
        saleItemNotFound: 'Product not found in this invoice',
        returnQtyExceeded: 'Returned quantity exceeds purchased quantity',
        invoiceNumberExists: 'Invoice number is duplicated, please choose another',
        invalidSaleStatus: 'Invalid invoice status',

        // Inventory
        movementLogged: 'Inventory movement logged successfully',

        // Users
        userCreated: 'User created successfully',
        userUpdated: 'User updated successfully',
        userDeleted: 'User deleted successfully',
        cannotDeleteAdmin: 'Cannot delete the main admin account',

        // Settings
        settingsSaved: 'Settings saved successfully',
        settingsRetrieved: 'Settings retrieved successfully',

        // Sessions
        sessionOpened: 'Session opened successfully',
        sessionAlreadyOpen: 'You already have an open session. Close it first',
        sessionClosed: 'Session closed successfully',
        sessionNotFound: 'No open session to close',

        // Coupons
        couponCreated: 'Coupon created successfully',
        couponUpdated: 'Coupon updated successfully',
        couponDeleted: 'Coupon deleted successfully',
        couponNotFound: 'Coupon not found',
        couponCodeExists: 'This code is already registered',
        couponInvalid: 'Invalid coupon',
        couponExpired: 'Coupon has expired',
        couponUsedUp: 'Coupon usage limit reached',
        couponMinOrder: 'Minimum order is',
        couponApplied: 'Coupon applied successfully',

        // Suppliers
        supplierCreated: 'Supplier created successfully',
        supplierUpdated: 'Supplier updated successfully',
        supplierDeleted: 'Supplier deleted successfully',
        supplierNotFound: 'Supplier not found',

        // Purchase orders
        purchaseOrderCreated: 'Purchase order created successfully',
        purchaseOrderUpdated: 'Purchase order updated successfully',
        purchaseOrderDeleted: 'Purchase order deleted successfully',
        purchaseOrderNotFound: 'Purchase order not found'
    },
    fr: {
        // Général
        welcome: "L'API DZ POS PRO fonctionne",
        serverError: 'Erreur du serveur',
        notFound: 'Route introuvable',
        unauthorized: 'Non autorisé',
        forbidden: "Vous n'avez pas la permission d'effectuer cette action",
        invalidToken: 'Jeton invalide',
        missingFields: 'Champs obligatoires manquants',
        invalidData: 'Données invalides',
        success: 'Opération réussie',
        created: 'Créé avec succès',
        updated: 'Mis à jour avec succès',
        deleted: 'Supprimé avec succès',
        noUpdateData: 'Aucune donnée à mettre à jour',

        // Authentification
        loginSuccess: 'Connexion réussie',
        loginFailed: 'Identifiants incorrects',
        userNotFound: 'Utilisateur introuvable',
        emailExists: 'Email déjà enregistré',
        accountDisabled: "Compte désactivé, veuillez contacter l'administration",
        passwordChanged: 'Mot de passe modifié avec succès',
        passwordMismatch: 'Mot de passe actuel incorrect',
        passwordTooShort: 'Le mot de passe doit comporter au moins 8 caractères',
        passwordWeak: 'Le mot de passe doit contenir des lettres et des chiffres',
        passwordSameAsOld: 'Le nouveau mot de passe doit être différent de l\'ancien',
        tokenRefreshed: 'Jeton renouvelé avec succès',
        logoutSuccess: 'Déconnexion réussie',

        // Produits
        productCreated: 'Produit créé avec succès',
        productUpdated: 'Produit mis à jour avec succès',
        productDeleted: 'Produit supprimé avec succès',
        productNotFound: 'Produit introuvable',
        barcodeExists: 'Ce code-barres est déjà enregistré',
        skuExists: 'Ce SKU est déjà enregistré',
        stockUpdated: 'Stock mis à jour avec succès',
        insufficientStock: 'Stock insuffisant',
        invalidMovementType: 'Type de mouvement invalide (in/out/adjust)',

        // Catégories
        categoryCreated: 'Catégorie créée avec succès',
        categoryUpdated: 'Catégorie mise à jour avec succès',
        categoryDeleted: 'Catégorie supprimée avec succès',
        categoryNotFound: 'Catégorie introuvable',
        categoryNameExists: 'Le nom de la catégorie existe déjà',
        categoryHasProducts: 'Impossible de supprimer une catégorie contenant des produits',

        // Clients
        customerCreated: 'Client créé avec succès',
        customerUpdated: 'Client mis à jour avec succès',
        customerDeleted: 'Client supprimé avec succès',
        customerNotFound: 'Client introuvable',
        customerPhoneExists: 'Le numéro de téléphone est déjà enregistré',

        // Ventes
        saleCreated: 'Facture créée avec succès',
        saleNotFound: 'Facture introuvable',
        saleReturned: 'Produits retournés avec succès',
        saleAlreadyReturned: 'Cette facture a déjà été retournée',

        returnDeleted: 'Retour supprimé avec succès',        saleCancelled: 'Facture annulée avec succès',
        saleCannotCancel: 'Impossible d\'annuler une facture retournée',
        sessionRequired: 'Impossible de vendre sans session ouverte',
        saleItemNotFound: 'Produit introuvable dans cette facture',
        returnQtyExceeded: 'Quantité retournée supérieure à la quantité achetée',
        invoiceNumberExists: 'Numéro de facture dupliqué, veuillez en choisir un autre',
        invalidSaleStatus: 'Statut de facture invalide',

        // Inventaire
        movementLogged: 'Mouvement de stock enregistré avec succès',

        // Utilisateurs
        userCreated: 'Utilisateur créé avec succès',
        userUpdated: 'Utilisateur mis à jour avec succès',
        userDeleted: 'Utilisateur supprimé avec succès',
        cannotDeleteAdmin: 'Impossible de supprimer le compte administrateur principal',

        // Paramètres
        settingsSaved: 'Paramètres enregistrés avec succès',
        settingsRetrieved: 'Paramètres récupérés avec succès',

        // Sessions
        sessionOpened: 'Session ouverte avec succès',
        sessionAlreadyOpen: 'Vous avez déjà une session ouverte. Fermez-la d\'abord',
        sessionClosed: 'Session fermée avec succès',
        sessionNotFound: 'Aucune session ouverte à fermer',

        // Coupons
        couponCreated: 'Coupon créé avec succès',
        couponUpdated: 'Coupon mis à jour avec succès',
        couponDeleted: 'Coupon supprimé avec succès',
        couponNotFound: 'Coupon introuvable',
        couponCodeExists: 'Ce code est déjà enregistré',
        couponInvalid: 'Coupon invalide',
        couponExpired: 'Le coupon a expiré',
        couponUsedUp: 'Limite d\'utilisation du coupon atteinte',
        couponMinOrder: 'La commande minimale est de',
        couponApplied: 'Coupon appliqué avec succès',

        // Fournisseurs
        supplierCreated: 'Fournisseur créé avec succès',
        supplierUpdated: 'Fournisseur mis à jour avec succès',
        supplierDeleted: 'Fournisseur supprimé avec succès',
        supplierNotFound: 'Fournisseur introuvable',

        // Bons de commande
        purchaseOrderCreated: 'Bon de commande créé avec succès',
        purchaseOrderUpdated: 'Bon de commande mis à jour avec succès',
        purchaseOrderDeleted: 'Bon de commande supprimé avec succès',
        purchaseOrderNotFound: 'Bon de commande introuvable'
    }
};

function getTranslation(key, lang = 'ar') {
    return translations[lang]?.[key] || translations['en'][key] || translations['ar'][key] || key;
}

module.exports = { getTranslation, translations };
