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
  console.log('Login OK, session:', jar);

  // Try to get home page HTML - look for userId in script vars
  console.log('\n=== GET / ===');
  const home = await get('', jar);
  const html = home.raw;
  // Search for UUID pattern
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuids = [...new Set(html.match(uuidPattern) || [])];
  console.log('UUIDs found in home page:', uuids.length, uuids.slice(0,10));
  // Search for userId keyword
  const idx = html.indexOf('userId');
  if (idx >= 0) console.log('userId context:', html.substring(idx-50, idx+200));

  // Try UserInfo.data GET-style endpoint
  console.log('\n=== Qs.UserInfo variants ===');
  for (const ep of ['Qs.UserInfo.getMyInfo.data','Qs.UserInfo.getCurrentUser.data','Qs.UserInfo.getMy.data']) {
    const r = await post(ep, {}, jar);
    const msg = r.data?.message||'';
    if (!r.data?._failed) console.log(`${ep}: OK =>`, r.raw.substring(0,300));
    else if (!msg.includes('不存在單元')) console.log(`${ep}: ${msg.substring(0,100)}`);
  }

  // Try Ecp sub-modules
  console.log('\n=== Ecp sub-modules ===');
  for (const ep of ['Ecp.Self.getInfo.data','Ecp.Account.getMyInfo.data','Ecp.HR.getMyInfo.data','Ecp.MyInfo.get.data','Ecp.Profile.get.data']) {
    const r = await post(ep, {}, jar);
    const msg = r.data?.message||'';
    if (!r.data?._failed) console.log(`${ep}: OK =>`, r.raw.substring(0,300));
    else if (!msg.includes('不存在單元') && !msg.includes('不存在名稱')) console.log(`${ep}: ${msg.substring(0,100)}`);
  }
}
main().catch(console.error);
