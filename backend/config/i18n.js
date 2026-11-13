// backend/config/i18n.js
// Nine-language translations (ar / en / fr / tr / es / it / de / ru / zh). Used by controllers via getTranslation(key, lang).
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

        // Products CSV import/export
        importCompleted: 'اكتمل استيراد المنتجات',
        csvFileRequired: 'يرجى اختيار ملف CSV صالح',
        csvEmpty: 'الملف فارغ',
        csvMissingColumns: 'الأعمدة المطلوبة غير موجودة في الملف: name، price',
        csvRow: 'السطر',
        csvNameRequired: 'الاسم مطلوب',
        csvPriceInvalid: 'السعر غير صالح',
        csvStockInvalid: 'المخزون غير صالح',
        csvStatusInvalid: 'الحالة يجب أن تكون active أو inactive',

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
        purchaseOrderNotFound: 'أمر الشراء غير موجود',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'تم إرسال طلب الاشتراك بنجاح — سيتم التفعيل بعد تأكيد الدفع من إدارة المنصة',
        subscriptionRequestExists: 'لديكم طلب قيد المراجعة بالفعل — يرجى انتظار الرد أو إلغاؤه أولاً',
        subscriptionInvalidPlan: 'الخطة المطلوبة غير صالحة',
        subscriptionInvalidCycle: 'دورة الفاتورة غير صالحة',
        subscriptionInvalidMethod: 'طريقة الدفع غير صالحة',
        subscriptionRequestNotFound: 'طلب الاشتراك غير موجود',
        subscriptionAlreadyProcessed: 'تمت معالجة هذا الطلب مسبقاً',
        subscriptionApproved: 'تم تأكيد الدفع وتفعيل الاشتراك بنجاح',
        subscriptionRejected: 'تم رفض طلب الاشتراك',
        subscriptionCancelled: 'تم إلغاء طلب الاشتراك',
        subscriptionExpired: 'انتهى اشتراك المخزن — يرجى تجديد الاشتراك للوصول إلى النظام',
        subscriptionApplied: 'تم تحديث اشتراك المخزن بنجاح',
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

        // Products CSV import/export
        importCompleted: 'Product import completed',
        csvFileRequired: 'Please choose a valid CSV file',
        csvEmpty: 'The file is empty',
        csvMissingColumns: 'Required columns missing from the file: name, price',
        csvRow: 'Row',
        csvNameRequired: 'name is required',
        csvPriceInvalid: 'price is invalid',
        csvStockInvalid: 'stock is invalid',
        csvStatusInvalid: 'status must be active or inactive',

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
        purchaseOrderNotFound: 'Purchase order not found',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Subscription request sent — it will be activated once the platform confirms the payment',
        subscriptionRequestExists: 'You already have a pending request — wait for the reply or cancel it first',
        subscriptionInvalidPlan: 'The requested plan is invalid',
        subscriptionInvalidCycle: 'Invalid billing cycle',
        subscriptionInvalidMethod: 'Invalid payment method',
        subscriptionRequestNotFound: 'Subscription request not found',
        subscriptionAlreadyProcessed: 'This request was already processed',
        subscriptionApproved: 'Payment confirmed and subscription activated successfully',
        subscriptionRejected: 'Subscription request rejected',
        subscriptionCancelled: 'Subscription request cancelled',
        subscriptionExpired: 'The store subscription has expired — please renew to access the system',
        subscriptionApplied: 'Store subscription updated successfully',
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

        // Produits — import/export CSV
        importCompleted: 'Importation des produits terminée',
        csvFileRequired: 'Veuillez choisir un fichier CSV valide',
        csvEmpty: 'Le fichier est vide',
        csvMissingColumns: 'Colonnes obligatoires manquantes dans le fichier : name, price',
        csvRow: 'Ligne',
        csvNameRequired: 'le nom est requis',
        csvPriceInvalid: 'prix invalide',
        csvStockInvalid: 'stock invalide',
        csvStatusInvalid: 'le statut doit être active ou inactive',

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
        purchaseOrderNotFound: 'Bon de commande introuvable',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Demande d\u2019abonnement envoyée — activation après confirmation du paiement par la plateforme',
        subscriptionRequestExists: 'Vous avez déjà une demande en attente — attendez la réponse ou annulez-la d\u2019abord',
        subscriptionInvalidPlan: 'Le plan demandé est invalide',
        subscriptionInvalidCycle: 'Cycle de facturation invalide',
        subscriptionInvalidMethod: 'Méthode de paiement invalide',
        subscriptionRequestNotFound: 'Demande d\u2019abonnement introuvable',
        subscriptionAlreadyProcessed: 'Cette demande a déjà été traitée',
        subscriptionApproved: 'Paiement confirmé et abonnement activé avec succès',
        subscriptionRejected: 'Demande d\u2019abonnement refusée',
        subscriptionCancelled: 'Demande d\u2019abonnement annulée',
        subscriptionExpired: 'L\u2019abonnement du magasin a expiré — veuillez le renouveler pour accéder au système',
        subscriptionApplied: 'Abonnement du magasin mis à jour avec succès',
    },
    tr: {
        // Genel
        welcome: 'DZ POS PRO API çalışıyor',
        serverError: 'Sunucuda bir hata oluştu',
        notFound: 'Yol bulunamadı',
        unauthorized: 'Yetkisiz',
        forbidden: 'Bu işlemi yapma yetkiniz yok',
        invalidToken: 'Kimlik doğrulama anahtarı geçersiz',
        missingFields: 'Zorunlu alanlar eksik',
        invalidData: 'Veriler geçersiz',
        success: 'İşlem başarılı',
        created: 'Başarıyla oluşturuldu',
        updated: 'Başarıyla güncellendi',
        deleted: 'Başarıyla silindi',
        noUpdateData: 'Güncellenecek veri yok',

        // Kimlik
        loginSuccess: 'Giriş başarılı',
        loginFailed: 'Giriş bilgileri hatalı',
        userNotFound: 'Kullanıcı bulunamadı',
        emailExists: 'Bu e-posta zaten kayıtlı',
        accountDisabled: 'Hesap devre dışı, lütfen yönetimle iletişime geçin',
        passwordChanged: 'Şifre başarıyla değiştirildi',
        passwordMismatch: 'Mevcut şifre hatalı',
        passwordTooShort: 'Şifre en az 8 karakter olmalı',
        passwordWeak: 'Şifre hem harf hem rakam içermeli',
        passwordSameAsOld: 'Yeni şifre eski şifreden farklı olmalı',
        tokenRefreshed: 'Anahtar başarıyla yenilendi',
        logoutSuccess: 'Çıkış başarılı',

        // Ürünler
        productCreated: 'Ürün başarıyla oluşturuldu',
        productUpdated: 'Ürün başarıyla güncellendi',
        productDeleted: 'Ürün başarıyla silindi',
        productNotFound: 'Ürün bulunamadı',
        barcodeExists: 'Bu barkod zaten kayıtlı',
        skuExists: 'Bu stok kodu zaten kayıtlı',
        stockUpdated: 'Stok başarıyla güncellendi',
        insufficientStock: 'Yetersiz stok',
        invalidMovementType: 'Hareket türü geçersiz (in/out/adjust)',

        // CSV içe/dışa aktarma
        importCompleted: 'Ürün içe aktarma tamamlandı',
        csvFileRequired: 'Lütfen geçerli bir CSV dosyası seçin',
        csvEmpty: 'Dosya boş',
        csvMissingColumns: 'Dosyada zorunlu sütunlar eksik: name, price',
        csvRow: 'Satır',
        csvNameRequired: 'name zorunludur',
        csvPriceInvalid: 'price geçersiz',
        csvStockInvalid: 'stock geçersiz',
        csvStatusInvalid: 'durum active veya inactive olmalı',

        // Kategoriler
        categoryCreated: 'Kategori başarıyla oluşturuldu',
        categoryUpdated: 'Kategori başarıyla güncellendi',
        categoryDeleted: 'Kategori başarıyla silindi',
        categoryNotFound: 'Kategori bulunamadı',
        categoryNameExists: 'Kategori adı zaten kayıtlı',
        categoryHasProducts: 'Ürün içeren kategori silinemez',

        // Müşteriler
        customerCreated: 'Müşteri başarıyla oluşturuldu',
        customerUpdated: 'Müşteri başarıyla güncellendi',
        customerDeleted: 'Müşteri başarıyla silindi',
        customerNotFound: 'Müşteri bulunamadı',
        customerPhoneExists: 'Telefon numarası zaten kayıtlı',

        // Satışlar
        saleCreated: 'Fatura başarıyla oluşturuldu',
        saleNotFound: 'Fatura bulunamadı',
        saleReturned: 'Ürünler başarıyla iade edildi',
        saleAlreadyReturned: 'Bu fatura daha önce iade edilmiş',
        returnDeleted: 'İade başarıyla silindi',
        saleCancelled: 'Fatura başarıyla iptal edildi',
        saleCannotCancel: 'İade edilmiş fatura iptal edilemez',
        sessionRequired: 'Açık oturum olmadan satış yapılamaz',
        saleItemNotFound: 'Ürün bu faturada bulunamadı',
        returnQtyExceeded: 'İade miktarı satın alınan miktarı aşıyor',
        invoiceNumberExists: 'Fatura numarası mükerrer, lütfen başka bir numara seçin',
        invalidSaleStatus: 'Geçersiz fatura durumu',

        // Stok
        movementLogged: 'Stok hareketi başarıyla kaydedildi',

        // Kullanıcılar
        userCreated: 'Kullanıcı başarıyla oluşturuldu',
        userUpdated: 'Kullanıcı başarıyla güncellendi',
        userDeleted: 'Kullanıcı başarıyla silindi',
        cannotDeleteAdmin: 'Ana yönetici hesabı silinemez',

        // Ayarlar
        settingsSaved: 'Ayarlar başarıyla kaydedildi',
        settingsRetrieved: 'Ayarlar başarıyla alındı',

        // Oturumlar
        sessionOpened: 'Oturum başarıyla açıldı',
        sessionAlreadyOpen: 'Zaten açık bir oturumunuz var. Önce kapatın',
        sessionClosed: 'Oturum başarıyla kapatıldı',
        sessionNotFound: 'Kapatılacak açık oturum yok',

        // Kuponlar
        couponCreated: 'Kupon başarıyla oluşturuldu',
        couponUpdated: 'Kupon başarıyla güncellendi',
        couponDeleted: 'Kupon başarıyla silindi',
        couponNotFound: 'Kupon bulunamadı',
        couponCodeExists: 'Bu kod zaten kayıtlı',
        couponInvalid: 'Geçersiz kupon',
        couponExpired: 'Kuponun süresi doldu',
        couponUsedUp: 'Kupon kullanım limitine ulaşıldı',
        couponMinOrder: 'Minimum sipariş tutarı:',
        couponApplied: 'Kupon başarıyla uygulandı',

        // Tedarikçiler
        supplierCreated: 'Tedarikçi başarıyla oluşturuldu',
        supplierUpdated: 'Tedarikçi başarıyla güncellendi',
        supplierDeleted: 'Tedarikçi başarıyla silindi',
        supplierNotFound: 'Tedarikçi bulunamadı',

        // Satın alma siparişleri
        purchaseOrderCreated: 'Satın alma siparişi başarıyla oluşturuldu',
        purchaseOrderUpdated: 'Satın alma siparişi başarıyla güncellendi',
        purchaseOrderDeleted: 'Satın alma siparişi başarıyla silindi',
        purchaseOrderNotFound: 'Satın alma siparişi bulunamadı',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Abonelik talebi gönderildi — platform ödemeyi onayladıktan sonra etkinleştirilir',
        subscriptionRequestExists: 'Zaten bekleyen bir talebiniz var — yanıtı bekleyin veya önce iptal edin',
        subscriptionInvalidPlan: 'İstenen plan geçersiz',
        subscriptionInvalidCycle: 'Geçersiz faturalandırma döngüsü',
        subscriptionInvalidMethod: 'Geçersiz ödeme yöntemi',
        subscriptionRequestNotFound: 'Abonelik talebi bulunamadı',
        subscriptionAlreadyProcessed: 'Bu talep zaten işlendi',
        subscriptionApproved: 'Ödeme onaylandı ve abonelik başarıyla etkinleştirildi',
        subscriptionRejected: 'Abonelik talebi reddedildi',
        subscriptionCancelled: 'Abonelik talebi iptal edildi',
        subscriptionExpired: 'Mağaza aboneliğinin süresi doldu — erişim için lütfen yenileyin',
        subscriptionApplied: 'Mağaza aboneliği başarıyla güncellendi',
    },

    es: {
        // General
        welcome: 'La API de DZ POS PRO está en funcionamiento',
        serverError: 'Error del servidor',
        notFound: 'Ruta no encontrada',
        unauthorized: 'No autorizado',
        forbidden: 'No tiene permiso para realizar esta acción',
        invalidToken: 'Token no válido',
        missingFields: 'Faltan campos obligatorios',
        invalidData: 'Datos no válidos',
        success: 'Operación exitosa',
        created: 'Creado con éxito',
        updated: 'Actualizado con éxito',
        deleted: 'Eliminado con éxito',
        noUpdateData: 'No hay datos para actualizar',

        // Autenticación
        loginSuccess: 'Inicio de sesión exitoso',
        loginFailed: 'Credenciales incorrectas',
        userNotFound: 'Usuario no encontrado',
        emailExists: 'El correo ya está registrado',
        accountDisabled: 'Cuenta desactivada, contacte con la administración',
        passwordChanged: 'Contraseña cambiada con éxito',
        passwordMismatch: 'La contraseña actual es incorrecta',
        passwordTooShort: 'La contraseña debe tener al menos 8 caracteres',
        passwordWeak: 'La contraseña debe contener letras y números',
        passwordSameAsOld: 'La nueva contraseña debe ser diferente de la anterior',
        tokenRefreshed: 'Token renovado con éxito',
        logoutSuccess: 'Sesión cerrada con éxito',

        // Productos
        productCreated: 'Producto creado con éxito',
        productUpdated: 'Producto actualizado con éxito',
        productDeleted: 'Producto eliminado con éxito',
        productNotFound: 'Producto no encontrado',
        barcodeExists: 'Este código de barras ya está registrado',
        skuExists: 'Esta referencia ya está registrada',
        stockUpdated: 'Stock actualizado con éxito',
        insufficientStock: 'Stock insuficiente',
        invalidMovementType: 'Tipo de movimiento no válido (in/out/adjust)',

        // Importación/exportación CSV
        importCompleted: 'Importación de productos completada',
        csvFileRequired: 'Elija un archivo CSV válido',
        csvEmpty: 'El archivo está vacío',
        csvMissingColumns: 'Faltan columnas obligatorias en el archivo: name, price',
        csvRow: 'Fila',
        csvNameRequired: 'name es obligatorio',
        csvPriceInvalid: 'price no es válido',
        csvStockInvalid: 'stock no es válido',
        csvStatusInvalid: 'el estado debe ser active o inactive',

        // Categorías
        categoryCreated: 'Categoría creada con éxito',
        categoryUpdated: 'Categoría actualizada con éxito',
        categoryDeleted: 'Categoría eliminada con éxito',
        categoryNotFound: 'Categoría no encontrada',
        categoryNameExists: 'El nombre de la categoría ya existe',
        categoryHasProducts: 'No se puede eliminar una categoría con productos',

        // Clientes
        customerCreated: 'Cliente creado con éxito',
        customerUpdated: 'Cliente actualizado con éxito',
        customerDeleted: 'Cliente eliminado con éxito',
        customerNotFound: 'Cliente no encontrado',
        customerPhoneExists: 'El teléfono ya está registrado',

        // Ventas
        saleCreated: 'Factura creada con éxito',
        saleNotFound: 'Factura no encontrada',
        saleReturned: 'Productos devueltos con éxito',
        saleAlreadyReturned: 'Esta factura ya fue devuelta',
        returnDeleted: 'Devolución eliminada con éxito',
        saleCancelled: 'Factura cancelada con éxito',
        saleCannotCancel: 'No se puede cancelar una factura devuelta',
        sessionRequired: 'No se puede vender sin una sesión abierta',
        saleItemNotFound: 'Producto no encontrado en esta factura',
        returnQtyExceeded: 'La cantidad devuelta supera la comprada',
        invoiceNumberExists: 'Número de factura duplicado, elija otro',
        invalidSaleStatus: 'Estado de factura no válido',

        // Inventario
        movementLogged: 'Movimiento de inventario registrado con éxito',

        // Usuarios
        userCreated: 'Usuario creado con éxito',
        userUpdated: 'Usuario actualizado con éxito',
        userDeleted: 'Usuario eliminado con éxito',
        cannotDeleteAdmin: 'No se puede eliminar la cuenta de administrador principal',

        // Ajustes
        settingsSaved: 'Ajustes guardados con éxito',
        settingsRetrieved: 'Ajustes obtenidos con éxito',

        // Sesiones
        sessionOpened: 'Sesión abierta con éxito',
        sessionAlreadyOpen: 'Ya tiene una sesión abierta. Ciérrela primero',
        sessionClosed: 'Sesión cerrada con éxito',
        sessionNotFound: 'No hay sesión abierta para cerrar',

        // Cupones
        couponCreated: 'Cupón creado con éxito',
        couponUpdated: 'Cupón actualizado con éxito',
        couponDeleted: 'Cupón eliminado con éxito',
        couponNotFound: 'Cupón no encontrado',
        couponCodeExists: 'Este código ya está registrado',
        couponInvalid: 'Cupón no válido',
        couponExpired: 'El cupón ha expirado',
        couponUsedUp: 'Límite de uso del cupón alcanzado',
        couponMinOrder: 'El pedido mínimo es de',
        couponApplied: 'Cupón aplicado con éxito',

        // Proveedores
        supplierCreated: 'Proveedor creado con éxito',
        supplierUpdated: 'Proveedor actualizado con éxito',
        supplierDeleted: 'Proveedor eliminado con éxito',
        supplierNotFound: 'Proveedor no encontrado',

        // Órdenes de compra
        purchaseOrderCreated: 'Orden de compra creada con éxito',
        purchaseOrderUpdated: 'Orden de compra actualizada con éxito',
        purchaseOrderDeleted: 'Orden de compra eliminada con éxito',
        purchaseOrderNotFound: 'Orden de compra no encontrada',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Solicitud de suscripción enviada — se activará cuando la plataforma confirme el pago',
        subscriptionRequestExists: 'Ya tiene una solicitud pendiente — espere la respuesta o cancélela primero',
        subscriptionInvalidPlan: 'El plan solicitado no es válido',
        subscriptionInvalidCycle: 'Ciclo de facturación no válido',
        subscriptionInvalidMethod: 'Método de pago no válido',
        subscriptionRequestNotFound: 'Solicitud de suscripción no encontrada',
        subscriptionAlreadyProcessed: 'Esta solicitud ya fue procesada',
        subscriptionApproved: 'Pago confirmado y suscripción activada con éxito',
        subscriptionRejected: 'Solicitud de suscripción rechazada',
        subscriptionCancelled: 'Solicitud de suscripción cancelada',
        subscriptionExpired: 'La suscripción de la tienda expiró — renueve para acceder al sistema',
        subscriptionApplied: 'Suscripción de la tienda actualizada con éxito',
    },

    it: {
        // Generale
        welcome: "L'API DZ POS PRO è in funzione",
        serverError: 'Errore del server',
        notFound: 'Percorso non trovato',
        unauthorized: 'Non autorizzato',
        forbidden: "Non hai i permessi per eseguire questa azione",
        invalidToken: 'Token non valido',
        missingFields: 'Campi obbligatori mancanti',
        invalidData: 'Dati non validi',
        success: 'Operazione riuscita',
        created: 'Creato con successo',
        updated: 'Aggiornato con successo',
        deleted: 'Eliminato con successo',
        noUpdateData: 'Nessun dato da aggiornare',

        // Autenticazione
        loginSuccess: 'Accesso riuscito',
        loginFailed: 'Credenziali non valide',
        userNotFound: 'Utente non trovato',
        emailExists: 'Email già registrata',
        accountDisabled: 'Account disabilitato, contatta la amministrazione',
        passwordChanged: 'Password modificata con successo',
        passwordMismatch: 'La password attuale non è corretta',
        passwordTooShort: 'La password deve avere almeno 8 caratteri',
        passwordWeak: 'La password deve contenere lettere e numeri',
        passwordSameAsOld: 'La nuova password deve essere diversa dalla precedente',
        tokenRefreshed: 'Token rinnovato con successo',
        logoutSuccess: 'Uscita riuscita',

        // Prodotti
        productCreated: 'Prodotto creato con successo',
        productUpdated: 'Prodotto aggiornato con successo',
        productDeleted: 'Prodotto eliminato con successo',
        productNotFound: 'Prodotto non trovato',
        barcodeExists: 'Questo codice a barre è già registrato',
        skuExists: 'Questo codice articolo è già registrato',
        stockUpdated: 'Scorta aggiornata con successo',
        insufficientStock: 'Scorta insufficiente',
        invalidMovementType: 'Tipo di movimento non valido (in/out/adjust)',

        // Import/export CSV
        importCompleted: 'Importazione prodotti completata',
        csvFileRequired: 'Scegli un file CSV valido',
        csvEmpty: 'Il file è vuoto',
        csvMissingColumns: 'Colonne obbligatorie mancanti nel file: name, price',
        csvRow: 'Riga',
        csvNameRequired: 'name è obbligatorio',
        csvPriceInvalid: 'price non è valido',
        csvStockInvalid: 'stock non è valido',
        csvStatusInvalid: 'lo stato deve essere active o inactive',

        // Categorie
        categoryCreated: 'Categoria creata con successo',
        categoryUpdated: 'Categoria aggiornata con successo',
        categoryDeleted: 'Categoria eliminata con successo',
        categoryNotFound: 'Categoria non trovata',
        categoryNameExists: 'Il nome della categoria esiste già',
        categoryHasProducts: 'Impossibile eliminare una categoria con prodotti',

        // Clienti
        customerCreated: 'Cliente creato con successo',
        customerUpdated: 'Cliente aggiornato con successo',
        customerDeleted: 'Cliente eliminato con successo',
        customerNotFound: 'Cliente non trovato',
        customerPhoneExists: 'Il numero di telefono è già registrato',

        // Vendite
        saleCreated: 'Fattura creata con successo',
        saleNotFound: 'Fattura non trovata',
        saleReturned: 'Prodotti restituiti con successo',
        saleAlreadyReturned: 'Questa fattura è già stata restituita',
        returnDeleted: 'Reso eliminato con successo',
        saleCancelled: 'Fattura annullata con successo',
        saleCannotCancel: 'Impossibile annullare una fattura restituita',
        sessionRequired: 'Impossibile vendere senza una sessione aperta',
        saleItemNotFound: 'Prodotto non trovato in questa fattura',
        returnQtyExceeded: 'La quantità restituita supera quella acquistata',
        invoiceNumberExists: 'Numero fattura duplicato, scegline un altro',
        invalidSaleStatus: 'Stato fattura non valido',

        // Magazzino
        movementLogged: 'Movimento di magazzino registrato con successo',

        // Utenti
        userCreated: 'Utente creato con successo',
        userUpdated: 'Utente aggiornato con successo',
        userDeleted: 'Utente eliminato con successo',
        cannotDeleteAdmin: "Impossibile eliminare l'account amministratore principale",

        // Impostazioni
        settingsSaved: 'Impostazioni salvate con successo',
        settingsRetrieved: 'Impostazioni recuperate con successo',

        // Sessioni
        sessionOpened: 'Sessione aperta con successo',
        sessionAlreadyOpen: 'Hai già una sessione aperta. Chiudila prima',
        sessionClosed: 'Sessione chiusa con successo',
        sessionNotFound: 'Nessuna sessione aperta da chiudere',

        // Coupon
        couponCreated: 'Coupon creato con successo',
        couponUpdated: 'Coupon aggiornato con successo',
        couponDeleted: 'Coupon eliminato con successo',
        couponNotFound: 'Coupon non trovato',
        couponCodeExists: 'Questo codice è già registrato',
        couponInvalid: 'Coupon non valido',
        couponExpired: 'Il coupon è scaduto',
        couponUsedUp: 'Limite di utilizzo del coupon raggiunto',
        couponMinOrder: "L'ordine minimo è di",
        couponApplied: 'Coupon applicato con successo',

        // Fornitori
        supplierCreated: 'Fornitore creato con successo',
        supplierUpdated: 'Fornitore aggiornato con successo',
        supplierDeleted: 'Fornitore eliminato con successo',
        supplierNotFound: 'Fornitore non trovato',

        // Ordini di acquisto
        purchaseOrderCreated: 'Ordine di acquisto creato con successo',
        purchaseOrderUpdated: 'Ordine di acquisto aggiornato con successo',
        purchaseOrderDeleted: 'Ordine di acquisto eliminato con successo',
        purchaseOrderNotFound: 'Ordine di acquisto non trovato',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Richiesta di abbonamento inviata — verrà attivata dopo la conferma del pagamento dalla piattaforma',
        subscriptionRequestExists: 'Hai già una richiesta in sospeso — attendi la risposta o annullala prima',
        subscriptionInvalidPlan: 'Il piano richiesto non è valido',
        subscriptionInvalidCycle: 'Ciclo di fatturazione non valido',
        subscriptionInvalidMethod: 'Metodo di pagamento non valido',
        subscriptionRequestNotFound: 'Richiesta di abbonamento non trovata',
        subscriptionAlreadyProcessed: 'Questa richiesta è già stata elaborata',
        subscriptionApproved: 'Pagamento confermato e abbonamento attivato con successo',
        subscriptionRejected: 'Richiesta di abbonamento rifiutata',
        subscriptionCancelled: 'Richiesta di abbonamento annullata',
        subscriptionExpired: 'L\u2019abbonamento del negozio è scaduto — rinnova per accedere al sistema',
        subscriptionApplied: 'Abbonamento del negozio aggiornato con successo',
    },

    de: {
        // Allgemein
        welcome: 'Die DZ POS PRO API läuft',
        serverError: 'Serverfehler',
        notFound: 'Route nicht gefunden',
        unauthorized: 'Nicht autorisiert',
        forbidden: 'Sie haben keine Berechtigung für diese Aktion',
        invalidToken: 'Ungültiges Token',
        missingFields: 'Pflichtfelder fehlen',
        invalidData: 'Ungültige Daten',
        success: 'Vorgang erfolgreich',
        created: 'Erfolgreich erstellt',
        updated: 'Erfolgreich aktualisiert',
        deleted: 'Erfolgreich gelöscht',
        noUpdateData: 'Keine Daten zum Aktualisieren',

        // Authentifizierung
        loginSuccess: 'Anmeldung erfolgreich',
        loginFailed: 'Zugangsdaten ungültig',
        userNotFound: 'Benutzer nicht gefunden',
        emailExists: 'E-Mail ist bereits registriert',
        accountDisabled: 'Konto ist deaktiviert, bitte kontaktieren Sie die Verwaltung',
        passwordChanged: 'Passwort erfolgreich geändert',
        passwordMismatch: 'Aktuelles Passwort ist falsch',
        passwordTooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein',
        passwordWeak: 'Das Passwort muss Buchstaben und Zahlen enthalten',
        passwordSameAsOld: 'Das neue Passwort muss sich vom alten unterscheiden',
        tokenRefreshed: 'Token erfolgreich erneuert',
        logoutSuccess: 'Erfolgreich abgemeldet',

        // Produkte
        productCreated: 'Produkt erfolgreich erstellt',
        productUpdated: 'Produkt erfolgreich aktualisiert',
        productDeleted: 'Produkt erfolgreich gelöscht',
        productNotFound: 'Produkt nicht gefunden',
        barcodeExists: 'Dieser Strichcode ist bereits registriert',
        skuExists: 'Diese Artikelnummer ist bereits registriert',
        stockUpdated: 'Bestand erfolgreich aktualisiert',
        insufficientStock: 'Nicht genügend Bestand',
        invalidMovementType: 'Ungültige Bewegungsart (in/out/adjust)',

        // CSV-Import/Export
        importCompleted: 'Produktimport abgeschlossen',
        csvFileRequired: 'Bitte eine gültige CSV-Datei wählen',
        csvEmpty: 'Die Datei ist leer',
        csvMissingColumns: 'Pflichtspalten fehlen in der Datei: name, price',
        csvRow: 'Zeile',
        csvNameRequired: 'name ist erforderlich',
        csvPriceInvalid: 'price ist ungültig',
        csvStockInvalid: 'stock ist ungültig',
        csvStatusInvalid: 'der Status muss active oder inactive sein',

        // Kategorien
        categoryCreated: 'Kategorie erfolgreich erstellt',
        categoryUpdated: 'Kategorie erfolgreich aktualisiert',
        categoryDeleted: 'Kategorie erfolgreich gelöscht',
        categoryNotFound: 'Kategorie nicht gefunden',
        categoryNameExists: 'Kategoriename existiert bereits',
        categoryHasProducts: 'Kategorie mit Produkten kann nicht gelöscht werden',

        // Kunden
        customerCreated: 'Kunde erfolgreich erstellt',
        customerUpdated: 'Kunde erfolgreich aktualisiert',
        customerDeleted: 'Kunde erfolgreich gelöscht',
        customerNotFound: 'Kunde nicht gefunden',
        customerPhoneExists: 'Telefonnummer ist bereits registriert',

        // Verkäufe
        saleCreated: 'Rechnung erfolgreich erstellt',
        saleNotFound: 'Rechnung nicht gefunden',
        saleReturned: 'Produkte erfolgreich retourniert',
        saleAlreadyReturned: 'Diese Rechnung wurde bereits retourniert',
        returnDeleted: 'Retoure erfolgreich gelöscht',
        saleCancelled: 'Rechnung erfolgreich storniert',
        saleCannotCancel: 'Eine retournierte Rechnung kann nicht storniert werden',
        sessionRequired: 'Ohne offene Schicht kann nicht verkauft werden',
        saleItemNotFound: 'Produkt in dieser Rechnung nicht gefunden',
        returnQtyExceeded: 'Retourenmenge übersteigt die Kaufmenge',
        invoiceNumberExists: 'Rechnungsnummer doppelt, bitte eine andere wählen',
        invalidSaleStatus: 'Ungültiger Rechnungsstatus',

        // Lager
        movementLogged: 'Lagerbewegung erfolgreich erfasst',

        // Benutzer
        userCreated: 'Benutzer erfolgreich erstellt',
        userUpdated: 'Benutzer erfolgreich aktualisiert',
        userDeleted: 'Benutzer erfolgreich gelöscht',
        cannotDeleteAdmin: 'Das Haupt-Administratorkonto kann nicht gelöscht werden',

        // Einstellungen
        settingsSaved: 'Einstellungen erfolgreich gespeichert',
        settingsRetrieved: 'Einstellungen erfolgreich abgerufen',

        // Schichten
        sessionOpened: 'Schicht erfolgreich geöffnet',
        sessionAlreadyOpen: 'Sie haben bereits eine offene Schicht. Schließen Sie diese zuerst',
        sessionClosed: 'Schicht erfolgreich geschlossen',
        sessionNotFound: 'Keine offene Schicht zum Schließen',

        // Gutscheine
        couponCreated: 'Gutschein erfolgreich erstellt',
        couponUpdated: 'Gutschein erfolgreich aktualisiert',
        couponDeleted: 'Gutschein erfolgreich gelöscht',
        couponNotFound: 'Gutschein nicht gefunden',
        couponCodeExists: 'Dieser Code ist bereits registriert',
        couponInvalid: 'Ungültiger Gutschein',
        couponExpired: 'Der Gutschein ist abgelaufen',
        couponUsedUp: 'Nutzungslimit des Gutscheins erreicht',
        couponMinOrder: 'Die Mindestbestellung beträgt',
        couponApplied: 'Gutschein erfolgreich angewendet',

        // Lieferanten
        supplierCreated: 'Lieferant erfolgreich erstellt',
        supplierUpdated: 'Lieferant erfolgreich aktualisiert',
        supplierDeleted: 'Lieferant erfolgreich gelöscht',
        supplierNotFound: 'Lieferant nicht gefunden',

        // Bestellungen
        purchaseOrderCreated: 'Bestellung erfolgreich erstellt',
        purchaseOrderUpdated: 'Bestellung erfolgreich aktualisiert',
        purchaseOrderDeleted: 'Bestellung erfolgreich gelöscht',
        purchaseOrderNotFound: 'Bestellung nicht gefunden',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Abonnementanfrage gesendet — Aktivierung nach Zahlungsbestätigung durch die Plattform',
        subscriptionRequestExists: 'Sie haben bereits eine offene Anfrage — warten Sie auf die Antwort oder stornieren Sie sie zuerst',
        subscriptionInvalidPlan: 'Der angeforderte Plan ist ungültig',
        subscriptionInvalidCycle: 'Ungültiger Abrechnungszyklus',
        subscriptionInvalidMethod: 'Ungültige Zahlungsmethode',
        subscriptionRequestNotFound: 'Abonnementanfrage nicht gefunden',
        subscriptionAlreadyProcessed: 'Diese Anfrage wurde bereits verarbeitet',
        subscriptionApproved: 'Zahlung bestätigt und Abonnement erfolgreich aktiviert',
        subscriptionRejected: 'Abonnementanfrage abgelehnt',
        subscriptionCancelled: 'Abonnementanfrage storniert',
        subscriptionExpired: 'Das Shop-Abonnement ist abgelaufen — bitte erneuern, um Zugriff zu erhalten',
        subscriptionApplied: 'Shop-Abonnement erfolgreich aktualisiert',
    },

    ru: {
        // Общее
        welcome: 'API DZ POS PRO работает',
        serverError: 'Ошибка сервера',
        notFound: 'Маршрут не найден',
        unauthorized: 'Не авторизован',
        forbidden: 'У вас нет прав на это действие',
        invalidToken: 'Недействительный токен',
        missingFields: 'Отсутствуют обязательные поля',
        invalidData: 'Недействительные данные',
        success: 'Операция выполнена',
        created: 'Успешно создано',
        updated: 'Успешно обновлено',
        deleted: 'Успешно удалено',
        noUpdateData: 'Нет данных для обновления',

        // Аутентификация
        loginSuccess: 'Вход выполнен успешно',
        loginFailed: 'Неверные учётные данные',
        userNotFound: 'Пользователь не найден',
        emailExists: 'Эта почта уже зарегистрирована',
        accountDisabled: 'Аккаунт отключён, обратитесь к администрации',
        passwordChanged: 'Пароль успешно изменён',
        passwordMismatch: 'Текущий пароль неверен',
        passwordTooShort: 'Пароль должен быть не менее 8 символов',
        passwordWeak: 'Пароль должен содержать буквы и цифры',
        passwordSameAsOld: 'Новый пароль должен отличаться от старого',
        tokenRefreshed: 'Токен успешно обновлён',
        logoutSuccess: 'Выход выполнен',

        // Товары
        productCreated: 'Товар успешно создан',
        productUpdated: 'Товар успешно обновлён',
        productDeleted: 'Товар успешно удалён',
        productNotFound: 'Товар не найден',
        barcodeExists: 'Этот штрихкод уже зарегистрирован',
        skuExists: 'Этот артикул уже зарегистрирован',
        stockUpdated: 'Остаток успешно обновлён',
        insufficientStock: 'Недостаточно остатка',
        invalidMovementType: 'Недопустимый тип движения (in/out/adjust)',

        // Импорт/экспорт CSV
        importCompleted: 'Импорт товаров завершён',
        csvFileRequired: 'Выберите корректный CSV-файл',
        csvEmpty: 'Файл пуст',
        csvMissingColumns: 'В файле отсутствуют обязательные столбцы: name, price',
        csvRow: 'Строка',
        csvNameRequired: 'name обязательно',
        csvPriceInvalid: 'price недействителен',
        csvStockInvalid: 'stock недействителен',
        csvStatusInvalid: 'статус должен быть active или inactive',

        // Категории
        categoryCreated: 'Категория успешно создана',
        categoryUpdated: 'Категория успешно обновлена',
        categoryDeleted: 'Категория успешно удалена',
        categoryNotFound: 'Категория не найдена',
        categoryNameExists: 'Название категории уже существует',
        categoryHasProducts: 'Нельзя удалить категорию с товарами',

        // Клиенты
        customerCreated: 'Клиент успешно создан',
        customerUpdated: 'Клиент успешно обновлён',
        customerDeleted: 'Клиент успешно удалён',
        customerNotFound: 'Клиент не найден',
        customerPhoneExists: 'Телефон уже зарегистрирован',

        // Продажи
        saleCreated: 'Счёт успешно создан',
        saleNotFound: 'Счёт не найден',
        saleReturned: 'Товары успешно возвращены',
        saleAlreadyReturned: 'Этот счёт уже был возвращён',
        returnDeleted: 'Возврат успешно удалён',
        saleCancelled: 'Счёт успешно отменён',
        saleCannotCancel: 'Нельзя отменить возвращённый счёт',
        sessionRequired: 'Продажа невозможна без открытой смены',
        saleItemNotFound: 'Товар не найден в этом счёте',
        returnQtyExceeded: 'Количество возврата превышает купленное',
        invoiceNumberExists: 'Номер счёта дублируется, выберите другой',
        invalidSaleStatus: 'Недопустимый статус счёта',

        // Склад
        movementLogged: 'Складское движение успешно записано',

        // Пользователи
        userCreated: 'Пользователь успешно создан',
        userUpdated: 'Пользователь успешно обновлён',
        userDeleted: 'Пользователь успешно удалён',
        cannotDeleteAdmin: 'Нельзя удалить главную учётную запись администратора',

        // Настройки
        settingsSaved: 'Настройки успешно сохранены',
        settingsRetrieved: 'Настройки успешно получены',

        // Смены
        sessionOpened: 'Смена успешно открыта',
        sessionAlreadyOpen: 'У вас уже есть открытая смена. Сначала закройте её',
        sessionClosed: 'Смена успешно закрыта',
        sessionNotFound: 'Нет открытой смены для закрытия',

        // Купоны
        couponCreated: 'Купон успешно создан',
        couponUpdated: 'Купон успешно обновлён',
        couponDeleted: 'Купон успешно удалён',
        couponNotFound: 'Купон не найден',
        couponCodeExists: 'Этот код уже зарегистрирован',
        couponInvalid: 'Недействительный купон',
        couponExpired: 'Срок действия купона истёк',
        couponUsedUp: 'Достигнут лимит использования купона',
        couponMinOrder: 'Минимальная сумма заказа:',
        couponApplied: 'Купон успешно применён',

        // Поставщики
        supplierCreated: 'Поставщик успешно создан',
        supplierUpdated: 'Поставщик успешно обновлён',
        supplierDeleted: 'Поставщик успешно удалён',
        supplierNotFound: 'Поставщик не найден',

        // Заказы на закупку
        purchaseOrderCreated: 'Заказ на закупку успешно создан',
        purchaseOrderUpdated: 'Заказ на закупку успешно обновлён',
        purchaseOrderDeleted: 'Заказ на закупку успешно удалён',
        purchaseOrderNotFound: 'Заказ на закупку не найден',
        // Subscription (v4.3)
        subscriptionRequestCreated: 'Запрос на подписку отправлен — активация после подтверждения оплаты платформой',
        subscriptionRequestExists: 'У вас уже есть запрос на рассмотрении — дождитесь ответа или сначала отмените его',
        subscriptionInvalidPlan: 'Запрошенный тариф недействителен',
        subscriptionInvalidCycle: 'Недействительный цикл выставления счетов',
        subscriptionInvalidMethod: 'Недействительный способ оплаты',
        subscriptionRequestNotFound: 'Запрос на подписку не найден',
        subscriptionAlreadyProcessed: 'Этот запрос уже обработан',
        subscriptionApproved: 'Оплата подтверждена, подписка успешно активирована',
        subscriptionRejected: 'Запрос на подписку отклонён',
        subscriptionCancelled: 'Запрос на подписку отменён',
        subscriptionExpired: 'Подписка магазина истекла — продлите её для доступа к системе',
        subscriptionApplied: 'Подписка магазина успешно обновлена',
    },

    zh: {
        // 通用
        welcome: 'DZ POS PRO API 正在运行',
        serverError: '服务器错误',
        notFound: '路由不存在',
        unauthorized: '未授权',
        forbidden: '您没有权限执行此操作',
        invalidToken: '无效的认证令牌',
        missingFields: '缺少必填字段',
        invalidData: '数据无效',
        success: '操作成功',
        created: '创建成功',
        updated: '更新成功',
        deleted: '删除成功',
        noUpdateData: '没有可更新的数据',

        // 认证
        loginSuccess: '登录成功',
        loginFailed: '账号或密码错误',
        userNotFound: '用户不存在',
        emailExists: '该邮箱已被注册',
        accountDisabled: '账号已被停用，请联系管理员',
        passwordChanged: '密码修改成功',
        passwordMismatch: '当前密码不正确',
        passwordTooShort: '密码至少需要8个字符',
        passwordWeak: '密码必须同时包含字母和数字',
        passwordSameAsOld: '新密码不能与旧密码相同',
        tokenRefreshed: '令牌刷新成功',
        logoutSuccess: '退出成功',

        // 商品
        productCreated: '商品创建成功',
        productUpdated: '商品更新成功',
        productDeleted: '商品删除成功',
        productNotFound: '商品不存在',
        barcodeExists: '该条码已被注册',
        skuExists: '该货号已被注册',
        stockUpdated: '库存更新成功',
        insufficientStock: '库存不足',
        invalidMovementType: '无效的变动类型（in/out/adjust）',

        // CSV 导入/导出
        importCompleted: '商品导入完成',
        csvFileRequired: '请选择有效的 CSV 文件',
        csvEmpty: '文件为空',
        csvMissingColumns: '文件缺少必需的列：name、price',
        csvRow: '行',
        csvNameRequired: 'name 必填',
        csvPriceInvalid: 'price 无效',
        csvStockInvalid: 'stock 无效',
        csvStatusInvalid: '状态必须为 active 或 inactive',

        // 分类
        categoryCreated: '分类创建成功',
        categoryUpdated: '分类更新成功',
        categoryDeleted: '分类删除成功',
        categoryNotFound: '分类不存在',
        categoryNameExists: '分类名称已存在',
        categoryHasProducts: '包含商品的分类无法删除',

        // 客户
        customerCreated: '客户创建成功',
        customerUpdated: '客户更新成功',
        customerDeleted: '客户删除成功',
        customerNotFound: '客户不存在',
        customerPhoneExists: '该电话已被注册',

        // 销售
        saleCreated: '发票创建成功',
        saleNotFound: '发票不存在',
        saleReturned: '商品退货成功',
        saleAlreadyReturned: '该发票已退货',
        returnDeleted: '退货删除成功',
        saleCancelled: '发票取消成功',
        saleCannotCancel: '已退货的发票无法取消',
        sessionRequired: '没有开班无法销售',
        saleItemNotFound: '该发票中未找到此商品',
        returnQtyExceeded: '退货数量超过购买数量',
        invoiceNumberExists: '发票号重复，请换一个',
        invalidSaleStatus: '无效的发票状态',

        // 库存
        movementLogged: '库存变动记录成功',

        // 用户
        userCreated: '用户创建成功',
        userUpdated: '用户更新成功',
        userDeleted: '用户删除成功',
        cannotDeleteAdmin: '无法删除主管理员账号',

        // 设置
        settingsSaved: '设置保存成功',
        settingsRetrieved: '设置获取成功',

        // 班次
        sessionOpened: '班次开启成功',
        sessionAlreadyOpen: '您已有进行中的班次，请先交班',
        sessionClosed: '班次关闭成功',
        sessionNotFound: '没有可关闭的进行中班次',

        // 优惠券
        couponCreated: '优惠券创建成功',
        couponUpdated: '优惠券更新成功',
        couponDeleted: '优惠券删除成功',
        couponNotFound: '优惠券不存在',
        couponCodeExists: '该代码已被注册',
        couponInvalid: '优惠券无效',
        couponExpired: '优惠券已过期',
        couponUsedUp: '优惠券使用次数已达上限',
        couponMinOrder: '最低订单金额为',
        couponApplied: '优惠券使用成功',

        // 供应商
        supplierCreated: '供应商创建成功',
        supplierUpdated: '供应商更新成功',
        supplierDeleted: '供应商删除成功',
        supplierNotFound: '供应商不存在',

        // 采购订单
        purchaseOrderCreated: '采购订单创建成功',
        purchaseOrderUpdated: '采购订单更新成功',
        purchaseOrderDeleted: '采购订单删除成功',
        purchaseOrderNotFound: '采购订单不存在',
        // Subscription (v4.3)
        subscriptionRequestCreated: '订阅申请已发送 — 平台确认付款后即会激活',
        subscriptionRequestExists: '您已有一个待处理的申请 — 请等待回复或先取消',
        subscriptionInvalidPlan: '请求的套餐无效',
        subscriptionInvalidCycle: '无效的计费周期',
        subscriptionInvalidMethod: '无效的付款方式',
        subscriptionRequestNotFound: '未找到订阅申请',
        subscriptionAlreadyProcessed: '该申请已被处理',
        subscriptionApproved: '付款已确认，订阅激活成功',
        subscriptionRejected: '订阅申请已被拒绝',
        subscriptionCancelled: '订阅申请已取消',
        subscriptionExpired: '商店订阅已过期 — 请续订以继续使用系统',
        subscriptionApplied: '商店订阅更新成功',
    },

};

function getTranslation(key, lang = 'ar') {
    return translations[lang]?.[key] || translations['en'][key] || translations['ar'][key] || key;
}

module.exports = { getTranslation, translations };
