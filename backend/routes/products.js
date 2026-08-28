// backend/routes/products.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
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
router.get('/export', authMiddleware, productController.exportProducts);
router.post('/import', authMiddleware, roleMiddleware('admin', 'manager'), csvUpload.single('file'), productController.importProducts);
router.get('/', authMiddleware, paginationValidation, productController.getProducts);
router.get('/low-stock', authMiddleware, productController.getLowStockProducts);
router.get('/barcode/:barcode', authMiddleware, productController.getProductByBarcode);
router.get('/:id', authMiddleware, idParamValidation, productController.getProductById);

router.post(
    '/',
    authMiddleware,
    roleMiddleware('admin', 'manager'),
    upload.array('images', 5),
    productValidation,
    productController.createProduct
);

router.put(
    '/:id',
    authMiddleware,
    roleMiddleware('admin', 'manager'),
    upload.array('images', 5),
    idParamValidation,
    productController.updateProduct
);

router.patch('/:id/stock', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, productController.updateStock);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), idParamValidation, productController.deleteProduct);

module.exports = router;
