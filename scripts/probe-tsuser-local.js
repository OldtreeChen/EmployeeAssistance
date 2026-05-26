'use strict';
/**
 * probe-tsuser-local.js
 * Run locally (Node v22). Connects to MySQL at 192.168.20.151:3306,
 * then probes econtact.ai3.cloud for TsUser lookup and task statuses.
 */
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
  // Try the EC2 host IP directly
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST_REMOTE || '192.168.20.151',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'punchuser',
    password: process.env.DB_PASSWORD || 'Punch@2026!',
    database: process.env.DB_NAME || 'line_punch_system',
    connectTimeout: 5000,
  });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  console.log('Username:', username);

  // QS login
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL', lr.raw.substring(0,100));

  // AIFF token
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId = tr.data.tokenId;
  console.log('Token employee id:', tr.data.employee?.id);
  console.log('Token employee name:', tr.data.employee?.name);
  const header = { _header_: { tokenId } };

  // ── A: TsUser / Employee QS lookup ──────────────────────────────
  console.log('\n=== A: TsUser / Employee QS lookup ===');
  const qsEndpoints = [
    { path: '/ecp/Ecp.TsUser.getByLoginName.data',   body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.query.data',             body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.getItem.data',        body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.getByLoginName.data',  body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',           body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',           body: { keyword: 'chen' } },
    { path: '/ecp/Ecp.Employee.getList.data',         body: { keyword: username } },
  ];
  for (const ep of qsEndpoints) {
    const r = await httpPost(ep.path, ep.body, jar);
    const ok = !r.raw.includes('"_failed":true') && r.raw.length > 10;
    console.log(`${ep.path}: ${ok ? r.raw.substring(0, 300) : 'FAILED'}`);
  }

  // ── B: OpenAPI user endpoints ────────────────────────────────────
  console.log('\n=== B: OpenAPI user endpoints ===');
  const apiEndpoints = [
    '/ecp/openapi/ecp/user/info',
    '/ecp/openapi/ecp/user/profile',
    '/ecp/openapi/aile/user/info',
    '/ecp/openapi/ecp/employee/info',
    '/ecp/openapi/ecp/employee/get',
  ];
  for (const path of apiEndpoints) {
    const r = await httpPost(path, { ...header }, jar);
    console.log(`${path}: ${r.raw.substring(0, 300)}`);
  }

  // ── C: All task statuses (up to 10 pages) ───────────────────────
  console.log('\n=== C: All task statuses ===');
  const allTasks = [];
  for (let p = 0; p < 10; p++) {
    const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: p*50, limit: 50 }, jar);
    const items = r.data?.items || [];
    allTasks.push(...items);
    console.log(`Page ${p}: ${items.length} tasks, hasNextPage=${r.data?.hasNextPage}`);
    if (!r.data?.hasNextPage) break;
  }
  const statusMap = {};
  allTasks.forEach(t => { statusMap[t.FStatus] = t.FStatus$; });
  console.log('All statuses:', JSON.stringify(statusMap, null, 2));
  console.log('Total:', allTasks.length, 'tasks');

  const active = allTasks.filter(t => t.FStatus !== 'Finished' && t.FStatus !== 'New');
  console.log('\nActive (non-New/non-Finished):', active.length);
  active.slice(0, 5).forEach(t =>
    console.log(` [${t.FStatus}(${t.FStatus$})] ${t.FName} | user=${t.FAssignUserId}`)
  );

  // ── D: Filter by userId variants ────────────────────────────────
  console.log('\n=== D: Task list userId filter ===');
  const ids = [
    ['tokenEmpId', tr.data.employee?.id],
    ['knownId', 'bbc693e1-e448-11ed-b376-0607bbc2ee97'],
  ];
  for (const [label, uid] of ids) {
    if (!uid) continue;
    for (const param of ['userId', 'assignUserId']) {
      const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 50, [param]: uid }, jar);
      const cnt = r.data?.items?.length;
      const sm = {};
      (r.data?.items||[]).forEach(t => { sm[t.FStatus] = (sm[t.FStatus]||0)+1; });
      console.log(`${label}(${uid.substring(0,8)}) ${param}=${cnt} statuses=${JSON.stringify(sm)}`);
    }
  }
}

main().catch(console.error);
