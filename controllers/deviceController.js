const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const socketModule = require('../socket');
const pendingDownloads = require('../utils/pendingDownloads');

// 1. GET /api/devices - Melihat daftar perangkat
async function getDevices(req, res) {
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
}

// 2. GET /api/devices/:deviceId/files - Meminta daftar file dari Android
async function getDeviceFiles(req, res) {
  const { deviceId } = req.params;
  const folder = req.query.folder || 'DCIM';
  const { date } = req.query; // format: YYYY-MM-DD

  try {
    console.log(`🔍 Meminta daftar file folder "${folder}" dari device ${deviceId}`);
    let files = await socketModule.sendDeviceCommand(deviceId, 'LIST_FILES', { folder });

    // Urutkan file berdasarkan mtime (modified time) secara descending (terbaru paling atas)
    if (Array.isArray(files)) {
      // Simpan respon ke VPS local storage dalam bentuk JSON berkelompok per tanggal (device_id-DCIM/Camera/tgl)
      try {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const targetDir = path.join(uploadDir, `${deviceId}-${folder}`);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // Simpan seluruh response asli tanpa filter tanggal ke 'all.json'
        const allFilePath = path.join(targetDir, 'all.json');
        fs.writeFileSync(allFilePath, JSON.stringify(files, null, 2), 'utf8');
        console.log(`💾 Sukses menyimpan seluruh response di VPS: ${allFilePath}`);

        const groups = {};
        for (const file of files) {
          let dateStr = 'no-date';
          if (file.mtime) {
            try {
              const d = new Date(file.mtime);
              if (!isNaN(d.getTime())) {
                const localYear = d.getFullYear();
                const localMonth = String(d.getMonth() + 1).padStart(2, '0');
                const localDay = String(d.getDate()).padStart(2, '0');
                dateStr = `${localYear}-${localMonth}-${localDay}`;
              }
            } catch (e) {}
          }

          if (!groups[dateStr]) {
            groups[dateStr] = [];
          }
          groups[dateStr].push(file);
        }

        for (const [dateStr, groupFiles] of Object.entries(groups)) {
          const filePath = path.join(targetDir, `${dateStr}.json`);
          fs.writeFileSync(filePath, JSON.stringify(groupFiles, null, 2), 'utf8');
          console.log(`💾 Sukses menyimpan cache JSON di VPS: ${filePath} (${groupFiles.length} berkas)`);
        }
      } catch (saveErr) {
        console.error('❌ Gagal menyimpan cache JSON berkas di VPS:', saveErr.message);
      }

      files.sort((a, b) => {
        const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
        const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
        return timeB - timeA;
      });

      // Filter berdasarkan tanggal jika parameter date disediakan
      if (date) {
        files = files.filter(file => {
          if (!file.mtime) return false;
          try {
            const d = new Date(file.mtime);
            if (isNaN(d.getTime())) return false;

            // Format ke YYYY-MM-DD UTC
            const isoDate = d.toISOString().split('T')[0];

            // Format ke YYYY-MM-DD Local
            const localYear = d.getFullYear();
            const localMonth = String(d.getMonth() + 1).padStart(2, '0');
            const localDay = String(d.getDate()).padStart(2, '0');
            const localDateStr = `${localYear}-${localMonth}-${localDay}`;

            return isoDate === date || localDateStr === date;
          } catch (e) {
            return false;
          }
        });
      }
    }

    // Catat ke log akses
    await db.logAccess(deviceId, folder, 'LIST_FILES');

    res.json(files);
  } catch (err) {
    res.status(504).json({ error: 'Gagal mendapatkan daftar file dari perangkat', details: err.message });
  }
}

