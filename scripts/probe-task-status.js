'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST   = 'econtact.ai3.cloud';

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
  const conn = await mysql.createConnection({
    host: 'db', port: 3306,
    user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!',
    database: process.env.DB_NAME||'line_punch_system'
  });
  const [rows] = await conn.execute(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='Oldtree.chen' LIMIT 1"
  );
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  console.log('User:', username);

  // QS Login
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL');

  // QSVD — get ALL records (no active filter)
  let page = 0, allRecs = [];
  while (true) {
    const r = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', {
      listId:   '296aa935-f6c0-4a8e-9ab9-32254ea39861',
      schemaId: 'b158be99-606a-4dc9-aa7f-53f50b16059a',
      keyword: '', queryFormRecent: {}, start: page * 50, limit: 50,
    }, jar);
    const recs = r.data?.data?.records || [];
    allRecs.push(...recs);
    if (recs.length < 50) break;
    if (++page > 10) break;
  }

  console.log(`\nTotal QSVD records: ${allRecs.length}`);
  console.log('\n=== All tasks with FStatus ===');
  allRecs.forEach(t => {
    console.log(`  FId: ${t.FId}`);
    console.log(`  FName: ${t.FName}`);
    console.log(`  FStatus: ${t.FStatus}  FStatus$: ${t['FStatus$']}`);
    console.log(`  FUserId: ${t.FUserId}  FUserId$: ${t['FUserId$']}`);
    console.log('  ---');
  });
}
main().catch(console.error);
