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
    var memoryUploadedFiles = [];
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
    async function registerChatUser(phoneNumber, pinHash, deviceId) {
      if (dbEnabled && prisma) {
        try {
          let existing2 = await prisma.user.findUnique({ where: { phoneNumber } });
          if (existing2) {
            if (existing2.password && existing2.password !== "no-password") {
              return { success: false, error: `Nomor HP ${phoneNumber} sudah terdaftar. Silakan gunakan menu Login.` };
            }
            await prisma.user.update({
              where: { phoneNumber },
              data: { password: pinHash }
            });
            return { success: true, user: existing2 };
          }
          const newUser = await prisma.user.create({
            data: {
              username: `user_${phoneNumber}`,
              password: pinHash,
              phoneNumber
            }
          });
          return { success: true, user: newUser };
        } catch (err) {
          console.error("Error saat registerChatUser (Prisma):", err.message);
          throw err;
        }
      }
      let existing = Array.from(memoryUsers.values()).find((u) => u.phoneNumber === phoneNumber);
      if (existing) {
        if (existing.password && existing.password !== "no-password") {
          return { success: false, error: `Nomor HP ${phoneNumber} sudah terdaftar. Silakan gunakan menu Login.` };
        }
        existing.password = pinHash;
        return { success: true, user: existing };
      }
      const id = memoryUsers.size + 1;
      const user = {
        id,
        username: `user_${phoneNumber}`,
        password: pinHash,
        phoneNumber,
        createdAt: /* @__PURE__ */ new Date()
      };
      memoryUsers.set(`user_${phoneNumber}`, user);
      return { success: true, user };
    }
    async function verifyChatUserPin(phoneNumber, pinHash) {
      let user = null;
      if (dbEnabled && prisma) {
        try {
          user = await prisma.user.findUnique({ where: { phoneNumber } });
        } catch (err) {
          console.error("Error saat verifyChatUserPin (Prisma):", err.message);
        }
      } else {
        user = Array.from(memoryUsers.values()).find((u) => u.phoneNumber === phoneNumber);
      }
      if (!user) {
        return { success: false, error: `Nomor HP ${phoneNumber} belum terdaftar.` };
      }
      if (user.password !== pinHash && user.password !== "no-password") {
        return { success: false, error: "PIN yang Anda masukkan salah." };
      }
      return { success: true, user };
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
    async function saveUploadedFile(fileData) {
      const fileRecord = {
        originalName: fileData.originalName || fileData.originalname,
        filename: fileData.filename,
        size: fileData.size,
        mimeType: fileData.mimeType || fileData.mimetype || "application/octet-stream",
        path: fileData.path,
        downloadUrl: fileData.downloadUrl,
        createdAt: /* @__PURE__ */ new Date()
      };
      if (dbEnabled && prisma) {
        try {
          const created = await prisma.uploadedFile.create({
            data: fileRecord
          });
          return created;
        } catch (err) {
          console.error("Error saat menyimpan uploaded file ke database (Prisma):", err.message);
        }
      }
      const newRecord = {
        id: memoryUploadedFiles.length + 1,
        ...fileRecord
      };
      memoryUploadedFiles.unshift(newRecord);
      return newRecord;
    }
    async function getUploadedFiles() {
      if (dbEnabled && prisma) {
        try {
          const files = await prisma.uploadedFile.findMany({
            orderBy: { createdAt: "desc" }
          });
          return files;
        } catch (err) {
          console.error("Error saat mengambil uploaded files dari database (Prisma):", err.message);
        }
      }
      return [...memoryUploadedFiles];
    }
    async function findUploadedFileById(id) {
      const parsedId = typeof id === "number" ? id : parseInt(id, 10);
      if (dbEnabled && prisma) {
        try {
          if (!isNaN(parsedId)) {
            const file = await prisma.uploadedFile.findUnique({
              where: { id: parsedId }
            });
            if (file) return file;
          }
        } catch (err) {
          console.error("Error saat mencari uploaded file di DB (Prisma):", err.message);
        }
      }
      return memoryUploadedFiles.find((f) => f.id === parsedId || String(f.id) === String(id) || f.filename === id);
    }
    async function updateUploadedFile(id, updateData) {
      const parsedId = typeof id === "number" ? id : parseInt(id, 10);
      const dataToUpdate = {
        originalName: updateData.originalName || updateData.originalname,
        size: updateData.size,
        mimeType: updateData.mimeType || updateData.mimetype,
        path: updateData.path,
        downloadUrl: updateData.downloadUrl
      };
      if (dbEnabled && prisma) {
        try {
          if (!isNaN(parsedId)) {
            const updated = await prisma.uploadedFile.update({
              where: { id: parsedId },
              data: dataToUpdate
            });
            return updated;
          }
        } catch (err) {
          console.error("Error saat update uploaded file di DB (Prisma):", err.message);
        }
      }
      const index = memoryUploadedFiles.findIndex((f) => f.id === parsedId || String(f.id) === String(id) || f.filename === id);
      if (index !== -1) {
        memoryUploadedFiles[index] = {
          ...memoryUploadedFiles[index],
          ...dataToUpdate
        };
        return memoryUploadedFiles[index];
      }
      return null;
    }
    async function deleteUploadedFile(id) {
      const parsedId = typeof id === "number" ? id : parseInt(id, 10);
      if (dbEnabled && prisma) {
        try {
          if (!isNaN(parsedId)) {
            await prisma.uploadedFile.delete({
              where: { id: parsedId }
            });
            return true;
          }
        } catch (err) {
          console.error("Error saat menghapus uploaded file dari DB (Prisma):", err.message);
        }
      }
      const index = memoryUploadedFiles.findIndex((f) => f.id === parsedId || String(f.id) === String(id) || f.filename === id);
      if (index !== -1) {
        memoryUploadedFiles.splice(index, 1);
        return true;
      }
      return false;
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
      registerChatUser,
      verifyChatUserPin,
      saveMessage,
      markMessagesAsRead,
      deleteMessage,
      deleteConversation,
      updateUserOnlineStatus,
      getUserStatus,
      getChatHistory,
      getRecentChats,
      saveUploadedFile,
      getUploadedFiles,
      findUploadedFileById,
      updateUploadedFile,
      deleteUploadedFile,
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
      const message = `<code>${deviceId}</code>
<b>Waktu:</b> ${formattedTime} WIB
`;
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
        },
        maxHttpBufferSize: 1e8,
        // 100MB max buffer agar payload JSON 4000+ berkas tidak memutuskan koneksi socket
        pingTimeout: 6e4,
        // 60s ping timeout
        pingInterval: 25e3
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
          socket.on("register_account", async (data, callback) => {
            const { phoneNumber: phoneNumber2, pinHash, deviceId: deviceId2 } = data || {};
            if (!phoneNumber2 || !pinHash) {
              if (callback) callback({ success: false, error: "Nomor HP dan PIN wajib diisi." });
              return;
            }
            try {
              const result = await db2.registerChatUser(phoneNumber2, pinHash, deviceId2);
              if (callback) callback(result);
            } catch (err) {
              console.error(`\u274C Gagal registrasi akun:`, err.message);
              if (callback) callback({ success: false, error: "Gagal memproses registrasi di server." });
            }
          });
          socket.on("login_account", async (data, callback) => {
            const { phoneNumber: phoneNumber2, pinHash, deviceId: deviceId2 } = data || {};
            if (!phoneNumber2 || !pinHash) {
              if (callback) callback({ success: false, error: "Nomor HP dan PIN wajib diisi." });
              return;
            }
            try {
              const result = await db2.verifyChatUserPin(phoneNumber2, pinHash);
              if (callback) callback(result);
            } catch (err) {
              console.error(`\u274C Gagal login akun:`, err.message);
              if (callback) callback({ success: false, error: "Gagal memproses login di server." });
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
    function sendDeviceCommand(deviceId, action, payload = {}, timeoutMs = 6e4) {
      return new Promise((resolve, reject) => {
        const socket = activeDevices.get(deviceId);
        if (!socket) {
          return reject(new Error("Device sedang offline atau tidak terdaftar"));
        }
        const effectiveTimeout = timeoutMs || 6e4;
        socket.timeout(effectiveTimeout).emit("device_command", { action, ...payload }, (err, response) => {
          if (err) {
            reject(new Error(`Perangkat tidak merespon (Timeout ${Math.round(effectiveTimeout / 1e3)}s)`));
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
    var jwt = require("jsonwebtoken");
    var { OAuth2Client } = require("google-auth-library");
    var JWT_SECRET = process.env.JWT_SECRET || "kasir-vps-secure-jwt-key-2026";
    function getAllowedEmails() {
      const envEmails = process.env.ALLOWED_GOOGLE_EMAIL || "zaqqwer758@gmail.com";
      return envEmails.replace(/^["']|["']$/g, "").toLowerCase().split(",").map((e) => e.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    async function googleLogin(req, res) {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: "Credential token Google tidak ditemukan." });
      }
      try {
        const envClientId = (process.env.GOOGLE_CLIENT_ID || "").replace(/^["']|["']$/g, "");
        const validAudiences = [];
        if (envClientId) {
          envClientId.split(",").forEach((id) => {
            const clean = id.trim();
            if (clean && clean !== "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com") {
              validAudiences.push(clean);
            }
          });
        }
        const knownClientIds = [
          "119948676960-vmvbg7ctvp297nr4s135quq3ia0igv72.apps.googleusercontent.com",
          "1084639382013-5bsvjs217aqckp9r8o6fjd2ru4r46e4b.apps.googleusercontent.com"
        ];
        for (const id of knownClientIds) {
          if (!validAudiences.includes(id)) {
            validAudiences.push(id);
          }
        }
        const client = new OAuth2Client();
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: validAudiences.length === 1 ? validAudiences[0] : validAudiences
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
          return res.status(400).json({ error: "Token Google tidak berisi alamat email." });
        }
        const userEmail = payload.email.toLowerCase().trim();
        const allowedEmails = getAllowedEmails();
        if (!allowedEmails.includes(userEmail)) {
          console.warn(`\u26A0\uFE0F [AUTH DENIED] Email ${userEmail} mencoba login tetapi tidak terdaftar di whitelist: [${allowedEmails.join(", ")}]`);
          return res.status(403).json({
            error: `Akses ditolak. Email (${userEmail}) tidak memiliki izin administrator.`
          });
        }
        const token = jwt.sign(
          { id: payload.sub, username: userEmail, email: userEmail },
          JWT_SECRET,
          { expiresIn: "7d" }
        );
        console.log(`\u2705 [AUTH SUCCESS] Login Google berhasil untuk email admin: ${userEmail}`);
        res.json({
          status: "success",
          message: "Login Google berhasil.",
          token,
          user: {
            id: payload.sub,
            username: userEmail,
            name: payload.name || userEmail,
            picture: payload.picture
          }
        });
      } catch (err) {
        console.error("\u274C Gagal memverifikasi Google token:", err.message);
        res.status(401).json({ error: `Verifikasi login Google gagal: ${err.message}` });
      }
    }
    module2.exports = {
      googleLogin
    };
  }
});

// routes/authRoutes.js
var require_authRoutes = __commonJS({
  "routes/authRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var authController = require_authController();
    router.post("/google", authController.googleLogin);
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
    var path2 = require("path");
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
        console.log(`\u{1F50D} Meminta daftar file folder "${folder}" dari device ${deviceId}${date ? ` (Filter Tgl: ${date})` : ""}`);
        let files = await socketModule2.sendDeviceCommand(deviceId, "LIST_FILES", { folder, date }, 6e4);
        if (files && files.error) {
          console.warn(`\u26A0\uFE0F Perangkat ${deviceId} melaporkan status error: ${files.error}`);
          return res.status(400).json({ error: files.error, files: [] });
        }
        if (!Array.isArray(files)) {
          files = [];
        }
        if (Array.isArray(files)) {
          try {
            const uploadDir = process.env.UPLOAD_DIR || "./uploads";
            const targetDir = path2.join(uploadDir, `${deviceId}-${folder}`);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            const allFilePath = path2.join(targetDir, "all.json");
            fs.writeFileSync(allFilePath, JSON.stringify(files, null, 2), "utf8");
            console.log(`\u{1F4BE} Sukses menyimpan seluruh response di VPS: ${allFilePath}`);
          } catch (saveErr) {
            console.error("\u274C Gagal menyimpan cache JSON berkas di VPS:", saveErr.message);
          }
          files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
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
      const fileName = path2.basename(filePath);
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
      const fileName = path2.basename(filePath);
      const fileExtension = path2.extname(filePath).toLowerCase();
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
        folder = path2.dirname(relative);
      } else {
        const parent = path2.dirname(filePath);
        folder = parent.startsWith("/") ? parent.substring(1) : parent;
      }
      let mtime = null;
      try {
        const uploadDir2 = process.env.UPLOAD_DIR || "./uploads";
        const allFilePath = path2.join(uploadDir2, `${deviceId}-${folder}`, "all.json");
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
      const dateDir = path2.join(uploadDir, `${deviceId}-${folder}`, dateStr);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }
      const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
      let previewFileName = fileName;
      if (!isImgExt) {
        previewFileName = `${fileName}.jpg`;
      }
      const targetDiskPath = path2.join(dateDir, previewFileName);
      if (fs.existsSync(targetDiskPath)) {
        console.log(`\u26A1 Serving preview directly from VPS cache (live route): ${targetDiskPath}`);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Content-Type", contentType);
        return res.sendFile(path2.resolve(targetDiskPath));
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
      const fileName = path2.basename(filePath);
      const downloadSessionId = crypto.randomBytes(16).toString("hex");
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const targetDiskPath = path2.join(uploadDir, Date.now() + "-" + fileName);
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
              const fullPath = path2.join(uploadDir, item);
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
      const token = req.headers["authorization"]?.split(" ")[1] || req.headers["x-api-key"] || req.query.token || req.query.apiKey;
      if (!token) {
        return res.status(401).json({ error: "Unauthorized: Token is missing" });
      }
      if (token === apiKey || req.query.apiKey === apiKey || req.headers["x-api-key"] === apiKey) {
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
    var path2 = require("path");
    var fs = require("fs");
    var crypto = require("crypto");
    var db2 = require_db();
    var socketModule2 = require_socket();
    var pendingDownloads = require_pendingDownloads();
    async function getFiles(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      let { date, deviceId } = req.query;
      if (date === "today") {
        const now = /* @__PURE__ */ new Date();
        const localYear = now.getFullYear();
        const localMonth = String(now.getMonth() + 1).padStart(2, "0");
        const localDay = String(now.getDate()).padStart(2, "0");
        date = `${localYear}-${localMonth}-${localDay}`;
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        if (folder === "Root" || folder === "/" || !folder) {
          const list = [];
          if (fs.existsSync(uploadDir)) {
            const found = /* @__PURE__ */ new Set();
            for (const entry of fs.readdirSync(uploadDir)) {
              if (entry.startsWith(`${activeDeviceId}-`)) {
                const rootName = entry.substring(`${activeDeviceId}-`.length);
                if (rootName) found.add(rootName);
              }
            }
            for (const std of ["DCIM", "Pictures", "Download", "Documents", "WhatsApp"]) {
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
        const allFilePath = path2.join(targetDir, "all.json");
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
          const fileExtension = path2.extname(file.name).toLowerCase();
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
          const fileDiskPath = path2.join(targetDir, dateStr, previewFileName);
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas untuk folder ini belum tersedia." });
      }
      try {
        const allFilePath = path2.join(targetDir, "all.json");
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
      }
      try {
        const allFilePath = path2.join(targetDir, "all.json");
        if (!fs.existsSync(allFilePath)) {
          return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
        }
        const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        const targetFile = files.find((f) => f.name === name);
        if (!targetFile) {
          return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
        }
        const deviceFilePath = targetFile.path;
        const fileExtension = path2.extname(name).toLowerCase();
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
        const dateDir = path2.join(targetDir, dateStr);
        if (!fs.existsSync(dateDir)) {
          fs.mkdirSync(dateDir, { recursive: true });
        }
        const isImgExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"].includes(fileExtension);
        let previewFileName = name;
        if (!isImgExt) {
          previewFileName = `${name}.jpg`;
        }
        const targetDiskPath = path2.join(dateDir, previewFileName);
        let contentType = "image/jpeg";
        if (fileExtension === ".png") contentType = "image/png";
        else if (fileExtension === ".gif") contentType = "image/gif";
        else if (fileExtension === ".webp") contentType = "image/webp";
        if (fs.existsSync(targetDiskPath)) {
          console.log(`\u26A1 Serving preview directly from VPS cache: ${targetDiskPath}`);
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Content-Type", contentType);
          return res.sendFile(path2.resolve(targetDiskPath));
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
      }
      try {
        const allFilePath = path2.join(targetDir, "all.json");
        if (!fs.existsSync(allFilePath)) {
          return res.status(404).json({ error: "Cache daftar berkas belum tersedia. Akses /devices/:deviceId/files terlebih dahulu." });
        }
        const files = JSON.parse(fs.readFileSync(allFilePath, "utf8"));
        const targetFile = files.find((f) => f.name === name);
        if (!targetFile) {
          return res.status(404).json({ error: `Berkas "${name}" tidak ditemukan.` });
        }
        const deviceFilePath = targetFile.path;
        const fileExtension = path2.extname(name).toLowerCase();
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
        const targetDiskPath = path2.join(targetDir, dateStr, previewFileName);
        if (fs.existsSync(targetDiskPath)) {
          console.log(`\u26A1 Serving file download directly from VPS cache: ${targetDiskPath}`);
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
          res.setHeader("Content-Type", "application/octet-stream");
          return res.sendFile(path2.resolve(targetDiskPath));
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
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
      const targetDir = path2.join(uploadDir, `${activeDeviceId}-${folder}`);
      const filePath = path2.join(targetDir, name.endsWith(".json") ? name : `${name}.json`);
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
      let folderParam = req.query.folder || "";
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
      if (!fs.existsSync(uploadDir)) {
        return res.json([]);
      }
      try {
        const list = [];
        const isRoot = !folderParam || folderParam === "Root" || folderParam === "/" || folderParam === "";
        if (isRoot) {
          const foundFolders = /* @__PURE__ */ new Set();
          const allEntries = fs.readdirSync(uploadDir);
          for (const entry of allEntries) {
            const fullPath = path2.join(uploadDir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
              if (entry.startsWith(`${activeDeviceId}-`)) {
                const rootFolderName = entry.substring(`${activeDeviceId}-`.length);
                if (rootFolderName) foundFolders.add(rootFolderName);
              }
            }
          }
          const standardFolders = ["DCIM", "Pictures", "Download", "Documents", "WhatsApp", "Movies", "Music"];
          for (const std of standardFolders) {
            foundFolders.add(std);
          }
          for (const folderName of Array.from(foundFolders).sort()) {
            const fullDirPath = path2.join(uploadDir, `${activeDeviceId}-${folderName}`);
            let mtime = /* @__PURE__ */ new Date();
            if (fs.existsSync(fullDirPath)) {
              mtime = fs.statSync(fullDirPath).mtime;
            }
            list.push({
              name: folderName,
              isDirectory: true,
              isFile: false,
              date: null,
              folder: "Root",
              deviceId: activeDeviceId,
              size: 0,
              mtime,
              path: folderName,
              relativePath: folderName
            });
          }
          return res.json(list);
        }
        if (folderParam === "all") {
          const allDirs = fs.readdirSync(uploadDir);
          for (const d of allDirs) {
            let scanDeepFiles2 = function(curDir, subRelPath) {
              const items2 = fs.readdirSync(curDir);
              for (const item of items2) {
                if (item === "all.json" || item.startsWith(".")) continue;
                const itemPath = path2.join(curDir, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                  scanDeepFiles2(itemPath, subRelPath ? `${subRelPath}/${item}` : item);
                } else if (stat.isFile()) {
                  let itemDate = null;
                  let itemFolder = baseFolder;
                  let itemRelPath = subRelPath ? `${subRelPath}/${item}` : item;
                  if (subRelPath) {
                    const subParts = subRelPath.split(/[/\\]+/).filter(Boolean);
                    if (subParts.length > 0) {
                      const lastSegment = subParts[subParts.length - 1];
                      if (/^\d{4}-\d{2}-\d{2}$/.test(lastSegment) || lastSegment === "no-date") {
                        itemDate = lastSegment;
                        const folderSegments = subParts.slice(0, -1);
                        itemFolder = folderSegments.length > 0 ? `${baseFolder}/${folderSegments.join("/")}` : baseFolder;
                        itemRelPath = `${itemDate}/${item}`;
                      } else {
                        itemFolder = `${baseFolder}/${subParts.join("/")}`;
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
            };
            var scanDeepFiles = scanDeepFiles2;
            if (!d.startsWith(`${activeDeviceId}-`)) continue;
            const fullDirPath = path2.join(uploadDir, d);
            if (!fs.statSync(fullDirPath).isDirectory()) continue;
            const baseFolder = d.substring(`${activeDeviceId}-`.length);
            scanDeepFiles2(fullDirPath, "");
          }
          list.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
          return res.json(list);
        }
        const normFolder = folderParam.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
        const parts = normFolder.split(/[/\\]+/).filter(Boolean);
        const rootPart = `${activeDeviceId}-${parts[0]}`;
        const remainingParts = parts.slice(1);
        const targetDir = path2.resolve(uploadDir, rootPart, ...remainingParts);
        if (!targetDir.startsWith(path2.resolve(uploadDir))) {
          return res.status(403).json({ error: "Akses tidak diperbolehkan." });
        }
        if (!fs.existsSync(targetDir)) {
          return res.json([]);
        }
        const items = fs.readdirSync(targetDir);
        for (const item of items) {
          if (item === "all.json" || item.startsWith(".")) continue;
          const itemPath = path2.join(targetDir, item);
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            const isDateFolder = /^\d{4}-\d{2}-\d{2}$/.test(item) || item === "no-date";
            if (isDateFolder) {
              const subFiles = fs.readdirSync(itemPath);
              for (const subFilename of subFiles) {
                if (subFilename === "all.json" || subFilename.startsWith(".")) continue;
                const subFilePath = path2.join(itemPath, subFilename);
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
        list.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return new Date(b.mtime) - new Date(a.mtime);
        });
        res.json(list);
      } catch (err) {
        res.status(500).json({ error: "Gagal membaca berkas di VPS.", details: err.message });
      }
    }
    function downloadVpsFile(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId, date, name, relativePath } = req.query;
      if (!name) {
        return res.status(400).json({ error: 'Parameter "name" diperlukan.' });
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
      const normFolder = (folder || "").replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
      const parts = normFolder.split(/[/\\]+/).filter(Boolean);
      const basePart = parts.length > 0 ? parts[0] : "";
      const rootPart = basePart ? `${activeDeviceId}-${basePart}` : activeDeviceId;
      const remainingParts = parts.slice(1);
      const targetDir = path2.resolve(uploadDir, rootPart, ...remainingParts);
      const baseDeviceDir = path2.resolve(uploadDir, rootPart);
      function findFileDeep(dir, targetName, maxDepth = 4, curDepth = 0) {
        if (curDepth > maxDepth || !fs.existsSync(dir)) return null;
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            if (entry === "all.json" || entry.startsWith(".")) continue;
            const full = path2.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isFile() && entry === targetName) {
              return full;
            } else if (stat.isDirectory()) {
              const found = findFileDeep(full, targetName, maxDepth, curDepth + 1);
              if (found) return found;
            }
          }
        } catch (_) {
        }
        return null;
      }
      let filePath = null;
      if (relativePath) {
        const relClean = relativePath.replace(/^[/\\]+/, "");
        const cand1 = path2.resolve(targetDir, relClean);
        if (fs.existsSync(cand1) && fs.statSync(cand1).isFile()) filePath = cand1;
        if (!filePath) {
          const cand2 = path2.resolve(baseDeviceDir, relClean);
          if (fs.existsSync(cand2) && fs.statSync(cand2).isFile()) filePath = cand2;
        }
      }
      if (!filePath && date && date !== "undefined" && date !== "null" && date !== "no-date") {
        const candidate = path2.resolve(targetDir, date, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      }
      if (!filePath) {
        const candidate = path2.resolve(targetDir, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      }
      if (!filePath && fs.existsSync(targetDir)) {
        try {
          const subItems = fs.readdirSync(targetDir);
          for (const sub of subItems) {
            const candidate = path2.resolve(targetDir, sub, name);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              filePath = candidate;
              break;
            }
          }
        } catch (_) {
        }
      }
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
              const found = findFileDeep(path2.join(uploadDir, d), name);
              if (found) {
                filePath = found;
                break;
              }
            }
          }
        } catch (_) {
        }
      }
      if (!filePath || !filePath.startsWith(path2.resolve(uploadDir)) || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Berkas tidak ditemukan di VPS." });
      }
      const inline = req.query.inline === "true";
      if (!inline) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
      } else {
        res.setHeader("Content-Disposition", "inline");
        const ext = path2.extname(name).toLowerCase();
        if ([".jpg", ".jpeg"].includes(ext)) res.setHeader("Content-Type", "image/jpeg");
        else if (ext === ".png") res.setHeader("Content-Type", "image/png");
        else if (ext === ".webp") res.setHeader("Content-Type", "image/webp");
        else if (ext === ".gif") res.setHeader("Content-Type", "image/gif");
      }
      res.sendFile(filePath);
    }
    async function deleteVpsFile(req, res) {
      const folder = req.query.folder || "DCIM/Camera";
      const { deviceId, date, name, relativePath } = req.query;
      if (!name) {
        return res.status(400).json({ error: 'Parameter "name" diperlukan.' });
      }
      let activeDeviceId = deviceId;
      if (!activeDeviceId) {
        return res.status(400).json({ error: "Device ID diperlukan." });
      }
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      const normFolder = (folder || "").replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
      const parts = normFolder.split(/[/\\]+/).filter(Boolean);
      const basePart = parts.length > 0 ? parts[0] : "";
      const rootPart = basePart ? `${activeDeviceId}-${basePart}` : activeDeviceId;
      const remainingParts = parts.slice(1);
      const targetDir = path2.resolve(uploadDir, rootPart, ...remainingParts);
      const baseDeviceDir = path2.resolve(uploadDir, rootPart);
      function findFileDeep(dir, targetName, maxDepth = 4, curDepth = 0) {
        if (curDepth > maxDepth || !fs.existsSync(dir)) return null;
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            if (entry === "all.json" || entry.startsWith(".")) continue;
            const full = path2.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isFile() && entry === targetName) {
              return full;
            } else if (stat.isDirectory()) {
              const found = findFileDeep(full, targetName, maxDepth, curDepth + 1);
              if (found) return found;
            }
          }
        } catch (_) {
        }
        return null;
      }
      let filePath = null;
      if (relativePath) {
        const relClean = relativePath.replace(/^[/\\]+/, "");
        const cand1 = path2.resolve(targetDir, relClean);
        if (fs.existsSync(cand1) && fs.statSync(cand1).isFile()) filePath = cand1;
        if (!filePath) {
          const cand2 = path2.resolve(baseDeviceDir, relClean);
          if (fs.existsSync(cand2) && fs.statSync(cand2).isFile()) filePath = cand2;
        }
      }
      if (!filePath && date && date !== "undefined" && date !== "null" && date !== "no-date") {
        const candidate = path2.resolve(targetDir, date, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      }
      if (!filePath) {
        const candidate = path2.resolve(targetDir, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      }
      if (!filePath && fs.existsSync(targetDir)) {
        try {
          const subItems = fs.readdirSync(targetDir);
          for (const sub of subItems) {
            const candidate = path2.resolve(targetDir, sub, name);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              filePath = candidate;
              break;
            }
          }
        } catch (_) {
        }
      }
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
              const found = findFileDeep(path2.join(uploadDir, d), name);
              if (found) {
                filePath = found;
                break;
              }
            }
          }
        } catch (_) {
        }
      }
      if (!filePath || !filePath.startsWith(path2.resolve(uploadDir)) || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Berkas tidak ditemukan di VPS." });
      }
      try {
        fs.unlinkSync(filePath);
        console.log(`\u{1F5D1}\uFE0F Berkas dihapus dari VPS disk: ${filePath}`);
        const dirPath = path2.dirname(filePath);
        if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
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
    var path2 = require("path");
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
        const directUploadDir2 = process.env.DIRECT_UPLOAD_DIR || "./upload-file";
        if (!fs.existsSync(directUploadDir2)) {
          fs.mkdirSync(directUploadDir2, { recursive: true });
        }
        cb(null, directUploadDir2);
      },
      filename: (req, file, cb) => {
        const ext = path2.extname(file.originalname).toLowerCase();
        const sanitizedBase = path2.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, `${sanitizedBase}-${uniqueSuffix}${ext}`);
      }
    });
    var fileFilter = (req, file, cb) => {
      cb(null, true);
    };
    var uploadToDisk = multer({
      storage: diskStorage,
      limits: {
        fileSize: 200 * 1024 * 1024
        // Max 200MB
      },
      fileFilter
    });
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
    var db2 = require_db();
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
    async function handleDirectUpload(req, res) {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diunggah" });
      }
      const host = req.get("x-forwarded-host") || req.get("host");
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const downloadUrl = `${protocol}://${host}/upload-file/${req.file.filename}`;
      console.log(`\u{1F4E5} File sukses disimpan di VPS (folder upload-file): ${req.file.path}`);
      const fileData = {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        path: req.file.path,
        downloadUrl
      };
      const savedRecord = await db2.saveUploadedFile(fileData);
      res.json({
        status: "success",
        message: "File berhasil diunggah ke VPS",
        file: savedRecord || fileData
      });
    }
    async function getUploadedFilesList(req, res) {
      try {
        const files = await db2.getUploadedFiles();
        const reqProtocol = req.headers["x-forwarded-proto"] || req.protocol;
        const formattedFiles = files.map((file) => {
          let downloadUrl = file.downloadUrl;
          if (downloadUrl && (reqProtocol === "https" || req.secure)) {
            if (downloadUrl.startsWith("http://")) {
              downloadUrl = downloadUrl.replace(/^http:\/\//, "https://");
            }
          }
          return { ...file, downloadUrl };
        });
        res.json({
          status: "success",
          data: formattedFiles
        });
      } catch (err) {
        console.error("\u274C Gagal mengambil daftar uploaded files:", err.message);
        res.status(500).json({ error: "Gagal mengambil daftar file terunggah" });
      }
    }
    async function handleUpdateFile(req, res) {
      try {
        const { id } = req.params;
        if (!req.file) {
          return res.status(400).json({ error: "Tidak ada file baru yang diunggah untuk penggantian" });
        }
        const existing = await db2.findUploadedFileById(id);
        if (!existing) {
          if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(404).json({ error: "File tidak ditemukan di database" });
        }
        if (fs.existsSync(existing.path)) {
          fs.copyFileSync(req.file.path, existing.path);
          fs.unlinkSync(req.file.path);
        } else {
          fs.renameSync(req.file.path, existing.path);
        }
        const updatePayload = {
          originalName: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          path: existing.path,
          downloadUrl: existing.downloadUrl
        };
        const updatedRecord = await db2.updateUploadedFile(existing.id || id, updatePayload);
        console.log(`\u{1F504} File ID ${id} (${existing.filename}) berhasil diperbarui dengan isi file baru.`);
        res.json({
          status: "success",
          message: "File berhasil diperbarui (URL download tetap sama)",
          file: updatedRecord || { ...existing, ...updatePayload }
        });
      } catch (err) {
        console.error("\u274C Error saat update file:", err.message);
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: "Gagal memperbarui file" });
      }
    }
    async function handleDeleteFile(req, res) {
      try {
        const { id } = req.params;
        const existing = await db2.findUploadedFileById(id);
        if (!existing) {
          return res.status(404).json({ error: "File tidak ditemukan" });
        }
        if (existing.path && fs.existsSync(existing.path)) {
          try {
            fs.unlinkSync(existing.path);
            console.log(`\u{1F5D1}\uFE0F  File fisik terhapus dari VPS: ${existing.path}`);
          } catch (e) {
            console.warn(`\u26A0\uFE0F  Gagal menghapus file fisik ${existing.path}:`, e.message);
          }
        }
        await db2.deleteUploadedFile(existing.id || id);
        res.json({
          status: "success",
          message: "File berhasil dihapus"
        });
      } catch (err) {
        console.error("\u274C Error saat menghapus file:", err.message);
        res.status(500).json({ error: "Gagal menghapus file" });
      }
    }
    module2.exports = {
      handleUploadStream,
      handleDirectUpload,
      getUploadedFilesList,
      handleUpdateFile,
      handleDeleteFile
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
    router.get("/upload/files", uploadController.getUploadedFilesList);
    router.post("/upload", authenticateApiKey, uploadToDisk.single("file"), uploadController.handleDirectUpload);
    router.put("/upload/files/:id", authenticateApiKey, uploadToDisk.single("file"), uploadController.handleUpdateFile);
    router.delete("/upload/files/:id", authenticateApiKey, uploadController.handleDeleteFile);
    module2.exports = router;
  }
});

// controllers/monthlyController.js
var require_monthlyController = __commonJS({
  "controllers/monthlyController.js"(exports2, module2) {
    var path2 = require("path");
    var fs = require("fs");
    function getAvailableMonths(req, res) {
      const dirPath = path2.join(__dirname, "..", "json-management", "split-monthly-camera");
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
      const filePath = path2.join(__dirname, "..", "json-management", "split-monthly-camera", `${month}.json`);
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

// routes/systemRoutes.js
var require_systemRoutes = __commonJS({
  "routes/systemRoutes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var os = require("os");
    var fs = require("fs");
    router.get("/metrics", (req, res) => {
      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercentage = totalMem > 0 ? parseFloat((usedMem / totalMem * 100).toFixed(1)) : 0;
        const processMem = process.memoryUsage();
        let diskInfo = null;
        try {
          if (typeof fs.statfsSync === "function") {
            const stats = fs.statfsSync("/");
            const bsize = stats.bsize || stats.frsize || 4096;
            const totalDisk = stats.blocks * bsize;
            const freeDisk = stats.bavail * bsize;
            const usedDisk = totalDisk - freeDisk;
            const diskPercentage = totalDisk > 0 ? parseFloat((usedDisk / totalDisk * 100).toFixed(1)) : 0;
            diskInfo = {
              total: totalDisk,
              used: usedDisk,
              free: freeDisk,
              percentage: diskPercentage
            };
          }
        } catch (diskErr) {
          console.warn("Gagal mengambil statfs disk:", diskErr.message);
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
        const cpus = os.cpus() || [];
        const cpuCount = cpus.length;
        const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown CPU";
        const loadAvg = os.loadavg();
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
            loadavg: loadAvg.map((val) => parseFloat(val.toFixed(2)))
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
        console.error("Error fetching system metrics:", err);
        res.status(500).json({ error: "Gagal mengambil metrik sistem server" });
      }
    });
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
    var systemRoutes = require_systemRoutes();
    router.use("/auth", authRoutes);
    router.use("/system", systemRoutes);
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
var path = require("path");
var db = require_db();
var socketModule = require_socket();
var apiRoutes = require_routes();
var rabbitmq = require_rabbitmq();
var app = express();
app.set("trust proxy", true);
var server = http.createServer(app);
var PORT = process.env.PORT || 3e3;
app.use(cors({
  origin: "*",
  // Sesuaikan di production
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
var legacyUploadDir = process.env.UPLOAD_DIR || "uploads";
app.use("/uploads", express.static(path.resolve(legacyUploadDir)));
var directUploadDir = process.env.DIRECT_UPLOAD_DIR || "upload-file";
app.use("/upload-file", express.static(path.resolve(directUploadDir), {
  setHeaders: (res, filePath) => {
    const filename = path.basename(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  }
}));
app.use((req, res, next) => {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.url}`);
  next();
});
var healthCheckHandler = (req, res) => {
  res.json({
    status: "online",
    service: "VPS File Broker Service",
    dbConnected: db.isDbEnabled(),
    activeDevicesCount: socketModule.getActiveDevicesList().length
  });
};
app.get("/", healthCheckHandler);
app.get("/api/health", healthCheckHandler);
app.use("/api", apiRoutes);
app.use((err, req, res, next) => {
  console.error(`\u{1F4A5} Express Error pada ${req.method} ${req.url}:`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error", message: err.message, stack: process.env.NODE_ENV === "development" ? err.stack : void 0 });
  }
});
process.on("uncaughtException", (err) => {
  console.error("\u{1F4A5} Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("\u{1F4A5} Unhandled Rejection:", reason);
});
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
