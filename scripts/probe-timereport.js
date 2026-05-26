'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');

const HOST = 'econtact.ai3.cloud';
const KNOWN_USER_ID = 'bbc693e1-e448-11ed-b376-0607bbc2ee97'; // from user payload

function postRaw(path, body, cookies) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: HOST, path: '/ecp/' + path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(cookies ? { Cookie: cookies } : {}) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const jar = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ data: parsed, raw, jar });
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'db', port: parseInt(process.env.DB_PORT || '3306'), user: process.env.DB_USER || 'punchuser', password: process.env.DB_PASSWORD || 'Punch@2026!', database: process.env.DB_NAME || 'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const USERNAME = rows[0].ec_username;
  const PASSWORD = decrypt(rows[0].ec_password);
  const loginRes = await postRaw('Qs.OnlineUser.login.data', { loginName: USERNAME, password: PASSWORD, language: 'zh-tw' });
  if (loginRes.data?._failed) { console.error('Login failed:', loginRes.data.message); process.exit(1); }
  const jar = loginRes.jar;
  console.log('Login OK');

  // 1. Get user info with known entityId
  console.log('\n=== Qs.OnlineUser.getItem with known userId ===');
  const userRes = await postRaw('Qs.OnlineUser.getItem.data', { entityId: KNOWN_USER_ID }, jar);
  console.log('status ok:', !userRes.data?._failed);
  console.log(userRes.raw.substring(0, 800));

  // 2. Try "get current user" patterns
  console.log('\n=== Current user patterns ===');
  for (const method of ['getCurrent','getCurrentUser','getLoginInfo','loginInfo','getSessionUser','getSelf','identity','getMe','getUser']) {
    const r = await postRaw(`Qs.OnlineUser.${method}.data`, {}, jar);
    if (!r.data?._failed) { console.log(`Qs.OnlineUser.${method}: OK =>`, r.raw.substring(0,200)); }
    else if (!r.data?.message?.includes('不存在名稱')) console.log(`Qs.OnlineUser.${method}: ${r.data?.message?.substring(0,80)}`);
  }

  // 3. More task list patterns
  console.log('\n=== More task patterns ===');
  for (const [ep, body] of [
    ['Ecp.Task.getTasksByUser.data',    {}],
    ['Ecp.Task.fetchList.data',         {}],
    ['Ecp.Task.listByUser.data',        {}],
    ['Ecp.Task.userTasks.data',         {}],
    ['Ecp.Task.getAssignedTask.data',   {}],
    ['Ecp.Task.queryByUser.data',       {}],
    ['Ecp.Task.listExecute.data',       {}],
    ['Ecp.Task.getExecuteList.data',    {}],
    ['Ecp.TimeReport.getTask.data',     {}],
    ['Ecp.TimeReport.queryTask.data',   { date: '2026-04-23', userId: KNOWN_USER_ID }],
    ['Ecp.TimeReport.listTask.data',    { userId: KNOWN_USER_ID }],
    ['Ecp.TimeReport.getTaskByDate.data', { date: '2026-04-23', userId: KNOWN_USER_ID }],
  ]) {
    const r = await postRaw(ep, body, jar);
    if (!r.data?._failed) {
      console.log(`${ep}: OK =>`);
      console.log('  ', r.raw.substring(0, 400));
    } else if (!r.data?.message?.includes('不存在名稱') && !r.data?.message?.includes('不存在單元')) {
      console.log(`${ep}: ${r.data?.message?.substring(0,100)}`);
    }
  }

  // 4. Type list patterns
  console.log('\n=== Type patterns ===');
  for (const [ep, body] of [
    ['Ecp.TimeReport.getWorkTypeList.data',    {}],
    ['Ecp.TimeReport.queryWorkType.data',      {}],
    ['Ecp.TimeReport.getDetailTypeName.data',  {}],
    ['Ecp.TimeReport.getDetailTypeOptions.data', {}],
    ['Ecp.Activity.queryType.data',            {}],
    ['Ecp.Activity.getType.data',              {}],
    ['Ecp.Activity.getActivityType.data',      {}],
    ['Ecp.Activity.queryActivityType.data',    {}],
  ]) {
    const r = await postRaw(ep, body, jar);
    if (!r.data?._failed) {
      console.log(`${ep}: OK =>`);
      console.log('  ', r.raw.substring(0, 400));
    } else if (!r.data?.message?.includes('不存在名稱') && !r.data?.message?.includes('不存在單元')) {
      console.log(`${ep}: ${r.data?.message?.substring(0,100)}`);
    }
  }
}

main().catch(console.error);
