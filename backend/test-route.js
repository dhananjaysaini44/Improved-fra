require('dotenv').config();
const db = require('./db');
const { anchorToAlgorand } = require('./services/algorand');
const { generateHash } = require('./utils/hash');

async function testRoute() {
  try {
    const claimData = { id: 999, action: 'approved', admin_id: 1 };
    const localHash = generateHash(claimData);
    console.log('Hash generated:', localHash);

    const txId = await anchorToAlgorand(localHash);
    console.log('TX ID:', txId);

    db.prepare(
      'INSERT INTO audit_ledger (claim_id, action, admin_id, local_hash, algorand_tx_id) VALUES (?, ?, ?, ?, ?)'
    ).run(888, 'approved', 1, localHash, txId);

    console.log('DB insert successful');
    console.log(db.prepare('SELECT * FROM audit_ledger WHERE claim_id = 888').all());

  } catch(err) {
    console.log('ERROR:', err.message);
    console.log(err);
  }
}

testRoute();
