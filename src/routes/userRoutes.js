const express = require('express');
const { listUsers, getUserById } = require('../controllers/userController');

const router = express.Router();

router.get('/', listUsers);
router.get('/:id', getUserById);

module.exports = router;