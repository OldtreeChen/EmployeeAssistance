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

function get(path, jar) {
  return new Promise((resolve, reject) => {
    https.request({ hostname: HOST, path, method: 'GET',
      headers: { ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => resolve(raw));
    }).on('error', reject).end();
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: 'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  const userId   = rows[0].employee_id;

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;

  // Try to find the work hours JS to discover the correct endpoint
  console.log('=== Searching e-Contact JS for task list endpoint ===');
  const jsFiles = [
    '/ecp/ecp/app/timereport/TimeReportAdd.js',
    '/ecp/ecp/app/timereport/timeReport.js',
    '/ecp/ecp/app/timereport/TimeReport.js',
    '/ecp/ecp/app/timereport/addTimeReport.js',
    '/ecp/ecp/app/workhours/WorkHours.js',
    '/ecp/ecp/app/ecp/TimeReport.js',
  ];
  for (const f of jsFiles) {
    const content = await get(f, jar);
    if (content.length > 100 && !content.includes('404') && !content.includes('Not Found')) {
      // Look for task-related API calls
      const lines = content.split('\n').filter(l => /task|Task|getTask|queryTask/i.test(l));
      if (lines.length) {
        console.log(`\nFound in ${f}:`);
        lines.slice(0, 10).forEach(l => console.log(' ', l.trim().substring(0, 150)));
      }
    }
  }

  // More QS endpoint attempts
  console.log('\n=== More QS task endpoints ===');
  const more = [
    { path: '/ecp/Ecp.TimeReport.getSelectableTask.data',       body: { userId } },
    { path: '/ecp/Ecp.TimeReport.getTaskForReport.data',        body: { userId } },
    { path: '/ecp/Ecp.TimeReport.querySelectableTask.data',     body: { userId } },
    { path: '/ecp/Ecp.TimeReport.getEmpTaskList.data',          body: { userId } },
    { path: '/ecp/Ecp.Project.getMyTask.data',                  body: { userId } },
    { path: '/ecp/Ecp.Project.queryMyTask.data',                body: {} },
    { path: '/ecp/Ecp.Project.getTaskList.data',                body: { userId } },
    { path: '/ecp/Ecp.EcpTask.queryMyTask.data',                body: {} },
    { path: '/ecp/Ecp.EcpTask.getMyTaskList.data',              body: { userId } },
    // Try with different userId field names
    { path: '/ecp/Ecp.Task.query.data',                         body: { userId, start: 0, limit: 20 } },
    { path: '/ecp/Ecp.Task.query.data',                         body: { FUserId: userId, start: 0, limit: 20 } },
    { path: '/ecp/Ecp.Task.query.data',                         body: { assignUserId: userId, start: 0, limit: 20 } },
  ];
  for (const ep of more) {
    const r = await post(ep.path, ep.body, jar);
    const ok = r.raw.length > 10 && r.raw !== '{}' && r.raw !== 'null' && !r.raw.includes('"_failed":true');
    if (ok) {
      console.log(`\nHIT: ${ep.path}`);
      console.log(r.raw.substring(0, 400));
    } else {
      process.stdout.write(`. `);
    }
  }
  console.log('\nDone.');
}
main().catch(console.error);
