var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// db.js
var require_db = __commonJS({
  "db.js"(exports2, module2) {
    var { PrismaClient } = require("@prisma/client");
    var { PrismaPg } = require("@prisma/adapter-pg");
    var { Pool } = require("pg");
    require("dotenv").config();
    var connectionString = process.env.DATABASE_URL;
    var prisma = null;
    var dbEnabled = false;
    var memoryDevices = /* @__PURE__ */ new Map();
    var memoryLogs = [];
    var memoryUsers = /* @__PURE__ */ new Map();
    var memoryMessages = [];
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
        console.warn("\u26A0\uFE0F  DATABASE_URL tidak diset. Menggunakan in-memory database.");
        return;
      }
      try {
        const pool = new Pool({
          connectionString,
          connectionTimeoutMillis: 5e3,
          ssl: {
            rejectUnauthorized: false
          }
        });
        const testClient = await pool.connect();
        testClient.release();
        const adapter = new PrismaPg(pool);
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();
        console.log("\u2705 Berhasil terhubung ke database AWS RDS PostgreSQL menggunakan Prisma ORM.");
        dbEnabled = true;
      } catch (error) {
        console.warn("\u26A0\uFE0F  Koneksi PostgreSQL menggunakan Prisma ORM gagal. Server akan berjalan menggunakan in-memory fallback.");
        console.warn(`Detail Error: ${error.message}`);
        dbEnabled = false;
        prisma = null;
      }
    }
    async function upsertDevice(id, status) {
      const lastSeen = /* @__PURE__ */ new Date();
      if (dbEnabled && prisma) {
        try {
          await prisma.device.upsert({
            where: { id },
            update: { status, lastSeen },
            create: { id, status, lastSeen }
          });
        } catch (err) {
          console.error("Error saat menyimpan device ke database (Prisma):", err.message);
        }
      }
      memoryDevices.set(id, { id, status, last_seen: lastSeen });
    }
    async function getDevices() {
      if (dbEnabled && prisma) {
        try {
          const devices = await prisma.device.findMany({
            orderBy: { lastSeen: "desc" }
          });
          return devices.map(formatDevice);
        } catch (err) {
          console.error("Error saat mengambil devices dari database (Prisma):", err.message);
        }
      }
      return Array.from(memoryDevices.values()).map(formatDevice);
    }
    async function deleteDevice(id) {
      if (dbEnabled && prisma) {
        try {
          await prisma.accessLog.deleteMany({
            where: { deviceId: id }
          });
          await prisma.device.delete({
            where: { id }
          });
        } catch (err) {
          console.error("Error saat menghapus device dari database (Prisma):", err.message);
        }
      }
      memoryDevices.delete(id);
      for (let i = memoryLogs.length - 1; i >= 0; i--) {
        if (memoryLogs[i].deviceId === id) {
          memoryLogs.splice(i, 1);
        }
      }
      return true;
    }
    async function logAccess(deviceId, fileName, action) {
      const accessTime = /* @__PURE__ */ new Date();
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
          console.error("Error saat mencatat log ke database (Prisma):", err.message);
        }
      }
      memoryLogs.push({ deviceId, fileName, action, accessTime });
    }
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
          console.error("Error saat menyimpan user ke database (Prisma):", err.message);
          throw err;
        }
      }
      const id = memoryUsers.size + 1;
      const user = {
        id,
        username,
        password: passwordHash,
        createdAt: /* @__PURE__ */ new Date()
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
          console.error("Error saat mencari user di database (Prisma):", err.message);
          throw err;
        }
      }
      return memoryUsers.get(username) || null;
    }
    async function findUserByPhone(phoneNumber) {
      if (dbEnabled && prisma) {
        try {
          return await prisma.user.findUnique({
            where: { phoneNumber }
          });
        } catch (err) {
          console.error("Error saat mencari user berdasarkan phone di database (Prisma):", err.message);
          throw err;
        }
      }
      return Array.from(memoryUsers.values()).find((u) => u.phoneNumber === phoneNumber) || null;
    }
    async function findOrCreateUserByPhone(phoneNumber) {
      if (dbEnabled && prisma) {
        try {
          let user2 = await prisma.user.findUnique({
            where: { phoneNumber }
          });
          if (!user2) {
            user2 = await prisma.user.create({
              data: {
                username: `user_${phoneNumber}`,
                password: "no-password",
                phoneNumber
              }
            });
          }
          return user2;
        } catch (err) {
          console.error("Error saat findOrCreateUserByPhone di database (Prisma):", err.message);
        }
      }
      let user = Array.from(memoryUsers.values()).find((u) => u.phoneNumber === phoneNumber);
      if (!user) {
        const id = memoryUsers.size + 1;
        user = {
          id,
          username: `user_${phoneNumber}`,
          password: "no-password",
          phoneNumber,
          createdAt: /* @__PURE__ */ new Date()
        };
        memoryUsers.set(`user_${phoneNumber}`, user);
      }
      return user;
    }
    async function saveMessage(fromPhone, toPhone, content, status = "sent", replyToId = null, replyToContent = null) {
      const createdAt = /* @__PURE__ */ new Date();
      if (dbEnabled && prisma) {
        try {
          return await prisma.message.create({
            data: {
              fromPhone,
              toPhone,
              content,
              status,
              replyToId: replyToId ? parseInt(replyToId) : null,
              replyToContent,
              createdAt
            }
          });
        } catch (err) {
          console.error("Error saat menyimpan message ke database (Prisma):", err.message);
        }
      }
      const id = memoryMessages.length + 1;
      const msg = {
        id,
        fromPhone,
        toPhone,
        content,
        status,
        replyToId: replyToId ? parseInt(replyToId) : null,
        replyToContent,
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
              status: "sent"
            },
            data: {
              status: "read"
            }
          });
          return true;
        } catch (err) {
          console.error("Error saat menandai pesan dibaca ke database (Prisma):", err.message);
        }
      }
      memoryMessages.forEach((msg) => {
        if (msg.fromPhone === fromPhone && msg.toPhone === toPhone && msg.status === "sent") {
          msg.status = "read";
        }
      });
      return true;
    }
    async function deleteMessage(id) {
      if (dbEnabled && prisma) {
        try {
          await prisma.message.delete({
            where: { id: parseInt(id) }
          });
          return true;
        } catch (err) {
          console.error("Error saat menghapus message dari database (Prisma):", err.message);
        }
      }
      const index = memoryMessages.findIndex((msg) => msg.id === parseInt(id));
      if (index >= 0) {
        memoryMessages.splice(index, 1);
      }
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
            orderBy: { createdAt: "asc" }
          });
        } catch (err) {
          console.error("Error saat mengambil chat history dari database (Prisma):", err.message);
        }
      }
      return memoryMessages.filter(
        (msg) => msg.fromPhone === phoneA && msg.toPhone === phoneB || msg.fromPhone === phoneB && msg.toPhone === phoneA
      ).sort((a, b) => a.createdAt - b.createdAt);
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
            orderBy: { createdAt: "desc" }
          });
          const recentMap2 = /* @__PURE__ */ new Map();
          const unreadMap2 = /* @__PURE__ */ new Map();
          for (const msg of messages) {
            const peer = msg.fromPhone === myPhone ? msg.toPhone : msg.fromPhone;
            if (!recentMap2.has(peer)) {
              recentMap2.set(peer, msg);
            }
            if (msg.toPhone === myPhone && msg.fromPhone !== myPhone && msg.status !== "read") {
              unreadMap2.set(peer, (unreadMap2.get(peer) || 0) + 1);
            }
          }
          return Array.from(recentMap2.entries()).map(([peer, lastMsg]) => ({
            phoneNumber: peer,
            lastMessage: lastMsg.content,
            timestamp: lastMsg.createdAt,
            unreadCount: unreadMap2.get(peer) || 0
          }));
        } catch (err) {
          console.error("Error saat mengambil recent chats dari database (Prisma):", err.message);
          throw err;
        }
      }
      const recentMap = /* @__PURE__ */ new Map();
      const unreadMap = /* @__PURE__ */ new Map();
      const sortedMemoryMsgs = [...memoryMessages].sort((a, b) => b.createdAt - a.createdAt);
      for (const msg of sortedMemoryMsgs) {
        if (msg.fromPhone === myPhone || msg.toPhone === myPhone) {
          const peer = msg.fromPhone === myPhone ? msg.toPhone : msg.fromPhone;
          if (!recentMap.has(peer)) {
            recentMap.set(peer, msg);
          }
          if (msg.toPhone === myPhone && msg.fromPhone !== myPhone && msg.status !== "read") {
            unreadMap.set(peer, (unreadMap.get(peer) || 0) + 1);
          }
        }
      }
      return Array.from(recentMap.entries()).map(([peer, lastMsg]) => ({
        phoneNumber: peer,
        lastMessage: lastMsg.content,
        timestamp: lastMsg.createdAt,
        unreadCount: unreadMap.get(peer) || 0
      }));
    }
    async function updateUserOnlineStatus(phoneNumber, isOnline) {
      const lastSeen = /* @__PURE__ */ new Date();
      if (dbEnabled && prisma) {
        try {
          await prisma.user.updateMany({
            where: { phoneNumber },
            data: { isOnline, lastSeen }
          });
          return true;
        } catch (err) {
          console.error("Error saat update status online user ke database (Prisma):", err.message);
        }
      }
      for (const [key, user] of memoryUsers.entries()) {
        if (user.phoneNumber === phoneNumber) {
          user.isOnline = isOnline;
          user.lastSeen = lastSeen;
          memoryUsers.set(key, user);
          break;
        }
      }
      return true;
    }
    async function getUserStatus(phoneNumber) {
      if (dbEnabled && prisma) {
        try {
          const user2 = await prisma.user.findUnique({
            where: { phoneNumber }
          });
          if (user2) {
            return { isOnline: user2.isOnline, lastSeen: user2.lastSeen };
          }
        } catch (err) {
          console.error("Error saat mengambil status online user dari database (Prisma):", err.message);
        }
      }
      const user = Array.from(memoryUsers.values()).find((u) => u.phoneNumber === phoneNumber);
      if (user) {
        return { isOnline: !!user.isOnline, lastSeen: user.lastSeen || /* @__PURE__ */ new Date() };
      }
      return { isOnline: false, lastSeen: /* @__PURE__ */ new Date() };
    }
    async function deleteConversation(phoneA, phoneB) {
      if (dbEnabled && prisma) {
        try {
          await prisma.message.deleteMany({
            where: {
              OR: [
                { fromPhone: phoneA, toPhone: phoneB },
                { fromPhone: phoneB, toPhone: phoneA }
              ]
            }
          });
          return true;
        } catch (err) {
          console.error("Error saat menghapus percakapan dari database (Prisma):", err.message);
        }
      }
      for (let i = memoryMessages.length - 1; i >= 0; i--) {
        const msg = memoryMessages[i];
        if (msg.fromPhone === phoneA && msg.toPhone === phoneB || msg.fromPhone === phoneB && msg.toPhone === phoneA) {
          memoryMessages.splice(i, 1);
        }
      }
      return true;
    }
    module2.exports = {
      initDb,
      upsertDevice,
      getDevices,
      deleteDevice,
      logAccess,
      createUser,
      findUserByUsername,
      findUserByPhone,
      findOrCreateUserByPhone,
      saveMessage,
      markMessagesAsRead,
      deleteMessage,
      deleteConversation,
      updateUserOnlineStatus,
      getUserStatus,
      getChatHistory,
      getRecentChats,
      isDbEnabled: () => dbEnabled
    };
  }
});

