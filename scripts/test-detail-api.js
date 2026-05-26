'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const db   = require('../lib/db');

async function main() {
  await db.init();
  const [u] = await db.query("SELECT line_user_id FROM users WHERE ec_username='oldtree.chen' LIMIT 1");
  const lid = u.line_user_id;
  console.log('Testing lineUserId:', lid);

  function get(url) {
    return new Promise((resolve, reject) => {
      let data = '';
      http.get(url, res => {
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      }).on('error', reject);
    });
  }

  // Test 1: detail for a filled date
  const detail = await get(`http://localhost:3000/api/econtact/work-hours-detail?lineUserId=${encodeURIComponent(lid)}&date=2026-05-09`);
  console.log('\nwork-hours-detail (2026-05-09):');
  console.log(JSON.stringify(detail, null, 2));

  // Test 2: history endpoint (to verify 1/7 filled shows)
  const history = await get(`http://localhost:3000/api/econtact/work-hours-history?lineUserId=${encodeURIComponent(lid)}`);
  console.log('\nwork-hours-history (last 7):');
  history.forEach(d => console.log(`  ${d.date}  hours=${d.hours}  filled=${d.filled}`));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
