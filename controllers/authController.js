const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';

// 1. POST /api/auth/register - Register a new user (Unexposed on frontend)
async function register(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password diperlukan.' });
  }

  try {
    // Cek apakah user sudah terdaftar
    const existingUser = await db.findUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Simpan ke database/memory
    const newUser = await db.createUser(username, passwordHash);

    res.status(201).json({
      status: 'success',
      message: 'Registrasi berhasil.',
      user: {
        id: newUser.id,
        username: newUser.username
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal melakukan registrasi.', details: err.message });
  }
}

// 2. POST /api/auth/login - Login and obtain a JWT
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password diperlukan.' });
  }

  try {
    // Cari user
    const user = await db.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    // Bandingkan password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    // Buat token JWT (berlaku 7 hari)
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      status: 'success',
      message: 'Login berhasil.',
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal melakukan login.', details: err.message });
  }
}

// 3. POST /api/auth/google - Login menggunakan Google OAuth dengan Whitelist Email
const { OAuth2Client } = require('google-auth-library');
const ALLOWED_EMAIL = (process.env.ALLOWED_GOOGLE_EMAIL || 'zaqqwer758@gmail.com').toLowerCase().trim();

async function googleLogin(req, res) {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Credential token Google tidak ditemukan.' });
  }

  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(googleClientId);
    
    // Verifikasi ID Token langsung ke server Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: googleClientId && googleClientId !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com' ? googleClientId : undefined,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Token Google tidak berisi alamat email.' });
    }

    const userEmail = payload.email.toLowerCase().trim();

    // STRICT WHITELIST CHECK: Hanya zaqqwer758@gmail.com yang diperbolehkan!
    if (userEmail !== ALLOWED_EMAIL) {
      console.warn(`⚠️ [AUTH DENIED] Email ${userEmail} mencoba login tetapi ditolak.`);
      return res.status(403).json({
        error: `Akses ditolak. Email (${userEmail}) tidak memiliki izin administrator.`
      });
    }

    // Buat token JWT internal aplikasi (berlaku 7 hari)
    const token = jwt.sign(
      { id: payload.sub, username: userEmail, email: userEmail },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ [AUTH SUCCESS] Login Google berhasil untuk email admin: ${userEmail}`);

    res.json({
      status: 'success',
      message: 'Login Google berhasil.',
      token,
      user: {
        id: payload.sub,
        username: userEmail,
        name: payload.name || userEmail,
        picture: payload.picture
      }
    });
  } catch (err) {
    console.error('❌ Gagal memverifikasi Google token:', err.message);
    res.status(401).json({ error: 'Verifikasi login Google gagal.', details: err.message });
  }
}

module.exports = {
  register,
  login,
  googleLogin
};
