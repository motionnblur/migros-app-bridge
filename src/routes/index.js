const express = require('express');
const { getApiHealth } = require('../controllers/healthController');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const healthRoutes = require('./healthRoutes');

const router = express.Router();

router.get('/', getApiHealth);
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

module.exports = router;