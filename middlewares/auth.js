const apiKey = process.env.API_KEY || 'super-secret-key-123';

function authenticateApiKey(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;

  if (token !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized: API Key invalid' });
  }
  next();
}

module.exports = {
  authenticateApiKey,
  apiKey
};
