const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const socketModule = require('./socket');

// Map untuk melacak request download yang tertunda (pending)
// Key: downloadSessionId, Value: { res, timer, fileName }
const pendingDownloads = new Map();

// Middleware Autentikasi untuk HTTP API
const apiKey = process.env.API_KEY || 'super-secret-key-123';
function authenticateApiKey(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;

  if (token !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized: API Key invalid' });
  }
  next();
}

// 1. GET /api/devices - Melihat daftar perangkat
router.get('/devices', authenticateApiKey, async (req, res) => {
  try {
    const devices = await db.getDevices();

    // Sinkronkan status online real-time dari Socket.IO activeDevices
    const activeDeviceIds = socketModule.getActiveDevicesList();

    const augmentedDevices = devices.map(device => ({
      ...device,
      status: activeDeviceIds.includes(device.id) ? 'online' : 'offline'
    }));

    res.json(augmentedDevices);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil daftar perangkat', details: err.message });
  }
});

// 2. GET /api/devices/:deviceId/files - Meminta daftar file dari Android
router.get('/devices/:deviceId/files', authenticateApiKey, async (req, res) => {
  const { deviceId } = req.params;
  const folder = req.query.folder || 'DCIM';

  try {
    console.log(`🔍 Meminta daftar file folder "${folder}" dari device ${deviceId}`);
    const files = await socketModule.sendDeviceCommand(deviceId, 'LIST_FILES', { folder });

    // Catat ke log akses
    await db.logAccess(deviceId, folder, 'LIST_FILES');

    res.json(files);
  } catch (err) {
    res.status(504).json({ error: 'Gagal mendapatkan daftar file dari perangkat', details: err.message });
  }
});

// 3. GET /api/devices/:deviceId/download - Inisiasi download file
router.get('/devices/:deviceId/download', authenticateApiKey, async (req, res) => {
  const { deviceId } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
  }

  const fileName = path.basename(filePath);
  const downloadSessionId = crypto.randomBytes(16).toString('hex');

  console.log(`📥 Browser meminta download: "${filePath}" (Session: ${downloadSessionId})`);

  // Set header untuk memicu download di browser
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  // Set timeout 30 detik. Jika HP tidak merespon/kirim file, batalkan request.
  const timer = setTimeout(() => {
    if (pendingDownloads.has(downloadSessionId)) {
      console.warn(`⏳ Download session ${downloadSessionId} timeout.`);
      const pending = pendingDownloads.get(downloadSessionId);
      pending.res.status(504).end('Gateway Timeout: Perangkat tidak mengirimkan file.');
      pendingDownloads.delete(downloadSessionId);
    }
  }, 30000);

  // Simpan response object browser agar bisa di-pipe nanti
  pendingDownloads.set(downloadSessionId, { res, timer, fileName });

  try {
    // Kirim instruksi ke HP Android untuk mengirim file
    await socketModule.sendDeviceCommand(deviceId, 'GET_FILE', {
      path: filePath,
      downloadSessionId
    });

    // Catat ke log akses
    await db.logAccess(deviceId, fileName, 'DOWNLOAD_FILE');
  } catch (err) {
    console.error(`❌ Gagal mengirim perintah GET_FILE ke device: ${err.message}`);
    clearTimeout(timer);
    pendingDownloads.delete(downloadSessionId);

    // Response headers sudah diset, ganti status dan kirim pesan error
    res.status(500).end(`Gagal mengunduh file: ${err.message}`);
  }
});

const multer = require('multer');

// Custom storage engine untuk Multer agar mengalirkan file multipart langsung (streaming) ke browser
const streamStorage = {
  _handleFile(req, file, cb) {
    const { downloadSessionId } = req.params;
    const pending = pendingDownloads.get(downloadSessionId);
    
    if (!pending) {
      return cb(new Error('Session download tidak ditemukan atau kadaluarsa'));
    }
    
    const { res: browserRes, timer, fileName } = pending;
    clearTimeout(timer);
    
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
  },
  _removeFile(req, file, cb) {
    cb(null);
  }
};

const upload = multer({ storage: streamStorage });

// 4. POST /api/upload-stream/:downloadSessionId - Endpoint untuk Android mengirim stream file
router.post('/upload-stream/:downloadSessionId', (req, res) => {
  const contentType = req.headers['content-type'] || '';
  
  if (contentType.includes('multipart/form-data')) {
    // Jalankan multer parser untuk mengalirkan file multipart
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error(`❌ Multer error: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
      res.status(200).json({ status: 'success', message: 'File streamed successfully (multipart)' });
    });
  } else {
    // Alur raw binary stream biasa (untuk simulasi / test script)
    const { downloadSessionId } = req.params;
    const pending = pendingDownloads.get(downloadSessionId);

    if (!pending) {
      console.warn(`⚠️  Menerima upload untuk session kadaluarsa/tidak valid: ${downloadSessionId}`);
      return res.status(404).json({ error: 'Session download kadaluarsa atau tidak valid' });
    }

    const { res: browserRes, timer, fileName } = pending;
    clearTimeout(timer);

    console.log(`🚀 (Raw) Mengalirkan data file "${fileName}" dari Android langsung ke Browser (Session: ${downloadSessionId})`);

    // Pipe stream request dari Android langsung ke response Browser
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

    // Jika koneksi browser terputus secara tidak sengaja
    browserRes.on('close', () => {
      if (pendingDownloads.has(downloadSessionId)) {
        console.warn(`🔌 Koneksi browser terputus untuk session ${downloadSessionId}`);
        req.destroy(); // Hentikan upload dari HP
        pendingDownloads.delete(downloadSessionId);
      }
    });
  }
});

module.exports = router;
