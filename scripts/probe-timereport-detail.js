'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
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

  // Step 1: get recent daily report entities
  const listRes = await post('/ecp/Ecp.TimeReport.getListData.data', {
    userId, start: 0, limit: 10,
  }, jar);
  const records = listRes.data?.data?.records || [];
  console.log('\n=== Daily report entities ===');
  records.slice(0, 5).forEach(r =>
    console.log(`  FDate=${r.FDate}  FId=${r.FId}  hours=${r.FRealityTime_Day}`)
  );

  const mainEntityId = records[0]?.FId;
  const mainDate     = records[0]?.FDate;
  if (!mainEntityId) { console.log('No records'); process.exit(0); }
  console.log(`\nUsing: date=${mainDate} entityId=${mainEntityId}`);

  // A: plain endpoint with userId + date
  console.log('\n=== A: TimeReportDetail.getListData userId+date ===');
  const rA = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    userId, date: mainDate, start: 0, limit: 20,
  }, jar);
  const recsA = rA.data?.data?.records || [];
  console.log(`Records: ${recsA.length}`);
  if (recsA.length) {
    console.log('Fields:', Object.keys(recsA[0]).join(', '));
    recsA.forEach(r => console.log(`  task=${r['FTaskId$']}  type=${r.FType}  hours=${r.FWorkTime}  desc=${r.FWorkDescription}`));
  } else {
    console.log('Raw:', JSON.stringify(rA.data).substring(0, 300));
  }

  // B: plain endpoint with mainId=entityId
  console.log('\n=== B: TimeReportDetail.getListData mainId=entityId ===');
  const rB = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    mainId: mainEntityId, start: 0, limit: 20,
  }, jar);
  const recsB = rB.data?.data?.records || [];
  console.log(`Records: ${recsB.length}`);
  if (recsB.length) {
    recsB.forEach(r => console.log(`  task=${r['FTaskId$']}  type=${r.FType}  hours=${r.FWorkTime}`));
  } else {
    console.log('Raw:', JSON.stringify(rB.data).substring(0, 300));
  }

  // C: plain endpoint — all recent detail records (check FMainId field exists)
  console.log('\n=== C: TimeReportDetail.getListData userId-only, check FMainId ===');
  const rC = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
    userId, start: 0, limit: 20,
  }, jar);
  const recsC = rC.data?.data?.records || [];
  console.log(`Records: ${recsC.length}`);
  if (recsC.length) {
    console.log('Fields:', Object.keys(recsC[0]).join(', '));
    recsC.slice(0, 5).forEach(r =>
      console.log(`  FDate=${r.FDate}  FMainId=${r.FMainId}  FTaskId=${r.FTaskId}  task$=${r['FTaskId$']}  hours=${r.FWorkTime}`)
    );
  }

  // D: QSVD with masterEntityId = daily entity (task HAR listId)
  console.log('\n=== D: QSVD TimeReportDetail masterEntityId=dailyEntity ===');
  const rD = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
    listId:         '158470cc-fcf0-0448-0d70-c65444558360',
    relationId:     '255b7ef4-ba57-48ea-939c-97c1fab1d272',
    masterUnitId:   '47a60f3c-165f-4fbb-a877-1a5baafb48a1',
    masterEntityId: mainEntityId,
    keyword: '',
  }, jar);
  const recsD = rD.data?.data?.records || [];
  console.log(`Records: ${recsD.length}`);
  if (recsD.length) {
    recsD.forEach(r => console.log(`  task=${r['FTaskId$']}  type=${r.FType}  hours=${r.FWorkTime}`));
  } else {
    console.log('Raw:', JSON.stringify(rD.data).substring(0, 300));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
