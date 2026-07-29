const fs = require('fs');
const pendingDownloads = require('../utils/pendingDownloads');
const { upload } = require('../middlewares/upload');

// 1. POST /api/upload-stream/:downloadSessionId - Android sends file streams (multipart or raw binary)
function handleUploadStream(req, res) {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    // Run Multer parser to stream the multipart file
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error(`❌ Multer error: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
      res.status(200).json({ status: 'success', message: 'File streamed successfully (multipart)' });
    });
  } else {
    // Raw binary stream path (for mock scripts / direct streams)
    const { downloadSessionId } = req.params;
    const pending = pendingDownloads.get(downloadSessionId);

    if (!pending) {
      console.warn(`⚠️  Menerima upload untuk session kadaluarsa/tidak valid: ${downloadSessionId}`);
      return res.status(404).json({ error: 'Session download kadaluarsa atau tidak valid' });
    }

    const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath, isJsonResponse, isStreamResponse } = pending;
    clearTimeout(timer);

    if (saveToDisk && targetDiskPath) {
      console.log(`💾 (Raw) Menyimpan data file "${fileName}" ke disk VPS (${targetDiskPath})`);
      const writeStream = fs.createWriteStream(targetDiskPath);
      req.pipe(writeStream);

      if (isStreamResponse && browserRes) {
        console.log(`🚀 (Raw) Sekaligus mengalirkan data file "${fileName}" ke Browser (Session: ${downloadSessionId})`);
        req.pipe(browserRes);
      }

      req.on('end', () => {
        console.log(`✅ (Raw) Sukses menyimpan file di VPS: ${targetDiskPath}`);
        pendingDownloads.delete(downloadSessionId);
        res.status(200).json({ status: 'success', message: 'File saved successfully on VPS (raw)' });

        if (isJsonResponse && browserRes) {
          // Send success back to the initial browser request
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

      req.on('error', (err) => {
        console.error(`❌ (Raw) Gagal menyimpan ke disk VPS:`, err.message);
        fs.unlink(targetDiskPath, () => {});
        pendingDownloads.delete(downloadSessionId);
        res.status(500).json({ error: 'Stream interrupted' });
        if (browserRes) {
          if (isJsonResponse) {
            browserRes.status(500).json({ error: 'Gagal menulis file ke disk VPS', details: err.message });
          } else {
            browserRes.end('Error saat mengunduh file.');
          }
        }
      });
    } else {
      console.log(`🚀 (Raw) Mengalirkan data file "${fileName}" dari Android langsung ke Browser (Session: ${downloadSessionId})`);

      // Pipe stream from Android request directly to browser response
      req.pipe(browserRes);

      req.on('end', () => {
        console.log(`✅ (Raw) Transfer file "${fileName}" selesai.`);
        pendingDownloads.delete(downloadSessionId);
        res.status(200).json({ status: 'success', message: 'File streamed successfully (raw)' });
      });

      req.on('error', (err) => {
        console.error(`❌ (Raw) Error saat streaming file "${fileName}":`, err.message);
        browserRes.end('Error saat mengunduh file dari perangkat.');
        pendingDownloads.delete(downloadSessionId);
        res.status(500).json({ error: 'Stream interrupted' });
      });

      // Handle browser closed prematurely
      browserRes.on('close', () => {
        if (pendingDownloads.has(downloadSessionId)) {
          console.warn(`🔌 Koneksi browser terputus untuk session ${downloadSessionId}`);
          req.destroy(); // stop upload from device
          pendingDownloads.delete(downloadSessionId);
        }
      });
    }
  }
}

// 2. POST /api/upload - Direct upload from clients to VPS
function handleDirectUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
  }

  const host = req.get('host');
  const protocol = req.protocol;
  const downloadUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  console.log(`📥 File sukses disimpan di VPS: ${req.file.path}`);
  res.json({
    status: 'success',
    message: 'File berhasil diunggah ke VPS',
    file: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
      downloadUrl: downloadUrl
    }
  });
}

module.exports = {
  handleUploadStream,
  handleDirectUpload
};
