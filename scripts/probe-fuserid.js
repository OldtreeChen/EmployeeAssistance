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
  const [rows] = await conn.execute('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: rows[0].ec_username }, lr.jar);
  const h = { _header_: { tokenId: tr.data.tokenId } };

  const myUserId = rows[0].employee_id; // bbc693e1-e448-11ed-b376-0607bbc2ee97
  console.log('My TsUser FId (employee_id):', myUserId);

  // Scan pages, track FUserId distribution and find tasks matching myUserId
  const myTasks = [];
  const fUserIdSamples = {};  // collect unique FUserIds
  let total = 0;

  for (let p = 0; p < 30; p++) {
    const r = await post('/ecp/openapi/ecp/task/list', { ...h, start: p * 50, limit: 50 }, lr.jar);
    const items = r.data?.items || [];
    total += items.length;
    items.forEach(t => {
      // Collect FUserId samples
      if (t.FUserId && !fUserIdSamples[t.FUserId]) {
        fUserIdSamples[t.FUserId] = t.FUserId$||'';
      }
      // Match tasks by FUserId
      if (t.FUserId === myUserId) {
        myTasks.push(t);
      }
    });
    if (!r.data?.hasNextPage) {
      console.log(`Scanned ${total} tasks (${p+1} pages)`);
      break;
    }
  }
  if (total === 1500) console.log('Scanned 1500 tasks (30 pages, stopped)');

  console.log('\nFUserId → name samples (first 10):');
  Object.entries(fUserIdSamples).slice(0, 10).forEach(([id, name]) => console.log(`  ${id}: ${name}`));

  console.log(`\nTasks where FUserId=${myUserId}: ${myTasks.length}`);
  myTasks.slice(0, 10).forEach(t =>
    console.log(`  [${t.FStatus}/${t.FStatus$}] ${t.FName}`)
  );

  // Also try keyword search for the specific task
  console.log('\n=== Keyword search ===');
  for (const kw of ['台鐵串接', 'Ldap架構', '台鐵LDAP', 'ldap架構', '台鐵串接L']) {
    const r = await post('/ecp/openapi/ecp/task/list', { ...h, start: 0, limit: 5, keyword: kw }, lr.jar);
    const cnt = r.data?.items?.length || 0;
    console.log(`  "${kw}": ${cnt}${cnt ? ' → ' + r.data.items.map(t=>t.FName).join(' | ') : ''}`);
  }
}
main().catch(console.error);
