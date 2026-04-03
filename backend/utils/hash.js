const crypto = require('crypto');

function generateHash(data) {
  // Convert object to deterministic string and hash
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

module.exports = { generateHash };
