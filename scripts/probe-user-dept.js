'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const { decrypt } = require('../lib/crypto');
const db = require('../lib/db');

const HOST = 'econtact.ai3.cloud';
function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    https.request({
      hostname: HOST, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(jar ? { Cookie: jar } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        try   { resolve({ data: JSON.parse(raw), jar: cookie }); }
        catch { resolve({ data: raw, jar: cookie }); }
      });
    }).on('error', reject).end(data);
  });
}

const DEPUTY_LIST_ID     = '5be1aa3f-3472-4ccb-8c7f-424d1c913586';
const DEPUTY_RELATION_ID = '8ced85ec-7850-4b20-b6da-7e18d1e5b437';
const DEPUTY_EDIT_ID     = 'ffd89819-7a61-4676-bfd2-84dcefea1e02';
const DEPUTY_FIELD_ID    = 'df625d98-6143-4327-b519-d14172f1eefd';

async function main() {
  await db.init();
  const [user] = await db.query('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 AND ec_username=? LIMIT 1', ['oldtree.chen']);

  const username = user.ec_username;
  const password = decrypt(user.ec_password);
  const ecUserId = user.employee_id || '';
  console.log(`User: ${username}, employee_id: ${ecUserId}`);

  // QS login
  const loginRes = await post('/ecp/Qs.OnlineUser.login.data', {
    loginName: username, password, language: 'zh-tw',
  });
  if (loginRes.data?._failed) { console.log('Login failed'); process.exit(1); }
  const jar = loginRes.jar;
  console.log('Login OK\n');

  // Test A: QSVD user list WITHOUT entity-box params (plain list query for self by FId)
  console.log('--- Test A: QSVD user list, conditions FId=Equal ---');
  const resA = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
    listId:   DEPUTY_LIST_ID,
    conditions: [{ fieldName: 'FId', value: ecUserId, operator: 'Equal' }],
    pageSize: 5,
  }, jar);
  const recA = resA.data?.data?.records || [];
  console.log(`Records: ${recA.length}`);
  if (recA.length) console.log('First:', JSON.stringify(recA[0]));
  else console.log('Raw (first 300):', JSON.stringify(resA.data).substring(0, 300));

  // Test B: QSVD user list WITHOUT entity-box, no conditions (just pageSize=5 to see format)
  console.log('\n--- Test B: QSVD user list, no conditions, no entity-box ---');
  const resB = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
    listId:   DEPUTY_LIST_ID,
    pageSize: 5,
    keyword:  '',
  }, jar);
  const recB = resB.data?.data?.records || [];
  console.log(`Records: ${recB.length}`);
  if (recB.length) {
    console.log('First record keys:', Object.keys(recB[0]).join(', '));
    // Is current user in these?
    const found = recB.find(r => r.FId === ecUserId);
    console.log(`Current user in results: ${found ? 'YES' : 'no'}`);
    console.log('First:', JSON.stringify(recB[0]).substring(0, 300));
  } else {
    console.log('Raw (first 300):', JSON.stringify(resB.data).substring(0, 300));
  }

  // Test C: Qs.OnlineUser.getItem.data (full response)
  console.log('\n--- Test C: Qs.OnlineUser.getItem.data ---');
  const resC = await post('/ecp/Qs.OnlineUser.getItem.data', { loginName: username }, jar);
  console.log('Full response:', JSON.stringify(resC.data).substring(0, 500));

  // Test D: Ecp.TsUser.getByLoginName.data (full response)
  console.log('\n--- Test D: Ecp.TsUser.getByLoginName.data ---');
  const resD = await post('/ecp/Ecp.TsUser.getByLoginName.data', { loginName: username }, jar);
  console.log('Full response:', JSON.stringify(resD.data).substring(0, 500));

  // Test E: QSVD user list with entity-box but pageSize=300 to see if self appears later
  console.log('\n--- Test E: QSVD entity-box user list, pageSize=300, check if self appears ---');
  const resE = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
    listId:           DEPUTY_LIST_ID,
    relationId:       DEPUTY_RELATION_ID,
    editId:           DEPUTY_EDIT_ID,
    entityBoxFieldId: DEPUTY_FIELD_ID,
    forms:            { form: { FUserId: ecUserId } },
    pageSize:         300,
    keyword:          '',
    isRefresh:        true,
  }, jar);
  const recE = resE.data?.data?.records || [];
  console.log(`Records: ${recE.length}`);
  const selfE = recE.find(r => r.FId === ecUserId);
  console.log(`Self in results: ${selfE ? 'YES - ' + JSON.stringify(selfE) : 'no'}`);
  // Find user with dept matching known dept
  const KNOWN_DEPT = 'ffffff19-b876-ec3a-3007-b725383cf204';
  const sameDept = recE.filter(r => r.FDepartmentId === KNOWN_DEPT);
  console.log(`Users with known dept (智能應用事業群): ${sameDept.length}`);
  if (sameDept.length > 0) console.log('Sample:', JSON.stringify(sameDept[0]));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
