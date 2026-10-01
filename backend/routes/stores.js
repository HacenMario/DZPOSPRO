// backend/routes/stores.js — super-admin platform routes.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const storeController = require('../controllers/storeController');

router.use(authMiddleware, roleMiddleware('superadmin'));
router.get('/', storeController.list);
router.get('/platform-stats', storeController.platformStats);
router.post('/', storeController.create);
router.put('/:id', storeController.update);
router.delete('/:id', storeController.remove);
router.post('/:id/users', storeController.addUser);

module.exports = router;
