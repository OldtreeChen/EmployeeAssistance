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

const DETAIL_LIST_ID = '158470cc-fcf0-0448-0d70-c65444558360';
const TASK_LIST_ID   = '296aa935-f6c0-4a8e-9ab9-32254ea39861';
const TASK_SCHEMA_ID = 'b158be99-606a-4dc9-aa7f-53f50b16059a';
const TARGET_DATE    = '2026-05-12';

async function main() {
  await db.init();
  const [user] = await db.query(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='oldtree.chen' LIMIT 1"
  );
  const username = user.ec_username;
  const password = decrypt(user.ec_password);
  const storedId = user.employee_id;

  console.log(`=== oldtree.chen 5/12 工時調查 ===`);
  console.log(`DB employee_id (stored): ${storedId}`);

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  console.log(`Login: ${jar ? 'OK' : 'FAIL'}\n`);

  // 1. 用 DB stored employee_id 查 TimeReport list（getWorkHoursLast7Days 的做法）
  console.log('=== 1. TimeReport.getListData with stored employee_id ===');
  const r1 = await post('/ecp/Ecp.TimeReport.getListData.data',
    { userId: storedId, start: 0, limit: 20 }, jar);
  const reports1 = r1.data?.data?.records || [];
  console.log(`Records: ${reports1.length}`);
  reports1.slice(0, 7).forEach(r =>
    console.log(`  FDate=${r.FDate}  FId=${r.FId}  hours=${r.FRealityTime_Day}  FUserId$=${r['FUserId$']}`)
  );

  // 2. 不帶 userId 查 TimeReport（session 範圍）
  console.log('\n=== 2. TimeReport.getListData WITHOUT userId (session-scoped) ===');
  const r2 = await post('/ecp/Ecp.TimeReport.getListData.data',
    { start: 0, limit: 20 }, jar);
  const reports2 = r2.data?.data?.records || [];
  console.log(`Records: ${reports2.length}`);
  reports2.slice(0, 7).forEach(r =>
    console.log(`  FDate=${r.FDate}  hours=${r.FRealityTime_Day}  FUserId$=${r['FUserId$']}`)
  );

  // 3. 取得 oldtree.chen 真正的 TsUser.FId（從 task）
  console.log('\n=== 3. Detect own userId from QSVD task ===');
  const r3 = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', {
    listId: TASK_LIST_ID, schemaId: TASK_SCHEMA_ID,
    keyword: '', queryFormRecent: {}, start: 0, limit: 1,
  }, jar);
  const ownUserId = r3.data?.data?.records?.[0]?.FUserId || null;
  console.log(`ownUserId from task: ${ownUserId || '(none — no active tasks)'}`);

  // 4. 5/12 的 TimeReportDetail — CurrentUser（現行方式）
  console.log(`\n=== 4. getWorkHoursDetail ${TARGET_DATE} with CurrentUser ===`);
  const r4 = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
    listId: DETAIL_LIST_ID,
    conditions: [
      { fieldName: 'FDate',   value: TARGET_DATE, operator: 'Equal' },
      { fieldName: 'FUserId', value: '',           operator: 'CurrentUser' },
    ],
    start: 0, limit: 50,
  }, jar);
  const recs4 = r4.data?.data?.records || [];
  console.log(`Records: ${recs4.length}`);
  recs4.forEach(r => console.log(`  FUserId=${r.FUserId}  task=${(r['FTaskId$']||'').slice(0,35)}  hours=${r.FWorkTime}`));

  // 5. 5/12 的 TimeReportDetail — FDate only（誰的資料）
  console.log(`\n=== 5. getWorkHoursDetail ${TARGET_DATE} FDate only (all users) ===`);
  const r5 = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
    listId: DETAIL_LIST_ID,
    conditions: [{ fieldName: 'FDate', value: TARGET_DATE, operator: 'Equal' }],
    start: 0, limit: 100,
  }, jar);
  const recs5 = r5.data?.data?.records || [];
  console.log(`Total records for ${TARGET_DATE}: ${recs5.length}`);
  const byUser = {};
  recs5.forEach(r => {
    const uid = r.FUserId || '(none)';
    if (!byUser[uid]) byUser[uid] = [];
    byUser[uid].push(`${(r['FTaskId$']||'').slice(0,30)} ${r.FWorkTime}h`);
  });
  Object.entries(byUser).forEach(([uid, items]) =>
    console.log(`  FUserId=${uid}\n    ${items.join('\n    ')}`)
  );

  // 6. 用 stored employee_id 查 5/12 的 entity detail
  console.log(`\n=== 6. getItem for 5/12 entity (stored userId) ===`);
  const rec512 = reports1.find(r => r.FDate === TARGET_DATE);
  if (rec512) {
    console.log(`Found entity: FId=${rec512.FId}  FUserId$=${rec512['FUserId$']}  hours=${rec512.FRealityTime_Day}`);
    const r6 = await post('/ecp/Ecp.TimeReport.getItem.data', { entityId: rec512.FId }, jar);
    console.log(`getItem: FUserId$=${r6.data?.['FUserId$']}  FUserId=${r6.data?.FUserId}`);
  } else {
    console.log(`No 5/12 record found using stored userId=${storedId}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
