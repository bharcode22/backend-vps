const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');

/**
 * GET /api/system/metrics
 * Mengambil metrik sistem server Node.js: Disk, Memory, CPU, Uptime
 */
router.get('/metrics', (req, res) => {
  try {
    // 1. Memory Usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercentage = totalMem > 0 ? parseFloat(((usedMem / totalMem) * 100).toFixed(1)) : 0;
    const processMem = process.memoryUsage();

    // 2. Disk Storage Usage
    let diskInfo = null;
    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync('/');
        const bsize = stats.bsize || stats.frsize || 4096;
        const totalDisk = stats.blocks * bsize;
        const freeDisk = stats.bavail * bsize;
        const usedDisk = totalDisk - freeDisk;
        const diskPercentage = totalDisk > 0 ? parseFloat(((usedDisk / totalDisk) * 100).toFixed(1)) : 0;

        diskInfo = {
          total: totalDisk,
          used: usedDisk,
          free: freeDisk,
          percentage: diskPercentage
        };
      }
    } catch (diskErr) {
      console.warn('Gagal mengambil statfs disk:', diskErr.message);
    }

    if (!diskInfo) {
      diskInfo = {
        total: 0,
        used: 0,
        free: 0,
        percentage: 0,
        unsupported: true
      };
    }

    // 3. CPU Info & Load Avg
    const cpus = os.cpus() || [];
    const cpuCount = cpus.length;
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
    const loadAvg = os.loadavg();

    // 4. System & Process Info
    const systemMetrics = {
      system: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        uptime: os.uptime(),
        processUptime: process.uptime()
      },
      cpu: {
        cores: cpuCount,
        model: cpuModel,
        loadavg: loadAvg.map(val => parseFloat(val.toFixed(2)))
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percentage: memPercentage,
        processRss: processMem.rss,
        heapUsed: processMem.heapUsed,
        heapTotal: processMem.heapTotal
      },
      disk: diskInfo
    };

    res.json(systemMetrics);
  } catch (err) {
    console.error('Error fetching system metrics:', err);
    res.status(500).json({ error: 'Gagal mengambil metrik sistem server' });
  }
});

module.exports = router;
