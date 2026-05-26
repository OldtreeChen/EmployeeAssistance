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
    https.request({ hostname: HOST, path, method: 'GET', headers: { ...(jar ? { Cookie: jar } : {}) } }, res => {
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

  // Get the home page HTML to find JS file paths
  const home = await get('/ecp/', jar);
  // Extract JS file references
  const jsFiles = [...(home.raw.matchAll(/src=['"]([^'"]*\.js[^'"]*)['"]/g))].map(m => m[1]).filter(f => f.includes('ecp/'));
  console.log('ECP JS files found:', jsFiles.slice(0, 10));

  // Download and search utility JS
  for (const file of ['/ecp/quicksilver/page/util/Utility.js', ...jsFiles.slice(0,3).map(f => '/ecp/' + f)]) {
    const js = await get(file, jar);
    if (js.status !== 200 || js.raw.length < 100) continue;
    console.log(`\n--- ${file} (${js.raw.length} bytes) ---`);
    // Search for userId, TimeReport, Task patterns
    const keywords = ['userId', 'TimeReport', 'getTask', 'taskList', 'activityType', 'departmentId', 'getUserId', 'loginUser'];
    for (const kw of keywords) {
      const idx = js.raw.indexOf(kw);
      if (idx >= 0) {
        console.log(`  Found "${kw}" at ${idx}:`);
        console.log('  ', js.raw.substring(Math.max(0,idx-50), idx+200));
      }
    }
  }
}
main().catch(console.error);
