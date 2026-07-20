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
const memoryUsers = new Map();
const memoryMessages = [];

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

// Helper untuk user management (Autentikasi)
async function createUser(username, passwordHash) {
  if (dbEnabled && prisma) {
    try {
      return await prisma.user.create({
        data: {
          username,
          password: passwordHash
        }
      });
    } catch (err) {
      console.error('Error saat menyimpan user ke database (Prisma):', err.message);
      throw err;
    }
  }

  // Fallback in-memory
  const id = memoryUsers.size + 1;
  const user = {
    id,
    username,
    password: passwordHash,
    createdAt: new Date()
  };
  memoryUsers.set(username, user);
  return user;
}

async function findUserByUsername(username) {
  if (dbEnabled && prisma) {
    try {
      return await prisma.user.findUnique({
        where: { username }
      });
    } catch (err) {
      console.error('Error saat mencari user di database (Prisma):', err.message);
      throw err;
    }
  }

  // Fallback in-memory
  return memoryUsers.get(username) || null;
}

async function findUserByPhone(phoneNumber) {
  if (dbEnabled && prisma) {
    try {
      return await prisma.user.findUnique({
        where: { phoneNumber }
      });
    } catch (err) {
      console.error('Error saat mencari user berdasarkan phone di database (Prisma):', err.message);
      throw err;
    }
  }

  // Fallback in-memory
  return Array.from(memoryUsers.values()).find(u => u.phoneNumber === phoneNumber) || null;
}

async function findOrCreateUserByPhone(phoneNumber) {
  if (dbEnabled && prisma) {
    try {
      let user = await prisma.user.findUnique({
        where: { phoneNumber }
      });
      if (!user) {
        user = await prisma.user.create({
          data: {
            username: `user_${phoneNumber}`,
            password: 'no-password',
            phoneNumber: phoneNumber
          }
        });
      }
      return user;
    } catch (err) {
      console.error('Error saat findOrCreateUserByPhone di database (Prisma):', err.message);
    }
  }

  // Fallback in-memory
  let user = Array.from(memoryUsers.values()).find(u => u.phoneNumber === phoneNumber);
  if (!user) {
    const id = memoryUsers.size + 1;
    user = {
      id,
      username: `user_${phoneNumber}`,
      password: 'no-password',
      phoneNumber: phoneNumber,
      createdAt: new Date()
    };
    memoryUsers.set(`user_${phoneNumber}`, user);
  }
  return user;
}

async function saveMessage(fromPhone, toPhone, content, status = 'sent') {
  const createdAt = new Date();
  if (dbEnabled && prisma) {
    try {
      return await prisma.message.create({
        data: {
          fromPhone,
          toPhone,
          content,
          status,
          createdAt
        }
      });
    } catch (err) {
      console.error('Error saat menyimpan message ke database (Prisma):', err.message);
    }
  }

  // Fallback in-memory
  const id = memoryMessages.length + 1;
  const msg = {
    id,
    fromPhone,
    toPhone,
    content,
    status,
    createdAt
  };
  memoryMessages.push(msg);
  return msg;
}

async function markMessagesAsRead(fromPhone, toPhone) {
  if (dbEnabled && prisma) {
    try {
      await prisma.message.updateMany({
        where: {
          fromPhone,
          toPhone,
          status: 'sent'
        },
        data: {
          status: 'read'
        }
      });
      return true;
    } catch (err) {
      console.error('Error saat menandai pesan dibaca ke database (Prisma):', err.message);
    }
  }

  // Fallback in-memory
  memoryMessages.forEach(msg => {
    if (msg.fromPhone === fromPhone && msg.toPhone === toPhone && msg.status === 'sent') {
      msg.status = 'read';
    }
  });
  return true;
}

async function getChatHistory(phoneA, phoneB) {
  if (dbEnabled && prisma) {
    try {
      return await prisma.message.findMany({
        where: {
          OR: [
            { fromPhone: phoneA, toPhone: phoneB },
            { fromPhone: phoneB, toPhone: phoneA }
          ]
        },
        orderBy: { createdAt: 'asc' }
      });
    } catch (err) {
      console.error('Error saat mengambil chat history dari database (Prisma):', err.message);
    }
  }

  // Fallback in-memory
  return memoryMessages
    .filter(
      msg =>
        (msg.fromPhone === phoneA && msg.toPhone === phoneB) ||
        (msg.fromPhone === phoneB && msg.toPhone === phoneA)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function getRecentChats(myPhone) {
  if (dbEnabled && prisma) {
    try {
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            { fromPhone: myPhone },
            { toPhone: myPhone }
          ]
        },
        orderBy: { createdAt: 'desc' }
      });

      const recentMap = new Map();
      for (const msg of messages) {
        const peer = msg.fromPhone === myPhone ? msg.toPhone : msg.fromPhone;
        if (!recentMap.has(peer)) {
          recentMap.set(peer, msg);
        }
      }

      return Array.from(recentMap.entries()).map(([peer, lastMsg]) => ({
        phoneNumber: peer,
        lastMessage: lastMsg.content,
        timestamp: lastMsg.createdAt
      }));
    } catch (err) {
      console.error('Error saat mengambil recent chats dari database (Prisma):', err.message);
      throw err;
    }
  }

  // Fallback in-memory
  const recentMap = new Map();
  const sortedMemoryMsgs = [...memoryMessages].sort((a, b) => b.createdAt - a.createdAt);
  for (const msg of sortedMemoryMsgs) {
    if (msg.fromPhone === myPhone || msg.toPhone === myPhone) {
      const peer = msg.fromPhone === myPhone ? msg.toPhone : msg.fromPhone;
      if (!recentMap.has(peer)) {
        recentMap.set(peer, msg);
      }
    }
  }

  return Array.from(recentMap.entries()).map(([peer, lastMsg]) => ({
    phoneNumber: peer,
    lastMessage: lastMsg.content,
    timestamp: lastMsg.createdAt
  }));
}

module.exports = {
  initDb,
  upsertDevice,
  getDevices,
  logAccess,
  createUser,
  findUserByUsername,
  findUserByPhone,
  findOrCreateUserByPhone,
  saveMessage,
  markMessagesAsRead,
  getChatHistory,
  getRecentChats,
  isDbEnabled: () => dbEnabled
};
