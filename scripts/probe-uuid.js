'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';
function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path: '/ecp/' + path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { const j = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '); try{resolve({data:JSON.parse(raw),raw,jar:j})}catch{resolve({data:raw,raw,jar:j})} });
    }).on('error', reject).end(d);
  });
}
function get(path, jar) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: HOST, path: '/ecp/' + path, method: 'GET',
      headers: { ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => resolve({ raw, status: res.statusCode }));
    }).on('error', reject).end();
  });
}
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const lr = await post('Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK');

  // Show UUID context in home page
  const home = await get('', jar);
  const uuid = '17c25e26-7da0-005b-55f2-3c6aa7bb54e5';
  const idx = home.raw.indexOf(uuid);
  console.log('\nUUID context in home page:');
  console.log(home.raw.substring(Math.max(0,idx-200), idx+200));

  // Try calling addMainUnitEntity with this UUID as userId
  console.log('\n=== Test with home-page UUID as userId ===');
  const r = await post('Ecp.TimeReport.addMainUnitEntity.data', { userId: uuid, actualWorktime: '0', actualWorkvalue: '0.0', date: '2026-04-23T00:00:00.000Z', couldSave: 1 }, jar);
  console.log('Result:', r.raw.substring(0, 300));

  // Try to get user list via different approach
  console.log('\n=== GET user-related pages ===');
  for (const path of ['page/user/profile', 'main', 'index.html', '#/user/profile']) {
    const g = await get(path, jar);
    const uuids = [...new Set((g.raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))];
    console.log(`GET /${path}: HTTP ${g.status}, UUIDs found:`, uuids.slice(0,5));
  }
}
main().catch(console.error);