// utils/rabbitmq.js
var require_rabbitmq = __commonJS({
  "utils/rabbitmq.js"(exports2, module2) {
    var amqp = require("amqplib");
    var RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
    var EXCHANGE_NAME = "chat.direct";
    var connection = null;
    var channel = null;
    var activeConsumers = /* @__PURE__ */ new Map();
    async function initRabbitMQ() {
      try {
        console.log(`\u{1F50C} Menghubungkan ke RabbitMQ di: ${RABBITMQ_URL}`);
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });
        console.log('\u2705 Terhubung ke RabbitMQ dan Exchange "chat.direct" siap.');
        connection.on("error", (err) => {
          console.error("\u274C Koneksi RabbitMQ error:", err.message);
        });
        connection.on("close", () => {
          console.warn("\u26A0\uFE0F Koneksi RabbitMQ ditutup. Mencoba menghubungkan kembali...");
          connection = null;
          channel = null;
          setTimeout(initRabbitMQ, 5e3);
        });
      } catch (error) {
        console.error("\u274C Gagal menghubungkan ke RabbitMQ:", error.message);
        console.log("\u{1F504} Mencoba menghubungkan kembali dalam 5 detik...");
        setTimeout(initRabbitMQ, 5e3);
      }
    }
    async function getChannel() {
      if (!channel) {
        throw new Error("RabbitMQ channel belum siap. Pastikan koneksi berhasil.");
      }
      return channel;
    }
    async function setupUserQueue(phoneNumber) {
      const ch = await getChannel();
      const queueName = `user.${phoneNumber}`;
      await ch.assertQueue(queueName, {
        durable: true,
        arguments: {
          "x-message-ttl": 6048e5
          // Pesan expire setelah 7 hari jika tidak dibaca
        }
      });
      await ch.bindQueue(queueName, EXCHANGE_NAME, queueName);
      return queueName;
    }
    async function publishMessage(toPhone, messageData) {
      try {
        const ch = await getChannel();
        const queueName = `user.${toPhone}`;
        await setupUserQueue(toPhone);
        const buffer = Buffer.from(JSON.stringify(messageData));
        ch.publish(EXCHANGE_NAME, queueName, buffer, {
          persistent: true
          // Agar pesan tersimpan di disk
        });
        console.log(`\u2709\uFE0F  Pesan di-publish ke queue: ${queueName}`);
        return true;
      } catch (error) {
        console.error(`\u274C Gagal publish pesan ke ${toPhone}:`, error.message);
        return false;
      }
    }
    async function startConsume(phoneNumber, onMessageCallback) {
      try {
        const ch = await getChannel();
        const queueName = `user.${phoneNumber}`;
        await setupUserQueue(phoneNumber);
        if (activeConsumers.has(phoneNumber)) {
          await stopConsume(phoneNumber);
        }
        console.log(`\u{1F4E5} Mulai consume queue untuk user: ${phoneNumber}`);
        const consumeResult = await ch.consume(queueName, async (msg) => {
          if (msg !== null) {
            try {
              const content = JSON.parse(msg.content.toString());
              const deliverySuccess = await onMessageCallback(content);
              if (deliverySuccess) {
                ch.ack(msg);
              } else {
                ch.nack(msg, false, true);
              }
            } catch (err) {
              console.error(`Error memproses pesan queue ${phoneNumber}:`, err.message);
              ch.nack(msg, false, false);
            }
          }
        }, { noAck: false });
        activeConsumers.set(phoneNumber, consumeResult.consumerTag);
      } catch (error) {
        console.error(`\u274C Gagal start consume untuk ${phoneNumber}:`, error.message);
      }
    }
    async function stopConsume(phoneNumber) {
      try {
        const consumerTag = activeConsumers.get(phoneNumber);
        if (consumerTag) {
          const ch = await getChannel();
          await ch.cancel(consumerTag);
          activeConsumers.delete(phoneNumber);
          console.log(`\u23F9\uFE0F  Consume dihentikan untuk user: ${phoneNumber}`);
        }
      } catch (error) {
        console.error(`\u274C Gagal stop consume untuk ${phoneNumber}:`, error.message);
      }
    }
    module2.exports = {
      initRabbitMQ,
      publishMessage,
      startConsume,
      stopConsume
    };
  }
});

// utils/telegram.js
var require_telegram = __commonJS({
  "utils/telegram.js"(exports2, module2) {
    var https = require("https");
    require("dotenv").config();
    var TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "7907582347:AAHFFbSQOB4XskWVi2dN3Hy7X8phLbqzPCI";
    var TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "1339211296";
    function sendTelegramMessage(text) {
      const token = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID;
      if (!token || !chatId) {
        console.warn("\u26A0\uFE0F Telegram Bot Token atau Chat ID tidak dikonfigurasi.");
        return Promise.resolve(false);
      }
      const payload = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML"
      });
      const options = {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      };
      return new Promise((resolve) => {
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.ok) {
                console.log(`\u{1F4AC} Notifikasi Telegram dikirim ke chat ${chatId}`);
                resolve(true);
              } else {
                console.error(`\u274C Gagal kirim notifikasi Telegram:`, parsed.description);
                resolve(false);
              }
            } catch (e) {
              console.error(`\u274C Response Telegram invalid JSON:`, data);
              resolve(false);
            }
          });
        });
        req.on("error", (err) => {
          console.error(`\u274C Error koneksi Telegram API:`, err.message);
          resolve(false);
        });
        req.write(payload);
        req.end();
      });
    }
    async function notifyDeviceOnline(deviceId) {
      const formattedTime = (/* @__PURE__ */ new Date()).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Jakarta"
      });
      const message = `\u{1F7E2} <b>PERANGKAT ONLINE</b>

\u{1F4F1} <b>Device ID:</b> <code>${deviceId}</code>
\u23F0 <b>Waktu:</b> ${formattedTime} WIB
\u26A1 <b>Status:</b> Perangkat sebelumnya offline dan sekarang telah kembali ONLINE.`;
      return sendTelegramMessage(message);
    }
    module2.exports = {
      sendTelegramMessage,
      notifyDeviceOnline
    };
  }
});

