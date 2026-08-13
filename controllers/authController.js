const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';
const ALLOWED_EMAIL = (process.env.ALLOWED_GOOGLE_EMAIL || 'zaqqwer758@gmail.com').toLowerCase().trim();

/**
 * POST /api/auth/google
 * Login menggunakan Google OAuth dengan Whitelist Email Tunggal (zaqqwer758@gmail.com)
 */
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
  googleLogin
};
