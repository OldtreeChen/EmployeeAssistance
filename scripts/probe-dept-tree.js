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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        ...(jar ? { Cookie: jar } : {}) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        try { resolve({ data: JSON.parse(raw), jar: cookie }); }
        catch { resolve({ data: raw, jar: cookie }); }
      });
    }).on('error', reject).end(data);
  });
}

const KNOWN_DEPT    = 'ffffff19-b876-ec3a-3007-b725383cf204'; // 智能應用事業群
const USER_LIST_ID  = '5be1aa3f-3472-4ccb-8c7f-424d1c913586';

async function main() {
  await db.init();
  const [user] = await db.query('SELECT ec_username, ec_password FROM users WHERE ec_username=?', ['oldtree.chen']);
  const jar = (await post('/ecp/Qs.OnlineUser.login.data', {
    loginName: user.ec_username, password: decrypt(user.ec_password), language: 'zh-tw',
  })).jar;
  console.log('Login OK\n');

  // Test A: Qs.Department.getListData.data (no listId needed?)
  console.log('--- Test A: Qs.Department.getListData (no listId) ---');
  const rA = await post('/ecp/Qs.Department.getListData.data', { pageSize: 5, keyword: '' }, jar);
  console.log(JSON.stringify(rA.data).substring(0, 300));

  // Test B: qsvd-list/Qs.Department.getListData.data with conditions on FParentId
  console.log('\n--- Test B: qsvd-list/Qs.Department.getListData.data (no listId) ---');
  const rB = await post('/ecp/qsvd-list/Qs.Department.getListData.data', {
    conditions: [{ fieldName: 'FParentId', value: KNOWN_DEPT, operator: 'Equal' }],
    pageSize: 20,
  }, jar);
  console.log(JSON.stringify(rB.data).substring(0, 500));

  // Test C: Try fetching all users, see unique depts, and check if any parent dept info is embedded
  console.log('\n--- Test C: All users, unique dept IDs ---');
  const rC = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
    listId: USER_LIST_ID,
    conditions: [],
    pageSize: 300,
  }, jar);
  const users = rC.data?.data?.records || [];
  const depts = {};
  for (const u of users) {
    const id = u.FDepartmentId || '';
    const nm = u['FDepartmentId$'] || '';
    if (id) depts[id] = nm;
  }
  console.log(`Total users: ${users.length}, Unique depts: ${Object.keys(depts).length}`);
  Object.entries(depts).forEach(([id, nm]) => console.log(`  ${nm} (${id})`));

  // Test D: Fetch dept by FId using Qs.Department.getItem.data
  console.log('\n--- Test D: Qs.Department.getItem.data for known dept ---');
  const rD = await post('/ecp/Qs.Department.getItem.data', { entityId: KNOWN_DEPT }, jar);
  console.log(JSON.stringify(rD.data).substring(0, 500));

  // Test E: Use Ecp.TsDepartment.getByXxx style
  console.log('\n--- Test E: Ecp.TsDepartment variations ---');
  const rE1 = await post('/ecp/Qs.Department.getListData.data', {
    conditions: [{ fieldName: 'FParentId', value: KNOWN_DEPT, operator: 'Equal' }],
    pageSize: 20,
  }, jar);
  console.log('Qs.Department.getListData with conditions:', JSON.stringify(rE1.data).substring(0, 400));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
