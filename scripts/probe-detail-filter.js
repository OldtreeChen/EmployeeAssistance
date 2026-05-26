'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const { decrypt } = require('../lib/crypto');
const db     = require('../lib/db');
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
  await db.init();
  const [user] = await db.query(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='oldtree.chen' LIMIT 1"
  );
  const username = user.ec_username;
  const password = decrypt(user.ec_password);
  const userId   = user.employee_id;

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK, userId:', userId);

  // Get daily report list to find a specific date + entityId
  const listRes = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, start: 0, limit: 10,
  }, jar);
  const reports = listRes.data?.data?.records || [];
  console.log('\n=== Daily reports ===');
  reports.slice(0, 5).forEach(r =>
    console.log(`  FDate=${r.FDate}  FId=${r.FId}  hours=${r.FRealityTime_Day}`)
  );
  const mainEntityId = reports[0]?.FId;
  const mainDate     = reports[0]?.FDate;
  if (!mainEntityId) { console.log('No reports'); process.exit(0); }
  console.log(`\nTarget: date=${mainDate} entityId=${mainEntityId}`);

  // ─── 1. Baseline: how many unfiltered detail records exist? ───────────────
  console.log('\n=== 1. Baseline unfiltered ===');
  const base = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    start: 0, limit: 200,
  }, jar);
  const baseRecs = base.data?.data?.records || [];
  console.log(`Total returned: ${baseRecs.length}  (API total=${base.data?.data?.total})`);
  // Show FDate distribution
  const dateCount = {};
  baseRecs.forEach(r => { dateCount[r.FDate] = (dateCount[r.FDate] || 0) + 1; });
  console.log('FDate distribution:');
  Object.entries(dateCount).sort().forEach(([d, c]) => console.log(`  ${d}: ${c}`));
  // Show FUserId in first record
  if (baseRecs[0]) {
    console.log('First record FUserId:', baseRecs[0].FUserId, '  FMainId:', baseRecs[0].FMainId, '  FDate:', baseRecs[0].FDate);
  }

  // ─── 2. conditions array filter by FDate ──────────────────────────────────
  console.log('\n=== 2. conditions array {fieldName FDate Equal} ===');
  const r2 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    conditions: [{ fieldName: 'FDate', value: mainDate, operator: 'Equal' }],
    start: 0, limit: 50,
  }, jar);
  const recs2 = r2.data?.data?.records || [];
  console.log(`Returned: ${recs2.length}  (total=${r2.data?.data?.total})`);
  recs2.slice(0, 3).forEach(r => console.log(`  FDate=${r.FDate}  task=${r['FTaskId$']}  hours=${r.FWorkTime}`));

  // ─── 3. conditions array filter by FUserId ────────────────────────────────
  console.log('\n=== 3. conditions array {fieldName FUserId Equal userId} ===');
  const r3 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    conditions: [{ fieldName: 'FUserId', value: userId, operator: 'Equal' }],
    start: 0, limit: 50,
  }, jar);
  const recs3 = r3.data?.data?.records || [];
  console.log(`Returned: ${recs3.length}  (total=${r3.data?.data?.total})`);
  recs3.slice(0, 3).forEach(r => console.log(`  FDate=${r.FDate}  FUserId=${r.FUserId}  task=${r['FTaskId$']}  hours=${r.FWorkTime}`));

  // ─── 4. conditions: FUserId + FDate ───────────────────────────────────────
  console.log('\n=== 4. conditions: FUserId + FDate ===');
  const r4 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    conditions: [
      { fieldName: 'FUserId', value: userId,   operator: 'Equal' },
      { fieldName: 'FDate',   value: mainDate,  operator: 'Equal' },
    ],
    start: 0, limit: 50,
  }, jar);
  const recs4 = r4.data?.data?.records || [];
  console.log(`Returned: ${recs4.length}  (total=${r4.data?.data?.total})`);
  recs4.forEach(r => console.log(`  FDate=${r.FDate}  task=${r['FTaskId$']}  hours=${r.FWorkTime}  desc=${r.FWorkDescription}`));

  // ─── 5. TimeReport.getItem.data — get main entity, see if detail inside ───
  console.log('\n=== 5. TimeReport.getItem.data ===');
  const r5 = await post('/ecp/Ecp.TimeReport.getItem.data', {
    entityId: mainEntityId,
  }, jar);
  console.log('Keys in data:', Object.keys(r5.data?.data || {}).join(', '));
  console.log('Raw (500):', JSON.stringify(r5.data).substring(0, 500));

  // ─── 6. TimeReport.getItem.data with userId + date ────────────────────────
  console.log('\n=== 6. TimeReport.getItem.data userId+date ===');
  const r6 = await post('/ecp/Ecp.TimeReport.getItem.data', {
    userId, date: mainDate,
  }, jar);
  console.log('Raw (500):', JSON.stringify(r6.data).substring(0, 500));

  // ─── 7. QSVD TimeReportDetail with conditions FDate ───────────────────────
  console.log('\n=== 7. QSVD TimeReportDetail conditions FDate ===');
  const r7 = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
    listId:     '158470cc-fcf0-0448-0d70-c65444558360',
    conditions: [{ fieldName: 'FDate', value: mainDate, operator: 'Equal' }],
    start: 0, limit: 50,
  }, jar);
  const recs7 = r7.data?.data?.records || [];
  console.log(`Returned: ${recs7.length}`);
  console.log('Raw (300):', JSON.stringify(r7.data).substring(0, 300));

  // ─── 8. TimeReportDetail getListData with userId + conditions FDate ────────
  console.log('\n=== 8. userId + conditions FDate ===');
  const r8 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    userId,
    conditions: [{ fieldName: 'FDate', value: mainDate, operator: 'Equal' }],
    start: 0, limit: 50,
  }, jar);
  const recs8 = r8.data?.data?.records || [];
  console.log(`Returned: ${recs8.length}  (total=${r8.data?.data?.total})`);
  recs8.forEach(r => console.log(`  FDate=${r.FDate}  task=${r['FTaskId$']}  hours=${r.FWorkTime}`));

  // ─── 9. Try getDetail or getDetailList variant endpoints ──────────────────
  console.log('\n=== 9. Ecp.TimeReport.getDetailList.data ===');
  const r9 = await post('/ecp/Ecp.TimeReport.getDetailList.data', {
    entityId: mainEntityId, userId, date: mainDate, start: 0, limit: 50,
  }, jar);
  console.log('Raw (400):', JSON.stringify(r9.data).substring(0, 400));

  // ─── 10. Check if FDate from daily list has time component (ISO) ───────────
  console.log('\n=== 10. Check FDate format in daily list ===');
  reports.slice(0, 3).forEach(r => console.log(`  FDate raw: ${JSON.stringify(r.FDate)}`));
  // Also check ISO date format
  const dateISO = mainDate + 'T12:00:00.000Z';
  const r10 = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    conditions: [{ fieldName: 'FDate', value: dateISO, operator: 'Equal' }],
    start: 0, limit: 50,
  }, jar);
  const recs10 = r10.data?.data?.records || [];
  console.log(`ISO date filter returned: ${recs10.length}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
