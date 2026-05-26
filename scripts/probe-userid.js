'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
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
        try { resolve({ data: JSON.parse(raw), raw, jar: j }); }
        catch { resolve({ data: raw, raw, jar: j }); }
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
  console.log('Username:', username);

  // Step 1: QS login — dump full response
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  console.log('\n=== QS login response ===');
  console.log(lr.raw.substring(0, 600));

  const jar = lr.jar;

  // AIFF token
  const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId = tr.data.tokenId;
  console.log('\n=== AIFF token employee ===');
  console.log(JSON.stringify(tr.data.employee));
  const header = { _header_: { tokenId } };

  // Probe TsUser / OnlineUser QS endpoints
  console.log('\n=== QS user lookup endpoints ===');
  const endpoints = [
    { path: '/ecp/Qs.OnlineUser.getItem.data',         body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.getSelf.data',          body: {} },
    { path: '/ecp/Qs.OnlineUser.getCurrent.data',       body: {} },
    { path: '/ecp/Qs.OnlineUser.getCurrentUser.data',   body: {} },
    { path: '/ecp/Qs.OnlineUser.query.data',            body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.query.data',            body: { keyword: username } },
    { path: '/ecp/Ecp.TsUser.getByLoginName.data',      body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.getItem.data',             body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.query.data',               body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.getByLoginName.data',    body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',             body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.getItem.data',          body: { id: 'bbc693e1-e448-11ed-b376-0607bbc2ee97' } },
  ];
  for (const ep of endpoints) {
    const r = await post(ep.path, ep.body, jar);
    const ok = r.raw.length > 5 && !r.raw.includes('"_failed":true') && r.raw !== '{}' && r.raw !== 'null';
    console.log(`${ep.path}(${JSON.stringify(ep.body)}): ${ok ? r.raw.substring(0, 250) : 'FAILED/EMPTY'}`);
  }

  // Also try openapi
  console.log('\n=== OpenAPI user endpoints ===');
  const apiPaths = [
    '/ecp/openapi/ecp/user/info',
    '/ecp/openapi/ecp/user/profile',
    '/ecp/openapi/ecp/employee/info',
  ];
  for (const p of apiPaths) {
    const r = await post(p, { ...header }, jar);
    console.log(`${p}: ${r.raw.substring(0, 250)}`);
  }
}
main().catch(console.error);
