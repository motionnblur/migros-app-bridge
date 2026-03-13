const express = require('express');
const { listUsers, getUserById } = require('../controllers/userController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { requireSupportAccess } = require('../middlewares/authorizationMiddleware');

const router = express.Router();

router.use(authenticateToken);
router.use(requireSupportAccess);

router.get('/', listUsers);
router.get('/:id', getUserById);

module.exports = router;
