'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const mysql = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';

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
  const conn = await mysql.createConnection({ host: 'db', port: 3306, user: process.env.DB_USER||'punchuser', password: process.env.DB_PASSWORD||'Punch@2026!', database: process.env.DB_NAME||'line_punch_system' });
  const [rows] = await conn.execute('SELECT ec_username, ec_password, employee_id FROM users WHERE ec_setup_done=1 LIMIT 1');
  await conn.end();

  const username = rows[0].ec_username; // Oldtree.chen
  const password = decrypt(rows[0].ec_password);
  const correctUserId = rows[0].employee_id; // bbc693e1-...
  console.log('Username:', username, '| Correct userId:', correctUserId);

  const lr = await post('/ecp/Qs.OnlineUser.login.data', { loginName: username, password, language: 'zh-tw' });
  const jar = lr.jar;

  // Try different token apply variants to get correct employee mapping
  console.log('\n=== AIFF token variants ===');
  const tokenVariants = [
    { loginType: 'aiff', loginName: username },
    { loginType: 'aiff', loginName: username, tenantCode: '' },
    { loginType: 'aiff', loginName: 'Oldtree.Chen' },        // Capital C
    { loginType: 'qs',   loginName: username },
    { loginType: 'qs',   loginName: username, tenantCode: '' },
    { loginType: 'aiff', userId: correctUserId },
    { loginType: 'aiff', loginName: username, userId: correctUserId },
  ];

  let goodTokenId = null;

  for (const body of tokenVariants) {
    const r = await post('/ecp/openapi/aile/token/apply', body, jar);
    const emp = r.data?.employee;
    const tok = r.data?.tokenId;
    console.log(`  ${JSON.stringify(body)} → employee=${emp?.id}(${emp?.name}) tokenId=${tok ? tok.substring(0,12)+'...' : 'null'}`);
    if (emp?.id === correctUserId && tok) {
      goodTokenId = tok;
      console.log('  *** CORRECT TOKEN FOUND ***');
    }
  }

  if (!goodTokenId) {
    // Try: get regular AIFF token but use task list with explicit userId to see if it breaks free of aven.chen's scope
    console.log('\n=== Try OpenAPI task list with explicit userId filter ===');
    const tr = await post('/ecp/openapi/aile/token/apply', { loginType: 'aiff', loginName: username }, jar);
    const tokenId = tr.data.tokenId;
    const h = { _header_: { tokenId } };

    // Try passing userId as explicit filter — maybe API returns tasks for that userId regardless of token scope
    const variants = [
      { ...h, userId: correctUserId, start: 0, limit: 5 },
      { ...h, FUserId: correctUserId, start: 0, limit: 5 },
      { ...h, assignUserId: correctUserId, start: 0, limit: 5 },
      { ...h, userId: correctUserId, start: 0, limit: 5, scope: 'all' },
      { ...h, userId: correctUserId, start: 0, limit: 5, viewAll: true },
    ];
    for (const body of variants) {
      const r = await post('/ecp/openapi/ecp/task/list', body, jar);
      const items = r.data?.items || [];
      const myHits = items.filter(t => t.FUserId === correctUserId);
      console.log(`  userId param (${Object.keys(body).filter(k=>k!=='_header_').join(',')}): total=${items.length} myHits=${myHits.length}`);
      if (myHits.length) {
        myHits.forEach(t => console.log(`    [${t.FStatus$}] ${t.FName}`));
      }
    }
  }
}
main().catch(console.error);
