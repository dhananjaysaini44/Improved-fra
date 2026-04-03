require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const algosdk = require('algosdk');

// Initialize Algod client using public testnet node
const algodToken = '';
const algodServer = 'https://testnet-api.algonode.cloud';
const algodPort = '';
const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);

async function anchorToAlgorand(localHash) {
  try {
    const mnemonic = process.env.ALGORAND_MNEMONIC;
    if (!mnemonic || mnemonic === 'placeholder') {
      console.warn('ALGORAND_MNEMONIC not set properly. Skipping Algorand anchor.');
      return null;
    }

    // Recover the account from the mnemonic
    const account = algosdk.mnemonicToSecretKey(mnemonic);

    // Get the suggested transaction parameters
    const params = await algodClient.getTransactionParams().do();

    // Create a 0 ALGO payment transaction to self.
    // The security payload (localHash) is packed securely into the Note field.
    const note = new TextEncoder().encode(localHash);
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr.toString(),
      receiver: account.addr.toString(),
      amount: 0,
      note: note,
      suggestedParams: params
    });

    // Sign the transaction
    const signedTxn = txn.signTxn(account.sk);

    // Submit the transaction
    const sendTx = await algodClient.sendRawTransaction(signedTxn).do();
    
    // Wait for confirmation
    try {
      await algosdk.waitForConfirmation(algodClient, sendTx.txid, 10);
    } catch (confirmError) {
      console.warn(`Transaction broadcasted (TXID: ${sendTx.txid}) but confirmation timed out. Continuing...`, confirmError.message);
    }
    
    console.log(`Successfully anchored to Algorand. TX ID: ${sendTx.txid}`);
    return sendTx.txid;
  } catch (error) {
    console.error('Failed to anchor to Algorand:', error);
    return null;
  }
}

module.exports = { anchorToAlgorand };
