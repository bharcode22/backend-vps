const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
let prisma = null;
let dbEnabled = false;

// In-memory fallback structures
const memoryDevices = new Map();
const memoryLogs = [];

// Helper untuk menyelaraskan properti camelCase (Prisma) dan snake_case (Legacy/Postgres)
function formatDevice(device) {
  if (!device) return null;
  const lastSeen = device.lastSeen || device.last_seen;
  const createdAt = device.createdAt || device.created_at;
  return {
    id: device.id,
    status: device.status,
    lastSeen,
    last_seen: lastSeen,
    createdAt,
    created_at: createdAt
  };
}

async function initDb() {
  if (!connectionString) {
    console.warn('⚠️  DATABASE_URL tidak diset. Menggunakan in-memory database.');
    return;
  }

  try {
    // Coba koneksi pool pg biasa terlebih dahulu untuk mendeteksi error koneksi secara cepat
    // AWS RDS mewajibkan koneksi terenkripsi (SSL)
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
      ssl: {
        rejectUnauthorized: false
      }
    });

    const testClient = await pool.connect();
    testClient.release();

    // Gunakan PrismaPg adapter (Prisma 7 requirement)
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    // Verifikasi koneksi dengan query sederhana
    await prisma.$connect();
    console.log('✅ Berhasil terhubung ke database AWS RDS PostgreSQL menggunakan Prisma ORM.');
    dbEnabled = true;
  } catch (error) {
    console.warn('⚠️  Koneksi PostgreSQL menggunakan Prisma ORM gagal. Server akan berjalan menggunakan in-memory fallback.');
    console.warn(`Detail Error: ${error.message}`);
    dbEnabled = false;
    prisma = null;
  }
}

// Helper untuk menyimpan atau memperbarui status device
async function upsertDevice(id, status) {
  const lastSeen = new Date();
  if (dbEnabled && prisma) {
    try {
      await prisma.device.upsert({
        where: { id },
        update: { status, lastSeen },
        create: { id, status, lastSeen }
      });
    } catch (err) {
      console.error('Error saat menyimpan device ke database (Prisma):', err.message);
    }
  }

  // Tetap update in-memory cache
  memoryDevices.set(id, { id, status, last_seen: lastSeen });
}

// Helper untuk mendapatkan list device
async function getDevices() {
  if (dbEnabled && prisma) {
    try {
      const devices = await prisma.device.findMany({
        orderBy: { lastSeen: 'desc' }
      });
      return devices.map(formatDevice);
    } catch (err) {
      console.error('Error saat mengambil devices dari database (Prisma):', err.message);
    }
  }
  return Array.from(memoryDevices.values()).map(formatDevice);
}

// Helper untuk mencatat log akses file
async function logAccess(deviceId, fileName, action) {
  const accessTime = new Date();
  if (dbEnabled && prisma) {
    try {
      await prisma.accessLog.create({
        data: {
          deviceId,
          fileName,
          action,
          accessTime
        }
      });
    } catch (err) {
      console.error('Error saat mencatat log ke database (Prisma):', err.message);
    }
  }

  // Tetap update in-memory
  memoryLogs.push({ deviceId, fileName, action, accessTime });
}

module.exports = {
  initDb,
  upsertDevice,
  getDevices,
  logAccess,
  isDbEnabled: () => dbEnabled
};
