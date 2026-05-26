'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';

function httpPost(path, body, jar) {
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
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST||'db', port: 3306,
    user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!',
    database: process.env.DB_NAME||'line_punch_system'
  });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  console.log('Username:', username);

  // Step 1: QS login
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login jar:', jar ? 'OK' : 'FAIL');

  // Step 2: AIFF token
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId = tr.data.tokenId;
  console.log('Token employee id:', tr.data.employee?.id);
  console.log('Token employee name:', tr.data.employee?.name || tr.data.employee?.FName$);
  console.log('Token employee full:', JSON.stringify(tr.data.employee));

  const header = { _header_: { tokenId } };

  // ── A: Try to get TsUser by login name ──────────────────────────
  console.log('\n=== A: TsUser lookup ===');
  const tsUserEndpoints = [
    { path: '/ecp/Ecp.TsUser.getByLoginName.data',   body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.getItem.data',           body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.query.data',             body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.getItem.data',        body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.query.data',          body: { keyword: username } },
    { path: '/ecp/Ecp.Employee.getByLoginName.data',  body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',           body: { loginName: username } },
  ];
  for (const ep of tsUserEndpoints) {
    try {
      const r = await httpPost(ep.path, { ...ep.body }, jar);
      const snippet = r.raw.substring(0, 200);
      if (!snippet.includes('"_failed":true') && snippet.length > 5) {
        console.log(`${ep.path}: ${snippet}`);
      } else {
        console.log(`${ep.path}: FAILED or empty`);
      }
    } catch (e) {
      console.log(`${ep.path}: ERROR ${e.message}`);
    }
  }

  // ── B: Try /openapi/ecp/user endpoints ──────────────────────────
  console.log('\n=== B: OpenAPI user lookup ===');
  const apiUserEndpoints = [
    { path: '/ecp/openapi/ecp/user/info',     body: { ...header } },
    { path: '/ecp/openapi/ecp/user/get',      body: { ...header, loginName: username } },
    { path: '/ecp/openapi/ecp/user/profile',  body: { ...header } },
    { path: '/ecp/openapi/aile/user/info',    body: { ...header } },
  ];
  for (const ep of apiUserEndpoints) {
    try {
      const r = await httpPost(ep.path, ep.body, jar);
      const snippet = r.raw.substring(0, 300);
      console.log(`${ep.path}: ${snippet}`);
    } catch (e) {
      console.log(`${ep.path}: ERROR ${e.message}`);
    }
  }

  // ── C: Task list – check ALL statuses, collect unique values ────
  console.log('\n=== C: All task status values ===');
  const allTasks = [];
  for (let p = 0; p < 10; p++) {
    const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: p * 50, limit: 50 }, jar);
    const items = r.data?.items || [];
    allTasks.push(...items);
    console.log(`Page ${p}: ${items.length} items, hasNextPage=${r.data?.hasNextPage}`);
    if (!r.data?.hasNextPage) break;
  }
  const statusMap = {};
  allTasks.forEach(t => { statusMap[t.FStatus] = t.FStatus$; });
  console.log('All statuses:', JSON.stringify(statusMap));
  console.log('Total tasks fetched:', allTasks.length);

  // Show sample of non-Finished tasks
  const active = allTasks.filter(t => t.FStatus !== 'Finished' && t.FStatus !== 'New');
  console.log('\nNon-New/Non-Finished tasks:', active.length);
  active.slice(0, 5).forEach(t => {
    console.log(` FId=${t.FId} FStatus=${t.FStatus}(${t.FStatus$}) FAssignUserId=${t.FAssignUserId} FName=${t.FName}`);
  });

  // ── D: Try task list with userId / assignUserId filter ──────────
  console.log('\n=== D: Task list with userId filter ===');
  const knownId = 'bbc693e1-e448-11ed-b376-0607bbc2ee97';
  const tokenEmpId = tr.data.employee?.id;
  for (const [label, uid] of [['knownId', knownId], ['tokenEmpId', tokenEmpId]]) {
    if (!uid) continue;
    for (const param of ['userId', 'assignUserId', 'FAssignUserId']) {
      const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 50, [param]: uid }, jar);
      const cnt = r.data?.items?.length;
      const statuses = {};
      (r.data?.items||[]).forEach(t => { statuses[t.FStatus] = (statuses[t.FStatus]||0)+1; });
      console.log(`${label} ${param}: count=${cnt} statuses=${JSON.stringify(statuses)}`);
    }
  }

  // ── E: Try to find employee by QS query ────────────────────────
  console.log('\n=== E: QS Employee search ===');
  const empEndpoints = [
    { path: '/ecp/Ecp.Employee.query.data', body: { keyword: username.split('.')[1] || username } },
    { path: '/ecp/Ecp.Employee.query.data', body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.getList.data', body: { loginName: username } },
  ];
  for (const ep of empEndpoints) {
    try {
      const r = await httpPost(ep.path, { ...ep.body }, jar);
      if (!r.raw.includes('"_failed":true')) {
        console.log(`${ep.path}(${JSON.stringify(ep.body)}): ${r.raw.substring(0, 400)}`);
      } else {
        console.log(`${ep.path}: FAILED`);
      }
    } catch (e) {
      console.log(`${ep.path}: ERROR ${e.message}`);
    }
  }
}

main().catch(console.error);
