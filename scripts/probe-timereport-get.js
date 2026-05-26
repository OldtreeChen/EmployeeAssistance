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
  const conn = await mysql.createConnection({
    host: 'db', port: 3306,
    user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!',
    database: process.env.DB_NAME||'line_punch_system'
  });
  // Use a user who has submitted work hours recently
  const [rows] = await conn.execute(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='xander.wang' LIMIT 1"
  );
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  const userId   = rows[0].employee_id;
  console.log('User:', username, '| userId:', userId);

  // QS Login
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL\n');

  const dateStr = '2026-04-24';
  const dateISO = dateStr + 'T12:00:00.000Z';

  // ── 1. Try getMainUnitEntity by date ─────────────────
  console.log('\n=== Ecp.TimeReport.getMainUnitEntity.data ===');
  const r1 = await post('/ecp/Ecp.TimeReport.getMainUnitEntity.data', { userId, date: dateISO }, jar);
  console.log(r1.raw.substring(0, 500));

  // ── 2. Try getEntityByDate ────────────────────────────
  console.log('\n=== Ecp.TimeReport.getEntityByDate.data ===');
  const r2 = await post('/ecp/Ecp.TimeReport.getEntityByDate.data', { userId, date: dateISO }, jar);
  console.log(r2.raw.substring(0, 500));

  // ── 3. Try getByDate ──────────────────────────────────
  console.log('\n=== Ecp.TimeReport.getByDate.data ===');
  const r3 = await post('/ecp/Ecp.TimeReport.getByDate.data', { userId, date: dateISO }, jar);
  console.log(r3.raw.substring(0, 500));

  // ── 4. Try getItem with entityId from a known submission ──
  // First create/find via addMainUnitEntity (couldSave=0 = dry-run to get entityId without writing)
  console.log('\n=== addMainUnitEntity couldSave=0 (dry-run, get entityId) ===');
  const mainDry = await post('/ecp/Ecp.TimeReport.addMainUnitEntity.data', {
    userId, actualWorktime: '1', actualWorkvalue: '0.0', date: dateISO, couldSave: 0,
  }, jar);
  console.log(mainDry.raw.substring(0, 300));

  // ── 5. Try getDetails / getDetailList ────────────────
  console.log('\n=== Ecp.TimeReport.getDetails.data (no entityId) ===');
  const r5 = await post('/ecp/Ecp.TimeReport.getDetails.data', { userId, date: dateISO }, jar);
  console.log(r5.raw.substring(0, 500));

  // ── 6. Try QSVD for TimeReport ───────────────────────
  console.log('\n=== QSVD Ecp.TimeReport.getListData.data (no listId) ===');
  const r6 = await post('/ecp/qsvd-list/Ecp.TimeReport.getListData.data', {
    keyword: '', queryFormRecent: {}, start: 0, limit: 10,
  }, jar);
  console.log(r6.raw.substring(0, 500));

  // ── 7. Try getListData directly ──────────────────────
  console.log('\n=== Ecp.TimeReport.getListData.data ===');
  const r7 = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, startDate: dateISO, endDate: dateISO, start: 0, limit: 10,
  }, jar);
  console.log(r7.raw.substring(0, 500));

  // ── 8. Try getDetailsByMainId if we got entityId ─────
  const entityId = mainDry.data?.entityIds?.[0];
  if (entityId) {
    console.log('\n=== Ecp.TimeReport.getDetails.data with entityId ===');
    const r8 = await post('/ecp/Ecp.TimeReport.getDetails.data', { entityId }, jar);
    console.log(r8.raw.substring(0, 800));

    console.log('\n=== Ecp.TimeReport.getDetailList.data with entityId ===');
    const r9 = await post('/ecp/Ecp.TimeReport.getDetailList.data', { entityId }, jar);
    console.log(r9.raw.substring(0, 800));

    console.log('\n=== Ecp.TimeReport.getItem.data with entityId ===');
    const r10 = await post('/ecp/Ecp.TimeReport.getItem.data', { id: entityId }, jar);
    console.log(r10.raw.substring(0, 800));
  }
}
main().catch(console.error);