// socket.js
var require_socket = __commonJS({
  "socket.js"(exports2, module2) {
    var { Server } = require("socket.io");
    var jwt = require("jsonwebtoken");
    var db2 = require_db();
    var rabbitmq2 = require_rabbitmq();
    var telegram = require_telegram();
    var apiKey = process.env.API_KEY || "super-secret-key-123";
    var JWT_SECRET = process.env.JWT_SECRET || "kasir-vps-secure-jwt-key-2026";
    var activeDevices = /* @__PURE__ */ new Map();
    var activeChatUsers = /* @__PURE__ */ new Map();
    var activeUserRooms = /* @__PURE__ */ new Map();
    function initSocket(server2) {
      const io = new Server(server2, {
        cors: {
          origin: "*",
          // Di production, sebaiknya diset ke domain web app Anda
          methods: ["GET", "POST"]
        }
      });
      io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        const phoneNumber = socket.handshake.query?.phoneNumber;
        if (phoneNumber) {
          socket.phoneNumber = phoneNumber;
          return next();
        }
        if (token === apiKey) {
          return next();
        }
        if (token) {
          try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.user = decoded;
            return next();
          } catch (err) {
            console.warn(`\u26A0\uFE0F  Koneksi Socket ditolak karena JWT tidak valid dari IP: ${socket.handshake.address}`);
            return next(new Error("Unauthorized: JWT invalid"));
          }
        }
        console.warn(`\u26A0\uFE0F  Koneksi Socket ditolak karena tanpa token dari IP: ${socket.handshake.address}`);
        return next(new Error("Unauthorized: Token missing"));
      });
      io.on("connection", (socket) => {
        const clientType = socket.handshake.query?.clientType;
        const deviceId = socket.handshake.query?.deviceId;
        const phoneNumber = socket.phoneNumber || socket.handshake.query?.phoneNumber;
        console.log(`\u{1F50C} Koneksi baru dari ${clientType || "unknown"} (IP: ${socket.handshake.address})`);
        if (phoneNumber) {
          console.log(`\u{1F4AC} Chat User terdaftar: ${phoneNumber}`);
          activeChatUsers.set(phoneNumber, socket);
          db2.findOrCreateUserByPhone(phoneNumber).then((user) => {
            console.log(`\u{1F464} User DB Sync: ${user.phoneNumber}`);
            db2.updateUserOnlineStatus(phoneNumber, true).then(() => {
              socket.broadcast.emit("user_status_change", {
                phoneNumber,
                isOnline: true,
                lastSeen: /* @__PURE__ */ new Date()
              });
            });
          });
          rabbitmq2.startConsume(phoneNumber, async (messageData) => {
            try {
              socket.emit("new_chat", messageData);
              return true;
            } catch (err) {
              console.error(`\u274C Gagal kirim socket chat ke ${phoneNumber}:`, err.message);
              return false;
            }
          });
          socket.on("check_user", async (data, callback) => {
            const { phoneNumber: phoneNumber2 } = data;
            if (!phoneNumber2) {
              if (callback) callback({ success: false, error: "Nomor HP wajib diisi" });
              return;
            }
            try {
              const user = await db2.findUserByPhone(phoneNumber2);
              if (user) {
                if (callback) callback({ success: true, exists: true });
              } else {
                if (callback) callback({ success: true, exists: false });
              }
            } catch (err) {
              console.error(`\u274C Gagal verifikasi nomor HP:`, err.message);
              if (callback) callback({ success: false, error: "Gagal memverifikasi nomor HP" });
            }
          });
          socket.on("get_recent_chats", async (data, callback) => {
            try {
              const recent = await db2.getRecentChats(phoneNumber);
              if (callback) callback({ success: true, recent });
            } catch (err) {
              console.error(`\u274C Gagal ambil recent chats:`, err.message);
              if (callback) callback({ success: false, error: "Gagal mengambil daftar chat terakhir" });
            }
          });
          socket.on("get_chat_history", async (data, callback) => {
            const { to } = data;
            if (!to) {
              if (callback) callback({ success: false, error: "Tujuan (to) wajib diisi" });
              return;
            }
            try {
              const history = await db2.getChatHistory(phoneNumber, to);
              if (callback) callback({ success: true, history });
            } catch (err) {
              console.error(`\u274C Gagal ambil riwayat chat:`, err.message);
              if (callback) callback({ success: false, error: "Gagal mengambil riwayat chat" });
            }
          });
          socket.on("send_chat", async (data, callback) => {
            const { to, content, replyToId, replyToContent } = data;
            if (!to || !content) {
              if (callback) callback({ success: false, error: "Tujuan (to) dan isi (content) wajib diisi" });
              return;
            }
            console.log(`\u2709\uFE0F  Chat dari ${phoneNumber} ke ${to}: "${content}"`);
            const isPeerInOurRoom = activeUserRooms.get(to) === phoneNumber;
            const initialStatus = isPeerInOurRoom ? "read" : "sent";
            const savedMsg = await db2.saveMessage(phoneNumber, to, content, initialStatus, replyToId, replyToContent);
            const published = await rabbitmq2.publishMessage(to, savedMsg);
            if (published) {
              if (callback) callback({ success: true, message: savedMsg });
            } else {
              if (callback) callback({ success: false, error: "Gagal memproses pesan" });
            }
          });
          socket.on("enter_chat_room", (data) => {
            const { peerPhone } = data;
            if (peerPhone) {
              activeUserRooms.set(phoneNumber, peerPhone);
              console.log(`\u{1F4AC} User ${phoneNumber} masuk ke room chat ${peerPhone}`);
            }
          });
          socket.on("leave_chat_room", () => {
            activeUserRooms.delete(phoneNumber);
            console.log(`\u{1F4AC} User ${phoneNumber} meninggalkan room chat`);
          });
          socket.on("read_chat", async (data) => {
            const { peerPhone } = data;
            if (!peerPhone) return;
            console.log(`\u{1F441}\uFE0F  User ${phoneNumber} membaca chat dari ${peerPhone}`);
            await db2.markMessagesAsRead(peerPhone, phoneNumber);
            const peerSocket = activeChatUsers.get(peerPhone);
            if (peerSocket) {
              peerSocket.emit("messages_read", { fromPhone: phoneNumber });
            }
          });
          socket.on("get_user_status", async (data, callback) => {
            const { peerPhone } = data;
            if (!peerPhone) {
              if (callback) callback({ success: false, error: "peerPhone wajib diisi" });
              return;
            }
            try {
              const status = await db2.getUserStatus(peerPhone);
              if (callback) callback({ success: true, isOnline: status.isOnline, lastSeen: status.lastSeen });
            } catch (err) {
              console.error(`\u274C Gagal ambil status user:`, err.message);
              if (callback) callback({ success: false, error: "Gagal mengambil status user" });
            }
          });
          socket.on("delete_chat", async (data, callback) => {
            const { id, to } = data;
            if (!id) {
              if (callback) callback({ success: false, error: "ID pesan wajib diisi" });
              return;
            }
            console.log(`\u{1F5D1}\uFE0F  Chat ID ${id} dihapus oleh ${phoneNumber}`);
            await db2.deleteMessage(id);
            const peerSocket = activeChatUsers.get(to);
            if (peerSocket) {
              peerSocket.emit("chat_deleted", { id });
            }
            if (callback) callback({ success: true });
          });
          socket.on("delete_conversation", async (data, callback) => {
            const { to } = data;
            if (!to) {
              if (callback) callback({ success: false, error: "Nomor lawan bicara wajib diisi" });
              return;
            }
            console.log(`\u{1F5D1}\uFE0F  Obrolan dengan ${to} dihapus oleh ${phoneNumber}`);
            await db2.deleteConversation(phoneNumber, to);
            if (callback) callback({ success: true });
          });
        }
        if (clientType === "android" && deviceId) {
          const isPreviouslyOffline = !activeDevices.has(deviceId);
          activeDevices.set(deviceId, socket);
          socket.deviceId = deviceId;
          console.log(`\u{1F4F1} Android Device terdaftar: ${deviceId}`);
          db2.upsertDevice(deviceId, "online");
          socket.broadcast.emit("device_status_change", { deviceId, status: "online" });
          if (isPreviouslyOffline) {
            telegram.notifyDeviceOnline(deviceId).catch((err) => {
              console.error("\u274C Gagal mengirim notifikasi Telegram:", err.message);
            });
          }
        }
        socket.on("disconnect", () => {
          console.log(`\u{1F50C} Koneksi terputus dari IP: ${socket.handshake.address}`);
          if (phoneNumber) {
            console.log(`\u{1F4AC} Chat User offline: ${phoneNumber}`);
            activeChatUsers.delete(phoneNumber);
            activeUserRooms.delete(phoneNumber);
            rabbitmq2.stopConsume(phoneNumber);
            db2.updateUserOnlineStatus(phoneNumber, false).then(() => {
              socket.broadcast.emit("user_status_change", {
                phoneNumber,
                isOnline: false,
                lastSeen: /* @__PURE__ */ new Date()
              });
            });
          }
          if (socket.deviceId && activeDevices.has(socket.deviceId)) {
            activeDevices.delete(socket.deviceId);
            console.log(`\u{1F4F1} Android Device offline: ${socket.deviceId}`);
            db2.upsertDevice(socket.deviceId, "offline");
            socket.broadcast.emit("device_status_change", { deviceId: socket.deviceId, status: "offline" });
          }
        });
      });
      return io;
    }
    function sendDeviceCommand(deviceId, action, payload = {}) {
      return new Promise((resolve, reject) => {
        const socket = activeDevices.get(deviceId);
        if (!socket) {
          return reject(new Error("Device sedang offline atau tidak terdaftar"));
        }
        socket.timeout(15e3).emit("device_command", { action, ...payload }, (err, response) => {
          if (err) {
            reject(new Error("Perangkat tidak merespon (Timeout 15s)"));
          } else {
            resolve(response);
          }
        });
      });
    }
    function getActiveDevicesList() {
      return Array.from(activeDevices.keys());
    }
    module2.exports = {
      initSocket,
      sendDeviceCommand,
      getActiveDevicesList
    };
  }
});

