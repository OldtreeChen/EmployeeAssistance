'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db       = require('../lib/db');
const econtact = require('../lib/econtact');
const { decrypt } = require('../lib/crypto');

async function main() {
  await db.init();
  const users = await db.query(
    "SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username IN ('li.lin','Julia.Chen') AND ec_setup_done=1"
  );
  for (const u of users) {
    const pass = decrypt(u.ec_password);
    const hist = await econtact.getWorkHoursLast7Days(u.ec_username, pass, u.employee_id);
    const filled = hist.filter(d => d.filled);
    console.log(`\n${u.ec_username} (stored_id=${u.employee_id})`);
    console.log(`  filled days: ${filled.map(d => d.date + '(' + d.hours + 'h)').join(', ') || '(none)'}`);
    for (const d of filled.slice(0, 2)) {
      const detail = await econtact.getWorkHoursDetail(u.ec_username, pass, d.date);
      console.log(`  detail for ${d.date}: ${detail.length} records`);
      detail.forEach(r => console.log(`    task=${(r.taskName||'').slice(0,35)}  type=${r.type}  hours=${r.hours}`));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
