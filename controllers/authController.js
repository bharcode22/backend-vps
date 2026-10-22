const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'kasir-vps-secure-jwt-key-2026';
function getAllowedEmails() {
  const envEmails = process.env.ALLOWED_GOOGLE_EMAIL || 'zaqqwer758@gmail.com';
  return envEmails
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .split(',')
    .map(e => e.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * POST /api/auth/google
 * Login menggunakan Google OAuth dengan Whitelist Email Administrator
 */
async function googleLogin(req, res) {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Credential token Google tidak ditemukan.' });
  }

  try {
    const envClientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/^["']|["']$/g, '');
    const validAudiences = [];

    if (envClientId) {
      envClientId.split(',').forEach(id => {
        const clean = id.trim();
        if (clean && clean !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
          validAudiences.push(clean);
        }
      });
    }

    // Pastikan kedua client ID yang terdaftar di proyek diterima oleh backend
    const knownClientIds = [
      '119948676960-vmvbg7ctvp297nr4s135quq3ia0igv72.apps.googleusercontent.com',
      '1084639382013-5bsvjs217aqckp9r8o6fjd2ru4r46e4b.apps.googleusercontent.com'
    ];
    for (const id of knownClientIds) {
      if (!validAudiences.includes(id)) {
        validAudiences.push(id);
      }
    }

    const client = new OAuth2Client();

    // Verifikasi ID Token langsung ke server Google dengan daftar audience yang valid
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: validAudiences.length === 1 ? validAudiences[0] : validAudiences,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Token Google tidak berisi alamat email.' });
    }

    const userEmail = payload.email.toLowerCase().trim();
    const allowedEmails = getAllowedEmails();

    // STRICT WHITELIST CHECK: Cek apakah email ada di daftar whitelist
    if (!allowedEmails.includes(userEmail)) {
      console.warn(`⚠️ [AUTH DENIED] Email ${userEmail} mencoba login tetapi tidak terdaftar di whitelist: [${allowedEmails.join(', ')}]`);
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
    res.status(401).json({ error: `Verifikasi login Google gagal: ${err.message}` });
  }
}

module.exports = {
  googleLogin
};