// controllers/authController.js
var require_authController = __commonJS({
  "controllers/authController.js"(exports2, module2) {
    var bcrypt = require("bcryptjs");
    var jwt = require("jsonwebtoken");
    var db2 = require_db();
    var JWT_SECRET = process.env.JWT_SECRET || "kasir-vps-secure-jwt-key-2026";
    async function register(req, res) {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username dan password diperlukan." });
      }
      try {
        const existingUser = await db2.findUserByUsername(username);
        if (existingUser) {
          return res.status(400).json({ error: "Username sudah digunakan." });
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const newUser = await db2.createUser(username, passwordHash);
        res.status(201).json({
          status: "success",
          message: "Registrasi berhasil.",
          user: {
            id: newUser.id,
            username: newUser.username
          }
        });
      } catch (err) {
        res.status(500).json({ error: "Gagal melakukan registrasi.", details: err.message });
      }
    }
    async function login(req, res) {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username dan password diperlukan." });
      }
      try {
        const user = await db2.findUserByUsername(username);
        if (!user) {
          return res.status(401).json({ error: "Username atau password salah." });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ error: "Username atau password salah." });
        }
        const token = jwt.sign(
          { id: user.id, username: user.username },
          JWT_SECRET,
          { expiresIn: "7d" }
        );
        res.json({
          status: "success",
          message: "Login berhasil.",
          token,
          user: {
            id: user.id,
            username: user.username
          }
        });
      } catch (err) {
        res.status(500).json({ error: "Gagal melakukan login.", details: err.message });
      }
    }
    module2.exports = {
      register,
      login
    };
  }
});

// routes/authRoutes.js
var require_authRoutes = __commonJS({
  "routes/authRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var authController = require_authController();
    router.post("/register", authController.register);
    router.post("/login", authController.login);
    module2.exports = router;
  }
});

// utils/pendingDownloads.js
var require_pendingDownloads = __commonJS({
  "utils/pendingDownloads.js"(exports2, module2) {
    var pendingDownloads = /* @__PURE__ */ new Map();
    module2.exports = pendingDownloads;
  }
});

