'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const mysql = require('mysql2/promise');
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
        try { resolve({ data: JSON.parse(raw), raw, jar: j }); } catch { resolve({ data: raw, raw, jar: j }); }
      });
    }).on('error', reject).end(d);
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: 'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  const userId   = rows[0].employee_id; // bbc693e1-...
  console.log('User:', username, '| userId:', userId);

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('QS login:', jar ? 'OK' : 'FAIL');

  // QS DataServlet endpoints — use JSESSIONID only (no AIFF token needed)
  const endpoints = [
    // TimeReport related task lists
    { path: '/ecp/Ecp.TimeReport.getTaskList.data',          body: { userId } },
    { path: '/ecp/Ecp.TimeReport.getTaskList.data',          body: { userId, start: 0, limit: 50 } },
    { path: '/ecp/Ecp.TimeReport.queryTask.data',            body: { userId } },
    { path: '/ecp/Ecp.TimeReport.queryUserTask.data',        body: { userId } },
    { path: '/ecp/Ecp.TimeReport.getMyTask.data',            body: {} },
    // Task list endpoints
    { path: '/ecp/Ecp.Task.queryMyTask.data',                body: {} },
    { path: '/ecp/Ecp.Task.queryMyTask.data',                body: { userId } },
    { path: '/ecp/Ecp.Task.getMyTaskList.data',              body: {} },
    { path: '/ecp/Ecp.Task.getList.data',                    body: { userId } },
    { path: '/ecp/Ecp.Task.getUserTask.data',                body: { userId } },
    { path: '/ecp/Ecp.Task.queryAssignTask.data',            body: { userId } },
    // With pagination
    { path: '/ecp/Ecp.Task.queryMyTask.data',                body: { start: 0, limit: 50 } },
  ];

  for (const ep of endpoints) {
    const r = await post(ep.path, ep.body, jar);
    const ok = r.raw.length > 5 && r.raw !== '{}' && r.raw !== 'null' && !r.raw.includes('"_failed":true');
    if (ok) {
      console.log(`\nHIT: ${ep.path}`);
      console.log(r.raw.substring(0, 500));
    } else {
      process.stdout.write(`FAIL ${ep.path.replace('/ecp/','')} `);
    }
  }
  console.log('\nDone.');
}
main().catch(console.error);
