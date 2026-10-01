// backend/routes/stores.js — super-admin platform routes.
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const storeController = require('../controllers/storeController');

router.use(authMiddleware, roleMiddleware('superadmin'));
router.get('/', storeController.list);
router.get('/platform-stats', storeController.platformStats);
router.get('/platform-overview', storeController.platformOverview);
router.post('/', storeController.create);
router.get('/:id', storeController.getDetails);
router.get('/:id/users', storeController.listUsers);
router.post('/:id/users', storeController.addUser);
router.patch('/:id/users/:userId', storeController.patchStoreUser);
router.delete('/:id/users/:userId', storeController.removeStoreUser);
router.post('/:id/extend-trial', storeController.extendTrial);
router.post('/:id/login-as', storeController.loginAs);
router.put('/:id', storeController.update);
router.delete('/:id', storeController.remove);

module.exports = router;
