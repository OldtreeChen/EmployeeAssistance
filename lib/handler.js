'use strict';

const db        = require('./db');
const econtact  = require('./econtact');
const { encrypt, decrypt } = require('./crypto');
const dayjs     = require('dayjs');

// ══════════════════════════════════════════════════════
// Flex Message 建構器
// ══════════════════════════════════════════════════════

function _menuBtn(label, bgColor, textColor, postbackData, displayText) {
  return {
    type: 'box', layout: 'horizontal',
    backgroundColor: bgColor, cornerRadius: '10px',
    paddingAll: '10px',
    action: { type: 'postback', data: postbackData, displayText },
    contents: [{ type: 'text', text: label, color: textColor, size: 'sm', weight: 'bold' }],
  };
}

function _comingItem(emoji, label) {
  return {
    type: 'box', layout: 'horizontal',
    backgroundColor: '#fff7f0', cornerRadius: '8px', paddingAll: '8px',
    contents: [
      { type: 'text', text: emoji, size: 'sm', flex: 0 },
      { type: 'text', text: label,  size: 'sm', color: '#aaaaaa', margin: 'sm', flex: 1 },
      { type: 'text', text: '即將推出', size: 'xxs', color: '#f27059', align: 'end', flex: 0 },
    ],
  };
}

function _uriBtn(label, bgColor, textColor, uri) {
  return {
    type: 'box', layout: 'horizontal',
    backgroundColor: bgColor, cornerRadius: '10px',
    paddingAll: '10px',
    action: { type: 'uri', uri },
    contents: [{ type: 'text', text: label, color: textColor, size: 'sm', weight: 'bold' }],
  };
}

