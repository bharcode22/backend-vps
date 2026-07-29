const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pendingDownloads = require('../utils/pendingDownloads');

// Custom storage engine untuk Multer agar mengalirkan file multipart langsung (streaming) ke browser / disk VPS
const streamStorage = {
  _handleFile(req, file, cb) {
    const { downloadSessionId } = req.params;
    const pending = pendingDownloads.get(downloadSessionId);

    if (!pending) {
      return cb(new Error('Session download tidak ditemukan atau kadaluarsa'));
    }

    const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath, isJsonResponse, isStreamResponse } = pending;
    clearTimeout(timer);

    if (saveToDisk && targetDiskPath) {
      console.log(`💾 (Multipart) Menyimpan file "${fileName}" dari Android ke disk VPS (${targetDiskPath})...`);
      const writeStream = fs.createWriteStream(targetDiskPath);
      file.stream.pipe(writeStream);

      // Jika minta stream langsung ke browser (misal preview/download)
      if (isStreamResponse && browserRes) {
        console.log(`🚀 (Multipart) Sekaligus mengalirkan file "${fileName}" ke Browser (Session: ${downloadSessionId})...`);
        file.stream.pipe(browserRes);
      }

      file.stream.on('end', () => {
        console.log(`✅ (Multipart) Sukses menyimpan file di VPS: ${targetDiskPath}`);
        pendingDownloads.delete(downloadSessionId);
        cb(null, { status: 'success' });

        if (isJsonResponse && browserRes) {
          // Kirim respon sukses ke pemanggil awal
          browserRes.json({
            status: 'success',
            message: 'File berhasil diambil dari perangkat dan disimpan di VPS',
            file: {
              originalName: fileName,
              path: targetDiskPath
            }
          });
        }
      });

      file.stream.on('error', (err) => {
        console.error(`❌ (Multipart) Gagal menyimpan ke disk VPS: ${err.message}`);
        fs.unlink(targetDiskPath, () => { }); // Hapus file parsial jika gagal
        pendingDownloads.delete(downloadSessionId);
        cb(err);
        if (browserRes) {
          if (isJsonResponse) {
            browserRes.status(500).json({ error: 'Gagal menulis file ke disk VPS', details: err.message });
          } else {
            browserRes.end('Error saat mengunduh file.');
          }
        }
      });
    } else {
      console.log(`🚀 (Multipart) Mengalirkan file "${fileName}" dari Android langsung ke Browser (Session: ${downloadSessionId})...`);
      file.stream.pipe(browserRes);

      file.stream.on('end', () => {
        console.log(`✅ (Multipart) Transfer file selesai untuk session: ${downloadSessionId}`);
        pendingDownloads.delete(downloadSessionId);
        cb(null, { status: 'success' });
      });

      file.stream.on('error', (err) => {
        console.error(`❌ (Multipart) Error transfer: ${err.message}`);
        browserRes.end('Error saat mengunduh file.');
        pendingDownloads.delete(downloadSessionId);
        cb(err);
      });
    }
  },
  _removeFile(req, file, cb) {
    cb(null);
  }
};

const upload = multer({ storage: streamStorage });

// Direct file upload to VPS
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedBase = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${sanitizedBase}-${uniqueSuffix}${ext}`);
  }
});

// Allowed file types filter
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|gif|webp|pdf|docx|xlsx|txt|zip/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

  if (allowedExtensions.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file .${ext} tidak diizinkan untuk di-upload.`));
  }
};

const uploadToDisk = multer({
  storage: diskStorage,
  limits: {
    fileSize: 200 * 1024 * 1024 // Max 200MB
  },
  fileFilter: fileFilter
});

module.exports = {
  upload,
  uploadToDisk
};
