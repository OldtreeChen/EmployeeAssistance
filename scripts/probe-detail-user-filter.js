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

// Use a listId from QSVD probe that returned FUserId in response
const DETAIL_LIST_ID = '158470cc-fcf0-0448-0d70-c65444558360';

async function main() {
  await db.init();
  // Test with a user that has known data
  const users = await db.query(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 3"
  );

  for (const user of users) {
    const username = user.ec_username;
    const password = decrypt(user.ec_password);
    const storedId = user.employee_id;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`User: ${username}  storedId=${storedId}`);

    const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
    const jar = lr.jar;
    if (!jar) { console.log('Login FAILED'); continue; }

    // Get this user's own TsUser.FId via QSVD task (most reliable)
    const taskR = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', {
      listId:   '296aa935-f6c0-4a8e-9ab9-32254ea39861',
      schemaId: 'b158be99-606a-4dc9-aa7f-53f50b16059a',
      keyword: '', queryFormRecent: {}, start: 0, limit: 1,
    }, jar);
    const ownUserId = taskR.data?.data?.records?.[0]?.FUserId || null;
    console.log(`ownUserId (from task): ${ownUserId}`);

    // Find a date that has records for this user
    const histR = await post('/ecp/Ecp.TimeReport.getListData.data',
      { userId: storedId, start: 0, limit: 10 }, jar);
    const reports = histR.data?.data?.records || [];
    const filledReport = reports.find(r => parseFloat(r.FRealityTime_Day) > 0);
    if (!filledReport) { console.log('No filled days found'); continue; }
    const testDate = filledReport.FDate;
    console.log(`Test date: ${testDate}  totalHours=${filledReport.FRealityTime_Day}`);

    // A: QSVD + FDate only (current approach)
    const rA = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
      listId: DETAIL_LIST_ID,
      conditions: [{ fieldName: 'FDate', value: testDate, operator: 'Equal' }],
      start: 0, limit: 100,
    }, jar);
    const recsA = rA.data?.data?.records || [];
    const uniqueUsersA = [...new Set(recsA.map(r => r.FUserId))];
    console.log(`\nA: QSVD FDate only → ${recsA.length} records, unique FUserIds: ${uniqueUsersA.length}`);
    recsA.slice(0, 3).forEach(r => console.log(`   FUserId=${r.FUserId}  task=${(r['FTaskId$']||'').slice(0,30)}  hours=${r.FWorkTime}`));

    // B: QSVD + FDate + CurrentUser
    const rB = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
      listId: DETAIL_LIST_ID,
      conditions: [
        { fieldName: 'FDate',   value: testDate, operator: 'Equal' },
        { fieldName: 'FUserId', value: '',        operator: 'CurrentUser' },
      ],
      start: 0, limit: 100,
    }, jar);
    const recsB = rB.data?.data?.records || [];
    console.log(`\nB: QSVD FDate + CurrentUser → ${recsB.length} records`);
    recsB.slice(0, 3).forEach(r => console.log(`   FUserId=${r.FUserId}  task=${(r['FTaskId$']||'').slice(0,30)}  hours=${r.FWorkTime}`));

    // C: Regular endpoint + FDate + CurrentUser
    const rC = await post('/ecp/Ecp.TimeReportDetail.getListData.data', {
      conditions: [
        { fieldName: 'FDate',   value: testDate, operator: 'Equal' },
        { fieldName: 'FUserId', value: '',        operator: 'CurrentUser' },
      ],
      start: 0, limit: 100,
    }, jar);
    const recsC = rC.data?.data?.records || [];
    console.log(`\nC: Regular FDate + CurrentUser → ${recsC.length} records`);
    recsC.slice(0, 3).forEach(r => console.log(`   FUserId=${r.FUserId}  task=${(r['FTaskId$']||'').slice(0,30)}  hours=${r.FWorkTime}`));

    // D: Post-filter A results by ownUserId
    if (ownUserId) {
      const filtered = recsA.filter(r => r.FUserId === ownUserId);
      console.log(`\nD: Post-filter A by ownUserId (${ownUserId}) → ${filtered.length} records`);
      filtered.forEach(r => console.log(`   task=${(r['FTaskId$']||'').slice(0,40)}  hours=${r.FWorkTime}`));
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
