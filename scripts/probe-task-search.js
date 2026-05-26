'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const mysql = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';

function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        const j = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
        try { resolve({ data: JSON.parse(raw), raw, jar: j }); } catch { resolve({ data: raw, raw, jar: j }); }
      });
    }).on('error', reject).end(d);
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: 'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId = tr.data.tokenId;
  const header = { _header_: { tokenId } };

  const r = await post('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 10, keyword: '台鐵' }, jar);
  const tasks = r.data?.items || [];
  console.log(`Found: ${tasks.length} task(s)\n`);
  tasks.forEach(t => {
    console.log('=== Task ===');
    // Print every field
    Object.entries(t).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') console.log(`  ${k}: ${v}`);
    });
  });
}
main().catch(console.error);
