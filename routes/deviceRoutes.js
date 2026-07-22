const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { authenticateApiKey } = require('../middlewares/auth');

// GET /api/devices - Melihat daftar perangkat
router.get('/devices', authenticateApiKey, deviceController.getDevices);

// GET /api/devices/:deviceId/files - Meminta daftar file dari Android
router.get('/devices/:deviceId/files', authenticateApiKey, deviceController.getDeviceFiles);

// GET /api/devices/:deviceId/download - Inisiasi download file
router.get('/devices/:deviceId/download', authenticateApiKey, deviceController.downloadDeviceFile);

// GET /api/devices/:deviceId/preview - Inisiasi stream preview terkompresi
router.get('/devices/:deviceId/preview', authenticateApiKey, deviceController.previewDeviceFile);

// GET /api/devices/:deviceId/fetch-to-vps - Mengambil file dari Android dan menyimpannya di disk VPS
router.get('/devices/:deviceId/fetch-to-vps', authenticateApiKey, deviceController.fetchDeviceFileToVps);

// DELETE /api/devices/:deviceId - Menghapus perangkat dan seluruh file/folder terkait di VPS
router.delete('/devices/:deviceId', authenticateApiKey, deviceController.deleteDevice);

module.exports = router;