function buildQuickMenuFlex(userId) {
  const liffId        = process.env.LINE_LIFF_ID || '';
  const attendanceUrl    = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=attendance`;
  const historyUrl       = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&mode=history`;
  const meetingUrl       = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=meeting`;
  const leaveApplyUrl    = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=leave-apply`;
  const leaveHistoryUrl  = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=leave-history`;
  const tasksUrl         = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=tasks`;

  // ── 出勤管理 ─────────────────────────────────────────
  const attendCard = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#52b788', paddingAll: '16px',
      contents: [
        { type: 'text', text: '🕐', size: 'xxl' },
        { type: 'text', text: '出勤管理', weight: 'bold', color: '#ffffff', size: 'lg', margin: 'sm' },
        { type: 'text', text: '打卡 · 紀錄 · 請假', color: '#ffffffBB', size: 'xs' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '10px',
      contents: [
        _menuBtn('🟢 上班打卡', '#d8f3dc', '#1b4332', 'action=clock_in',  '上班打卡'),
        _menuBtn('🔴 下班打卡', '#ffe8c8', '#7c3d12', 'action=clock_out', '下班打卡'),
        _uriBtn( '📋 打卡紀錄', '#dbeafe', '#1e3a5f', attendanceUrl),
        _menuBtn('🏖️ 餘假查詢', '#fef3c7', '#92400e', 'action=leave_balance', '餘假查詢'),
        _uriBtn( '📝 請假申請', '#fce7f3', '#9d174d', leaveApplyUrl),
        _uriBtn( '📅 請假紀錄', '#e0f2fe', '#0c4a6e', leaveHistoryUrl),
      ],
    },
  };

  // ── 日常作業 ─────────────────────────────────────────
  const workCard = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#9b72cf', paddingAll: '16px',
      contents: [
        { type: 'text', text: '📊', size: 'xxl' },
        { type: 'text', text: '日常作業', weight: 'bold', color: '#ffffff', size: 'lg', margin: 'sm' },
        { type: 'text', text: '工時 · 會議室 · 任務', color: '#ffffffBB', size: 'xs' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '10px',
      contents: [
        _uriBtn('📈 工時查詢',   '#ede9fe', '#4c1d95', historyUrl),
        _uriBtn('🏢 會議室預約', '#fff3e0', '#bf360c', meetingUrl),
        _uriBtn('✅ 任務管理',   '#dcfce7', '#14532d', tasksUrl),
      ],
    },
  };

  // ── 帳號管理 ─────────────────────────────────────────
  const accountCard = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#64748b', paddingAll: '16px',
      contents: [
        { type: 'text', text: '⚙️', size: 'xxl' },
        { type: 'text', text: '帳號管理', weight: 'bold', color: '#ffffff', size: 'lg', margin: 'sm' },
        { type: 'text', text: '設定 e-Contact 帳號', color: '#ffffffBB', size: 'xs' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '10px',
      contents: [
        {
          type: 'box', layout: 'horizontal',
          backgroundColor: '#f1f5f9', cornerRadius: '10px', paddingAll: '10px',
          action: { type: 'message', text: '設定帳號' },
          contents: [{ type: 'text', text: '🔑 帳號設定', color: '#1e3a5f', size: 'sm', weight: 'bold' }],
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: '📌 常用選單 — 出勤管理 / 日常作業 / 帳號管理',
    contents: { type: 'carousel', contents: [attendCard, workCard, accountCard] },
  };
}

function buildWorkHoursQueryFlex(days) {
  const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  const total  = days.reduce((s, d) => s + d.hours, 0);
  const filled = days.filter(d => d.filled).length;

  const rows = [];
  for (let i = 0; i < days.length; i++) {
    const d    = days[i];
    const mmdd = d.date.slice(5).replace('-', '/');
    const day  = new Date(d.date + 'T12:00:00Z');
    const dow  = DAY_NAMES[day.getUTCDay()];
    const isWE = day.getUTCDay() === 0 || day.getUTCDay() === 6;

    if (i > 0) rows.push({ type: 'separator', color: '#f0ecfa' });

    // Left indicator bar
    const indicator = {
      type: 'box', layout: 'vertical', flex: 0,
      width: '4px',
      backgroundColor: d.filled ? '#52b788' : '#e2e8f0',
      cornerRadius: '4px',
    };

    // Date column
    const dateCol = {
      type: 'box', layout: 'vertical', flex: 1,
      margin: 'md', justifyContent: 'center',
      contents: [
        { type: 'text', text: mmdd, size: 'sm', weight: 'bold',
          color: isWE ? '#d63031' : '#2d3748' },
        { type: 'text', text: `週${dow}`, size: 'xxs', color: '#a0aec0', margin: 'none' },
      ],
    };

    // Hours or empty badge — flex:0 keeps it compact
    const badge = d.filled
      ? {
          type: 'box', layout: 'vertical', flex: 0,
          backgroundColor: '#e9f7ef', cornerRadius: '12px',
          paddingTop: '6px', paddingBottom: '6px',
          paddingStart: '14px', paddingEnd: '14px',
          justifyContent: 'center',
          contents: [
            { type: 'text', text: `${d.hours}h`, size: 'md', weight: 'bold',
              color: '#27ae60', align: 'center' },
            { type: 'text', text: '已填', size: 'xxs', color: '#52b788',
              align: 'center', margin: 'none' },
          ],
        }
      : {
          type: 'box', layout: 'vertical', flex: 0,
          backgroundColor: '#fff0f3', cornerRadius: '12px',
          paddingTop: '6px', paddingBottom: '6px',
          paddingStart: '14px', paddingEnd: '14px',
          justifyContent: 'center',
          contents: [
            { type: 'text', text: '－', size: 'md', weight: 'bold',
              color: '#e57373', align: 'center' },
            { type: 'text', text: '未填', size: 'xxs', color: '#e57373',
              align: 'center', margin: 'none' },
          ],
        };

    rows.push({
      type: 'box', layout: 'horizontal',
      paddingTop: '10px', paddingBottom: '10px',
      paddingStart: '12px', paddingEnd: '12px',
      alignItems: 'center',
      contents: [indicator, dateCol, badge],
    });
  }

  // Progress dots in header
  const dots = days.slice().reverse().map(d => ({
    type: 'box', layout: 'vertical', flex: 1,
    height: '6px',
    backgroundColor: d.filled ? '#ffffff' : 'rgba(255,255,255,0.3)',
    cornerRadius: '3px',
    margin: 'xs',
  }));

  return {
    type: 'flex',
    altText: `📊 近 7 天工時（${filled}/7 天，合計 ${total.toFixed(1)}h）`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#7c6bc9', paddingAll: '16px',
        contents: [
          { type: 'text', text: '📊 近 7 天工時', weight: 'bold', color: '#ffffff', size: 'lg' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: `已填 ${filled}/7 天`, color: '#ffffffBB', size: 'xs', flex: 1 },
              { type: 'text', text: `合計 ${total.toFixed(1)}h`, color: '#ffffff',
                size: 'xs', weight: 'bold', align: 'end' },
            ],
          },
          // Progress bar dots
          { type: 'box', layout: 'horizontal', margin: 'md', contents: dots },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
        contents: rows,
      },
      footer: {
        type: 'box', layout: 'horizontal', paddingAll: '14px',
        backgroundColor: '#f9f6ff', alignItems: 'center',
        contents: [
          { type: 'text', text: '7 天合計', size: 'sm', color: '#aaaaaa', flex: 1 },
          { type: 'text', text: `${total.toFixed(1)}`, size: 'xxl',
            weight: 'bold', color: '#7c3aed', flex: 0 },
          { type: 'text', text: 'h', size: 'md', weight: 'bold',
            color: '#7c3aed', margin: 'xs', flex: 0 },
        ],
      },
    },
  };
}

