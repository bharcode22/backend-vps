const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');

const apiKey = process.env.API_KEY || 'super-secret-key-123';
const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';
const activeDevices = new Map(); // Map untuk menyimpan deviceId -> socket instance

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*', // Di production, sebaiknya diset ke domain web app Anda
      methods: ['GET', 'POST']
    }
  });

  // Middleware Autentikasi
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    // 1. Cek jika menggunakan static API Key
    if (token === apiKey) {
      return next();
    }

    // 2. Coba verifikasi dengan JWT jika token tersedia
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
        return next();
      } catch (err) {
        console.warn(`⚠️  Koneksi Socket ditolak karena JWT tidak valid dari IP: ${socket.handshake.address}`);
        return next(new Error('Unauthorized: JWT invalid'));
      }
    }

    console.warn(`⚠️  Koneksi Socket ditolak karena tanpa token dari IP: ${socket.handshake.address}`);
    return next(new Error('Unauthorized: Token missing'));
  });

  io.on('connection', (socket) => {
    const clientType = socket.handshake.query?.clientType; // 'android' atau 'web'
    const deviceId = socket.handshake.query?.deviceId;

    console.log(`🔌 Koneksi baru dari ${clientType || 'unknown'} (IP: ${socket.handshake.address})`);

    if (clientType === 'android' && deviceId) {
      // Daftarkan device android ke activeDevices
      activeDevices.set(deviceId, socket);
      socket.deviceId = deviceId;

      console.log(`📱 Android Device terdaftar: ${deviceId}`);
      db.upsertDevice(deviceId, 'online');

      // Beri notifikasi ke semua client lain bahwa device ini online
      socket.broadcast.emit('device_status_change', { deviceId, status: 'online' });
    }

    socket.on('disconnect', () => {
      console.log(`🔌 Koneksi terputus dari IP: ${socket.handshake.address}`);

      if (socket.deviceId && activeDevices.has(socket.deviceId)) {
        activeDevices.delete(socket.deviceId);
        console.log(`📱 Android Device offline: ${socket.deviceId}`);
        db.upsertDevice(socket.deviceId, 'offline');

        // Beri notifikasi ke semua client lain bahwa device ini offline
        socket.broadcast.emit('device_status_change', { deviceId: socket.deviceId, status: 'offline' });
      }
    });
  });

  return io;
}

// Helper untuk mengirim perintah ke device spesifik dan menunggu respons (callback)
function sendDeviceCommand(deviceId, action, payload = {}) {
  return new Promise((resolve, reject) => {
    const socket = activeDevices.get(deviceId);
    if (!socket) {
      return reject(new Error('Device sedang offline atau tidak terdaftar'));
    }

    // Set timeout 15 detik untuk respon dari HP Android
    socket.timeout(15000).emit('device_command', { action, ...payload }, (err, response) => {
      if (err) {
        reject(new Error('Perangkat tidak merespon (Timeout 15s)'));
      } else {
        resolve(response);
      }
    });
  });
}

// Mendapatkan daftar device yang sedang online secara real-time
function getActiveDevicesList() {
  return Array.from(activeDevices.keys());
}

module.exports = {
  initSocket,
  sendDeviceCommand,
  getActiveDevicesList
};
