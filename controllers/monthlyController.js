const path = require('path');
const fs = require('fs');

// 1. GET /api/files/months - Mengambil daftar bulan yang tersedia dari berkas JSON hasil split
function getAvailableMonths(req, res) {
  // Path is resolved relative to backend/controllers, so we go up one directory
  const dirPath = path.join(__dirname, '..', 'json-management', 'split-monthly-camera');

  try {
    if (!fs.existsSync(dirPath)) {
      return res.json([]);
    }

    const files = fs.readdirSync(dirPath);
    const months = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort((a, b) => b.localeCompare(a)); // Urutkan terbaru dahulu (descending)

    res.json(months);
  } catch (err) {
    console.error('❌ Gagal membaca daftar bulan:', err.message);
    res.status(500).json({ error: 'Gagal mengambil daftar bulan', details: err.message });
  }
}

// 2. GET /api/files/monthly/:month - Mengambil data file untuk bulan tertentu
function getMonthlyFiles(req, res) {
  const { month } = req.params;

  // Validasi input untuk mencegah directory traversal attack
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Format bulan tidak valid. Harus format YYYY-MM' });
  }

  const filePath = path.join(__dirname, '..', 'json-management', 'split-monthly-camera', `${month}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Data untuk bulan ${month} tidak ditemukan` });
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawData);

    // Urutkan arsip bulanan berdasarkan mtime (modified time) secara descending (terbaru paling atas)
    if (Array.isArray(data)) {
      data.sort((a, b) => {
        const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
        const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
        return timeB - timeA;
      });
    }

    res.json(data);
  } catch (err) {
    console.error(`❌ Gagal membaca data bulan ${month}:`, err.message);
    res.status(500).json({ error: 'Gagal mengambil data bulanan', details: err.message });
  }
}

module.exports = {
  getAvailableMonths,
  getMonthlyFiles
};
