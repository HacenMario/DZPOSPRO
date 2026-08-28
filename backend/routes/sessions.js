// backend/routes/sessions.js
const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const { idParamValidation, paginationValidation } = require('../middleware/validator');

// Open a new session (any authenticated user — cashier included)
router.post('/', authMiddleware, sessionController.openSession);
router.get('/current', authMiddleware, sessionController.getCurrentSession);

// History / management
router.get('/', authMiddleware, roleMiddleware('admin', 'manager'), paginationValidation, sessionController.getSessions);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'manager'), idParamValidation, sessionController.getSessionById);
router.put('/:id/close', authMiddleware, idParamValidation, sessionController.closeSession);

module.exports = router;
