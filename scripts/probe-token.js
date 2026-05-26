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

  // Step 1: Jeedsoft session login
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  if (lr.data?._failed) { console.error('Login failed:', lr.data.message); process.exit(1); }
  const jar = lr.jar;
  console.log('QuickSilver login OK, session:', jar.substring(0, 30));

  // Step 2: Try AIFF token apply with just loginName + session cookie
  console.log('\n=== Try /openapi/aile/token/apply ===');
  const attempts = [
    { loginType: 'aiff', loginName: username, tenantCode: '' },
    { loginType: 'aiff', loginName: username },
    { loginType: 'qs', loginName: username, tenantCode: '' },
    { loginType: 'qs', loginName: username, password },
    { loginName: username, password, loginType: 'aiff' },
    { loginName: username, password },
  ];
  for (const body of attempts) {
    const r = await httpPost('/ecp/openapi/aile/token/apply', body, jar);
    console.log(`body ${JSON.stringify(Object.keys(body))}: status raw=${r.raw.substring(0,200)}`);
  }

  // Step 3: Try /openapi/user/login
  console.log('\n=== Try /openapi/user/login ===');
  for (const body of [
    { loginName: username, password },
    { loginName: username, password, loginType: 'qs' },
  ]) {
    const r = await httpPost('/ecp/openapi/user/login', body, jar);
    console.log(`body: ${r.raw.substring(0, 300)}`);
  }

  // Step 4: Try QuickSilver API calls WITH _header_
  // (maybe with tokenId = empty, the JSESSIONID is enough for user info)
  console.log('\n=== QS APIs with _header_ ===');
  const qsBody = { _header_: { tokenId: '' } };
  for (const ep of [
    'Qs.OnlineUser.getCurrentUserInfo.data',
    'Ecp.TimeReport.getTaskList.data',
  ]) {
    const r = await httpPost('/ecp/' + ep, qsBody, jar);
    const msg = r.data?.message || '';
    if (!r.data?._failed) console.log(`✅ ${ep}: ${r.raw.substring(0,300)}`);
    else if (!msg.includes('不存在名稱')) console.log(`${ep}: ${msg.substring(0,100)}`);
  }
}
main().catch(console.error);
