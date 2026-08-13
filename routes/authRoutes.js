const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/google - Login user dengan Google OAuth (Satu-satunya metode otentikasi)
router.post('/google', authController.googleLogin);

module.exports = router;
