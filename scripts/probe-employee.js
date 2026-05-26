'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';
function httpPost(path, body, jar) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { const j=(res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '); try{resolve({data:JSON.parse(raw),raw,jar:j})}catch{resolve({data:raw,raw,jar:j})}});
    }).on('error', reject).end(d);
  });
}
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: rows[0].ec_username }, jar);
  const tokenId = tr.data.tokenId;
  const header  = { _header_: { tokenId } };
  console.log('Token employee:', JSON.stringify(tr.data.employee));
  console.log('Token departments:', JSON.stringify(tr.data.department));

  // 1. Try /application/apply to find all identities
  console.log('\n=== /application/apply ===');
  const apps = [
    { loginType: 'aiff', loginName: rows[0].ec_username, tenantCode: '' },
    { loginType: 'aiff', loginName: rows[0].ec_username, tenantCode: '', ...header },
  ];
  for (const body of apps) {
    const r = await httpPost('/ecp/openapi/application/apply', body, jar);
    if (r.raw.length > 5) console.log('application/apply:', r.raw.substring(0, 400));
  }

  // 2. Try task list with userId filter (known from user's payload)
  const knownUserId = 'bbc693e1-e448-11ed-b376-0607bbc2ee97';
  console.log('\n=== Task list with userId filter ===');
  const r1 = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 50, userId: knownUserId }, jar);
  console.log('userId filter result count:', r1.data?.items?.length, 'hasNextPage:', r1.data?.hasNextPage);
  if (r1.data?.items?.length) {
    console.log('FAssignUserId$ samples:', r1.data.items.slice(0,3).map(t => t.FAssignUserId$).join(', '));
    // Collect all status values
    const statuses = {};
    r1.data.items.forEach(t => { statuses[t.FStatus] = t.FStatus$; });
    console.log('Statuses in results:', JSON.stringify(statuses));
  }

  // 3. Try task list with assignUserId filter
  console.log('\n=== Task list with assignUserId filter ===');
  const r2 = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 50, assignUserId: knownUserId }, jar);
  console.log('assignUserId filter count:', r2.data?.items?.length);
  if (r2.data?.items?.length) {
    const statuses = {};
    r2.data.items.forEach(t => { statuses[t.FStatus] = t.FStatus$; });
    console.log('Statuses:', JSON.stringify(statuses));
    console.log('First item FAssignUserId$:', r2.data.items[0]?.FAssignUserId$);
  }

  // 4. Check all status values across pages for default token user
  console.log('\n=== All status values (pages 1-5) ===');
  const allStatuses = {};
  for (let p = 0; p < 5; p++) {
    const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: p*50, limit: 50 }, jar);
    (r.data?.items||[]).forEach(t => { allStatuses[t.FStatus] = t.FStatus$; });
    if (!r.data?.hasNextPage) break;
  }
  console.log('All status values found:', JSON.stringify(allStatuses));
}
main().catch(console.error);
