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

async function testUser(username, password, label) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`${label} (${username})`);
  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;
  if (!jar) { console.log('Login FAILED'); return; }

  // A: 目前方式（帶 userId）
  const [u] = await db.query(`SELECT employee_id FROM users WHERE ec_username=? LIMIT 1`, [username]);
  const storedId = u?.employee_id;
  const rA = await post('/ecp/Ecp.TimeReport.getListData.data',
    { userId: storedId, start: 0, limit: 20 }, jar);
  const recsA = rA.data?.data?.records || [];
  console.log(`A (stored userId=${storedId}): ${recsA.length} records, FUserIds: ${[...new Set(recsA.map(r=>r['FUserId$']))].join(', ')}`);

  // B: conditions CurrentUser
  const rB = await post('/ecp/Ecp.TimeReport.getListData.data', {
    conditions: [{ fieldName: 'FUserId', value: '', operator: 'CurrentUser' }],
    start: 0, limit: 20,
  }, jar);
  const recsB = rB.data?.data?.records || [];
  console.log(`B (CurrentUser condition): ${recsB.length} records`);
  recsB.slice(0, 5).forEach(r =>
    console.log(`  FDate=${r.FDate}  hours=${r.FRealityTime_Day}  FUserId$=${r['FUserId$']}`)
  );

  // C: Qs.OnlineUser.getItem.data（取得 session 使用者資訊）
  const rC = await post('/ecp/Qs.OnlineUser.getItem.data', { loginName: username }, jar);
  const sessionId = rC.data?.id || rC.data?.FId || rC.data?.userId || null;
  console.log(`C (Qs.OnlineUser.getItem → id): ${sessionId}`);
  if (sessionId && sessionId !== storedId) {
    // 用正確的 id 再查一次
    const rD = await post('/ecp/Ecp.TimeReport.getListData.data',
      { userId: sessionId, start: 0, limit: 20 }, jar);
    const recsD = rD.data?.data?.records || [];
    const uniq = [...new Set(recsD.map(r=>r['FUserId$']))];
    console.log(`D (session userId=${sessionId}): ${recsD.length} records, FUserIds: ${uniq.join(', ')}`);
  }
}

async function main() {
  await db.init();
  const users = await db.query(
    "SELECT ec_username, ec_password FROM users WHERE ec_username IN ('oldtree.chen','li.lin') AND ec_setup_done=1"
  );
  for (const u of users) {
    await testUser(u.ec_username, decrypt(u.ec_password), u.ec_username === 'oldtree.chen' ? 'Oldtree（問題使用者）' : 'li.lin（正常使用者）');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
