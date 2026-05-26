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

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: rows[0].ec_username }, lr.jar);
  const h = { _header_: { tokenId: tr.data.tokenId } };

  const keywords = ['Ldap', 'ldap', 'LDAP', '串接', '鐵路', 'TRA', '2026', '台鐵串'];
  for (const kw of keywords) {
    const r = await post('/ecp/openapi/ecp/task/list', { ...h, start: 0, limit: 5, keyword: kw }, lr.jar);
    const items = r.data?.items || [];
    const names = items.map(t => t.FName).join(' | ');
    console.log(`keyword="${kw}": ${items.length} result(s)${names ? ' → ' + names : ''}`);
  }
}
main().catch(console.error);