// ══════════════════════════════════════════════════════
// 主要事件路由
// ══════════════════════════════════════════════════════
async function handleEvent(event, client) {
  if (event.type === 'message' && event.message.type === 'text') {
    return handleText(event, client);
  }
  if (event.type === 'postback') {
    return handlePostback(event, client);
  }
  if (event.type === 'follow') {
    return handleFollow(event, client);
  }
}

// ─────────────────────────────────────────────────────
// Follow（加入好友）
// ─────────────────────────────────────────────────────
async function handleFollow(event, client) {
  const userId = event.source.userId;

  try {
    const profile = await client.getProfile(userId);
    await db.query(
      `INSERT INTO users (line_user_id, display_name, picture_url)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), picture_url=VALUES(picture_url)`,
      [userId, profile.displayName, profile.pictureUrl]
    );
  } catch (_) {
    await db.query(`INSERT IGNORE INTO users (line_user_id) VALUES (?)`, [userId]);
  }

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: `歡迎使用員工打卡系統！🎉\n\n使用前請先完成帳號設定：\n請輸入「設定帳號」並依照指示輸入您的 e-Contact 帳號密碼。\n\n設定完成後即可使用下方選單打卡 ✅`
    }]
  });
}

// ─────────────────────────────────────────────────────
// 文字訊息處理（含設定帳號對話流程）
// ─────────────────────────────────────────────────────
async function handleText(event, client) {
  const text   = event.message.text.trim();
  const userId = event.source.userId;

  // 確保用戶存在
  await db.query(`INSERT IGNORE INTO users (line_user_id) VALUES (?)`, [userId]);

  // 取得用戶狀態
  const [user] = await db.query(
    `SELECT ec_setup_done, setup_state, ec_username, ec_password FROM users WHERE line_user_id=?`,
    [userId]
  );

  // ── 設定帳號流程（狀態機）────────────────────────
  if (text === '設定帳號' || text === 'SETUP') {
    await db.query(`UPDATE users SET setup_state='awaiting_username' WHERE line_user_id=?`, [userId]);
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `📋 設定 e-Contact 帳號\n\n請輸入您的 e-Contact 登入帳號：`
      }]
    });
  }

  if (user && user.setup_state === 'awaiting_username') {
    await db.query(
      `UPDATE users SET ec_username=?, setup_state='awaiting_password' WHERE line_user_id=?`,
      [text, userId]
    );
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `✅ 帳號已記錄：${text}\n\n請輸入您的 e-Contact 密碼：\n⚠️ 密碼會加密儲存，請放心輸入。`
      }]
    });
  }

  if (user && user.setup_state === 'awaiting_password') {
    // 驗證帳密（直接等待完成後用 replyMessage 回傳結果，避免 pushMessage 月用量限制）
    const username  = user.ec_username;
    const password  = text;
    const loginOK   = await econtact.testLogin(username, password);

    if (!loginOK) {
      await db.query(`UPDATE users SET setup_state='awaiting_username', ec_username=NULL WHERE line_user_id=?`, [userId]);
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `❌ 帳號或密碼驗證失敗\n\n請重新輸入「設定帳號」再試一次。\n請確認帳密與 e-Contact 網站登入一致。`
        }]
      });
    }

    const encPwd    = encrypt(password);
    // Resolve AIFF employee ID and store it. Can be manually corrected in DB if AIFF returns wrong user.
    const employeeId = await econtact.resolveEmployeeId(username, password);
    await db.query(
      `UPDATE users SET ec_password=?, ec_setup_done=1, setup_state=NULL, employee_id=? WHERE line_user_id=?`,
      [encPwd, employeeId || null, userId]
    );

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `🎉 帳號設定成功！\n\n帳號：${username}\n密碼已加密儲存 🔒\n\n現在可以使用下方選單打卡了！`
      }]
    });
  }

  // ── Rich Menu 文字觸發（備用）───────────────────────
  if (text === '上班打卡' || text === 'CLOCK_IN')       return handleClockIn(event, client, userId);
  if (text === '下班打卡' || text === 'CLOCK_OUT')      return handleClockOut(event, client, userId);
  if (text === '填寫工時' || text === 'WORK_HOURS')     return handleWorkHours(event, client, userId);
  if (text === '打卡紀錄' || text === 'MY_RECORD')      return handleMyRecord(event, client, userId);
  if (text === '常用選單' || text === 'QUICK_MENU')     return handleQuickMenu(event, client);
  if (text === '查詢工時' || text === 'WORK_HOURS_QUERY') return handleWorkHoursQuery(event, client, userId);
  if (text === '請假紀錄' || text === 'LEAVE_HISTORY')  return handleLeaveHistory(event, client, userId);
  if (text === '會議室'   || text === 'MEETING_ROOM')   return handleMeetingRoom(event, client, userId);
  if (text === '說明'     || text === 'HELP')           return handleHelp(event, client);
}

