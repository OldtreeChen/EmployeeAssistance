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
  const storedId = rows[0].employee_id;
  console.log('Username:', username, '| Stored employee_id:', storedId);

  // QS Login
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('QS login:', jar ? 'OK' : 'FAIL');
  if (lr.data) console.log('Login response keys:', Object.keys(lr.data||{}).join(', '));

  // Try to get current user's own TsUser record
  console.log('\n=== Qs.OnlineUser.getItem.data ===');
  const me = await post('/ecp/Qs.OnlineUser.getItem.data', {}, jar);
  console.log(me.raw.substring(0, 500));

  // Try TsUser lookup by login name
  console.log('\n=== Ecp.TsUser.getByLoginName.data ===');
  const tsUser = await post('/ecp/Ecp.TsUser.getByLoginName.data', { loginName: username }, jar);
  console.log(tsUser.raw.substring(0, 300));

  // Try Qs.User lookup
  console.log('\n=== Qs.User.getItem.data ===');
  const qsUser = await post('/ecp/Qs.User.getItem.data', { loginName: username }, jar);
  console.log(qsUser.raw.substring(0, 300));

  // AIFF token — get employee ID from there
  console.log('\n=== AIFF token ===');
  const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  console.log('AIFF employee:', tr.data?.employee?.id, '|', tr.data?.employee?.name);
  const tokenId = tr.data?.tokenId;

  // Try OpenAPI user info
  if (tokenId) {
    console.log('\n=== OpenAPI user info ===');
    const ui = await post('/ecp/openapi/ecp/user/info', { _header_: { tokenId } }, jar);
    console.log(ui.raw.substring(0, 300));
  }

  // Scan QSVD and dump ALL FUserId / FUserId$ to find Oldtree.chen's actual userId
  console.log('\n=== QSVD full scan — FUserId breakdown ===');
  const allRecs = [];
  let page = 0;
  while (true) {
    const pr = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', { start: page * 50, limit: 50 }, jar);
    const recs = pr.data?.data?.records || [];
    allRecs.push(...recs);
    if (recs.length < 50) break;
    page++;
    if (page > 40) break;
  }
  console.log(`Total QSVD records: ${allRecs.length}`);

  // Show unique FUserId values with their display names
  const userMap = {};
  for (const r of allRecs) {
    const uid = r.FUserId || '(null)';
    const uname = r['FUserId$'] || '?';
    if (!userMap[uid]) userMap[uid] = { name: uname, count: 0, tasks: [] };
    userMap[uid].count++;
    if (userMap[uid].tasks.length < 3) userMap[uid].tasks.push(r.FName?.substring(0,50));
  }
  console.log('\nFUserId breakdown:');
  Object.entries(userMap).sort((a,b)=>b[1].count-a[1].count).forEach(([uid, v]) => {
    console.log(`  ${uid} (${v.name}) × ${v.count} tasks`);
    v.tasks.forEach(t => console.log(`    - ${t}`));
  });

  // Show unique FAssignUserId as well
  const assignMap = {};
  for (const r of allRecs) {
    const uid = r.FAssignUserId || '(null)';
    const uname = r['FAssignUserId$'] || '?';
    if (!assignMap[uid]) assignMap[uid] = { name: uname, count: 0 };
    assignMap[uid].count++;
  }
  console.log('\nFAssignUserId breakdown:');
  Object.entries(assignMap).sort((a,b)=>b[1].count-a[1].count).forEach(([uid, v]) => {
    console.log(`  ${uid} (${v.name}) × ${v.count}`);
  });

  // Also try QSVD with userId filter
  console.log('\n=== QSVD with userId filters ===');
  const filterBodies = [
    { start: 0, limit: 50, userId: storedId },
    { start: 0, limit: 50, FUserId: storedId },
    { start: 0, limit: 50, assignUserId: storedId },
    { start: 0, limit: 50, basicQueryArguments: { userId: storedId } },
    { start: 0, limit: 50, basicQueryArguments: { FUserId: storedId } },
    { start: 0, limit: 50, queryArguments: { FUserId: storedId } },
  ];
  for (const body of filterBodies) {
    const r = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', body, jar);
    const recs = r.data?.data?.records || [];
    console.log(`  ${JSON.stringify(Object.keys(body).filter(k=>k!=='start'&&k!=='limit'))}: ${recs.length} records`);
    if (recs.length > 0 && recs.length !== allRecs.length) {
      recs.slice(0,3).forEach(t => console.log(`    ${t.FName?.substring(0,60)} FUserId=${t.FUserId}`));
    }
  }
}
main().catch(console.error);
