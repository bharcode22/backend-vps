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
    module2.exports = {
      initDb,
      upsertDevice,
      getDevices,
      logAccess,
      isDbEnabled: () => dbEnabled
    };
  }
});

// socket.js
var require_socket = __commonJS({
  "socket.js"(exports2, module2) {
    var { Server } = require("socket.io");
    var db2 = require_db();
    var apiKey = process.env.API_KEY || "super-secret-key-123";
    var activeDevices = /* @__PURE__ */ new Map();
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
        if (token !== apiKey) {
          console.warn(`\u26A0\uFE0F  Koneksi Socket ditolak karena token salah dari IP: ${socket.handshake.address}`);
          return next(new Error("Unauthorized: Token invalid"));
        }
        next();
      });
      io.on("connection", (socket) => {
        const clientType = socket.handshake.query?.clientType;
        const deviceId = socket.handshake.query?.deviceId;
        console.log(`\u{1F50C} Koneksi baru dari ${clientType || "unknown"} (IP: ${socket.handshake.address})`);
        if (clientType === "android" && deviceId) {
          activeDevices.set(deviceId, socket);
          socket.deviceId = deviceId;
          console.log(`\u{1F4F1} Android Device terdaftar: ${deviceId}`);
          db2.upsertDevice(deviceId, "online");
          socket.broadcast.emit("device_status_change", { deviceId, status: "online" });
        }
        socket.on("disconnect", () => {
          console.log(`\u{1F50C} Koneksi terputus dari IP: ${socket.handshake.address}`);
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

// routes.js
var require_routes = __commonJS({
  "routes.js"(exports2, module2) {
    var express2 = require("express");
    var router = express2.Router();
    var path = require("path");
    var fs = require("fs");
    var crypto = require("crypto");
    var db2 = require_db();
    var socketModule2 = require_socket();
    var pendingDownloads = /* @__PURE__ */ new Map();
    var apiKey = process.env.API_KEY || "super-secret-key-123";
    function authenticateApiKey(req, res, next) {
      const token = req.headers["authorization"]?.split(" ")[1] || req.query.token;
      if (token !== apiKey) {
        return res.status(401).json({ error: "Unauthorized: API Key invalid" });
      }
      next();
    }
    router.get("/devices", authenticateApiKey, async (req, res) => {
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
    });
    router.get("/devices/:deviceId/files", authenticateApiKey, async (req, res) => {
      const { deviceId } = req.params;
      const folder = req.query.folder || "DCIM";
      try {
        console.log(`\u{1F50D} Meminta daftar file folder "${folder}" dari device ${deviceId}`);
        const files = await socketModule2.sendDeviceCommand(deviceId, "LIST_FILES", { folder });
        await db2.logAccess(deviceId, folder, "LIST_FILES");
        res.json(files);
      } catch (err) {
        res.status(504).json({ error: "Gagal mendapatkan daftar file dari perangkat", details: err.message });
      }
    });
    router.get("/devices/:deviceId/download", authenticateApiKey, async (req, res) => {
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
    });
    var multer = require("multer");
    var streamStorage = {
      _handleFile(req, file, cb) {
        const { downloadSessionId } = req.params;
        const pending = pendingDownloads.get(downloadSessionId);
        if (!pending) {
          return cb(new Error("Session download tidak ditemukan atau kadaluarsa"));
        }
        const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath } = pending;
        clearTimeout(timer);
        if (saveToDisk && targetDiskPath) {
          console.log(`\u{1F4BE} (Multipart) Menyimpan file "${fileName}" dari Android ke disk VPS (${targetDiskPath})...`);
          const writeStream = fs.createWriteStream(targetDiskPath);
          file.stream.pipe(writeStream);
          file.stream.on("end", () => {
            console.log(`\u2705 (Multipart) Sukses menyimpan file di VPS: ${targetDiskPath}`);
            pendingDownloads.delete(downloadSessionId);
            cb(null, { status: "success" });
            browserRes.json({
              status: "success",
              message: "File berhasil diambil dari perangkat dan disimpan di VPS",
              file: {
                originalName: fileName,
                path: targetDiskPath
              }
            });
          });
          file.stream.on("error", (err) => {
            console.error(`\u274C (Multipart) Gagal menyimpan ke disk VPS: ${err.message}`);
            fs.unlink(targetDiskPath, () => {
            });
            pendingDownloads.delete(downloadSessionId);
            cb(err);
            browserRes.status(500).json({ error: "Gagal menulis file ke disk VPS", details: err.message });
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
    router.post("/upload-stream/:downloadSessionId", (req, res) => {
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
        const { res: browserRes, timer, fileName, saveToDisk, targetDiskPath } = pending;
        clearTimeout(timer);
        if (saveToDisk && targetDiskPath) {
          console.log(`\u{1F4BE} (Raw) Menyimpan data file "${fileName}" ke disk VPS (${targetDiskPath})`);
          const writeStream = fs.createWriteStream(targetDiskPath);
          req.pipe(writeStream);
          req.on("end", () => {
            console.log(`\u2705 (Raw) Sukses menyimpan file di VPS: ${targetDiskPath}`);
            pendingDownloads.delete(downloadSessionId);
            res.status(200).json({ status: "success", message: "File saved successfully on VPS (raw)" });
            browserRes.json({
              status: "success",
              message: "File berhasil diambil dari perangkat dan disimpan di VPS",
              file: {
                originalName: fileName,
                path: targetDiskPath
              }
            });
          });
          req.on("error", (err) => {
            console.error(`\u274C (Raw) Gagal menyimpan ke disk VPS:`, err.message);
            fs.unlink(targetDiskPath, () => {
            });
            pendingDownloads.delete(downloadSessionId);
            res.status(500).json({ error: "Stream interrupted" });
            browserRes.status(500).json({ error: "Gagal menulis file ke disk VPS", details: err.message });
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
    });
    router.get("/devices/:deviceId/fetch-to-vps", authenticateApiKey, async (req, res) => {
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
      pendingDownloads.set(downloadSessionId, { res, timer, fileName, saveToDisk: true, targetDiskPath });
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
    });
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
    router.post("/upload", authenticateApiKey, uploadToDisk.single("file"), (req, res) => {
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
    });
    router.get("/devices/:deviceId/preview", authenticateApiKey, async (req, res) => {
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
      const downloadSessionId = crypto.randomBytes(16).toString("hex");
      console.log(`\u{1F441}\uFE0F  Browser meminta preview: "${filePath}" (Session: ${downloadSessionId})`);
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
      pendingDownloads.set(downloadSessionId, { res, timer, fileName });
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
    });
    router.get("/files/months", authenticateApiKey, (req, res) => {
      const dirPath = path.join(__dirname, "json-management", "split-monthly-camera");
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
    });
    router.get("/files/monthly/:month", authenticateApiKey, (req, res) => {
      const { month } = req.params;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Format bulan tidak valid. Harus format YYYY-MM" });
      }
      const filePath = path.join(__dirname, "json-management", "split-monthly-camera", `${month}.json`);
      try {
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: `Data untuk bulan ${month} tidak ditemukan` });
        }
        const rawData = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(rawData);
        res.json(data);
      } catch (err) {
        console.error(`\u274C Gagal membaca data bulan ${month}:`, err.message);
        res.status(500).json({ error: "Gagal mengambil data bulanan", details: err.message });
      }
    });
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
