const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');
const rabbitmq = require('./utils/rabbitmq');

const apiKey = process.env.API_KEY || 'super-secret-key-123';
const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';
const activeDevices = new Map(); // Map untuk menyimpan deviceId -> socket instance
const activeChatUsers = new Map(); // Map untuk menyimpan phoneNumber -> socket instance
const activeUserRooms = new Map(); // Map untuk menyimpan phoneNumber -> peerPhone (room aktif saat ini)

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
    const phoneNumber = socket.handshake.query?.phoneNumber;

    // Jika koneksi Chat (tanpa auth, menggunakan nomor HP)
    if (phoneNumber) {
      socket.phoneNumber = phoneNumber;
      return next();
    }

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
    const clientType = socket.handshake.query?.clientType; // 'android' atau 'web' atau 'chat'
    const deviceId = socket.handshake.query?.deviceId;
    const phoneNumber = socket.phoneNumber || socket.handshake.query?.phoneNumber;

    console.log(`🔌 Koneksi baru dari ${clientType || 'unknown'} (IP: ${socket.handshake.address})`);

    // JIKA USER CHAT
    if (phoneNumber) {
      console.log(`💬 Chat User terdaftar: ${phoneNumber}`);
      activeChatUsers.set(phoneNumber, socket);

      // Sync user ke database dan set status online
      db.findOrCreateUserByPhone(phoneNumber).then(user => {
        console.log(`👤 User DB Sync: ${user.phoneNumber}`);
        db.updateUserOnlineStatus(phoneNumber, true).then(() => {
          // Broadcast status online ke user lainnya
          socket.broadcast.emit('user_status_change', {
            phoneNumber,
            isOnline: true,
            lastSeen: new Date()
          });
        });
      });

      // Mulai consume queue RabbitMQ milik user ini
      rabbitmq.startConsume(phoneNumber, async (messageData) => {
        try {
          socket.emit('new_chat', messageData);
          return true; // Acknowledge sukses
        } catch (err) {
          console.error(`❌ Gagal kirim socket chat ke ${phoneNumber}:`, err.message);
          return false; // Requeue
        }
      });

      // Event cek apakah nomor HP terdaftar di server
      socket.on('check_user', async (data, callback) => {
        const { phoneNumber } = data;
        if (!phoneNumber) {
          if (callback) callback({ success: false, error: 'Nomor HP wajib diisi' });
          return;
        }
        try {
          const user = await db.findUserByPhone(phoneNumber);
          if (user) {
            if (callback) callback({ success: true, exists: true });
          } else {
            if (callback) callback({ success: true, exists: false });
          }
        } catch (err) {
          console.error(`❌ Gagal verifikasi nomor HP:`, err.message);
          if (callback) callback({ success: false, error: 'Gagal memverifikasi nomor HP' });
        }
      });

      // Event mengambil list chat terakhir (Recent Chats)
      socket.on('get_recent_chats', async (data, callback) => {
        try {
          const recent = await db.getRecentChats(phoneNumber);
          if (callback) callback({ success: true, recent });
        } catch (err) {
          console.error(`❌ Gagal ambil recent chats:`, err.message);
          if (callback) callback({ success: false, error: 'Gagal mengambil daftar chat terakhir' });
        }
      });

      // Event ambil riwayat chat
      socket.on('get_chat_history', async (data, callback) => {
        const { to } = data;
        if (!to) {
          if (callback) callback({ success: false, error: 'Tujuan (to) wajib diisi' });
          return;
        }
        try {
          const history = await db.getChatHistory(phoneNumber, to);
          if (callback) callback({ success: true, history });
        } catch (err) {
          console.error(`❌ Gagal ambil riwayat chat:`, err.message);
          if (callback) callback({ success: false, error: 'Gagal mengambil riwayat chat' });
        }
      });

      // Event kirim chat
      socket.on('send_chat', async (data, callback) => {
        const { to, content, replyToId, replyToContent } = data;
        if (!to || !content) {
          if (callback) callback({ success: false, error: 'Tujuan (to) dan isi (content) wajib diisi' });
          return;
        }

        console.log(`✉️  Chat dari ${phoneNumber} ke ${to}: "${content}"`);

        // Cek apakah penerima online dan sedang membuka room chat dengan pengirim
        const isPeerInOurRoom = activeUserRooms.get(to) === phoneNumber;
        const initialStatus = isPeerInOurRoom ? 'read' : 'sent';

        // 1. Simpan ke database dengan status dan reply metadata
        const savedMsg = await db.saveMessage(phoneNumber, to, content, initialStatus, replyToId, replyToContent);

        // 2. Kirim ke RabbitMQ queue penerima
        const published = await rabbitmq.publishMessage(to, savedMsg);

        if (published) {
          if (callback) callback({ success: true, message: savedMsg });
        } else {
          if (callback) callback({ success: false, error: 'Gagal memproses pesan' });
        }
      });

      // User masuk ke room chat peer tertentu
      socket.on('enter_chat_room', (data) => {
        const { peerPhone } = data;
        if (peerPhone) {
          activeUserRooms.set(phoneNumber, peerPhone);
          console.log(`💬 User ${phoneNumber} masuk ke room chat ${peerPhone}`);
        }
      });

      // User meninggalkan room chat peer
      socket.on('leave_chat_room', () => {
        activeUserRooms.delete(phoneNumber);
        console.log(`💬 User ${phoneNumber} meninggalkan room chat`);
      });

      // User menandai pesan dari peer tertentu sebagai terbaca
      socket.on('read_chat', async (data) => {
        const { peerPhone } = data;
        if (!peerPhone) return;

        console.log(`👁️  User ${phoneNumber} membaca chat dari ${peerPhone}`);
        await db.markMessagesAsRead(peerPhone, phoneNumber);

        // Kirim notifikasi ke pengirim jika pengirim online
        const peerSocket = activeChatUsers.get(peerPhone);
        if (peerSocket) {
          peerSocket.emit('messages_read', { fromPhone: phoneNumber });
        }
      });

      // Ambil status online & terakhir aktif dari peer
      socket.on('get_user_status', async (data, callback) => {
        const { peerPhone } = data;
        if (!peerPhone) {
          if (callback) callback({ success: false, error: 'peerPhone wajib diisi' });
          return;
        }
        try {
          const status = await db.getUserStatus(peerPhone);
          if (callback) callback({ success: true, isOnline: status.isOnline, lastSeen: status.lastSeen });
        } catch (err) {
          console.error(`❌ Gagal ambil status user:`, err.message);
          if (callback) callback({ success: false, error: 'Gagal mengambil status user' });
        }
      });

      // Event hapus chat
      socket.on('delete_chat', async (data, callback) => {
        const { id, to } = data;
        if (!id) {
          if (callback) callback({ success: false, error: 'ID pesan wajib diisi' });
          return;
        }

        console.log(`🗑️  Chat ID ${id} dihapus oleh ${phoneNumber}`);

        // 1. Hapus dari database
        await db.deleteMessage(id);

        // 2. Beritahu penerima (jika online) agar menghapus pesan dari UI secara real-time
        const peerSocket = activeChatUsers.get(to);
        if (peerSocket) {
          peerSocket.emit('chat_deleted', { id });
        }

        if (callback) callback({ success: true });
      });

      // Event hapus seluruh obrolan (conversation thread)
      socket.on('delete_conversation', async (data, callback) => {
        const { to } = data;
        if (!to) {
          if (callback) callback({ success: false, error: 'Nomor lawan bicara wajib diisi' });
          return;
        }

        console.log(`🗑️  Obrolan dengan ${to} dihapus oleh ${phoneNumber}`);
        await db.deleteConversation(phoneNumber, to);

        if (callback) callback({ success: true });
      });
    }

    // JIKA USER ANDROID (Sistem Monitoring File)
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

      if (phoneNumber) {
        console.log(`💬 Chat User offline: ${phoneNumber}`);
        activeChatUsers.delete(phoneNumber);
        activeUserRooms.delete(phoneNumber);
        rabbitmq.stopConsume(phoneNumber);

        // Update DB dan broadcast offline status
        db.updateUserOnlineStatus(phoneNumber, false).then(() => {
          socket.broadcast.emit('user_status_change', {
            phoneNumber,
            isOnline: false,
            lastSeen: new Date()
          });
        });
      }

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
