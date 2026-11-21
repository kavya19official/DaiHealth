'use strict';

const fs = require('node:fs');
const { verifyReceipt } = require('../backend/consentAudit');

const [receiptPath, trustedKeyPath] = process.argv.slice(2);
if (!receiptPath || !trustedKeyPath) {
  console.error('Usage: node scripts/verify-consent-receipt.cjs <receipt.json> <trusted-public-key.pem>');
  process.exitCode = 2;
} else {
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (!verifyReceipt(receipt, fs.readFileSync(trustedKeyPath, 'utf8'))) {
      console.error('Receipt signature could not be verified with this key.');
      process.exitCode = 1;
    } else {
      console.log('Receipt signature verified.');
    }
  } catch {
    console.error('Could not read the receipt or verification key.');
    process.exitCode = 2;
  }
}