// ─────────────────────────────────────────────────────
// Postback（Rich Menu 按鈕）
// ─────────────────────────────────────────────────────
async function handlePostback(event, client) {
  const data   = event.postback.data;
  const userId = event.source.userId;
  if (data === 'action=clock_in')         return handleClockIn(event, client, userId);
  if (data === 'action=clock_out')        return handleClockOut(event, client, userId);
  if (data === 'action=work_hours')       return handleWorkHours(event, client, userId);
  if (data === 'action=my_record')        return handleMyRecord(event, client, userId);
  if (data === 'action=quick_menu')       return handleQuickMenu(event, client);
  if (data === 'action=work_hours_query') return handleWorkHoursQuery(event, client, userId);
  if (data === 'action=leave_balance')    return handleLeaveBalance(event, client, userId);
  if (data === 'action=help')             return handleHelp(event, client);
}

// ─────────────────────────────────────────────────────
// 共用：取得並確認用戶已設定 e-Contact 帳密
// ─────────────────────────────────────────────────────
async function getUserCredentials(userId) {
  const [user] = await db.query(
    `SELECT ec_setup_done, ec_username, ec_password, display_name FROM users WHERE line_user_id=?`,
    [userId]
  );
  if (!user || !user.ec_setup_done || !user.ec_username || !user.ec_password) {
    return null;
  }
  return {
    username: user.ec_username,
    password: decrypt(user.ec_password),
    displayName: user.display_name || '員工',
  };
}