// controllers/deviceController.js
var require_deviceController = __commonJS({
  "controllers/deviceController.js"(exports2, module2) {
    var path = require("path");
    var fs = require("fs");
    var crypto = require("crypto");
    var db2 = require_db();
    var socketModule2 = require_socket();
    var pendingDownloads = require_pendingDownloads();
    async function getDevices(req, res) {
      try {
        const devices = await db2.getDevices();
        const activeDeviceIds = socketModule2.getActiveDevicesList();
        const augmentedDevices = devices.map((device) => ({
          ...device,
          status: activeDeviceIds.includes(device.id) ? "online" : "offline"
        }));
        res.json(augmentedDevices);
      } catch (err) {
        res.status(500).json({ error: "Gagal mengambil daftar perangkat", details: err.message });
      }
    }
    async function getDeviceFiles(req, res) {
      const { deviceId } = req.params;
      const folder = req.query.folder || "DCIM";
      const { date } = req.query;
      try {
        console.log(`\u{1F50D} Meminta daftar file folder "${folder}" dari device ${deviceId}`);
        let files = await socketModule2.sendDeviceCommand(deviceId, "LIST_FILES", { folder });
        if (Array.isArray(files)) {
          try {
            const uploadDir = process.env.UPLOAD_DIR || "./uploads";
            const targetDir = path.join(uploadDir, `${deviceId}-${folder}`);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            const allFilePath = path.join(targetDir, "all.json");
            fs.writeFileSync(allFilePath, JSON.stringify(files, null, 2), "utf8");
            console.log(`\u{1F4BE} Sukses menyimpan seluruh response di VPS: ${allFilePath}`);
          } catch (saveErr) {
            console.error("\u274C Gagal menyimpan cache JSON berkas di VPS:", saveErr.message);
          }
          files.sort((a, b) => {
            const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
            const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
            return timeB - timeA;
          });
          if (date) {
            files = files.filter((file) => {
              if (!file.mtime) return false;
              try {
                const d = new Date(file.mtime);
                if (isNaN(d.getTime())) return false;
                const isoDate = d.toISOString().split("T")[0];
                const localYear = d.getFullYear();
                const localMonth = String(d.getMonth() + 1).padStart(2, "0");
                const localDay = String(d.getDate()).padStart(2, "0");
                const localDateStr = `${localYear}-${localMonth}-${localDay}`;
                return isoDate === date || localDateStr === date;
              } catch (e) {
                return false;
              }
            });
          }
        }
        await db2.logAccess(deviceId, folder, "LIST_FILES");
        res.json(files);
      } catch (err) {
        res.status(504).json({ error: "Gagal mendapatkan daftar file dari perangkat", details: err.message });
      }
    }
    async function downloadDeviceFile(req, res) {
      const { deviceId } = req.params;
      const filePath = req.query.path;
      if (!filePath) {
        return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
      }
      const fileName = path.basename(filePath);
      const downloadSessionId = crypto.randomBytes(16).toString("hex");
      console.log(`\u{1F4E5} Browser meminta download: "${filePath}" (Session: ${downloadSessionId})`);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Content-Type", "application/octet-stream");
      const timer = setTimeout(() => {
        if (pendingDownloads.has(downloadSessionId)) {
          console.warn(`\u23F3 Download session ${downloadSessionId} timeout.`);
          const pending = pendingDownloads.get(downloadSessionId);
          pending.res.status(504).end("Gateway Timeout: Perangkat tidak mengirimkan file.");
          pendingDownloads.delete(downloadSessionId);
        }
      }, 3e4);
      pendingDownloads.set(downloadSessionId, { res, timer, fileName });
      try {
        await socketModule2.sendDeviceCommand(deviceId, "GET_FILE", {
          path: filePath,
          downloadSessionId
        });
        await db2.logAccess(deviceId, fileName, "DOWNLOAD_FILE");
      } catch (err) {
        console.error(`\u274C Gagal mengirim perintah GET_FILE ke device: ${err.message}`);
        clearTimeout(timer);
        pendingDownloads.delete(downloadSessionId);
        res.status(500).end(`Gagal mengunduh file: ${err.message}`);
      }
    }
    async function previewDeviceFile(req, res) {
      const { deviceId } = req.params;
      const filePath = req.query.path;
      if (!filePath) {
        return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
      }
      const fileName = path.basename(filePath);
      const fileExtension = path.extname(filePath).toLowerCase();
      let contentType = "image/jpeg";
      if (fileExtension === ".png") {
        contentType = "image/png";
      } else if (fileExtension === ".gif") {
        contentType = "image/gif";
      } else if (fileExtension === ".webp") {
        contentType = "image/webp";
      }
      let folder = "DCIM";
      const prefix = "/storage/emulated/0/";
      if (filePath.startsWith(prefix)) {
        const relative = filePath.substring(prefix.length);
        folder = path.dirname(relative);
      } else {
        const parent = path.dirname(filePath);
        folder = parent.startsWith("/") ? parent.substring(1) : parent;
      }
      let mtime = null;
      try {
        const uploadDir2 = process.env.UPLOAD_DIR || "./uploads";
        const allFilePath = path.join(uploadDir2, `${deviceId}-${folder}`, "all.json");
        if (fs.existsSync(allFilePath)) {
          const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
          const foundFile = files.find((f) => f.path === filePath || f.name === fileName);
          if (foundFile) {
            mtime = foundFile.mtime || foundFile.fileMtime;
          }
        }
      } catch (e) {
      }
      let dateStr = "no-date";
      if (mtime) {
        try {
          const d = new Date(mtime);
          if (!isNaN(d.getTime())) {
            const localYear = d.getFullYear();
            const localMonth = String(d.getMonth() + 1).padStart(2, "0");
            const localDay = String(d.getDate()).padStart(2, "0");
            dateStr = `${localYear}-${localMonth}-${localDay}`;
          }
        } catch (e) {
        }
      } else {
        const d = /* @__PURE__ */ new Date();
        const localYear = d.getFullYear();
        const localMonth = String(d.getMonth() + 1).padStart(2, "0");
        const localDay = String(d.getDate()).padStart(2, "0");
        dateStr = `${localYear}-${localMonth}-${localDay}`;
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const dateDir = path.join(uploadDir, `${deviceId}-${folder}`, dateStr);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }
      const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
      let previewFileName = fileName;
      if (!isImgExt) {
        previewFileName = `${fileName}.jpg`;
      }
      const targetDiskPath = path.join(dateDir, previewFileName);
      if (fs.existsSync(targetDiskPath)) {
        console.log(`\u26A1 Serving preview directly from VPS cache (live route): ${targetDiskPath}`);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Content-Type", contentType);
        return res.sendFile(path.resolve(targetDiskPath));
      }
      const downloadSessionId = crypto.randomBytes(16).toString("hex");
      console.log(`\u{1F441}\uFE0F  Browser meminta preview: "${filePath}" (Session: ${downloadSessionId})`);
      console.log(`\u{1F4BE} Preview akan disimpan di VPS: ${targetDiskPath}`);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Type", contentType);
      const timer = setTimeout(() => {
        if (pendingDownloads.has(downloadSessionId)) {
          console.warn(`\u23F3 Preview session ${downloadSessionId} timeout.`);
          const pending = pendingDownloads.get(downloadSessionId);
          pending.res.status(504).end("Gateway Timeout: Perangkat tidak mengirimkan preview.");
          pendingDownloads.delete(downloadSessionId);
        }
      }, 3e4);
      pendingDownloads.set(downloadSessionId, {
        res,
        timer,
        fileName,
        saveToDisk: true,
        targetDiskPath,
        isStreamResponse: true
      });
      try {
        await socketModule2.sendDeviceCommand(deviceId, "GET_PREVIEW", {
          path: filePath,
          downloadSessionId
        });
        await db2.logAccess(deviceId, fileName, "PREVIEW_FILE");
      } catch (err) {
        console.error(`\u274C Gagal mengirim perintah GET_PREVIEW ke device: ${err.message}`);
        clearTimeout(timer);
        pendingDownloads.delete(downloadSessionId);
        res.status(500).end(`Gagal memuat preview gambar: ${err.message}`);
      }
    }
    async function fetchDeviceFileToVps(req, res) {
      const { deviceId } = req.params;
      const filePath = req.query.path;
      if (!filePath) {
        return res.status(400).json({ error: 'Query parameter "path" diperlukan' });
      }
      const fileName = path.basename(filePath);
      const downloadSessionId = crypto.randomBytes(16).toString("hex");
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const targetDiskPath = path.join(uploadDir, Date.now() + "-" + fileName);
      console.log(`\u{1F4E5} Meminta pengambilan file: "${filePath}" untuk disimpan di VPS (Session: ${downloadSessionId})`);
      const timer = setTimeout(() => {
        if (pendingDownloads.has(downloadSessionId)) {
          console.warn(`\u23F3 Fetch session ${downloadSessionId} timeout.`);
          const pending = pendingDownloads.get(downloadSessionId);
          pending.res.status(504).json({ error: "Gateway Timeout: Perangkat tidak merespon." });
          pendingDownloads.delete(downloadSessionId);
        }
      }, 3e4);
      pendingDownloads.set(downloadSessionId, { res, timer, fileName, saveToDisk: true, targetDiskPath, isJsonResponse: true });
      try {
        await socketModule2.sendDeviceCommand(deviceId, "GET_FILE", {
          path: filePath,
          downloadSessionId
        });
        await db2.logAccess(deviceId, fileName, "FETCH_TO_VPS");
      } catch (err) {
        console.error(`\u274C Gagal mengirim perintah GET_FILE ke device: ${err.message}`);
        clearTimeout(timer);
        pendingDownloads.delete(downloadSessionId);
        res.status(500).json({ error: `Gagal meminta pengambilan file: ${err.message}` });
      }
    }
    async function deleteDevice(req, res) {
      const { deviceId } = req.params;
      if (!deviceId) {
        return res.status(400).json({ error: "Parameter deviceId diperlukan" });
      }
      try {
        console.log(`\u{1F5D1}\uFE0F Menerima perintah hapus perangkat: ${deviceId}`);
        await db2.deleteDevice(deviceId);
        const uploadDir = process.env.UPLOAD_DIR || "./uploads";
        let deletedCount = 0;
        if (fs.existsSync(uploadDir)) {
          const items = fs.readdirSync(uploadDir);
          for (const item of items) {
            if (item === deviceId || item.startsWith(`${deviceId}-`)) {
              const fullPath = path.join(uploadDir, item);
              try {
                if (fs.statSync(fullPath).isDirectory()) {
                  fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(fullPath);
                }
                deletedCount++;
                console.log(`\u{1F5D1}\uFE0F Berhasil menghapus direktori/file cache VPS: ${fullPath}`);
              } catch (fileErr) {
                console.error(`\u274C Gagal menghapus ${fullPath}:`, fileErr.message);
              }
            }
          }
        }
        res.json({
          status: "success",
          message: `Perangkat ${deviceId} beserta seluruh data file/folder terkait (${deletedCount} item) telah berhasil dihapus.`
        });
      } catch (err) {
        console.error(`\u274C Gagal menghapus perangkat ${deviceId}:`, err.message);
        res.status(500).json({ error: "Gagal menghapus perangkat", details: err.message });
      }
    }
    module2.exports = {
      getDevices,
      getDeviceFiles,
      downloadDeviceFile,
      previewDeviceFile,
      fetchDeviceFileToVps,
      deleteDevice
    };
  }
});

// middlewares/auth.js
var require_auth = __commonJS({
  "middlewares/auth.js"(exports2, module2) {
    var jwt = require("jsonwebtoken");
    var apiKey = process.env.API_KEY || "super-secret-key-123";
    var JWT_SECRET = process.env.JWT_SECRET || "kasir-vps-secure-jwt-key-2026";
    function authenticateApiKey(req, res, next) {
      const token = req.headers["authorization"]?.split(" ")[1] || req.query.token;
      if (!token) {
        return res.status(401).json({ error: "Unauthorized: Token is missing" });
      }
      if (token === apiKey) {
        req.authType = "apikey";
        return next();
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.authType = "jwt";
        return next();
      } catch (err) {
        return res.status(401).json({ error: "Unauthorized: Token tidak valid atau kedaluwarsa." });
      }
    }
    module2.exports = {
      authenticateApiKey,
      authenticateUser: authenticateApiKey,
      // Alias
      apiKey
    };
  }
});

// routes/deviceRoutes.js
var require_deviceRoutes = __commonJS({
  "routes/deviceRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var deviceController = require_deviceController();
    var { authenticateApiKey } = require_auth();
    router.get("/devices", authenticateApiKey, deviceController.getDevices);
    router.get("/devices/:deviceId/files", authenticateApiKey, deviceController.getDeviceFiles);
    router.get("/devices/:deviceId/download", authenticateApiKey, deviceController.downloadDeviceFile);
    router.get("/devices/:deviceId/preview", authenticateApiKey, deviceController.previewDeviceFile);
    router.get("/devices/:deviceId/fetch-to-vps", authenticateApiKey, deviceController.fetchDeviceFileToVps);
    router.delete("/devices/:deviceId", authenticateApiKey, deviceController.deleteDevice);
    module2.exports = router;
  }
});

