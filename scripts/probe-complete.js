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
      res.on('end', () => { const j = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '); try{resolve({data:JSON.parse(raw),raw,jar:j})}catch{resolve({data:raw,raw,jar:j})} });
    }).on('error', reject).end(d);
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);

  // Auth
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
  const tokenId  = tr.data.tokenId;
  const userId   = tr.data.employee?.id;
  const header   = { _header_: { tokenId } };
  console.log('Auth OK. userId:', userId);

  // 1. Full task list (first item)
  console.log('\n=== Full task list (first 2 items) ===');
  const tl = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 5 }, jar);
  console.log('hasNextPage:', tl.data.hasNextPage, 'total items so far:', tl.data.items?.length);
  if (tl.data.items?.length) {
    console.log('First task keys:', Object.keys(tl.data.items[0]));
    console.log('First task:', JSON.stringify(tl.data.items[0], null, 2).substring(0, 800));
    console.log('Second task (if any):', tl.data.items[1] ? JSON.stringify(tl.data.items[1]).substring(0, 300) : 'none');
  }

  // 2. Try to find activity type list via OpenAPI
  console.log('\n=== Activity type list ===');
  for (const [path, body] of [
    ['/ecp/openapi/ecp/activitytype/list', { ...header }],
    ['/ecp/openapi/ecp/activity/type/list', { ...header }],
    ['/ecp/openapi/ecp/timereport/type/list', { ...header }],
    ['/ecp/openapi/ecp/worktype/list', { ...header }],
    ['/ecp/openapi/timereport/type', { ...header }],
    ['/ecp/openapi/aile/dict/list', { ...header, type: 'ACTIVITY_TYPE' }],
    ['/ecp/Ecp.TimeReport.getType.data', { _header_: { tokenId } }],
    ['/ecp/Ecp.Activity.query.data', { _header_: { tokenId }, start: 0, limit: 20 }],
  ]) {
    const r = await httpPost(path, body, jar);
    const d = r.data;
    const ok = (d?._header_?.success === true) || (!d?._failed && r.raw !== '{}' && r.raw.length > 10);
    if (ok) console.log(`✅ ${path}: ${r.raw.substring(0, 400)}`);
  }

  // 3. Try /openapi/ecp/timereport endpoints
  console.log('\n=== OpenAPI timereport endpoints ===');
  for (const [path, body] of [
    ['/ecp/openapi/ecp/timereport/task/list', { ...header }],
    ['/ecp/openapi/ecp/timereport/add', { ...header }],
    ['/ecp/openapi/ecp/timereport/form', { ...header }],
  ]) {
    const r = await httpPost(path, body, jar);
    if (r.raw.length > 5) console.log(`${path}: ${r.raw.substring(0, 200)}`);
  }

  // 4. Test addMainUnitEntity with couldSave:0 - what does it return?
  // NOTE: couldSave:0 might actually save! Let's use couldSave:1 which is safer
  // From the user's payload they used couldSave:0 for real submission
  // Let's check: does couldSave:0 actually create a record?
  console.log('\n=== addMainUnitEntity couldSave meanings ===');
  const today = new Date();
  const pastDate = '2020-01-01T00:00:00.000Z'; // far past date - unlikely to conflict
  const r0 = await httpPost('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId, actualWorktime: '0', actualWorkvalue: '0.0',
    date: pastDate, couldSave: 0,
  }, jar);
  console.log('couldSave:0 result:', r0.raw.substring(0, 200));
  const r1 = await httpPost('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId, actualWorktime: '0', actualWorkvalue: '0.0',
    date: pastDate, couldSave: 1,
  }, jar);
  console.log('couldSave:1 result:', r1.raw.substring(0, 200));
}
main().catch(console.error);
