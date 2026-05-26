'use strict';
/**
 * probe-tsuser-args.js
 * Usage: $env:EC_USER="Oldtree.chen"; $env:EC_PASS="yourpass"; node scripts/probe-tsuser-args.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const HOST  = 'econtact.ai3.cloud';

const username = process.env.EC_USER;
const password = process.env.EC_PASS;
if (!username || !password) {
  console.error('Usage: $env:EC_USER="Oldtree.chen"; $env:EC_PASS="yourpass"; node scripts/probe-tsuser-args.js');
  process.exit(1);
}

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
  console.log('Username:', username);

  // QS login
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  if (!jar) { console.error('Login FAILED:', lr.raw); process.exit(1); }
  console.log('Login OK');

  // AIFF token
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId = tr.data.tokenId;
  console.log('Token employee:', JSON.stringify(tr.data.employee));
  const header = { _header_: { tokenId } };

  // ── A: TsUser / Employee QS lookup ──────────────────────────────
  console.log('\n=== A: QS employee/user lookup ===');
  const qsEndpoints = [
    { path: '/ecp/Ecp.TsUser.getByLoginName.data',  body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.query.data',            body: { loginName: username } },
    { path: '/ecp/Ecp.TsUser.getItem.data',          body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.getByLoginName.data', body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',          body: { loginName: username } },
    { path: '/ecp/Ecp.Employee.query.data',          body: { keyword: 'Oldtree' } },
    { path: '/ecp/Ecp.Employee.getList.data',        body: { keyword: username } },
    { path: '/ecp/Qs.OnlineUser.getItem.data',       body: { loginName: username } },
    { path: '/ecp/Qs.OnlineUser.query.data',         body: { keyword: username } },
  ];
  for (const ep of qsEndpoints) {
    const r = await httpPost(ep.path, ep.body, jar);
    const failed = r.raw.includes('"_failed":true') || r.raw === '{}' || r.raw.length < 5;
    console.log(`${ep.path}: ${failed ? 'FAILED' : r.raw.substring(0, 350)}`);
  }

  // ── B: OpenAPI user/employee endpoints ──────────────────────────
  console.log('\n=== B: OpenAPI user endpoints ===');
  const apiPaths = [
    '/ecp/openapi/ecp/user/info',
    '/ecp/openapi/ecp/user/profile',
    '/ecp/openapi/ecp/employee/info',
    '/ecp/openapi/ecp/employee/get',
    '/ecp/openapi/aile/user/info',
    '/ecp/openapi/aile/employee/info',
  ];
  for (const path of apiPaths) {
    const r = await httpPost(path, { ...header }, jar);
    console.log(`${path}: ${r.raw.substring(0, 300)}`);
  }

  // ── C: All tasks with status inventory ──────────────────────────
  console.log('\n=== C: Task status inventory ===');
  const allTasks = [];
  for (let p = 0; p < 10; p++) {
    const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: p*50, limit: 50 }, jar);
    const items = r.data?.items || [];
    allTasks.push(...items);
    process.stdout.write(`Page ${p}: ${items.length} tasks `);
    if (!r.data?.hasNextPage) { console.log('(last page)'); break; }
    console.log();
  }
  const statusMap = {};
  allTasks.forEach(t => { statusMap[t.FStatus] = t.FStatus$; });
  console.log('\nAll status codes:', JSON.stringify(statusMap, null, 2));
  console.log('Total tasks:', allTasks.length);

  // Distribution
  const dist = {};
  allTasks.forEach(t => {
    const k = `${t.FStatus}(${t.FStatus$})`;
    dist[k] = (dist[k] || 0) + 1;
  });
  console.log('\nDistribution:');
  Object.entries(dist).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  // Non-Finished, non-New samples
  const active = allTasks.filter(t => t.FStatus !== 'Finished' && t.FStatus !== 'New');
  console.log(`\nActive tasks (non-New/non-Finished): ${active.length}`);
  active.slice(0, 8).forEach(t =>
    console.log(`  [${t.FStatus}/${t.FStatus$}] ${t.FName} | assignUser=${t.FAssignUserId?.substring(0,8)} dept=${t.FAssignDepartmentId?.substring(0,8)}`)
  );

  // ── D: userId / assignUserId filter tests ───────────────────────
  console.log('\n=== D: Task filter by userId ===');
  const tokenEmpId = tr.data.employee?.id;
  const knownId = 'bbc693e1-e448-11ed-b376-0607bbc2ee97';
  for (const [label, uid] of [['tokenEmpId', tokenEmpId], ['knownId', knownId]]) {
    if (!uid) { console.log(`${label}: no ID`); continue; }
    for (const param of ['userId', 'assignUserId']) {
      const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 50, [param]: uid }, jar);
      const cnt = r.data?.items?.length ?? '?';
      const sm = {};
      (r.data?.items||[]).forEach(t => { sm[t.FStatus] = (sm[t.FStatus]||0)+1; });
      console.log(`  ${label} ${param}=${uid.substring(0,12)}… → count=${cnt} ${JSON.stringify(sm)}`);
    }
  }
}

main().catch(console.error);
