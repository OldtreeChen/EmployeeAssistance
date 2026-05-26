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
      res.on('end', () => { const j = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '); try{resolve({data:JSON.parse(raw),raw,jar:j})}catch{resolve({data:raw,raw,jar:j})} });
    }).on('error', reject).end(d);
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);

  // 1. QuickSilver login
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  if (lr.data?._failed) { console.error('Login failed:', lr.data.message); process.exit(1); }
  const jar = lr.jar;
  console.log('QS Login OK');

  // 2. Get AIFF token + userId
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  if (!tr.data?._header_?.success) { console.error('Token failed:', tr.data); process.exit(1); }
  const tokenId    = tr.data.tokenId;
  const userId     = tr.data.employee?.id;
  const deptList   = tr.data.department || [];
  console.log('Token OK:', tokenId.substring(0,8));
  console.log('userId:', userId);
  console.log('departments:', JSON.stringify(deptList));

  // 3. Test addMainUnitEntity with token-derived userId
  console.log('\n=== Test addMainUnitEntity with token userId ===');
  const amr = await httpPost('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId, actualWorktime: '0', actualWorkvalue: '0.0',
    date: '2026-04-23T00:00:00.000Z', couldSave: 1,
  }, jar);
  console.log('Result:', amr.raw.substring(0, 300));

  // 4. Try OpenAPI task endpoints
  console.log('\n=== OpenAPI task endpoints ===');
  const header = { _header_: { tokenId } };
  for (const [path, body] of [
    ['/ecp/openapi/task/list', { ...header }],
    ['/ecp/openapi/task/query', { ...header, start: 0, limit: 20 }],
    ['/ecp/openapi/ecp/task/list', { ...header }],
    ['/ecp/openapi/timereport/task', { ...header }],
    ['/ecp/openapi/timereport/getTask', { ...header }],
    ['/ecp/openapi/aile/task/list', { ...header }],
  ]) {
    const r = await httpPost(path, body, jar);
    if (r.raw.length > 2) console.log(`${path}: ${r.raw.substring(0, 300)}`);
  }

  // 5. Try QS APIs with _header_ tokenId
  console.log('\n=== QS APIs with tokenId in body ===');
  for (const ep of [
    'Ecp.TimeReport.getTaskList.data',
    'Ecp.Task.getList.data',
    'Ecp.TimeReport.getTypeList.data',
  ]) {
    const r = await httpPost('/ecp/' + ep, { _header_: { tokenId } }, jar);
    if (!r.data?._failed) console.log(`✅ ${ep}: ${r.raw.substring(0,300)}`);
    else {
      const msg = r.data?.message||'';
      if (!msg.includes('不存在名稱')) console.log(`${ep}: ${msg.substring(0,100)}`);
    }
  }

  // 6. Try to get dept + identity
  console.log('\n=== Identities/departments ===');
  for (const [path, body] of [
    ['/ecp/openapi/aile/identity/list', { _header_: { tokenId } }],
    ['/ecp/openapi/user/identity', { _header_: { tokenId } }],
    ['/ecp/openapi/employee/info', { _header_: { tokenId } }],
  ]) {
    const r = await httpPost(path, body, jar);
    if (r.raw.length > 2) console.log(`${path}: ${r.raw.substring(0, 300)}`);
  }
}
main().catch(console.error);
