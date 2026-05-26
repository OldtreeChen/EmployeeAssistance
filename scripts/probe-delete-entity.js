'use strict';
// Tests Ecp.TimeReport.delete.data with a freshly-created test entity (then deletes it).
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
  const conn = await mysql.createConnection({
    host: 'db', port: 3306, user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system'
  });
  const [rows] = await conn.execute("SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='xander.wang' LIMIT 1");
  await conn.end();
  const password = decrypt(rows[0].ec_password);
  const userId = rows[0].employee_id;

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL');

  // Use a future/test date unlikely to already have data
  const testDate = '2026-05-01';
  const testDateISO = testDate + 'T12:00:00.000Z';

  // Step 1: Create a test main entity
  console.log('\n1. Creating test entity for', testDate);
  const createRes = await post('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId, actualWorktime: '1', actualWorkvalue: '0.0', date: testDateISO, couldSave: 1,
  }, jar);
  console.log('   state=', createRes.data?.state, 'entityIds=', createRes.data?.entityIds);
  const entityId = createRes.data?.entityIds?.[0];
  if (!entityId) { console.log('   No entityId, abort'); return; }
  console.log('   entityId:', entityId);

  // Step 2: Verify it exists in getListData
  console.log('\n2. Verify entity exists via getListData');
  const checkBefore = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, start: 0, limit: 5,
  }, jar);
  const before = (checkBefore.data?.data?.records || []).find(r => r.FDate === testDate);
  console.log('   Found before delete:', before ? `FDate=${before.FDate} FRealityTime_Day=${before.FRealityTime_Day}` : 'NOT FOUND');

  // Step 3: Delete the entity
  console.log('\n3. Deleting entity via Ecp.TimeReport.delete.data');
  const deleteRes = await post('/ecp/Ecp.TimeReport.delete.data', {
    entityIds: [entityId],
  }, jar);
  console.log('   raw:', deleteRes.raw.substring(0, 300));

  // Step 4: Verify it's gone
  console.log('\n4. Verify entity removed via getListData');
  const checkAfter = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, start: 0, limit: 5,
  }, jar);
  const after = (checkAfter.data?.data?.records || []).find(r => r.FDate === testDate);
  console.log('   Found after delete:', after ? `FDate=${after.FDate}` : 'GONE ✅');
}
main().catch(console.error);
