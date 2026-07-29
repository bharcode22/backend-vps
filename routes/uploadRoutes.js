const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateApiKey } = require('../middlewares/auth');
const { uploadToDisk } = require('../middlewares/upload');

// POST /api/upload-stream/:downloadSessionId - Android sends file streams (multipart or raw binary)
router.post('/upload-stream/:downloadSessionId', uploadController.handleUploadStream);

// GET /api/upload/files - List all uploaded files from DB/memory
router.get('/upload/files', uploadController.getUploadedFilesList);

// POST /api/upload - Direct upload from clients to VPS (Multer disk storage)
router.post('/upload', authenticateApiKey, uploadToDisk.single('file'), uploadController.handleDirectUpload);

// PUT /api/upload/files/:id - Update existing file (replace file content keeping same URL)
router.put('/upload/files/:id', authenticateApiKey, uploadToDisk.single('file'), uploadController.handleUpdateFile);

// DELETE /api/upload/files/:id - Delete file physically and from DB
router.delete('/upload/files/:id', authenticateApiKey, uploadController.handleDeleteFile);

module.exports = router;
