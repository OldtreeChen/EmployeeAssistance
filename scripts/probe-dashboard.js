'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';
function postRaw(path, body, jar) {
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
function getRaw(path, jar) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: HOST, path, method: 'GET', headers: { ...(jar ? { Cookie: jar } : {}) } }, res => {
      let raw = ''; res.on('data', c => raw += c);
      const loc = res.headers['location'] || '';
      res.on('end', () => resolve({ raw, status: res.statusCode, location: loc }));
    }).on('error', reject).end();
  });
}
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const lr = await postRaw('Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK, cookie:', jar);

  // After login, the browser loads the main ECP page
  // Try accessing various post-login pages
  for (const path of [
    '/ecp/main', '/ecp/home', '/ecp/dashboard',
    '/ecp/?p=main', '/ecp/ecp/main', '/ecp/app',
  ]) {
    const g = await getRaw(path, jar);
    const uuids = [...new Set((g.raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))];
    if (g.status !== 404) {
      console.log(`GET ${path}: HTTP ${g.status}, UUIDs: ${uuids.length}`);
      if (uuids.length > 0) {
        console.log('  UUIDs:', uuids.slice(0,5));
        // Show clientData context
        const cd = g.raw.indexOf('clientData');
        if (cd >= 0) console.log('  clientData:', g.raw.substring(cd, cd+500));
      }
    }
  }

  // Try Qs.PersonalInfo module
  console.log('\n=== PersonalInfo patterns ===');
  for (const [ep, body] of [
    ['Qs.PersonalInfo.getMyInfo.data', {}],
    ['Qs.PersonalInfo.get.data', {}],
    ['Qs.PersonalInfo.getItem.data', {}],
    ['Qs.MyInfo.get.data', {}],
    ['Qs.OnlineUser.getByLoginName.data', { loginName: rows[0].ec_username }],
    ['Qs.OnlineUser.findByLoginName.data', { loginName: rows[0].ec_username }],
    ['Qs.OnlineUser.getItemByLoginName.data', { loginName: rows[0].ec_username }],
    ['Ecp.Aile.getLoginUserInfo.data', {}],
    ['Ecp.Aile.getMyInfo.data', {}],
    ['Ecp.Aile.init.data', {}],
  ]) {
    const r = await postRaw(ep, body, jar);
    const msg = r.data?.message||'';
    if (!r.data?._failed) {
      console.log(`✅ ${ep}:`);
      console.log('  ', r.raw.substring(0, 500));
    } else if (!msg.includes('不存在單元') && !msg.includes('不存在名稱')) {
      console.log(`⚠️  ${ep}: ${msg.substring(0,100)}`);
    }
  }
}
main().catch(console.error);
