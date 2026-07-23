const https = require('https');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7907582347:AAHFFbSQOB4XskWVi2dN3Hy7X8phLbqzPCI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1339211296';

/**
 * Kirim pesan teks ke Telegram Chat ID via HTTPS Request
 * @param {string} text - Pesan (mendukung format HTML)
 */
function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('⚠️ Telegram Bot Token atau Chat ID tidak dikonfigurasi.');
    return Promise.resolve(false);
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            console.log(`💬 Notifikasi Telegram dikirim ke chat ${chatId}`);
            resolve(true);
          } else {
            console.error(`❌ Gagal kirim notifikasi Telegram:`, parsed.description);
            resolve(false);
          }
        } catch (e) {
          console.error(`❌ Response Telegram invalid JSON:`, data);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`❌ Error koneksi Telegram API:`, err.message);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Notifikasi ketika perangkat Android yang sebelumnya offline menjadi online
 * @param {string} deviceId - ID perangkat Android
 */
async function notifyDeviceOnline(deviceId) {
  const formattedTime = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Jakarta'
  });

  const message = `🟢 <b>PERANGKAT ONLINE</b>\n\n` +
    `📱 <b>Device ID:</b> <code>${deviceId}</code>\n` +
    `⏰ <b>Waktu:</b> ${formattedTime} WIB\n`;

  return sendTelegramMessage(message);
}

module.exports = {
  sendTelegramMessage,
  notifyDeviceOnline
};
