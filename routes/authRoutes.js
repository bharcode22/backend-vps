const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/register - Registrasi user baru
router.post('/register', authController.register);

// POST /api/auth/login - Login user
router.post('/login', authController.login);

module.exports = router;