// ─────────────────────────────────────────────────────
// 上班打卡
// ─────────────────────────────────────────────────────
async function handleClockIn(event, client, userId) {
  const creds = await getUserCredentials(userId);
  if (!creds) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `⚠️ 尚未設定 e-Contact 帳號\n\n請輸入「設定帳號」完成初始設定後再打卡。`
      }]
    });
  }

  // 直接等待打卡完成後用 replyMessage 回傳結果（避免 pushMessage 月用量限制）
  const result = await econtact.punch(creds.username, creds.password, 'clock_in');
  const now    = dayjs().add(8, 'hour');

  if (result.success) {
    // 記錄到本地 DB
    await db.query(
      `INSERT INTO attendance (line_user_id, punch_type, punch_time) VALUES (?, 'clock_in', NOW())`,
      [userId]
    );
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `✅ 上班打卡成功！\n\n📅 ${now.format('YYYY/MM/DD')}\n⏰ ${now.format('HH:mm')}\n\n${result.message}\n\n祝您工作順利 💪`
      }]
    });
  } else {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `❌ 打卡失敗\n\n${result.message}\n\n如持續失敗，請輸入「設定帳號」重新設定，或直接至 e-Contact 系統打卡。`
      }]
    });
  }
}

// ─────────────────────────────────────────────────────
// 下班打卡
// ─────────────────────────────────────────────────────
async function handleClockOut(event, client, userId) {
  const creds = await getUserCredentials(userId);
  if (!creds) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `⚠️ 尚未設定 e-Contact 帳號\n\n請輸入「設定帳號」完成初始設定後再打卡。`
      }]
    });
  }

  // 直接等待打卡完成後用 replyMessage 回傳結果（避免 pushMessage 月用量限制）
  const result = await econtact.punch(creds.username, creds.password, 'clock_out');
  const now    = dayjs().add(8, 'hour');

  if (result.success) {
    // 計算今日在班時數
    const [clockIn] = await db.query(
      `SELECT CONVERT_TZ(punch_time,'+00:00','+08:00') AS pt
       FROM attendance
       WHERE line_user_id=? AND punch_type='clock_in'
         AND DATE(CONVERT_TZ(punch_time,'+00:00','+08:00'))=?
       ORDER BY punch_time DESC LIMIT 1`,
      [userId, now.format('YYYY-MM-DD')]
    );

    let durationMsg = '';
    if (clockIn) {
      const inTime  = dayjs(clockIn.pt);
      const diffMin = now.diff(inTime, 'minute');
      const h = Math.floor(diffMin / 60), m = diffMin % 60;
      durationMsg = `\n⏱ 在班：${h} 小時 ${m} 分鐘`;
    }

    await db.query(
      `INSERT INTO attendance (line_user_id, punch_type, punch_time) VALUES (?, 'clock_out', NOW())`,
      [userId]
    );

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `🏠 下班打卡成功！\n\n📅 ${now.format('YYYY/MM/DD')}\n⏰ ${now.format('HH:mm')}${durationMsg}\n\n${result.message}\n\n辛苦了，好好休息！ 😊`
      }]
    });
  } else {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `❌ 打卡失敗\n\n${result.message}\n\n如持續失敗，請輸入「設定帳號」重新設定。`
      }]
    });
  }
}

// ─────────────────────────────────────────────────────
// 填寫工時 → 開啟 LIFF
// ─────────────────────────────────────────────────────
async function handleWorkHours(event, client, userId) {
  const liffUrl = `https://liff.line.me/${process.env.LINE_LIFF_ID}?userId=${userId}`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'template',
      altText: '填寫工時表單',
      template: {
        type: 'buttons',
        title: '📋 填寫工時',
        text: '請點擊下方按鈕開啟工時填寫表單',
        actions: [{ type: 'uri', label: '開啟工時表單', uri: liffUrl }]
      }
    }]
  });
}

