// backend/routes/ai.js — Gemini AI features (admin + manager).
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const upload = require('./../middleware/upload');
const controller = require('../controllers/aiController');

router.use(authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'));

router.get('/status', controller.status);
router.post('/ask', controller.ask);
router.post('/ocr-invoice', (req, res, next) => {
    // single image upload — field name "image"
    upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
        next();
    });
}, controller.ocrInvoice);
router.get('/forecast', controller.forecast);
router.get('/anomalies', controller.anomalies);
router.post('/daily-summary', controller.dailySummary);

module.exports = router;
