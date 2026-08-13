const fs = require('fs');
const pendingDownloads = require('../utils/pendingDownloads');
const { upload } = require('../middlewares/upload');
const db = require('../db');

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
        fs.unlink(targetDiskPath, () => { });
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
async function handleDirectUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
  }

  const host = req.get('x-forwarded-host') || req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const downloadUrl = `${protocol}://${host}/upload-file/${req.file.filename}`;

  console.log(`📥 File sukses disimpan di VPS (folder upload-file): ${req.file.path}`);

  const fileData = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
    path: req.file.path,
    downloadUrl: downloadUrl
  };

  // Simpan record metadata file ke Database / memory
  const savedRecord = await db.saveUploadedFile(fileData);

  res.json({
    status: 'success',
    message: 'File berhasil diunggah ke VPS',
    file: savedRecord || fileData
  });
}

// 3. GET /api/upload/files - List all uploaded files
async function getUploadedFilesList(req, res) {
  try {
    const files = await db.getUploadedFiles();
    const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol;

    const formattedFiles = files.map(file => {
      let downloadUrl = file.downloadUrl;
      if (downloadUrl && (reqProtocol === 'https' || req.secure)) {
        if (downloadUrl.startsWith('http://')) {
          downloadUrl = downloadUrl.replace(/^http:\/\//, 'https://');
        }
      }
      return { ...file, downloadUrl };
    });

    res.json({
      status: 'success',
      data: formattedFiles
    });
  } catch (err) {
    console.error('❌ Gagal mengambil daftar uploaded files:', err.message);
    res.status(500).json({ error: 'Gagal mengambil daftar file terunggah' });
  }
}

// 4. PUT /api/upload/files/:id - Replace existing file while keeping exact same download URL
async function handleUpdateFile(req, res) {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'Tidak ada file baru yang diunggah untuk penggantian' });
    }

    const existing = await db.findUploadedFileById(id);
    if (!existing) {
      // Hapus file temp multer jika record tidak ditemukan
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'File tidak ditemukan di database' });
    }

    // Overwrite file fisik di disk dengan file baru (menggunakan path fisik yang sama)
    if (fs.existsSync(existing.path)) {
      fs.copyFileSync(req.file.path, existing.path);
      // Hapus file temp dari multer
      fs.unlinkSync(req.file.path);
    } else {
      // Jika file fisik lama tidak ditemukan di disk, pindahkan file temp ke lokasi existing.path
      fs.renameSync(req.file.path, existing.path);
    }

    // Update metadata di Database (downloadUrl dan filename TETAP SAMA)
    const updatePayload = {
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      path: existing.path,
      downloadUrl: existing.downloadUrl
    };

    const updatedRecord = await db.updateUploadedFile(existing.id || id, updatePayload);

    console.log(`🔄 File ID ${id} (${existing.filename}) berhasil diperbarui dengan isi file baru.`);
    res.json({
      status: 'success',
      message: 'File berhasil diperbarui (URL download tetap sama)',
      file: updatedRecord || { ...existing, ...updatePayload }
    });
  } catch (err) {
    console.error('❌ Error saat update file:', err.message);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Gagal memperbarui file' });
  }
}

// 5. DELETE /api/upload/files/:id - Delete file physically & from DB
async function handleDeleteFile(req, res) {
  try {
    const { id } = req.params;
    const existing = await db.findUploadedFileById(id);

    if (!existing) {
      return res.status(404).json({ error: 'File tidak ditemukan' });
    }

    // Hapus file fisik dari disk VPS
    if (existing.path && fs.existsSync(existing.path)) {
      try {
        fs.unlinkSync(existing.path);
        console.log(`🗑️  File fisik terhapus dari VPS: ${existing.path}`);
      } catch (e) {
        console.warn(`⚠️  Gagal menghapus file fisik ${existing.path}:`, e.message);
      }
    }

    // Hapus metadata dari DB
    await db.deleteUploadedFile(existing.id || id);

    res.json({
      status: 'success',
      message: 'File berhasil dihapus'
    });
  } catch (err) {
    console.error('❌ Error saat menghapus file:', err.message);
    res.status(500).json({ error: 'Gagal menghapus file' });
  }
}

module.exports = {
  handleUploadStream,
  handleDirectUpload,
  getUploadedFilesList,
  handleUpdateFile,
  handleDeleteFile
};
