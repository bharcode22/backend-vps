const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateApiKey } = require('../middlewares/auth');
const { uploadToDisk } = require('../middlewares/upload');

// POST /api/upload-stream/:downloadSessionId - Android sends file streams (multipart or raw binary)
router.post('/upload-stream/:downloadSessionId', uploadController.handleUploadStream);

// POST /api/upload - Direct upload from clients to VPS (Multer disk storage)
router.post('/upload', authenticateApiKey, uploadToDisk.single('file'), uploadController.handleDirectUpload);

module.exports = router;