// ─────────────────────────────────────────────────────
// 打卡紀錄 Flex Message 建構器（以日為單位）
// ─────────────────────────────────────────────────────
function buildPunchRecordFlex(records) {
  const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

  // ── 以 UTC+8 日期分組，每天保留最早上班、最晚下班 ──
  const dayMap = new Map(); // 'YYYY-MM-DD' → { in: dayjs|null, inStatus, out: dayjs|null, outStatus }

  for (const r of records) {
    if (!r.punchTime) continue;
    const pt      = dayjs(r.punchTime.replace(' ', 'T') + ':00Z').add(8, 'hour');
    const dateKey = pt.format('YYYY-MM-DD');

    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, { in: null, inStatus: '', out: null, outStatus: '' });
    }
    const entry = dayMap.get(dateKey);

    if (r.punchType === 'clock_in') {
      // Keep earliest clock-in of the day
      if (!entry.in || pt.unix() < entry.in.unix()) {
        entry.in = pt; entry.inStatus = r.status || '';
      }
    } else {
      // Keep latest clock-out of the day
      if (!entry.out || pt.unix() > entry.out.unix()) {
        entry.out = pt; entry.outStatus = r.status || '';
      }
    }
  }

  // Sort descending by date, take up to 5 days
  const sortedKeys = [...dayMap.keys()].sort().reverse().slice(0, 5);

  const bodyRows = [];

  for (let di = 0; di < sortedKeys.length; di++) {
    const key   = sortedKeys[di];
    const entry = dayMap.get(key);
    const dt    = new Date(key + 'T12:00:00Z');
    const mmdd  = key.slice(5).replace('-', '/');
    const dow   = DAY_NAMES[dt.getUTCDay()];
    const isWE  = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;

    if (di > 0) bodyRows.push({ type: 'separator', color: '#e8edf2' });

    // ── Date header band ──
    bodyRows.push({
      type: 'box', layout: 'horizontal',
      backgroundColor: '#f4f7fb',
      paddingTop: '8px', paddingBottom: '8px',
      paddingStart: '14px', paddingEnd: '14px',
      alignItems: 'center',
      contents: [
        { type: 'text', text: mmdd, size: 'sm', weight: 'bold',
          color: isWE ? '#c0392b' : '#2d3748', flex: 0 },
        { type: 'text', text: `週${dow}`, size: 'xs', color: '#a0aec0',
          margin: 'sm', flex: 1 },
      ],
    });

    // ── Helper: one punch row ──
    const punchRow = (isIn, timeObj, status) => {
      const timeStr = timeObj ? timeObj.format('HH:mm') : null;
      const bgBadge = isIn ? '#d8f3dc' : '#fce4ec';
      const txtBadge = isIn ? '#2d6a4f' : '#b71c1c';
      const label = isIn ? '上班' : '下班';

      const row = {
        type: 'box', layout: 'horizontal',
        paddingTop: '9px', paddingBottom: '9px',
        paddingStart: '20px', paddingEnd: '16px',
        alignItems: 'center',
        contents: [
          // Badge
          {
            type: 'box', layout: 'vertical', flex: 0,
            backgroundColor: bgBadge, cornerRadius: '20px',
            paddingTop: '3px', paddingBottom: '3px',
            paddingStart: '10px', paddingEnd: '10px',
            contents: [{ type: 'text', text: label, size: 'xxs', weight: 'bold', color: txtBadge }],
          },
          // Time
          timeStr
            ? { type: 'text', text: timeStr, size: 'xl', weight: 'bold',
                color: isIn ? '#1b4332' : '#7b1818', margin: 'lg', flex: 1 }
            : { type: 'text', text: '─', size: 'lg', color: '#d0d5dd',
                margin: 'lg', flex: 1 },
          // Abnormal status tag
          ...(status && status !== '正常'
            ? [{ type: 'text', text: status, size: 'xxs', color: '#e17055',
                 align: 'end', flex: 0 }]
            : []
          ),
        ],
      };
      return row;
    };

    bodyRows.push(punchRow(true,  entry.in,  entry.inStatus));
    bodyRows.push({ type: 'separator', color: '#f0f4f8' });
    bodyRows.push(punchRow(false, entry.out, entry.outStatus));
  }

  return {
    type: 'flex',
    altText: '📋 打卡紀錄',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#4a90d9', paddingAll: '16px',
        contents: [
          { type: 'text', text: '📋', size: 'xxl' },
          { type: 'text', text: '打卡紀錄', weight: 'bold', color: '#ffffff', size: 'lg', margin: 'sm' },
          { type: 'text', text: `近 ${sortedKeys.length} 天`, color: '#ffffffBB', size: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
        contents: bodyRows,
      },
    },
  };
}

