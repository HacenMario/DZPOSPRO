// backend/routes/sessions.js
const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

// Open a new session (any authenticated user — cashier included)
router.post('/', authMiddleware, tenantMiddleware, sessionController.openSession);
router.get('/current', authMiddleware, tenantMiddleware, sessionController.getCurrentSession);

// History / management
router.get('/', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, sessionController.getSessions);
router.get('/:id', authMiddleware, tenantMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, sessionController.getSessionById);
router.put('/:id/close', authMiddleware, tenantMiddleware, idParamValidation, sessionController.closeSession);

module.exports = router;
