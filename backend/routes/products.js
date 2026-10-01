// backend/routes/products.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const upload = require('../middleware/upload');
const { productValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

// CSV upload (memory storage) for the products import — kept separate from
// the image upload middleware. Invalid files are rejected silently (null);
// the controller then answers 400 with a friendly message.
const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        const type = (file.mimetype || '').toLowerCase();
        if (name.endsWith('.csv') || type.includes('csv') || type === 'text/plain' || type === 'application/vnd.ms-excel') {
            return cb(null, true);
        }
        return cb(null, false);
    }
});

// NOTE: only ONE definition per verb+path (the old duplicate-route bug is gone).
// /export and /import must come BEFORE /:id so they are not captured by it.
router.get('/export', authMiddleware, tenantMiddleware, productController.exportProducts);
router.post('/import', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), csvUpload.single('file'), productController.importProducts);
router.get('/', authMiddleware, tenantMiddleware, paginationValidation, productController.getProducts);
router.get('/low-stock', authMiddleware, tenantMiddleware, productController.getLowStockProducts);
router.get('/barcode/:barcode', authMiddleware, tenantMiddleware, productController.getProductByBarcode);
router.get('/:id', authMiddleware, tenantMiddleware, idParamValidation, productController.getProductById);

router.post(
    '/',
    authMiddleware, tenantMiddleware,
    roleMiddleware('admin', 'manager'),
    upload.array('images', 5),
    productValidation,
    productController.createProduct
);

router.put(
    '/:id',
    authMiddleware, tenantMiddleware,
    roleMiddleware('admin', 'manager'),
    upload.array('images', 5),
    idParamValidation,
    productController.updateProduct
);

router.patch('/:id/stock', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, productController.updateStock);
router.delete('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin'), idParamValidation, productController.deleteProduct);

module.exports = router;
