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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(d),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, res => {
      let raw = '';
      const setCookies = res.headers['set-cookie'] || [];
      res.on('data', c => raw += c);
      res.on('end', () => {
        const jar = setCookies.map(c => c.split(';')[0]).join('; ');
        try { resolve({ data: JSON.parse(raw), raw, jar, status: res.statusCode }); }
        catch { resolve({ data: raw, raw, jar, status: res.statusCode }); }
      });
    }).on('error', reject).end(d);
  });
}

async function login(username, password) {
  // QS login → JSESSIONID
  const r = await httpPost('/ecp/Qs.OnlineUser.login.data', {
    loginName: username, password: password, language: 'zh-tw',
  });
  if (!r.data || r.data._failed) throw new Error('QS login failed: ' + r.raw.substring(0, 200));
  const jsessionid = r.jar;
  console.log('JSESSIONID:', jsessionid);
  return jsessionid;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'db', port: 3306,
    user: process.env.DB_USER || 'punchuser',
    password: process.env.DB_PASSWORD || 'Punch@2026!',
    database: process.env.DB_NAME || 'line_punch_system',
  });

  // Get Oldtree.chen credentials
  const [rows] = await conn.query(
    `SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username='Oldtree.chen' LIMIT 1`
  );
  await conn.end();

  if (!rows.length) { console.error('User not found'); return; }
  const { ec_username: username, ec_password: encPwd, employee_id: userId } = rows[0];
  const password = decrypt(encPwd);
  console.log(`Using: ${username}, employee_id=${userId}`);

  const jar = await login(username, password);

  // Known Finance room ID — get it from room list first
  console.log('\n--- Fetching room list to get Finance FId ---');
  const roomsRes = await httpPost('/ecp/qsvd-list/OCS.MeetingRoom.getListData.data', {
    listId: 'dc749022-d79c-43ee-83e0-38a0d91d92ca',
    pageSize: 100, keyword: '', isRefresh: true,
  }, jar);
  const rooms = (roomsRes.data?.data?.records || [])
    .filter(r => (r['FMeetingRoomLocation$'] || '').includes('南港'));
  console.log('南港 rooms:');
  rooms.forEach(r => console.log(`  ${r['FMeetingRoomName$']||r.FMeetingRoomName} loc=${r.FMeetingRoomLocation} floor=${r.FMeetingRoomFloor} num=${r.FMeetingRoomName} id=${r.FId}`));

  const financeRoom = rooms.find(r => r.FMeetingRoomName === 'Finance');
  if (!financeRoom) { console.error('Finance room not found in list'); return; }
  console.log('\nFinance room FId:', financeRoom.FId);

  // Test existMeetingRoom with various date field names
  // Finance room codes
  const fl = financeRoom.FMeetingRoomLocation;   // 'nanA'
  const ff = financeRoom.FMeetingRoomFloor;      // 'n9F'
  const fn = financeRoom.FMeetingRoomName;       // 'Finance'

  const testCases = [
    // Format A: with all location fields, FNormalMeeting* times — Finance 09:00-10:00 (BUSY)
    {
      label: 'A: full fields, Finance 09:00-10:00 (BUSY)',
      body: {
        data: {
          FMeetingRoom: financeRoom.FId,
          FMeetingRoomLocation: fl,
          FMeetingRoomFloor: ff,
          FMeetingRoomName: fn,
          FNormalMeetingStartDateTime: '2026-05-04 09:00',
          FNormalMeetingEndDateTime: '2026-05-04 10:00',
        },
      },
    },
    // Format B: same but Finance 19:00-20:00 (should be FREE)
    {
      label: 'B: full fields, Finance 19:00-20:00 (FREE)',
      body: {
        data: {
          FMeetingRoom: financeRoom.FId,
          FMeetingRoomLocation: fl,
          FMeetingRoomFloor: ff,
          FMeetingRoomName: fn,
          FNormalMeetingStartDateTime: '2026-05-04 19:00',
          FNormalMeetingEndDateTime: '2026-05-04 20:00',
        },
      },
    },
  ];

  for (const tc of testCases) {
    console.log(`\n--- Test ${tc.label} ---`);
    try {
      const r = await httpPost('/ecp/OCS.MeetingRoomApply.existMeetingRoom.data', tc.body, jar);
      console.log('status:', r.status);
      console.log('data:', JSON.stringify(r.data).substring(0, 300));
    } catch (e) {
      console.error('ERROR:', e.message);
    }
  }

  // Also test with a room that should be free (e.g. Innovation)
  const innovRoom = rooms.find(r => r.FMeetingRoomName === '11'); // Innovation
  // Test Deep Learning (KNOWN BUSY 09:00-12:00 from QSVD)
  const deepRoom = rooms.find(r => r.FMeetingRoomName === '9'); // Deep learning
  if (deepRoom) {
    console.log(`\n--- Deep learning 09:00-10:00 (KNOWN BUSY) ---`);
    const r = await httpPost('/ecp/OCS.MeetingRoomApply.existMeetingRoom.data', {
      data: {
        FMeetingRoom: deepRoom.FId,
        FMeetingRoomLocation: deepRoom.FMeetingRoomLocation,
        FMeetingRoomFloor: deepRoom.FMeetingRoomFloor,
        FMeetingRoomName: deepRoom.FMeetingRoomName,
        FNormalMeetingStartDateTime: '2026-05-04 09:00',
        FNormalMeetingEndDateTime: '2026-05-04 10:00',
      },
    }, jar);
    console.log('result (true=busy?):', JSON.stringify(r.data));
  }

  if (innovRoom) {
    console.log(`\n--- Innovation 09:00-10:00 (KNOWN FREE) ---`);
    const r = await httpPost('/ecp/OCS.MeetingRoomApply.existMeetingRoom.data', {
      data: {
        FMeetingRoom: innovRoom.FId,
        FMeetingRoomLocation: innovRoom.FMeetingRoomLocation,
        FMeetingRoomFloor: innovRoom.FMeetingRoomFloor,
        FMeetingRoomName: innovRoom.FMeetingRoomName,
        FNormalMeetingStartDateTime: '2026-05-04 09:00',
        FNormalMeetingEndDateTime: '2026-05-04 10:00',
      },
    }, jar);
    console.log('result (false=free?):', JSON.stringify(r.data));
  }

  // Also try a date we know has no bookings at all (e.g. 2026-05-10 Sunday)
  if (innovRoom) {
    console.log(`\n--- Innovation 2026-05-10 09:00-10:00 (Sunday, should be FREE) ---`);
    const r = await httpPost('/ecp/OCS.MeetingRoomApply.existMeetingRoom.data', {
      data: {
        FMeetingRoom: innovRoom.FId,
        FMeetingRoomLocation: innovRoom.FMeetingRoomLocation,
        FMeetingRoomFloor: innovRoom.FMeetingRoomFloor,
        FMeetingRoomName: innovRoom.FMeetingRoomName,
        FNormalMeetingStartDateTime: '2026-05-10 09:00',
        FNormalMeetingEndDateTime: '2026-05-10 10:00',
      },
    }, jar);
    console.log('result:', JSON.stringify(r.data));
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
