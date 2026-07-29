require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const socketModule = require('./socket');
const apiRoutes = require('./routes');
const rabbitmq = require('./utils/rabbitmq');

const app = express();
const server = http.createServer(app);

// Port server
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*', // Sesuaikan di production
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploaded files with Content-Disposition attachment (Direct Download)
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.resolve(uploadDir), {
  setHeaders: (res, filePath) => {
    const filename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
}));

// Lacak request log sederhana
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root endpoint untuk health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'VPS File Broker Service',
    dbConnected: db.isDbEnabled(),
    activeDevicesCount: socketModule.getActiveDevicesList().length
  });
});

// Daftarkan route API
app.use('/api', apiRoutes);

// Jalankan Server & Inisialisasi Database
async function startServer() {
  // Inisialisasi koneksi PostgreSQL (dengan in-memory fallback otomatis jika gagal)
  await db.initDb();

  // Inisialisasi RabbitMQ
  await rabbitmq.initRabbitMQ();

  // Inisialisasi Socket.IO
  socketModule.initSocket(server);

  // Jalankan server HTTP
  server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('❌ Gagal menjalankan server:', err);
  process.exit(1);
});