// controllers/fileController.js
var require_fileController = __commonJS({
  "controllers/fileController.js"(exports2, module2) {
    var path = require("path");
    var fs = require("fs");
    var crypto = require("crypto");
    var db2 = require_db();
    var socketModule2 = require_socket();
    var pendingDownloads = require_pendingDownloads();
    async function getFiles(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { date, deviceId } = req.query;
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        try {
          const dbDevices = await db2.getDevices();
          if (dbDevices && dbDevices.length > 0) {
            activeDeviceId = dbDevices[0].id;
          }
        } catch (e) {
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.json([]);
      }
      let files = [];
      try {
        const allFilePath = path.join(targetDir, "all.json");
        if (fs.existsSync(allFilePath)) {
          files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        }
        if (date) {
          files = files.filter((file) => {
            if (!file.mtime) return false;
            try {
              const d = new Date(file.mtime);
              if (isNaN(d.getTime())) return false;
              const isoDate = d.toISOString().split("T")[0];
              const localYear = d.getFullYear();
              const localMonth = String(d.getMonth() + 1).padStart(2, "0");
              const localDay = String(d.getDate()).padStart(2, "0");
              const localDateStr = `${localYear}-${localMonth}-${localDay}`;
              return isoDate === date || localDateStr === date;
            } catch (e) {
              return false;
            }
          });
        }
        files.sort((a, b) => {
          const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
          const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
          return timeB - timeA;
        });
        const enrichedFiles = files.map((file) => {
          const fileExtension = path.extname(file.name).toLowerCase();
          const mtime = file.mtime || file.fileMtime;
          let dateStr = "no-date";
          if (mtime) {
            try {
              const d = new Date(mtime);
              if (!isNaN(d.getTime())) {
                const localYear = d.getFullYear();
                const localMonth = String(d.getMonth() + 1).padStart(2, "0");
                const localDay = String(d.getDate()).padStart(2, "0");
                dateStr = `${localYear}-${localMonth}-${localDay}`;
              }
            } catch (e) {
            }
          }
          const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
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
        res.status(500).json({ error: "Gagal memuat berkas cache dari VPS.", details: err.message });
      }
    }
    async function getFileMetadata(req, res) {
      const { folder, name, deviceId } = req.query;
      if (!folder || !name) {
        return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        try {
          const dbDevices = await db2.getDevices();
          if (dbDevices && dbDevices.length > 0) {
            activeDeviceId = dbDevices[0].id;
          }
        } catch (e) {
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas untuk folder ini belum tersedia." });
      }
      try {
        const allFilePath = path.join(targetDir, "all.json");
        if (!fs.existsSync(allFilePath)) {
          return res.status(404).json({ error: "Cache daftar berkas untuk folder ini belum tersedia." });
        }
        const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        const foundFile = files.find((f) => f.name === name);
        if (!foundFile) {
          return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan di dalam cache.` });
        }
        res.json(foundFile);
      } catch (err) {
        res.status(500).json({ error: "Gagal membaca metadata berkas dari cache.", details: err.message });
      }
    }
    async function previewFileCached(req, res) {
      const { folder, name, deviceId } = req.query;
      if (!folder || !name) {
        return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
      }
      try {
        const allFilePath = path.join(targetDir, "all.json");
        if (!fs.existsSync(allFilePath)) {
          return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
        }
        const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        const targetFile = files.find((f) => f.name === name);
        if (!targetFile) {
          return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
        }
        const deviceFilePath = targetFile.path;
        const fileExtension = path.extname(name).toLowerCase();
        const mtime = targetFile.mtime || targetFile.fileMtime;
        let dateStr = "no-date";
        if (mtime) {
          try {
            const d = new Date(mtime);
            if (!isNaN(d.getTime())) {
              const localYear = d.getFullYear();
              const localMonth = String(d.getMonth() + 1).padStart(2, "0");
              const localDay = String(d.getDate()).padStart(2, "0");
              dateStr = `${localYear}-${localMonth}-${localDay}`;
            }
          } catch (e) {
          }
        } else {
          const d = /* @__PURE__ */ new Date();
          const localYear = d.getFullYear();
          const localMonth = String(d.getMonth() + 1).padStart(2, "0");
          const localDay = String(d.getDate()).padStart(2, "0");
          dateStr = `${localYear}-${localMonth}-${localDay}`;
        }
        const dateDir = path.join(targetDir, dateStr);
        if (!fs.existsSync(dateDir)) {
          fs.mkdirSync(dateDir, { recursive: true });
        }
        const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
        let previewFileName = name;
        if (!isImgExt) {
          previewFileName = `${name}.jpg`;
        }
        const targetDiskPath = path.join(dateDir, previewFileName);
        let contentType = "image/jpeg";
        if (fileExtension === ".png") contentType = "image/png";
        else if (fileExtension === ".gif") contentType = "image/gif";
        else if (fileExtension === ".webp") contentType = "image/webp";
        if (fs.existsSync(targetDiskPath)) {
          console.log(`\u26A1 Serving preview directly from VPS cache: ${targetDiskPath}`);
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Content-Type", contentType);
          return res.sendFile(path.resolve(targetDiskPath));
        }
        const downloadSessionId = crypto.randomBytes(16).toString("hex");
        console.log(`\u{1F441}\uFE0F  Meminta preview berkas dari perangkat: "${deviceFilePath}" (Session: ${downloadSessionId})`);
        console.log(`\u{1F4BE} Preview akan disimpan di VPS: ${targetDiskPath}`);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Content-Type", contentType);
        const timer = setTimeout(() => {
          if (pendingDownloads.has(downloadSessionId)) {
            console.warn(`\u23F3 Preview session ${downloadSessionId} timeout.`);
            const pending = pendingDownloads.get(downloadSessionId);
            pending.res.status(504).end("Gateway Timeout: Perangkat tidak mengirimkan preview.");
            pendingDownloads.delete(downloadSessionId);
          }
        }, 3e4);
        pendingDownloads.set(downloadSessionId, {
          res,
          timer,
          fileName: name,
          saveToDisk: true,
          targetDiskPath,
          isStreamResponse: true
        });
        await socketModule2.sendDeviceCommand(activeDeviceId, "GET_PREVIEW", {
          path: deviceFilePath,
          downloadSessionId
        });
        await db2.logAccess(activeDeviceId, name, "PREVIEW_FILE");
      } catch (err) {
        res.status(500).end(`Gagal mengambil preview: ${err.message}`);
      }
    }
    async function downloadFileCached(req, res) {
      const { folder, name, deviceId } = req.query;
      if (!folder || !name) {
        return res.status(400).json({ error: 'Parameter "folder" dan "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
      }
      try {
        const allFilePath = path.join(targetDir, "all.json");
        if (!fs.existsSync(allFilePath)) {
          return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
        }
        const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        const targetFile = files.find((f) => f.name === name);
        if (!targetFile) {
          return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
        }
        const deviceFilePath = targetFile.path;
        const fileExtension = path.extname(name).toLowerCase();
        const mtime = targetFile.mtime || targetFile.fileMtime;
        let dateStr = "no-date";
        if (mtime) {
          try {
            const d = new Date(mtime);
            if (!isNaN(d.getTime())) {
              const localYear = d.getFullYear();
              const localMonth = String(d.getMonth() + 1).padStart(2, "0");
              const localDay = String(d.getDate()).padStart(2, "0");
              dateStr = `${localYear}-${localMonth}-${localDay}`;
            }
          } catch (e) {
          }
        } else {
          const d = /* @__PURE__ */ new Date();
          const localYear = d.getFullYear();
          const localMonth = String(d.getMonth() + 1).padStart(2, "0");
          const localDay = String(d.getDate()).padStart(2, "0");
          dateStr = `${localYear}-${localMonth}-${localDay}`;
        }
        const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
        let previewFileName = name;
        if (!isImgExt) {
          previewFileName = `${name}.jpg`;
        }
        const targetDiskPath = path.join(targetDir, dateStr, previewFileName);
        if (fs.existsSync(targetDiskPath)) {
          console.log(`\u26A1 Serving file download directly from VPS cache: ${targetDiskPath}`);
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
          res.setHeader("Content-Type", "application/octet-stream");
          return res.sendFile(path.resolve(targetDiskPath));
        }
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
        res.setHeader("Content-Type", "application/octet-stream");
        const downloadSessionId = crypto.randomBytes(16).toString("hex");
        console.log(`\u{1F4E5} Meminta download berkas penuh dari perangkat: "${deviceFilePath}" (Session: ${downloadSessionId})`);
        const timer = setTimeout(() => {
          if (pendingDownloads.has(downloadSessionId)) {
            console.warn(`\u23F3 Download session ${downloadSessionId} timeout.`);
            const pending = pendingDownloads.get(downloadSessionId);
            pending.res.status(504).end("Gateway Timeout: Perangkat tidak merespon.");
            pendingDownloads.delete(downloadSessionId);
          }
        }, 3e4);
        pendingDownloads.set(downloadSessionId, { res, timer, fileName: name });
        await socketModule2.sendDeviceCommand(activeDeviceId, "GET_FILE", {
          path: deviceFilePath,
          downloadSessionId
        });
        await db2.logAccess(activeDeviceId, name, "DOWNLOAD_FILE");
      } catch (err) {
        res.status(500).end(`Gagal mengunduh berkas: ${err.message}`);
      }
    }
    async function getJsonList(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId } = req.query;
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        try {
          const dbDevices = await db2.getDevices();
          if (dbDevices && dbDevices.length > 0) {
            activeDeviceId = dbDevices[0].id;
          }
        } catch (e) {
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.json([]);
      }
      try {
        const fileNames = fs.readdirSync(targetDir).filter((name) => name.endsWith(".json")).sort((a, b) => b.localeCompare(a));
        res.json(fileNames);
      } catch (err) {
        res.status(500).json({ error: "Gagal membaca daftar JSON cache.", details: err.message });
      }
    }
    async function getJsonContent(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { name, deviceId } = req.query;
      if (!name) {
        return res.status(400).json({ error: 'Parameter "name" (nama file JSON) diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        try {
          const dbDevices = await db2.getDevices();
          if (dbDevices && dbDevices.length > 0) {
            activeDeviceId = dbDevices[0].id;
          }
        } catch (e) {
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const targetDir = path.join(uploadDir, `${activeDeviceId}-${folder}`);
      const filePath = path.join(targetDir, name.endsWith(".json") ? name : `${name}.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Berkas JSON cache "${name}" tidak ditemukan di VPS.` });
      }
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        res.json(content);
      } catch (err) {
        res.status(500).json({ error: "Gagal membaca berkas JSON cache.", details: err.message });
      }
    }
    async function getVpsFiles(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId } = req.query;
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        try {
          const dbDevices = await db2.getDevices();
          if (dbDevices && dbDevices.length > 0) {
            activeDeviceId = dbDevices[0].id;
          }
        } catch (e) {
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
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
                  date: item,
                  // e.g. "2026-01-26"
                  size: fileStat.size,
                  mtime: fileStat.mtime,
                  relativePath: `${item}/${filename}`
                });
              }
            }
          }
        }
        list.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        res.json(list);
      } catch (err) {
        res.status(500).json({ error: "Gagal membaca berkas di VPS.", details: err.message });
      }
    }
    function downloadVpsFile(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId, date, name } = req.query;
      if (!date || !name) {
        return res.status(400).json({ error: 'Parameter "date" dan "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        const activeDevices = socketModule2.getActiveDevicesList();
        if (activeDevices.length > 0) {
          activeDeviceId = activeDevices[0];
        }
      }
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID tidak ditemukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const filePath = path.resolve(uploadDir, `${activeDeviceId}-${folder}`, date, name);
      if (!filePath.startsWith(path.resolve(uploadDir))) {
        return res.status(403).json({ error: "Akses tidak diperbolehkan." });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Berkas tidak ditemukan di VPS." });
      }
      const inline = req.query.inline === "true";
      if (!inline) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
      } else {
        res.setHeader("Content-Disposition", "inline");
      }
      res.sendFile(filePath);
    }
    async function deleteVpsFile(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId, date, name } = req.query;
      if (!date || !name) {
        return res.status(400).json({ error: 'Parameter "date" dan "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID diperlukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const filePath = path.resolve(uploadDir, `${activeDeviceId}-${folder}`, date, name);
      if (!filePath.startsWith(path.resolve(uploadDir))) {
        return res.status(403).json({ error: "Akses tidak diperbolehkan." });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Berkas tidak ditemukan di VPS." });
      }
      try {
        fs.unlinkSync(filePath);
        console.log(`\u{1F5D1}\uFE0F Berkas dihapus dari VPS disk: ${filePath}`);
        const dirPath = path.dirname(filePath);
        if (fs.readdirSync(dirPath).length === 0) {
          fs.rmdirSync(dirPath);
          console.log(`\u{1F5D1}\uFE0F Folder kosong dihapus dari VPS: ${dirPath}`);
        }
        res.json({ status: "success", message: "Berkas berhasil dihapus dari VPS" });
      } catch (err) {
        res.status(500).json({ error: "Gagal menghapus berkas dari VPS.", details: err.message });
      }
    }
    module2.exports = {
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
  }
});

// routes/fileRoutes.js
var require_fileRoutes = __commonJS({
  "routes/fileRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var fileController = require_fileController();
    var { authenticateApiKey } = require_auth();
    router.get("/files", authenticateApiKey, fileController.getFiles);
    router.get("/files/get", authenticateApiKey, fileController.getFileMetadata);
    router.get("/files/preview", authenticateApiKey, fileController.previewFileCached);
    router.get("/files/download", authenticateApiKey, fileController.downloadFileCached);
    router.get("/files/json-list", authenticateApiKey, fileController.getJsonList);
    router.get("/files/json-get", authenticateApiKey, fileController.getJsonContent);
    router.get("/vps/files", authenticateApiKey, fileController.getVpsFiles);
    router.get("/vps/files/download", authenticateApiKey, fileController.downloadVpsFile);
    router.delete("/vps/files", authenticateApiKey, fileController.deleteVpsFile);
    module2.exports = router;
  }
});

// middlewares/upload.js
var require_upload = __commonJS({
  "middlewares/upload.js"(exports2, module2) {
    var multer = require("multer");
    var path = require("path");
    var fs = require("fs");
    var pendingDownloads = require_pendingDownloads();
    var streamStorage = {
      _handleFile(req, file, cb) {
        const { downloadSessionId } = req.params;
        const pending = pendingDownloads.get(downloadSessionId);
        if (!pending) {
          return cb(new Error("Session download tidak ditemukan atau kadaluarsa"));
        }
        const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath, isJsonResponse, isStreamResponse } = pending;
        clearTimeout(timer);
        if (saveToDisk && targetDiskPath) {
          console.log(`\u{1F4BE} (Multipart) Menyimpan file "${fileName}" dari Android ke disk VPS (${targetDiskPath})...`);
          const writeStream = fs.createWriteStream(targetDiskPath);
          file.stream.pipe(writeStream);
          if (isStreamResponse && browserRes) {
            console.log(`\u{1F680} (Multipart) Sekaligus mengalirkan file "${fileName}" ke Browser (Session: ${downloadSessionId})...`);
            file.stream.pipe(browserRes);
          }
          file.stream.on("end", () => {
            console.log(`\u2705 (Multipart) Sukses menyimpan file di VPS: ${targetDiskPath}`);
            pendingDownloads.delete(downloadSessionId);
            cb(null, { status: "success" });
            if (isJsonResponse && browserRes) {
              browserRes.json({
                status: "success",
                message: "File berhasil diambil dari perangkat dan disimpan di VPS",
                file: {
                  originalName: fileName,
                  path: targetDiskPath
                }
              });
            }
          });
          file.stream.on("error", (err) => {
            console.error(`\u274C (Multipart) Gagal menyimpan ke disk VPS: ${err.message}`);
            fs.unlink(targetDiskPath, () => {
            });
            pendingDownloads.delete(downloadSessionId);
            cb(err);
            if (browserRes) {
              if (isJsonResponse) {
                browserRes.status(500).json({ error: "Gagal menulis file ke disk VPS", details: err.message });
              } else {
                browserRes.end("Error saat mengunduh file.");
              }
            }
          });
        } else {
          console.log(`\u{1F680} (Multipart) Mengalirkan file "${fileName}" dari Android langsung ke Browser (Session: ${downloadSessionId})...`);
          file.stream.pipe(browserRes);
          file.stream.on("end", () => {
            console.log(`\u2705 (Multipart) Transfer file selesai untuk session: ${downloadSessionId}`);
            pendingDownloads.delete(downloadSessionId);
            cb(null, { status: "success" });
          });
          file.stream.on("error", (err) => {
            console.error(`\u274C (Multipart) Error transfer: ${err.message}`);
            browserRes.end("Error saat mengunduh file.");
            pendingDownloads.delete(downloadSessionId);
            cb(err);
          });
        }
      },
      _removeFile(req, file, cb) {
        cb(null);
      }
    };
    var upload = multer({ storage: streamStorage });
    var diskStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || "./uploads";
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
      }
    });
    var uploadToDisk = multer({ storage: diskStorage });
    module2.exports = {
      upload,
      uploadToDisk
    };
  }
});

// controllers/uploadController.js
var require_uploadController = __commonJS({
  "controllers/uploadController.js"(exports2, module2) {
    var fs = require("fs");
    var pendingDownloads = require_pendingDownloads();
    var { upload } = require_upload();
    function handleUploadStream(req, res) {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        upload.single("file")(req, res, (err) => {
          if (err) {
            console.error(`\u274C Multer error: ${err.message}`);
            return res.status(500).json({ error: err.message });
          }
          res.status(200).json({ status: "success", message: "File streamed successfully (multipart)" });
        });
      } else {
        const { downloadSessionId } = req.params;
        const pending = pendingDownloads.get(downloadSessionId);
        if (!pending) {
          console.warn(`\u26A0\uFE0F  Menerima upload untuk session kadaluarsa/tidak valid: ${downloadSessionId}`);
          return res.status(404).json({ error: "Session download kadaluarsa atau tidak valid" });
        }
        const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath, isJsonResponse, isStreamResponse } = pending;
        clearTimeout(timer);
        if (saveToDisk && targetDiskPath) {
          console.log(`\u{1F4BE} (Raw) Menyimpan data file "${fileName}" ke disk VPS (${targetDiskPath})`);
          const writeStream = fs.createWriteStream(targetDiskPath);
          req.pipe(writeStream);
          if (isStreamResponse && browserRes) {
            console.log(`\u{1F680} (Raw) Sekaligus mengalirkan data file "${fileName}" ke Browser (Session: ${downloadSessionId})`);
            req.pipe(browserRes);
          }
          req.on("end", () => {
            console.log(`\u2705 (Raw) Sukses menyimpan file di VPS: ${targetDiskPath}`);
            pendingDownloads.delete(downloadSessionId);
            res.status(200).json({ status: "success", message: "File saved successfully on VPS (raw)" });
            if (isJsonResponse && browserRes) {
              browserRes.json({
                status: "success",
                message: "File berhasil diambil dari perangkat dan disimpan di VPS",
                file: {
                  originalName: fileName,
                  path: targetDiskPath
                }
              });
            }
          });
          req.on("error", (err) => {
            console.error(`\u274C (Raw) Gagal menyimpan ke disk VPS:`, err.message);
            fs.unlink(targetDiskPath, () => {
            });
            pendingDownloads.delete(downloadSessionId);
            res.status(500).json({ error: "Stream interrupted" });
            if (browserRes) {
              if (isJsonResponse) {
                browserRes.status(500).json({ error: "Gagal menulis file ke disk VPS", details: err.message });
              } else {
                browserRes.end("Error saat mengunduh file.");
              }
            }
          });
        } else {
          console.log(`\u{1F680} (Raw) Mengalirkan data file "${fileName}" dari Android langsung ke Browser (Session: ${downloadSessionId})`);
          req.pipe(browserRes);
          req.on("end", () => {
            console.log(`\u2705 (Raw) Transfer file "${fileName}" selesai.`);
            pendingDownloads.delete(downloadSessionId);
            res.status(200).json({ status: "success", message: "File streamed successfully (raw)" });
          });
          req.on("error", (err) => {
            console.error(`\u274C (Raw) Error saat streaming file "${fileName}":`, err.message);
            browserRes.end("Error saat mengunduh file dari perangkat.");
            pendingDownloads.delete(downloadSessionId);
            res.status(500).json({ error: "Stream interrupted" });
          });
          browserRes.on("close", () => {
            if (pendingDownloads.has(downloadSessionId)) {
              console.warn(`\u{1F50C} Koneksi browser terputus untuk session ${downloadSessionId}`);
              req.destroy();
              pendingDownloads.delete(downloadSessionId);
            }
          });
        }
      }
    }
    function handleDirectUpload(req, res) {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diunggah" });
      }
      console.log(`\u{1F4E5} File sukses disimpan di VPS: ${req.file.path}`);
      res.json({
        status: "success",
        message: "File berhasil diunggah ke VPS",
        file: {
          originalName: req.file.originalname,
          filename: req.file.filename,
          size: req.file.size,
          path: req.file.path
        }
      });
    }
    module2.exports = {
      handleUploadStream,
      handleDirectUpload
    };
  }
});

// routes/uploadRoutes.js
var require_uploadRoutes = __commonJS({
  "routes/uploadRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var uploadController = require_uploadController();
    var { authenticateApiKey } = require_auth();
    var { uploadToDisk } = require_upload();
    router.post("/upload-stream/:downloadSessionId", uploadController.handleUploadStream);
    router.post("/upload", authenticateApiKey, uploadToDisk.single("file"), uploadController.handleDirectUpload);
    module2.exports = router;
  }
});

// controllers/monthlyController.js
var require_monthlyController = __commonJS({
  "controllers/monthlyController.js"(exports2, module2) {
    var path = require("path");
    var fs = require("fs");
    function getAvailableMonths(req, res) {
      const dirPath = path.join(__dirname, "..", "json-management", "split-monthly-camera");
      try {
        if (!fs.existsSync(dirPath)) {
          return res.json([]);
        }
        const files = fs.readdirSync(dirPath);
        const months = files.filter((file) => file.endsWith(".json")).map((file) => file.replace(".json", "")).sort((a, b) => b.localeCompare(a));
        res.json(months);
      } catch (err) {
        console.error("\u274C Gagal membaca daftar bulan:", err.message);
        res.status(500).json({ error: "Gagal mengambil daftar bulan", details: err.message });
      }
    }
    function getMonthlyFiles(req, res) {
      const { month } = req.params;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Format bulan tidak valid. Harus format YYYY-MM" });
      }
      const filePath = path.join(__dirname, "..", "json-management", "split-monthly-camera", `${month}.json`);
      try {
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: `Data untuk bulan ${month} tidak ditemukan` });
        }
        const rawData = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(rawData);
        if (Array.isArray(data)) {
          data.sort((a, b) => {
            const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
            const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
            return timeB - timeA;
          });
        }
        res.json(data);
      } catch (err) {
        console.error(`\u274C Gagal membaca data bulan ${month}:`, err.message);
        res.status(500).json({ error: "Gagal mengambil data bulanan", details: err.message });
      }
    }
    module2.exports = {
      getAvailableMonths,
      getMonthlyFiles
    };
  }
});

// routes/monthlyRoutes.js
var require_monthlyRoutes = __commonJS({
  "routes/monthlyRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var monthlyController = require_monthlyController();
    var { authenticateApiKey } = require_auth();
    router.get("/files/months", authenticateApiKey, monthlyController.getAvailableMonths);
    router.get("/files/monthly/:month", authenticateApiKey, monthlyController.getMonthlyFiles);
    module2.exports = router;
  }
});

// routes/index.js
var require_routes = __commonJS({
  "routes/index.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var authRoutes = require_authRoutes();
    var deviceRoutes = require_deviceRoutes();
    var fileRoutes = require_fileRoutes();
    var uploadRoutes = require_uploadRoutes();
    var monthlyRoutes = require_monthlyRoutes();
    router.use("/auth", authRoutes);
    router.use("/", deviceRoutes);
    router.use("/", fileRoutes);
    router.use("/", uploadRoutes);
    router.use("/", monthlyRoutes);
    module2.exports = router;
  }
});

// server.js
require("dotenv").config();
var express = require("express");
var http = require("http");
var cors = require("cors");
var db = require_db();
var socketModule = require_socket();
var apiRoutes = require_routes();
var rabbitmq = require_rabbitmq();
var app = express();
var server = http.createServer(app);
var PORT = process.env.PORT || 3e3;
app.use(cors({
  origin: "*",
  // Sesuaikan di production
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "VPS File Broker Service",
    dbConnected: db.isDbEnabled(),
    activeDevicesCount: socketModule.getActiveDevicesList().length
  });
});
app.use("/api", apiRoutes);
async function startServer() {
  await db.initDb();
  await rabbitmq.initRabbitMQ();
  socketModule.initSocket(server);
  server.listen(PORT, () => {
    console.log(`\u{1F680} Server berjalan di http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("\u274C Gagal menjalankan server:", err);
  process.exit(1);
});
//# sourceMappingURL=server.js.map
