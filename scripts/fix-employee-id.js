'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'db', port: 3306,
    user: process.env.DB_USER || 'punchuser',
    password: process.env.DB_PASSWORD || 'Punch@2026!',
    database: process.env.DB_NAME || 'line_punch_system',
  });

  // Fix known AIFF misconfiguration: Oldtree.chen → correct TsUser FId
  const fixes = [
    ['bbc693e1-e448-11ed-b376-0607bbc2ee97', 'Oldtree.chen'],
  ];

  for (const [empId, username] of fixes) {
    const [r] = await conn.execute(
      'UPDATE users SET employee_id=? WHERE ec_username=?',
      [empId, username]
    );
    console.log(`${username}: affected=${r.affectedRows}, employee_id=${empId}`);
  }

  // Show result
  const [rows] = await conn.execute(
    'SELECT ec_username, employee_id FROM users WHERE ec_setup_done=1'
  );
  console.log('\nCurrent employee_id values:');
  rows.forEach(r => console.log(` ${r.ec_username}: ${r.employee_id || '(null)'}`));

  await conn.end();
}
main().catch(console.error);
