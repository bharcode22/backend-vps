const jwt = require('jsonwebtoken');

const apiKey = process.env.API_KEY || 'super-secret-key-123';
const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';

function authenticateApiKey(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Token is missing' });
  }

  // 1. Cek apakah token adalah static API Key (untuk mobile / scripts)
  if (token === apiKey) {
    req.authType = 'apikey';
    return next();
  }

  // 2. Jika bukan API Key, coba verifikasi sebagai JWT (untuk web client)
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.authType = 'jwt';
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Token tidak valid atau kedaluwarsa.' });
  }
}

module.exports = {
  authenticateApiKey,
  authenticateUser: authenticateApiKey, // Alias
  apiKey
};
