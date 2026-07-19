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

module.exports = {
  register,
  login
};
