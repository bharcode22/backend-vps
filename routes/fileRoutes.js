const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { authenticateApiKey } = require('../middlewares/auth');

// GET /api/files - Menyeleksi berkas dari cache JSON lokal VPS (select & filter tgl)
router.get('/files', authenticateApiKey, fileController.getFiles);

// GET /api/files/get - Membaca metadata berkas spesifik dari cache JSON lokal VPS
router.get('/files/get', authenticateApiKey, fileController.getFileMetadata);

// GET /api/files/preview - Inisiasi request preview berkas dari HP menggunakan jalur path cache
router.get('/files/preview', authenticateApiKey, fileController.previewFileCached);

// GET /api/files/download - Inisiasi request download berkas penuh dari HP menggunakan jalur path cache
router.get('/files/download', authenticateApiKey, fileController.downloadFileCached);

// GET /api/files/json-list - Menampilkan daftar file JSON cache yang tersimpan di VPS
router.get('/files/json-list', authenticateApiKey, fileController.getJsonList);

// GET /api/files/json-get - Membaca isi berkas JSON cache spesifik di VPS
router.get('/files/json-get', authenticateApiKey, fileController.getJsonContent);

// GET /api/vps/files - Menampilkan daftar berkas fisik terkompresi yang tersimpan di VPS
router.get('/vps/files', authenticateApiKey, fileController.getVpsFiles);

// GET /api/vps/files/download - Mengunduh berkas fisik terkompresi langsung dari VPS disk
router.get('/vps/files/download', authenticateApiKey, fileController.downloadVpsFile);

module.exports = router;
