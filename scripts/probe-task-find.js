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

  const keywords = ['台鐵', 'Ldap', 'ldap', 'LDAP', '串接', '台鐵串接'];
  let allTasks = [];

  // Scan ALL pages without limit
  console.log('Scanning all pages...');
  for (let p = 0; p < 100; p++) {
    const r = await post('/ecp/openapi/ecp/task/list', { ...header, start: p * 50, limit: 50 }, jar);
    const items = r.data?.items || [];
    allTasks.push(...items);
    if (!r.data?.hasNextPage) {
      console.log(`Last page: ${p}, total tasks scanned: ${allTasks.length}`);
      break;
    }
    if (p % 10 === 9) process.stdout.write(`...page ${p+1} (${allTasks.length} tasks so far)\n`);
  }

  console.log(`\nTotal tasks: ${allTasks.length}`);

  for (const kw of keywords) {
    const hits = allTasks.filter(t => t.FName && t.FName.includes(kw));
    if (hits.length) {
      console.log(`\n=== Keyword "${kw}": ${hits.length} hit(s) ===`);
      hits.forEach(t => {
        console.log(`  FName:         ${t.FName}`);
        console.log(`  FStatus:       ${t.FStatus} (${t.FStatus$})`);
        console.log(`  FAssignUserId: ${t.FAssignUserId}`);
        // All user-related fields
        Object.keys(t).filter(k => /user|assign|owner|executor|member/i.test(k))
          .forEach(k => { if (t[k]) console.log(`  ${k}: ${t[k]}`); });
        console.log('  ---');
      });
    } else {
      console.log(`Keyword "${kw}": not found`);
    }
  }

  // Also show status distribution
  const dist = {};
  allTasks.forEach(t => { const k=`${t.FStatus}(${t.FStatus$})`; dist[k]=(dist[k]||0)+1; });
  console.log('\nStatus distribution:', JSON.stringify(dist));
}
main().catch(console.error);
