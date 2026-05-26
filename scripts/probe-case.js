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

  const username = rows[0].ec_username; // e.g. 'Oldtree.chen'
  const password = decrypt(rows[0].ec_password);
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK:', !!jar);

  // Case variations to try
  const variations = [
    username,
    username.charAt(0).toUpperCase() + username.slice(1), // Oldtree.chen
    username.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('.'), // Oldtree.Chen
    username.toUpperCase(),
    username.toLowerCase(),
  ];

  const endpoints = [
    '/ecp/Ecp.TsUser.getByLoginName.data',
    '/ecp/Qs.OnlineUser.getItem.data',
    '/ecp/Ecp.Employee.getByLoginName.data',
    '/ecp/Ecp.TsUser.query.data',
  ];

  for (const ep of endpoints) {
    for (const v of [...new Set(variations)]) {
      const r = await post(ep, { loginName: v }, jar);
      const ok = r.raw.length > 5 && r.raw !== '{}' && !r.raw.includes('"_failed":true');
      if (ok) console.log(`HIT: ${ep} loginName=${v} → ${r.raw.substring(0,300)}`);
    }
  }
  console.log('Case probe done.');
}
main().catch(console.error);
