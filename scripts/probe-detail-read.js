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

  const entityId = 'ffffff19-dba2-5e76-7802-38af463cf204'; // 2026-04-23 main entity

  // ── Try getting item with details included ────────────
  console.log('=== TimeReport.getListData with FId conditions ===');
  const r1 = await post('/ecp/Ecp.TimeReport.getListData.data', {
    conditions: [{ field: 'FId', op: '=', value: entityId }], start: 0, limit: 5,
  }, jar);
  console.log(r1.raw.substring(0, 600));

  // ── Try TrpMainUnit variants ──────────────────────────
  console.log('\n=== Ecp.TrpMainUnit.getItem.data ===');
  const r2 = await post('/ecp/Ecp.TrpMainUnit.getItem.data', { id: entityId }, jar);
  console.log(r2.raw.substring(0, 500));

  // ── Try TimeReport detail via "getSubList" pattern ────
  console.log('\n=== Ecp.TimeReport.getSubList variants ===');
  for (const ep of [
    'Ecp.TimeReport.getSubList.data',
    'Ecp.TrpMainUnit.getSubList.data',
    'Ecp.TrpMainUnit.getDetailList.data',
    'Ecp.TrpDetail.getListByMainId.data',
    'Ecp.TimeReport.getDetailsByEntity.data',
  ]) {
    const r = await post(`/ecp/${ep}`, { mainId: entityId, entityId, id: entityId, start: 0, limit: 50 }, jar);
    if (!r.raw?.includes('NoMethodWithArgument') && !r.raw?.includes('NotExistByUnitCode')) {
      console.log(`\n✅ ${ep}`);
      console.log(r.raw.substring(0, 600));
    } else {
      console.log(`❌ ${ep}`);
    }
  }

  // ── Check if TrpDetail has 2026 records ───────────────
  console.log('\n=== TimeReportDetail last 50 sorted by FId desc ===');
  const r3 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    sortBy: 'FId', sortDesc: true, start: 0, limit: 10,
  }, jar);
  const recs = r3.data?.data?.records || [];
  console.log('Records:', recs.length);
  recs.forEach(r => console.log(`  FId=${r.FId}  FDate=${r.FDate}  FTaskId$=${r.FTaskId$}  FWorkTime=${r.FWorkTime}`));

  // ── Try delete of main entity (dry test only - don't actually delete) ──
  console.log('\n=== Delete endpoint discovery ===');
  for (const [ep, body] of [
    ['Ecp.TimeReport.delete.data',            { id: entityId }],
    ['Ecp.TimeReport.deleteMain.data',        { mainId: entityId }],
    ['Ecp.TimeReport.deleteMainEntity.data',  { entityId }],
    ['Ecp.TimeReport.removeMain.data',        { mainId: entityId }],
    ['Ecp.TrpMainUnit.delete.data',           { id: entityId }],
  ]) {
    const r = await post(`/ecp/${ep}`, body, jar);
    const noMethod = r.raw?.includes('NoMethodWithArgument') || r.raw?.includes('NotExistByUnitCode');
    if (!noMethod) {
      console.log(`\n⚠️  EXISTS: ${ep}  →  ${r.raw.substring(0, 200)}`);
    } else {
      console.log(`❌ ${ep}`);
    }
  }
}
main().catch(console.error);
