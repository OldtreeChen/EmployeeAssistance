'use strict';

require('dotenv').config();
const express = require('express');
const line    = require('@line/bot-sdk');
const path    = require('path');
const db        = require('./lib/db');
const handler   = require('./lib/handler');
const econtact  = require('./lib/econtact');
const { decrypt } = require('./lib/crypto');

// ── LINE SDK 設定 ─────────────────────────────────────
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
};
const client = new line.messagingApi.MessagingApiClient(lineConfig);

// ── Express 設定 ──────────────────────────────────────
const app = express();

// 靜態檔案（LIFF 表單頁面）
app.use('/liff', express.static(path.join(__dirname, 'public')));

// LINE Webhook（需原始 body 做簽章驗證）
app.post(
  '/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    try {
      await Promise.all(req.body.events.map(e => handler.handleEvent(e, client)));
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Webhook error:', err);
      res.status(500).end();
    }
  }
);

// ── REST API（供 LIFF 呼叫）──────────────────────────
app.use(express.json());

// GET /api/econtact/form-data?lineUserId=xxx  取得工時表單資料（任務、類型）
app.get('/api/econtact/form-data', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }
    const username = user.ec_username;
    const password = decrypt(user.ec_password);

    const data = await econtact.getWorkHoursFormData(username, password, user.employee_id || null);

    // Auto-persist the correct TsUser.FId detected from QSVD task data.
    // Task-derived FUserId is more reliable than AIFF token (which can map to wrong user).
    // Always update when detected value differs from what's stored.
    if (data.detectedUserId && data.detectedUserId !== user.employee_id) {
      await db.query(
        'UPDATE users SET employee_id=? WHERE line_user_id=?',
        [data.detectedUserId, lineUserId]
      );
      console.log(`[server] updated employee_id: ${user.employee_id || 'null'} → ${data.detectedUserId} for ${username}`);
    }

    res.json({ tasks: data.tasks, types: data.types });
  } catch (err) {
    console.error('form-data API error:', err);
    res.status(500).json({ error: '取得表單資料失敗：' + err.message });
  }
});

// GET /api/econtact/work-hours?lineUserId=xxx&date=2026-04-23  查詢當日已填工時
app.get('/api/econtact/work-hours', async (req, res) => {
  const { lineUserId, date } = req.query;
  if (!lineUserId || !date) return res.status(400).json({ error: '缺少 lineUserId 或 date' });

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });

    const result = await econtact.getWorkHoursForDate(
      user.ec_username, decrypt(user.ec_password), date, user.employee_id || null
    );

    // Auto-persist detected TsUser.FId
    if (result?.detectedUserId && result.detectedUserId !== user.employee_id) {
      await db.query(
        'UPDATE users SET employee_id=? WHERE line_user_id=?',
        [result.detectedUserId, lineUserId]
      );
      console.log(`[server] work-hours updated employee_id: ${user.employee_id || 'null'} → ${result.detectedUserId} for ${user.ec_username}`);
    }

    res.json(result || { exists: false });
  } catch (err) {
    console.error('get work-hours API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// POST /api/econtact/work-hours  新增工時到 e-Contact
app.post('/api/econtact/work-hours', async (req, res) => {
  const { lineUserId, date, workTime, taskId, taskName, taskDeptId, type, description, startHour } = req.body;

  if (!lineUserId || !date || !workTime || !taskId || !type) {
    return res.status(400).json({ error: '缺少必要欄位（date, workTime, taskId, type）' });
  }

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }
    const username = user.ec_username;
    const password = decrypt(user.ec_password);

    const result = await econtact.submitWorkHours(username, password, {
      date, workTime, taskId, taskName, taskDeptId, type, description, startHour,
    }, user.employee_id || null);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('econtact work-hours API error:', err);
    res.status(500).json({ error: '提交失敗：' + err.message });
  }
});

// POST /api/econtact/work-hours-batch  一次送出同一天多筆工時
// body: { lineUserId, date, tasks: [{ taskId, taskName, taskDeptId, type, workTime, description }] }
app.post('/api/econtact/work-hours-batch', async (req, res) => {
  const { lineUserId, date, tasks } = req.body;

  if (!lineUserId || !date || !Array.isArray(tasks) || !tasks.length) {
    return res.status(400).json({ error: '缺少必要欄位（date, tasks）' });
  }
  for (const t of tasks) {
    if (!t.taskId || !t.type || !t.workTime) {
      return res.status(400).json({ error: '每筆任務需包含 taskId、type、workTime' });
    }
  }

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }
    const username = user.ec_username;
    const password = decrypt(user.ec_password);

    const result = await econtact.submitWorkHoursBatch(
      username, password, date, tasks, user.employee_id || null
    );

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('econtact work-hours-batch API error:', err);
    res.status(500).json({ error: '提交失敗：' + err.message });
  }
});

