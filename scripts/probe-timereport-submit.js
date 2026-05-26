'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST   = 'econtact.ai3.cloud';

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
  // Use xander.wang for testing
  const [rows] = await conn.execute("SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='xander.wang' LIMIT 1");
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  const userId   = rows[0].employee_id;
  console.log('User:', username, '| userId:', userId);

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL');

  // Use first task from QSVD
  const tr = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', {
    listId: '296aa935-f6c0-4a8e-9ab9-32254ea39861',
    schemaId: 'b158be99-606a-4dc9-aa7f-53f50b16059a',
    keyword: '', queryFormRecent: {}, start: 0, limit: 5,
  }, jar);
  const tasks = tr.data?.data?.records || [];
  const task = tasks[0];
  console.log('Task:', task?.FName, '| FId:', task?.FId, '| dept:', task?.FAssignDepartmentId);

  const dateStr = '2026-04-23';
  const dateISO = new Date(dateStr + 'T00:00:00+08:00').toISOString();
  console.log('dateISO:', dateISO);

  // Step 1: addMainUnitEntity with couldSave=1
  const mainRes = await post('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId,
    actualWorktime:  '2',
    actualWorkvalue: '0.0',
    date:            dateISO,
    couldSave:       1,
  }, jar);
  console.log('\nStep1 state=', mainRes.data?.state, 'entityIds=', mainRes.data?.entityIds);
  const entityId = mainRes.data?.entityIds?.[0];
  if (!entityId) { console.log('No entityId, abort'); return; }
  console.log('entityId:', entityId);

  const hours   = 2;
  const startH  = 9;
  const endH    = startH + hours;
  const pad     = n => String(Math.floor(n)).padStart(2,'0');
  const startDT = `${dateStr} ${pad(startH)}:00:00`;
  const endDT   = `${dateStr} ${pad(endH)}:00:00`;
  const fname   = task.FName + ':專案實施';
  const deptId  = task.FAssignDepartmentId || '';

  // Step 2: addDetails
  const detail = {
    taskId: task.FId, type: '專案實施', workTime: String(hours),
    progress: '0', outputValue: '0.00', WorkDescription: '測試probe',
    fname, fdatetime: startDT, fenddatetime: endDT,
    userId, departmentId: deptId,
  };
  const allDetail = {
    trpDetail: '', taskId: task.FId, type: '專案實施', workHours: String(hours),
    progress: '0', outputValue: '0.00', description: '測試probe',
    fname, userId, date: dateISO,
  };
  const detailRes = await post('/ecp/Ecp.TimeReport.addDetails.data', {
    entityId, jsonData: [detail], allDetails: [allDetail],
  }, jar);
  console.log('\nStep2 _failed=', detailRes.data?._failed);
  console.log('  raw:', detailRes.raw.substring(0, 400));
}
main().catch(console.error);
