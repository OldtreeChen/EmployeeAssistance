'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';

function httpPost(path, body, cookie) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...(cookie ? { Cookie: cookie } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        const jar = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
        try { resolve({ data: JSON.parse(raw), raw, jar }); }
        catch { resolve({ data: raw, raw, jar }); }
      });
    }).on('error', reject).end(d);
  });
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST||'db', port: 3306,
    user: process.env.DB_USER||'punchuser',
    password: process.env.DB_PASSWORD||'Punch@2026!',
    database: process.env.DB_NAME||'line_punch_system',
  });
  const [rows] = await conn.query(`SELECT ec_username, ec_password FROM users WHERE ec_username='Oldtree.chen' LIMIT 1`);
  await conn.end();
  if (!rows.length) { console.error('找不到使用者'); return; }
  const password = decrypt(rows[0].ec_password);

  const loginRes = await httpPost('/ecp/Qs.OnlineUser.login.data',
    { loginName: rows[0].ec_username, password, language: 'zh-tw' });
  if (loginRes.data?._failed) { console.error('登入失敗'); return; }
  const jar = loginRes.jar;
  console.log('登入成功');

  // 查詢餘假
  const r = await httpPost('/ecp/qsvd-list/Ecp.LeaveProvided.getListData.data', {
    listId:   'f7c8f14b-b1ba-4793-bebf-60e0e594dc4a',
    schemaId: 'ffffff19-de9d-32a9-3802-38af463cf204',
    keyword:  '',
  }, jar);

  const records = r.data?.data?.records || [];
  console.log(`\n共 ${records.length} 筆記錄`);
  if (records.length) {
    console.log('\n第一筆所有欄位：');
    Object.entries(records[0]).forEach(([k, v]) => {
      if (v !== null && v !== '' && v !== undefined) console.log(`  ${k}: ${JSON.stringify(v)}`);
    });
    console.log('\n所有筆資料（精簡）：');
    records.forEach((rec, i) => {
      const keys = Object.keys(rec).filter(k => !k.startsWith('F') || !k.endsWith('Id'));
      const mini = {};
      Object.entries(rec).forEach(([k,v]) => { if (v !== null && v !== '' && v !== 0) mini[k] = v; });
      console.log(`[${i}]`, JSON.stringify(mini));
    });
  } else {
    console.log('無資料，完整回應：', r.raw.substring(0, 500));
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