// 3. GET /api/devices/:deviceId/download - Inisiasi download file
async function downloadDeviceFile(req, res) {
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

  // Set timeout 30 detik
  const timer = setTimeout(() => {
    if (pendingDownloads.has(downloadSessionId)) {
      console.warn(`⏳ Download session ${downloadSessionId} timeout.`);
      const pending = pendingDownloads.get(downloadSessionId);
      pending.res.status(504).end('Gateway Timeout: Perangkat tidak mengirimkan file.');
      pendingDownloads.delete(downloadSessionId);
    }
  }, 30000);

  pendingDownloads.set(downloadSessionId, { res, timer, fileName });

  try {
    await socketModule.sendDeviceCommand(deviceId, 'GET_FILE', {
      path: filePath,
      downloadSessionId
    });

    await db.logAccess(deviceId, fileName, 'DOWNLOAD_FILE');
  } catch (err) {
    console.error(`❌ Gagal mengirim perintah GET_FILE ke device: ${err.message}`);
    clearTimeout(timer);
    pendingDownloads.delete(downloadSessionId);
    res.status(500).end(`Gagal mengunduh file: ${err.message}`);
  }
}

// 4. GET /api/devices/:deviceId/preview - Inisiasi stream preview terkompresi
async function previewDeviceFile(req, res) {
  const { deviceId } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
  }

  const fileName = path.basename(filePath);
  const fileExtension = path.extname(filePath).toLowerCase();

  let contentType = 'image/jpeg';
  if (fileExtension === '.png') {
    contentType = 'image/png';
  } else if (fileExtension === '.gif') {
    contentType = 'image/gif';
  } else if (fileExtension === '.webp') {
    contentType = 'image/webp';
  }

  const downloadSessionId = crypto.randomBytes(16).toString('hex');

  console.log(`👁️  Browser meminta preview: "${filePath}" (Session: ${downloadSessionId})`);

  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Type', contentType);

  const timer = setTimeout(() => {
    if (pendingDownloads.has(downloadSessionId)) {
      console.warn(`⏳ Preview session ${downloadSessionId} timeout.`);
      const pending = pendingDownloads.get(downloadSessionId);
      pending.res.status(504).end('Gateway Timeout: Perangkat tidak mengirimkan preview.');
      pendingDownloads.delete(downloadSessionId);
    }
  }, 30000);

  pendingDownloads.set(downloadSessionId, { res, timer, fileName });

  try {
    await socketModule.sendDeviceCommand(deviceId, 'GET_PREVIEW', {
      path: filePath,
      downloadSessionId
    });

    await db.logAccess(deviceId, fileName, 'PREVIEW_FILE');
  } catch (err) {
    console.error(`❌ Gagal mengirim perintah GET_PREVIEW ke device: ${err.message}`);
    clearTimeout(timer);
    pendingDownloads.delete(downloadSessionId);
    res.status(500).end(`Gagal memuat preview gambar: ${err.message}`);
  }
}

// 5. GET /api/devices/:deviceId/fetch-to-vps - Mengambil file dari Android dan menyimpannya di disk VPS
async function fetchDeviceFileToVps(req, res) {
  const { deviceId } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
  }

  const fileName = path.basename(filePath);
  const downloadSessionId = crypto.randomBytes(16).toString('hex');
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const targetDiskPath = path.join(uploadDir, Date.now() + '-' + fileName);

  console.log(`📥 Meminta pengambilan file: "${filePath}" untuk disimpan di VPS (Session: ${downloadSessionId})`);

  const timer = setTimeout(() => {
    if (pendingDownloads.has(downloadSessionId)) {
      console.warn(`⏳ Fetch session ${downloadSessionId} timeout.`);
      const pending = pendingDownloads.get(downloadSessionId);
      pending.res.status(504).json({ error: 'Gateway Timeout: Perangkat tidak merespon.' });
      pendingDownloads.delete(downloadSessionId);
    }
  }, 30000);

  pendingDownloads.set(downloadSessionId, { res, timer, fileName, saveToDisk: true, targetDiskPath });

  try {
    await socketModule.sendDeviceCommand(deviceId, 'GET_FILE', {
      path: filePath,
      downloadSessionId
    });

    await db.logAccess(deviceId, fileName, 'FETCH_TO_VPS');
  } catch (err) {
    console.error(`❌ Gagal mengirim perintah GET_FILE ke device: ${err.message}`);
    clearTimeout(timer);
    pendingDownloads.delete(downloadSessionId);
    res.status(500).json({ error: `Gagal meminta pengambilan file: ${err.message}` });
  }
}

module.exports = {
  getDevices,
  getDeviceFiles,
  downloadDeviceFile,
  previewDeviceFile,
  fetchDeviceFileToVps
};
