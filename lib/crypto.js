'use strict';
/**
 * 簡單的對稱加解密，用於保護儲存在 DB 的 e-Contact 密碼
 * 金鑰從 .env 的 ENCRYPT_KEY 取得（32 bytes hex string）
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_HEX   = process.env.ENCRYPT_KEY || 'default_dev_key_32bytes_0000000000'; // 務必在 .env 設定

function getKey() {
  // 確保 key 是 32 bytes
  return Buffer.from(KEY_HEX.padEnd(32, '0').slice(0, 32));
}

function encrypt(plaintext) {
  const iv  = crypto.randomBytes(16);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decrypt(ciphertext) {
  const [ivHex, enc] = ciphertext.split(':');
  const iv  = Buffer.from(ivHex, 'hex');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

module.exports = { encrypt, decrypt };
