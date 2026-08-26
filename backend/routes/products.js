// backend/routes/products.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const upload = require('../middleware/upload');
const { productValidation, idParamValidation, paginationValidation } = require('../middleware/validator');

// NOTE: only ONE definition per verb+path (the old duplicate-route bug is gone).
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
