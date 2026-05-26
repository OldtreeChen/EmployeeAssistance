'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const mysql = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';

function get(path, jar) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: HOST, path, method: 'GET',
      headers: { 'Accept': '*/*', ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    }).on('error', reject).end();
  });
}

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
  const conn = await mysql.createConnection({ host: 'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;

  // Enumerate possible JS paths for work hours / time report
  const candidates = [
    '/ecp/ecp/app/ecp/timereport/',
    '/ecp/ecp/app/ecp/TimeReport/',
    '/ecp/ecp/app/ecp/workhours/',
    '/ecp/ecp/app/ecp/workHours/',
  ];

  // Try to find the module entry point
  const jsNames = [
    'TimeReportAdd', 'TimeReportEdit', 'TimeReportForm',
    'timeReportAdd', 'timeReportEdit', 'timeReportForm',
    'addTimeReport', 'editTimeReport',
    'WorkHoursAdd', 'workHoursAdd',
    'TimeReport', 'timeReport',
    'main', 'index', 'form',
  ];

  console.log('=== Scanning for TimeReport JS ===');
  for (const base of candidates) {
    for (const name of jsNames) {
      const path = `${base}${name}.js`;
      const r = await get(path, jar);
      if (r.status === 200 && r.body.length > 200) {
        console.log(`\nFOUND: ${path} (${r.body.length} bytes)`);
        // Extract lines with task-related keywords
        const hits = r.body.split('\n').filter(l =>
          /\.data['"]\s*,|getTask|queryTask|taskList|task\.list|TimeReport\.\w+Task/i.test(l)
        );
        hits.slice(0, 15).forEach(l => console.log('  ' + l.trim().substring(0, 200)));
        break;
      }
    }
  }

  // Also try the ECP module browser endpoint to find all JS
  console.log('\n=== Checking ECP module list ===');
  const moduleList = await get('/ecp/ecp/modules.json', jar);
  if (moduleList.status === 200) console.log(moduleList.body.substring(0, 500));

  const appList = await get('/ecp/ecp/app/ecp/', jar);
  if (appList.status === 200) console.log('app/ecp/ listing:', appList.body.substring(0, 300));
}
main().catch(console.error);
