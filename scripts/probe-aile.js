'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const mysql  = require('mysql2/promise');
const { decrypt } = require('../lib/crypto');
const HOST = 'econtact.ai3.cloud';
function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    https.request({ hostname: HOST, path: '/ecp/' + path, method: 'POST',
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
  const lr = await post('Qs.OnlineUser.login.data', { loginName: rows[0].ec_username, password: decrypt(rows[0].ec_password), language: 'zh-tw' });
  const jar = lr.jar;
  console.log('Login OK');

  // Ecp.Aile methods
  const probes = [
    ['Ecp.Aile.getUserInfo.data', {}],
    ['Ecp.Aile.getLoginUser.data', {}],
    ['Ecp.Aile.getMyInfo.data', {}],
    ['Ecp.Aile.getUser.data', {}],
    ['Ecp.Aile.afterLogin.data', {}],
    ['Ecp.Aile.getLoginInfo.data', {}],
    ['Ecp.Aile.loadUser.data', {}],
    ['Ecp.Aile.getProfile.data', {}],
    // Try Qs page/init calls
    ['Qs.Page.getPageData.data', { pageCode: 'Ecp.TimeReport.AddQuick' }],
    ['Qs.Page.getPageData.data', { pageCode: 'Ecp.Aile.Main' }],
    ['Qs.Page.init.data', {}],
    ['Qs.Page.getPage.data', { pageCode: 'Ecp.Aile.Main' }],
    // Try loading Ecp.TimeReport form to see if it returns task/type data
    ['Ecp.TimeReport.loadForm.data', {}],
    ['Ecp.TimeReport.getAddQuickFormData.data', {}],
    ['Ecp.TimeReport.initAddForm.data', {}],
    ['Ecp.TimeReport.getAddFormData.data', {}],
    ['Ecp.TimeReport.beforeAdd.data', {}],
    // Try Qs.Auth
    ['Qs.Auth.me.data', {}],
    ['Qs.Auth.getUser.data', {}],
    ['Qs.Auth.getLoginUser.data', {}],
    ['Qs.Auth.getLoggedInUser.data', {}],
  ];

  for (const [ep, body] of probes) {
    const r = await post(ep, body, jar);
    const msg = r.data?.message||'';
    if (!r.data?._failed) {
      console.log(`✅ ${ep}:`);
      console.log('  ', r.raw.substring(0, 600));
    } else if (!msg.includes('不存在單元') && !msg.includes('不存在名稱')) {
      console.log(`⚠️  ${ep}: ${msg.substring(0,120)}`);
    }
  }
}
main().catch(console.error);
