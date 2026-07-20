const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE_NAME = 'chat.direct';

let connection = null;
let channel = null;
const activeConsumers = new Map(); // phoneNumber -> consumerTag

async function initRabbitMQ() {
  try {
    console.log(`🔌 Menghubungkan ke RabbitMQ di: ${RABBITMQ_URL}`);
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // Assert exchange
    await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
    console.log('✅ Terhubung ke RabbitMQ dan Exchange "chat.direct" siap.');
    
    // Handle error / close
    connection.on('error', (err) => {
      console.error('❌ Koneksi RabbitMQ error:', err.message);
    });
    
    connection.on('close', () => {
      console.warn('⚠️ Koneksi RabbitMQ ditutup. Mencoba menghubungkan kembali...');
      connection = null;
      channel = null;
      setTimeout(initRabbitMQ, 5000);
    });
    
  } catch (error) {
    console.error('❌ Gagal menghubungkan ke RabbitMQ:', error.message);
    console.log('🔄 Mencoba menghubungkan kembali dalam 5 detik...');
    setTimeout(initRabbitMQ, 5000);
  }
}

async function getChannel() {
  if (!channel) {
    throw new Error('RabbitMQ channel belum siap. Pastikan koneksi berhasil.');
  }
  return channel;
}

/**
 * Setup queue untuk user jika belum ada
 */
async function setupUserQueue(phoneNumber) {
  const ch = await getChannel();
  const queueName = `user.${phoneNumber}`;
  
  // Assert queue agar persistent
  await ch.assertQueue(queueName, { 
    durable: true,
    arguments: {
      'x-message-ttl': 604800000 // Pesan expire setelah 7 hari jika tidak dibaca
    }
  });
  
  // Bind queue ke exchange direct dengan routing key yang sama dengan nama queue
  await ch.bindQueue(queueName, EXCHANGE_NAME, queueName);
  return queueName;
}

/**
 * Publish pesan ke queue penerima
 */
async function publishMessage(toPhone, messageData) {
  try {
    const ch = await getChannel();
    const queueName = `user.${toPhone}`;
    
    // Pastikan queue penerima terbuat/terikat
    await setupUserQueue(toPhone);
    
    const buffer = Buffer.from(JSON.stringify(messageData));
    ch.publish(EXCHANGE_NAME, queueName, buffer, {
      persistent: true // Agar pesan tersimpan di disk
    });
    console.log(`✉️  Pesan di-publish ke queue: ${queueName}`);
    return true;
  } catch (error) {
    console.error(`❌ Gagal publish pesan ke ${toPhone}:`, error.message);
    return false;
  }
}

/**
 * Mendengarkan pesan dari queue user
 */
async function startConsume(phoneNumber, onMessageCallback) {
  try {
    const ch = await getChannel();
    const queueName = `user.${phoneNumber}`;
    
    // Pastikan queue terbuat
    await setupUserQueue(phoneNumber);
    
    // Jika sudah ada consumer aktif, stop dulu
    if (activeConsumers.has(phoneNumber)) {
      await stopConsume(phoneNumber);
    }
    
    console.log(`📥 Mulai consume queue untuk user: ${phoneNumber}`);
    const consumeResult = await ch.consume(queueName, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          const deliverySuccess = await onMessageCallback(content);
          
          if (deliverySuccess) {
            // Acknowledge pesan hanya jika sukses dikirim ke client (Socket.io)
            ch.ack(msg);
          } else {
            // Requeue jika pengiriman gagal
            ch.nack(msg, false, true);
          }
        } catch (err) {
          console.error(`Error memproses pesan queue ${phoneNumber}:`, err.message);
          // Nack and reject, do not requeue if formatting is broken
          ch.nack(msg, false, false);
        }
      }
    }, { noAck: false });
    
    activeConsumers.set(phoneNumber, consumeResult.consumerTag);
  } catch (error) {
    console.error(`❌ Gagal start consume untuk ${phoneNumber}:`, error.message);
  }
}

/**
 * Stop mendengarkan queue user
 */
async function stopConsume(phoneNumber) {
  try {
    const consumerTag = activeConsumers.get(phoneNumber);
    if (consumerTag) {
      const ch = await getChannel();
      await ch.cancel(consumerTag);
      activeConsumers.delete(phoneNumber);
      console.log(`⏹️  Consume dihentikan untuk user: ${phoneNumber}`);
    }
  } catch (error) {
    console.error(`❌ Gagal stop consume untuk ${phoneNumber}:`, error.message);
  }
}

module.exports = {
  initRabbitMQ,
  publishMessage,
  startConsume,
  stopConsume
};
