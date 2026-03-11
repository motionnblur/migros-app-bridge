const express = require('express');
const { login, me } = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.get('/me', authenticateToken, me);

module.exports = router;