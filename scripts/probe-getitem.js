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
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const lr = await post('Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK');

  // Try getItem with special entityIds
  for (const eid of ['current', 'me', 'self', '0', '-1', 'null', null]) {
    const r = await post('Qs.OnlineUser.getItem.data', { entityId: eid }, jar);
    console.log(`getItem entityId=${eid}: ${r.data?._failed ? r.data.message?.substring(0,100) : 'OK: ' + r.raw.substring(0,300)}`);
  }

  // Try Ecp.CheckIn to see if it returns userId in success
  const cr = await post('Ecp.CheckIn.getCurrentCheck.data', {}, jar);
  console.log('\nCheckIn.getCurrentCheck:', cr.raw.substring(0,300));
  const cr2 = await post('Ecp.CheckIn.getToday.data', {}, jar);
  console.log('CheckIn.getToday:', cr2.raw.substring(0,300));
  const cr3 = await post('Ecp.CheckIn.query.data', { start: 0, limit: 5 }, jar);
  console.log('CheckIn.query:', cr3.raw.substring(0,300));
  const cr4 = await post('Ecp.CheckIn.getMyCheck.data', {}, jar);
  console.log('CheckIn.getMyCheck:', cr4.raw.substring(0,300));
  const cr5 = await post('Ecp.CheckIn.getItem.data', {}, jar);
  console.log('CheckIn.getItem:', cr5.raw.substring(0,300));
}
main().catch(console.error);