// GET /api/econtact/work-hours-detail?lineUserId=xxx&date=YYYY-MM-DD  讀取當日工時明細
app.get('/api/econtact/work-hours-detail', async (req, res) => {
  const { lineUserId, date } = req.query;
  if (!lineUserId || !date) return res.status(400).json({ error: '缺少 lineUserId 或 date' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    const details = await econtact.getWorkHoursDetail(user.ec_username, decrypt(user.ec_password), date);
    res.json(details);
  } catch (err) {
    console.error('work-hours-detail API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// GET /api/econtact/work-hours-history?lineUserId=xxx  近 7 天工時總覽
app.get('/api/econtact/work-hours-history', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }
    const { days, detectedUserId } = await econtact.getWorkHoursLast7Days(
      user.ec_username, decrypt(user.ec_password), user.employee_id || null
    );

    // Auto-persist the correct TsUser.FId detected from TimeReport (CurrentUser-scoped)
    if (detectedUserId && detectedUserId !== user.employee_id) {
      await db.query(
        'UPDATE users SET employee_id=? WHERE line_user_id=?',
        [detectedUserId, lineUserId]
      );
      console.log(`[server] work-hours-history updated employee_id: ${user.employee_id || 'null'} → ${detectedUserId} for ${user.ec_username}`);
    }

    res.json(days);
  } catch (err) {
    console.error('work-hours-history API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// GET /api/attendance?lineUserId=xxx&month=2026-04  (從 e-Contact QSVD 查詢)
app.get('/api/attendance', async (req, res) => {
  const { lineUserId, month } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }

    const username = user.ec_username;
    const password = decrypt(user.ec_password);
    const limit    = month ? 50 : 20;

    const records = await econtact.getCheckInRecords(username, password, user.employee_id || null, limit);

    // Optionally filter by month (YYYY-MM) — punchTime is UTC 'YYYY-MM-DD HH:mm'
    const filtered = month
      ? records.filter(r => r.punchTime && r.punchTime.startsWith(month))
      : records;

    res.json(filtered.map(r => ({
      punch_type: r.punchType,
      punch_time: r.punchTime,
      remark:     r.status,
    })));
  } catch (err) {
    console.error('attendance API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// ── 會議室 API ────────────────────────────────────────

// GET /api/meeting-room/rooms?lineUserId=xxx  取得所有會議室清單
app.get('/api/meeting-room/rooms', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定帳號' });
    const rooms = await econtact.getMeetingRooms(user.ec_username, decrypt(user.ec_password));
    res.json(rooms);
  } catch (err) {
    console.error('meeting-room/rooms error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// GET /api/meeting-room/bookings?lineUserId=xxx&date=YYYY-MM-DD  查詢預約紀錄
app.get('/api/meeting-room/bookings', async (req, res) => {
  const { lineUserId, date } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定帳號' });
    const bookings = await econtact.getMeetingRoomBookings(
      user.ec_username, decrypt(user.ec_password),
      user.employee_id || null, date || null
    );
    res.json(bookings);
  } catch (err) {
    console.error('meeting-room/bookings error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// POST /api/meeting-room/book  預約會議室
app.post('/api/meeting-room/book', async (req, res) => {
  const { lineUserId, booking } = req.body;
  if (!lineUserId || !booking) return res.status(400).json({ error: '缺少必要欄位' });
  if (!booking.topic || !booking.roomId || !booking.startDateTime || !booking.endDateTime) {
    return res.status(400).json({ error: '缺少 topic / roomId / startDateTime / endDateTime' });
  }
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id, display_name FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定帳號' });
    const result = await econtact.bookMeetingRoom(
      user.ec_username, decrypt(user.ec_password),
      user.employee_id || null,
      user.display_name || user.ec_username,
      booking
    );
    if (!result.success) return res.status(400).json({ error: result.message, conflict: result.conflict || false });
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('meeting-room/book error:', err);
    res.status(500).json({ error: '預約失敗：' + err.message });
  }
});

// GET /api/meeting-room/availability?lineUserId=xxx&date=YYYY-MM-DD&start=HH:mm&end=HH:mm
// 以 existMeetingRoom 逐室確認，並往後掃尋下一可用時段
app.get('/api/meeting-room/availability', async (req, res) => {
  const { lineUserId, date, start, end } = req.query;
  if (!lineUserId || !date || !start || !end)
    return res.status(400).json({ error: '缺少必要參數 (date / start / end)' });

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id, display_name FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定帳號' });

    const username = user.ec_username;
    const password = decrypt(user.ec_password);
    const ecUserId = user.employee_id || null;

    // findAvailableRooms fetches rooms + bookings in one session, filters 南港 internally
    const result = await econtact.findAvailableRooms(
      username, password, ecUserId, date, start, end
    );
    res.json(result);
  } catch (err) {
    console.error('availability API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// POST /api/econtact/makeup-punch  補打卡申請（預補上班卡 / 預補下班卡）
// body: { lineUserId, type: 'clock_in'|'clock_out', date: 'YYYY-MM-DD', time: 'HH:mm' }
app.post('/api/econtact/makeup-punch', async (req, res) => {
  const { lineUserId, type, date, time } = req.body;
  if (!lineUserId || !type || !date || !time) {
    return res.status(400).json({ error: '缺少必要欄位（type, date, time）' });
  }
  if (!['clock_in', 'clock_out'].includes(type)) {
    return res.status(400).json({ error: 'type 必須為 clock_in 或 clock_out' });
  }
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, display_name FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) {
      return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    }
    const result = await econtact.makeupPunch(
      user.ec_username, decrypt(user.ec_password),
      { type, date, time, displayName: user.display_name || user.ec_username }
    );
    if (!result.success) return res.status(400).json({ error: result.message });
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('makeup-punch API error:', err);
    res.status(500).json({ error: '補打卡失敗：' + err.message });
  }
});

// GET /api/econtact/leave-balance?lineUserId=xxx  查詢餘假
app.get('/api/econtact/leave-balance', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    const leaves = await econtact.getLeaveBalance(user.ec_username, decrypt(user.ec_password));
    res.json(leaves);
  } catch (err) {
    console.error('leave-balance API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// ── 請假申請 API ──────────────────────────────────────

// GET /api/econtact/leave-form-data?lineUserId=&year=  取得請假表單資料（假別、代理人）
app.get('/api/econtact/leave-form-data', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id, display_name FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    const year = String(new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear());
    const data = await econtact.getLeaveFormData(
      user.ec_username, decrypt(user.ec_password),
      user.employee_id || '', year
    );

    // Auto-persist the correct TsUser.FId detected via CurrentUser
    if (data.detectedUserId && data.detectedUserId !== user.employee_id) {
      await db.query(
        'UPDATE users SET employee_id=? WHERE line_user_id=?',
        [data.detectedUserId, lineUserId]
      );
      console.log(`[server] leave-form-data updated employee_id: ${user.employee_id || 'null'} → ${data.detectedUserId} for ${user.ec_username}`);
    }

    res.json({
      leaveTypes:  data.leaveTypes,
      deputies:    data.deputies,
      deptId:      data.deptId,
      deptName:    data.deptName,
      yearFakeHour: data.yearFakeHour,
    });
  } catch (err) {
    console.error('leave-form-data API error:', err);
    res.status(500).json({ error: '取得表單資料失敗：' + err.message });
  }
});

// GET /api/econtact/available-leave-records?lineUserId=&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/econtact/available-leave-records', async (req, res) => {
  const { lineUserId, startDate, endDate } = req.query;
  if (!lineUserId || !startDate || !endDate) return res.status(400).json({ error: '缺少必要參數' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    const records = await econtact.getAvailableLeaveRecords(
      user.ec_username, decrypt(user.ec_password), startDate, endDate
    );
    res.json(records);
  } catch (err) {
    console.error('available-leave-records API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// GET /api/econtact/leave-history?lineUserId=xxx  查詢近 30 天請假紀錄
app.get('/api/econtact/leave-history', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });
    const records = await econtact.getLeaveHistory(user.ec_username, decrypt(user.ec_password));
    res.json(records);
  } catch (err) {
    console.error('leave-history API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// POST /api/econtact/leave-apply  送出請假申請
// body: { lineUserId, leaveType, startDateTime, endDateTime, totalHour,
//         deputyId, deputyName, deptId, deptName, reason, yearFakeHour, slaveEntities }
app.post('/api/econtact/leave-apply', async (req, res) => {
  const {
    lineUserId, leaveType, startDateTime, endDateTime, totalHour,
    deputyId, deputyName, deptId, deptName, reason, yearFakeHour, slaveEntities,
  } = req.body;

  if (!lineUserId || !leaveType || !startDateTime || !endDateTime || !totalHour || !deputyId) {
    return res.status(400).json({ error: '缺少必要欄位（leaveType/startDateTime/endDateTime/totalHour/deputyId）' });
  }
  if (!Array.isArray(slaveEntities) || !slaveEntities.length) {
    return res.status(400).json({ error: '請選擇至少一筆餘假抵扣記錄' });
  }

  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id, display_name FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });

    const result = await econtact.submitLeaveApplication(
      user.ec_username, decrypt(user.ec_password),
      user.employee_id || '',
      user.display_name || user.ec_username,
      { leaveType, startDateTime, endDateTime, totalHour,
        deputyId, deputyName, deptId, deptName, reason, yearFakeHour, slaveEntities }
    );

    if (!result.success) return res.status(400).json({ error: result.message });
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('leave-apply API error:', err);
    res.status(500).json({ error: '請假申請失敗：' + err.message });
  }
});

// GET /api/econtact/my-tasks?lineUserId=xxx  目前尚未關閉的任務（依到期日排序）
app.get('/api/econtact/my-tasks', async (req, res) => {
  const { lineUserId } = req.query;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password, employee_id FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });

    const { tasks, detectedUserId } = await econtact.getMyOpenTasks(
      user.ec_username, decrypt(user.ec_password), user.employee_id || null
    );

    // Auto-persist detected TsUser.FId
    if (detectedUserId && detectedUserId !== user.employee_id) {
      await db.query(
        'UPDATE users SET employee_id=? WHERE line_user_id=?',
        [detectedUserId, lineUserId]
      );
      console.log(`[server] my-tasks updated employee_id: ${user.employee_id || 'null'} → ${detectedUserId} for ${user.ec_username}`);
    }

    res.json(tasks);
  } catch (err) {
    console.error('my-tasks API error:', err);
    res.status(500).json({ error: '查詢失敗：' + err.message });
  }
});

// POST /api/econtact/close-task  送出任務結案審核
// body: { lineUserId, taskId, finishDescription? }
app.post('/api/econtact/close-task', async (req, res) => {
  const { lineUserId, taskId, finishDescription } = req.body;
  if (!lineUserId || !taskId) return res.status(400).json({ error: '缺少 lineUserId 或 taskId' });
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });

    const result = await econtact.closeTask(
      user.ec_username, decrypt(user.ec_password), taskId, finishDescription || ''
    );

    if (!result.success) return res.status(400).json({ error: result.message });
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('close-task API error:', err);
    res.status(500).json({ error: '結案失敗：' + err.message });
  }
});

// POST /api/econtact/prolong-task  送出任務延時申請
// body: { lineUserId, taskId, taskStatus, prolongDate ('YYYY-MM-DD HH:mm'), prolongTime, prolongReason? }
app.post('/api/econtact/prolong-task', async (req, res) => {
  const { lineUserId, taskId, taskStatus, prolongDate, prolongTime, prolongReason } = req.body;
  if (!lineUserId || !taskId || !prolongDate || !prolongTime) {
    return res.status(400).json({ error: '缺少必要欄位（taskId/prolongDate/prolongTime）' });
  }
  try {
    const [user] = await db.query(
      `SELECT ec_setup_done, ec_username, ec_password FROM users WHERE line_user_id=?`,
      [lineUserId]
    );
    if (!user || !user.ec_setup_done) return res.status(403).json({ error: '尚未設定 e-Contact 帳號' });

    const result = await econtact.submitProlongTask(
      user.ec_username, decrypt(user.ec_password),
      { taskId, taskStatus, prolongDate, prolongTime, prolongReason: prolongReason || '' }
    );

    if (!result.success) return res.status(400).json({ error: result.message });
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('prolong-task API error:', err);
    res.status(500).json({ error: '延時申請失敗：' + err.message });
  }
});

// ── 健康檢查 ─────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 啟動伺服器 ────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await db.init();
  console.log(`✅ LINE 打卡系統啟動：http://localhost:${PORT}`);
});
