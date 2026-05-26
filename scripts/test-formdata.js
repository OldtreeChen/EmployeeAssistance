'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db       = require('../lib/db');
const econtact = require('../lib/econtact');
const { decrypt } = require('../lib/crypto');
async function main() {
  await db.init();
  const [user] = await db.query('SELECT ec_username, ec_password FROM users WHERE ec_setup_done=1 LIMIT 1');
  if (!user) { console.log('No setup user'); process.exit(1); }
  console.log('Testing for:', user.ec_username);
  const data = await econtact.getWorkHoursFormData(user.ec_username, decrypt(user.ec_password));
  console.log('tasks:', data.tasks.length, 'types:', data.types.length);
  if (data.tasks.length) {
    console.log('First task:', JSON.stringify(data.tasks[0], null, 2));
    console.log('Last task:',  JSON.stringify(data.tasks[data.tasks.length - 1]));
  }
  console.log('Types:', data.types.map(t => t.value).join(', '));
}
main().catch(console.error).finally(() => process.exit());
