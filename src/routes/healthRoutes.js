const express = require('express');
const { getDbHealth } = require('../controllers/healthController');

const router = express.Router();

router.get('/db', getDbHealth);

module.exports = router;