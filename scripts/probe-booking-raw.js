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
  if (!rows.length) { console.error('No user'); return; }
  const { ec_username, ec_password } = rows[0];
  const password = decrypt(ec_password);

  // Login
  const loginRes = await httpPost('/ecp/Qs.OnlineUser.login.data', { loginName: ec_username, password, language: 'zh-tw' });
  if (loginRes.data?._failed) { console.error('Login failed:', loginRes.raw.substring(0,200)); return; }
  const jar = loginRes.jar;
  console.log('Logged in as', ec_username);

  // Query QSVD booking list — no date filter, get raw records
  console.log('\n--- QSVD booking list (queryFormRecent:{}, limit=500) ---');
  const r = await httpPost('/ecp/qsvd-list/OCS.MeetingRoomApply.getListData.data', {
    listId:          'ba239049-d1d8-4062-b061-2c13a36856f2',
    schemaId:        'ffffff19-de74-d439-2802-38af463cf204',
    keyword:         '',
    queryFormRecent: {},
    start:           0,
    limit:           500,
  }, jar);

  const records = r.data?.data?.records || [];
  console.log(`Total records returned: ${records.length}`);

  // Look for Finance booking
  const financeBookings = records.filter(rec =>
    (rec.FMeetingRoomName === 'Finance') ||
    (rec['FMeetingRoomName$'] || '').toLowerCase().includes('finance')
  );
  console.log(`Finance bookings found: ${financeBookings.length}`);
  financeBookings.forEach(b => {
    console.log('FINANCE:', JSON.stringify({
      FId: b.FId,
      FTopic: b.FTopic,
      FMeetingRoomName: b.FMeetingRoomName,
      'FMeetingRoomName$': b['FMeetingRoomName$'],
      FNormalMeetingStartDateTime: b.FNormalMeetingStartDateTime,
      FNormalMeetingEndDateTime: b.FNormalMeetingEndDateTime,
      FMeetingRoomLocation: b.FMeetingRoomLocation,
      FMeetingRoomFloor: b.FMeetingRoomFloor,
      FMeetingRoom: b.FMeetingRoom,
    }));
  });

  // Look for any record containing 'finance' or the Finance room id
  const FINANCE_ROOM_ID = 'ffffff18-99b9-5f87-3005-ca5a923cf204';
  const byRoomId = records.filter(rec => rec.FMeetingRoom === FINANCE_ROOM_ID);
  console.log(`\nRecords by Finance room id (${FINANCE_ROOM_ID}): ${byRoomId.length}`);
  byRoomId.forEach(b => console.log(' ', JSON.stringify({ FTopic: b.FTopic, start: b.FNormalMeetingStartDateTime, end: b.FNormalMeetingEndDateTime })));

  // Show ALL records' start times to see what date range is returned
  console.log('\nAll records start dates:');
  const startDates = [...new Set(records.map(r => (r.FNormalMeetingStartDateTime || '').substring(0, 10)))].sort();
  startDates.forEach(d => {
    const cnt = records.filter(r => (r.FNormalMeetingStartDateTime || '').startsWith(d)).length;
    console.log(`  ${d}: ${cnt} booking(s)`);
  });

  // Also check if there's a 'nanA' room booking on 2026-05-04
  console.log('\nAll 2026-05-04 bookings (full details):');
  records.filter(r => (r.FNormalMeetingStartDateTime || '').startsWith('2026-05-04')).forEach(b => {
    console.log(JSON.stringify({
      topic: b.FTopic,
      room: b['FMeetingRoomName$'] || b.FMeetingRoomName,
      roomId: b.FMeetingRoom,
      loc: b.FMeetingRoomLocation,
      floor: b.FMeetingRoomFloor,
      num: b.FMeetingRoomName,
      start: b.FNormalMeetingStartDateTime,
      end: b.FNormalMeetingEndDateTime,
      status: b.FMeetingRoomApplyStatus || b.FStatus,
    }));
  });

  // Try alternate fields for the Finance booking
  console.log('\nLooking for "新人報到" in any field:');
  records.forEach(rec => {
    const str = JSON.stringify(rec);
    if (str.includes('新人') || str.includes('Finance') || str.includes('報到')) {
      console.log('MATCH:', str.substring(0, 300));
    }
  });
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
