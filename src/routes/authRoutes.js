const express = require('express');
const { login, me } = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { enforceLoginRateLimit } = require('../middlewares/loginRateLimitMiddleware');

const router = express.Router();

router.post('/login', enforceLoginRateLimit, login);
router.get('/me', authenticateToken, me);

module.exports = router;
