const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/register - Registrasi user baru
router.post('/register', authController.register);

// POST /api/auth/login - Login user dengan username & password
router.post('/login', authController.login);

// POST /api/auth/google - Login user dengan Google OAuth
router.post('/google', authController.googleLogin);

module.exports = router;
