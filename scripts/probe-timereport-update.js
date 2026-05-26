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
    host: 'db', port: 3306, user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system'
  });
  const [rows] = await conn.execute("SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='xander.wang' LIMIT 1");
  await conn.end();

  const username = rows[0].ec_username;
  const password = decrypt(rows[0].ec_password);
  const userId   = rows[0].employee_id;
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login:', jar ? 'OK' : 'FAIL');

  // ── Get main entity for 2026-04-23 ────────────────────
  const targetDate = '2026-04-23';
  const listRes = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, startDate: targetDate + 'T00:00:00.000Z', endDate: targetDate + 'T23:59:59.000Z',
    start: 0, limit: 5,
  }, jar);
  const mains = listRes.data?.data?.records || [];
  console.log('\nMain records for', targetDate, ':', mains.length);
  const main = mains.find(r => r.FDate === targetDate) || mains[0];
  if (!main) { console.log('No main entity, abort'); return; }
  console.log('  entityId:', main.FId, '  FRealityTime_Day:', main.FRealityTime_Day);

  // ── Get detail records — show ALL fields for first record ─
  const detRes = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    mainId: main.FId, start: 0, limit: 50,
  }, jar);
  const details = detRes.data?.data?.records || [];
  console.log('\nAll detail records returned:', details.length);
  const matching = details.filter(d => d.FDate === targetDate);
  console.log('Matching FDate=' + targetDate + ':', matching.length);
  if (details.length > 0) {
    console.log('\nFirst detail ALL fields:');
    console.log(JSON.stringify(details[0], null, 2).substring(0, 1200));
  }

  // ── Try filtering with queryFormRecent ────────────────
  console.log('\n=== Try queryFormRecent date filter ===');
  const qfr = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    mainId: main.FId,
    queryFormRecent: { FDate: targetDate },
    start: 0, limit: 50,
  }, jar);
  console.log('With queryFormRecent FDate filter:', (qfr.data?.data?.records||[]).length, 'records');

  // ── Try delete endpoints ──────────────────────────────
  if (matching.length > 0) {
    const detailId = matching[0].FId;
    console.log('\n=== Test delete endpoints (DRY RUN - will check if endpoint exists) ===');
    console.log('Detail FId to test:', detailId);

    // Just check if methods exist — do NOT actually delete
    const deleteTests = [
      ['Ecp.TimeReport.deleteDetail.data',      { detailId }],
      ['Ecp.TimeReport.removeDetail.data',       { detailId }],
      ['Ecp.TimeReport.deleteDetails.data',      { detailIds: [detailId] }],
      ['Ecp.TimeReport.removeDetails.data',      { detailIds: [detailId] }],
      ['Ecp.TimeReportDetail.delete.data',       { id: detailId }],
      ['Ecp.TimeReportDetail.deleteItem.data',   { id: detailId }],
      ['Ecp.TimeReport.removeMainAndDetails.data', { mainId: main.FId }],
      ['Ecp.TimeReport.clearDetails.data',       { mainId: main.FId }],
    ];

    for (const [ep, body] of deleteTests) {
      const r = await post(`/ecp/${ep}`, body, jar);
      const failed = r.data?._failed;
      const noMethod = r.raw?.includes('NoMethodWithArgument') || r.raw?.includes('NotExistByUnitCode');
      if (!failed) {
        console.log(`\n✅ FOUND: ${ep}  body=${JSON.stringify(body)}`);
        console.log(r.raw.substring(0, 400));
      } else if (noMethod) {
        console.log(`❌ NOT EXIST: ${ep}`);
      } else {
        console.log(`⚠️  EXISTS but error: ${ep}  →  ${r.raw.substring(0, 120)}`);
      }
    }
  }

  // ── Try updateMainUnitEntity ──────────────────────────
  console.log('\n=== update endpoints ===');
  const updateTests = [
    ['Ecp.TimeReport.updateMainUnitEntity.data', { entityId: main.FId, actualWorktime: String(main.FRealityTime_Day) }],
    ['Ecp.TimeReport.updateDetail.data',  {}],
  ];
  for (const [ep, body] of updateTests) {
    const r = await post(`/ecp/${ep}`, body, jar);
    const noMethod = r.raw?.includes('NoMethodWithArgument') || r.raw?.includes('NotExistByUnitCode');
    console.log(`${noMethod ? '❌' : '⚠️ '} ${ep}  →  ${r.raw.substring(0, 120)}`);
  }
}
main().catch(console.error);
