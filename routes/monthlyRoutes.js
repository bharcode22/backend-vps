const express = require('express');
const router = express.Router();
const monthlyController = require('../controllers/monthlyController');
const { authenticateApiKey } = require('../middlewares/auth');

// GET /api/files/months - Mengambil daftar bulan yang tersedia dari berkas JSON hasil split
router.get('/files/months', authenticateApiKey, monthlyController.getAvailableMonths);

// GET /api/files/monthly/:month - Mengambil data file untuk bulan tertentu
router.get('/files/monthly/:month', authenticateApiKey, monthlyController.getMonthlyFiles);

module.exports = router;