// ─────────────────────────────────────────────────────
// 打卡紀錄 → 開啟 LIFF attendance 頁面（近7天 + 補打卡）
// ─────────────────────────────────────────────────────
async function handleMyRecord(event, client, userId) {
  const liffUrl = `https://liff.line.me/${process.env.LINE_LIFF_ID}?userId=${encodeURIComponent(userId)}&page=attendance`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'template',
      altText: '打卡紀錄',
      template: {
        type: 'buttons',
        title: '📋 打卡紀錄',
        text: '查看近 7 天打卡記錄，未打卡日可進行補打卡',
        actions: [{ type: 'uri', label: '開啟打卡紀錄', uri: liffUrl }],
      },
    }],
  });
}

// ─────────────────────────────────────────────────────
// 常用選單 → Flex Carousel
// ─────────────────────────────────────────────────────
async function handleQuickMenu(event, client) {
  const userId = event.source.userId;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [buildQuickMenuFlex(userId)],
  });
}

// ─────────────────────────────────────────────────────
// 查詢工時(7天) → Flex Message
// ─────────────────────────────────────────────────────
async function handleWorkHoursQuery(event, client, userId) {
  // 文字觸發時也開啟 LIFF history 頁面
  const liffUrl = `https://liff.line.me/${process.env.LINE_LIFF_ID}?userId=${encodeURIComponent(userId)}&mode=history`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'template',
      altText: '查詢工時記錄',
      template: {
        type: 'buttons',
        text: '點擊下方按鈕開啟工時總覽',
        actions: [{ type: 'uri', label: '📈 開啟工時總覽', uri: liffUrl }],
      },
    }],
  });
}

// ─────────────────────────────────────────────────────
// 會議室查詢與預約 → 開啟 LIFF
// ─────────────────────────────────────────────────────
async function handleMeetingRoom(event, client, userId) {
  const liffUrl = `https://liff.line.me/${process.env.LINE_LIFF_ID}?userId=${encodeURIComponent(userId)}&page=meeting`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'template',
      altText: '會議室查詢與預約',
      template: {
        type: 'buttons',
        title: '🏢 會議室',
        text: '查詢今日預約狀況，或預約會議室',
        actions: [{ type: 'uri', label: '開啟會議室系統', uri: liffUrl }],
      },
    }],
  });
}

// ─────────────────────────────────────────────────────
// 餘假查詢 Flex Message 建構器
// ─────────────────────────────────────────────────────
function buildLeaveBalanceFlex(leaves) {
  // 合併同名假別（如兩筆特休）並加總
  const merged = new Map();
  for (const l of leaves) {
    if (merged.has(l.name)) {
      const m = merged.get(l.name);
      m.preset    += l.preset;
      m.consumed  += l.consumed;
      m.remaining += l.remaining;
      // 保留最近到期日（取最小值）
      if (l.expiryDate && (!m.expiryDate || l.expiryDate < m.expiryDate)) {
        m.expiryDate = l.expiryDate;
      }
    } else {
      merged.set(l.name, { ...l });
    }
  }
  const items = [...merged.values()];

  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const l = items[i];
    const remainHrs = l.remaining.toFixed(1);
    const presetHrs = l.preset.toFixed(1);
    const usedHrs   = l.consumed.toFixed(1);
    const pct        = l.preset > 0 ? Math.round((l.remaining / l.preset) * 100) : 0;
    const barColor   = pct >= 50 ? '#52b788' : pct >= 20 ? '#f6ad55' : '#fc8181';
    const expiry     = l.expiryDate ? l.expiryDate.slice(5).replace('-', '/') : '';

    if (i > 0) rows.push({ type: 'separator', color: '#f0f4f8' });

    rows.push({
      type: 'box', layout: 'vertical',
      paddingTop: '12px', paddingBottom: '12px',
      paddingStart: '14px', paddingEnd: '14px',
      contents: [
        // 第一行：假別名稱 + 到期日
        {
          type: 'box', layout: 'horizontal', alignItems: 'center',
          contents: [
            { type: 'text', text: l.name, size: 'sm', weight: 'bold', color: '#2d3748', flex: 1 },
            ...(expiry ? [{ type: 'text', text: `到期 ${expiry}`, size: 'xxs', color: '#a0aec0', flex: 0 }] : []),
          ],
        },
        // 第二行：進度條
        {
          type: 'box', layout: 'horizontal', margin: 'sm',
          height: '6px', backgroundColor: '#e2e8f0', cornerRadius: '3px',
          contents: [{
            type: 'box', layout: 'vertical',
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: barColor, cornerRadius: '3px',
            contents: [],
          }],
        },
        // 第三行：剩餘天數 + 已用/總計
        {
          type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
          contents: [
            { type: 'text', text: `剩餘`, size: 'xxs', color: '#a0aec0', flex: 0 },
            { type: 'text', text: ` ${remainHrs}h`, size: 'sm', weight: 'bold',
              color: barColor, flex: 1, margin: 'xs' },
            { type: 'text', text: `已用 ${usedHrs} / 共 ${presetHrs} h`,
              size: 'xxs', color: '#a0aec0', flex: 0, align: 'end' },
          ],
        },
      ],
    });
  }

  return {
    type: 'flex',
    altText: '🏖️ 餘假查詢',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#d97706', paddingAll: '16px',
        contents: [
          { type: 'text', text: '🏖️ 餘假查詢', weight: 'bold', color: '#ffffff', size: 'lg' },
          { type: 'text', text: `共 ${items.length} 種假別`, color: '#ffffffBB', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
        contents: rows,
      },
    },
  };
}

