const express = require('express');
const { getApiHealth } = require('../controllers/healthController');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const healthRoutes = require('./healthRoutes');
const internalEventsRoutes = require('./internalEventsRoutes');

const router = express.Router();

router.get('/', getApiHealth);
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/internal/events', internalEventsRoutes);

module.exports = router;
