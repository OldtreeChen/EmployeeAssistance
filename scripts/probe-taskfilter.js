'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';
function httpPost(path, body, jar) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { const j = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; '); try{resolve({data:JSON.parse(raw),raw,jar:j})}catch{resolve({data:raw,raw,jar:j})} });
    }).on('error', reject).end(d);
  });
}
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST||'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();
  const lr = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  const tr = await httpPost('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: rows[0].ec_username }, jar);
  const tokenId = tr.data.tokenId;
  const header  = { _header_: { tokenId } };

  // 1. See all unique FStatus values
  const all = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 200 }, jar);
  const statuses = [...new Set((all.data.items||[]).map(t => t.FStatus))];
  const statusMap = {};
  (all.data.items||[]).forEach(t => { statusMap[t.FStatus] = t.FStatus$; });
  console.log('All status values:', statuses.map(s => `${s}(${statusMap[s]})`).join(', '));
  console.log('Total tasks:', (all.data.items||[]).length, 'hasNextPage:', all.data.hasNextPage);

  // 2. Try filtering by status via API parameter
  for (const statusFilter of ['doing', 'open', 'active', 'ongoing', 'inProgress', 'processing']) {
    const r = await httpPost('/ecp/openapi/ecp/task/list', { ...header, start: 0, limit: 10, status: statusFilter }, jar);
    const count = r.data?.items?.length;
    if (count !== undefined && count !== (all.data.items||[]).length) {
      console.log(`Filter status=${statusFilter}: ${count} tasks`);
    }
  }

  // 3. Check the FStatus values and their display names in detail
  console.log('\nStatus distribution:');
  const dist = {};
  (all.data.items||[]).forEach(t => {
    const key = `${t.FStatus}(${t.FStatus$})`;
    dist[key] = (dist[key] || 0) + 1;
  });
  Object.entries(dist).forEach(([k,v]) => console.log(` ${k}: ${v} tasks`));
}
main().catch(console.error);