// ─────────────────────────────────────────────────────
// 餘假查詢 Handler
// ─────────────────────────────────────────────────────
async function handleLeaveBalance(event, client, userId) {
  const creds = await getUserCredentials(userId);
  if (!creds) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '⚠️ 尚未設定 e-Contact 帳號\n\n請輸入「設定帳號」完成初始設定後再查詢。' }]
    });
  }

  // 直接等待查詢完成後用 replyMessage 回傳結果（避免 pushMessage 月用量限制）
  try {
    const leaves = await econtact.getLeaveBalance(creds.username, creds.password);
    if (!leaves.length) {
      return client.replyMessage({ replyToken: event.replyToken,
        messages: [{ type: 'text', text: '目前查無餘假資料。' }] });
    }
    return client.replyMessage({ replyToken: event.replyToken,
      messages: [buildLeaveBalanceFlex(leaves)] });
  } catch (err) {
    return client.replyMessage({ replyToken: event.replyToken,
      messages: [{ type: 'text', text: `❌ 查詢失敗：${err.message}` }] });
  }
}

// ─────────────────────────────────────────────────────
// 請假紀錄（LIFF 連結）
// ─────────────────────────────────────────────────────
async function handleLeaveHistory(event, client, userId) {
  const liffId = process.env.LINE_LIFF_ID || '';
  const url    = `https://liff.line.me/${liffId}?userId=${encodeURIComponent(userId)}&page=leave-history`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'flex',
      altText: '📅 請假紀錄',
      contents: {
        type: 'bubble', size: 'kilo',
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
          contents: [
            { type: 'text', text: '📅 請假紀錄', weight: 'bold', size: 'lg', color: '#0c4a6e' },
            { type: 'text', text: '最近 5 筆請假記錄', size: 'sm', color: '#64748b', margin: 'xs' },
            {
              type: 'box', layout: 'vertical', margin: 'lg',
              backgroundColor: '#e0f2fe', cornerRadius: '12px', paddingAll: '14px',
              action: { type: 'uri', uri: url },
              contents: [
                { type: 'text', text: '🔎 查看請假紀錄', weight: 'bold', color: '#0c4a6e',
                  size: 'md', align: 'center' },
              ],
            },
          ],
        },
      },
    }],
  });
}

// ─────────────────────────────────────────────────────
// 說明
// ─────────────────────────────────────────────────────
async function handleHelp(event, client) {
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: `📖 員工助理使用說明\n${'─'.repeat(18)}\n\n🟢 上班打卡\n   上班時點擊打卡\n\n🔴 下班打卡\n   下班時點擊打卡\n\n📋 打卡紀錄\n   查看最近 6 筆打卡\n\n📝 填寫工時\n   填寫當日詳細工時\n\n⚙️ 設定帳號\n   首次使用或更換帳密\n\n如遇問題請聯繫 HR 或 IT 部門。`
    }]
  });
}

module.exports = { handleEvent };
