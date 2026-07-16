const express = require('express');
const router = express.Router();

const deviceRoutes = require('./deviceRoutes');
const fileRoutes = require('./fileRoutes');
const uploadRoutes = require('./uploadRoutes');
const monthlyRoutes = require('./monthlyRoutes');

// Mount sub-routers under the root of the main router
// Since this router is mounted under '/api' in server.js,
// these will resolve to /api/devices, /api/files, etc.
router.use('/', deviceRoutes);
router.use('/', fileRoutes);
router.use('/', uploadRoutes);
router.use('/', monthlyRoutes);

module.exports = router;
