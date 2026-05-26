'use strict';
/**
 * econtact.js
 * e-Contact REST API: login (QS + AIFF token), punch, work hours
 */

const https = require('https');
const HOST  = 'econtact.ai3.cloud';

// ── Generic HTTPS POST ─────────────────────────────────
function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    https.request({
      hostname: HOST,
      path,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(jar ? { Cookie: jar } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        try   { resolve({ data: JSON.parse(raw), raw, jar: cookie }); }
        catch { resolve({ data: raw, raw, jar: cookie }); }
      });
    }).on('error', reject).end(data);
  });
}

// ── QuickSilver DataServlet POST ("/ecp/Xxx.Method.data") ──
function qsPost(endpoint, body, jar) {
  return post('/ecp/' + endpoint, body, jar);
}

// ── OpenAPI POST ("/ecp/openapi/...") ──────────────────
function apiPost(path, body, jar) {
  return post('/ecp/openapi' + path, body, jar);
}

// ── Step 1: QuickSilver session login → { jar, userId, deptId, deptName } ──
// The QS login response may contain the TsUser FId directly.
// This avoids relying on the AIFF token which can resolve to the wrong employee.
async function qsLogin(username, password) {
  const res = await qsPost('Qs.OnlineUser.login.data', {
    loginName: username,
    password,
    language: 'zh-tw',
  });
  if (res.data?._failed) throw new Error(res.data.message || '登入失敗');
  if (!res.jar)          throw new Error('登入後未取得 Session');

  // Try to extract userId from login response
  // QS stores the TsUser FId in various fields depending on the system version
  const userId   = res.data?.id || res.data?.FId || res.data?.userId || res.data?.tsUserId || '';
  const deptId   = res.data?.FDepartmentId      || '';
  const deptName = res.data?.['FDepartmentId$'] || '';
  return { jar: res.jar, userId, deptId, deptName };
}

// ── Step 2: Get AIFF token (tokenId only; userId comes from QS login) ──
async function getToken(jar, username) {
  const res = await apiPost('/aile/token/apply', {
    loginType: 'aiff',
    loginName: username,
  }, jar);
  if (!res.data?._header_?.success) {
    throw new Error('取得 Token 失敗：' + (res.data?._header_?.errorMessage || JSON.stringify(res.data)));
  }
  // NOTE: res.data.employee?.id here may return the wrong employee in some AIFF
  // configurations. We prefer the QS-derived userId from the session login.
  return {
    tokenId:      res.data.tokenId,
    aiffUserId:   res.data.employee?.id || '',
  };
}

// ── Step 3: Look up TsUser FId by loginName via QS ────
// This is the definitive userId used in ECP work-hours and tasks.
async function getTsUserId(jar, username) {
  try {
    const res = await qsPost('Qs.OnlineUser.getItem.data', { loginName: username }, jar);
    if (!res.data?._failed) {
      const uid = res.data?.id || res.data?.FId || res.data?.userId;
      if (uid) return uid;
    }
  } catch { /* ignore, try next */ }

  try {
    const res = await qsPost('Ecp.TsUser.getByLoginName.data', { loginName: username }, jar);
    if (!res.data?._failed) {
      const uid = res.data?.id || res.data?.FId;
      if (uid) return uid;
    }
  } catch { /* ignore */ }

  return null;
}

// ── Full login → { jar, tokenId, userId } ─────────────
// ecUserId: if provided (from users.employee_id in DB), it takes top priority.
// Otherwise: QS-login response > TsUser lookup > AIFF token employee
async function fullLogin(username, password, ecUserId = null) {
  const { jar, userId: qsUserId } = await qsLogin(username, password);
  const { tokenId, aiffUserId }   = await getToken(jar, username);

  let userId = ecUserId || qsUserId;
  if (!userId) {
    userId = await getTsUserId(jar, username);
  }
  if (!userId) {
    userId = aiffUserId;
  }

  console.log(`[econtact] fullLogin ${username} → userId=${userId} (override=${ecUserId||'-'} qsLogin=${qsUserId||'-'} aiff=${aiffUserId||'-'})`);
  return { jar, tokenId, userId };
}

// ── Resolve AIFF employee ID (for account setup storage) ──
// Returns the raw AIFF employee ID — callers should store it in users.employee_id
// and manually correct it if the AIFF mapping is wrong.
async function resolveEmployeeId(username, password) {
  try {
    const { jar }       = await qsLogin(username, password);
    const { aiffUserId } = await getToken(jar, username);
    return aiffUserId || null;
  } catch {
    return null;
  }
}

// ── Punch (上班/下班打卡) ─────────────────────────────
async function punch(username, password, punchType) {
  try {
    const { jar }   = await qsLogin(username, password);
    const checkType = punchType === 'clock_in' ? 'I' : 'O';
    const res       = await qsPost('Ecp.CheckIn.newCheckIn.data', {
      confirmRst: { isConfirmed: false },
      checkType,
    }, jar);

    if (res.data._failed) {
      return { success: false, message: res.data.message || '打卡失敗' };
    }
    const label = punchType === 'clock_in' ? '上班' : '下班';
    const extra = res.data.notWorkTime === 'Y' ? '（非工作時間）' : '';
    return { success: true, message: `${label}打卡完成${extra}` };
  } catch (err) {
    console.error('[econtact] punch error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ── Test login ─────────────────────────────────────────
async function testLogin(username, password) {
  try {
    await qsLogin(username, password);
    return true;
  } catch {
    return false;
  }
}

// ── Closed task statuses (deny-list) ──────────────────
// Only exclude tasks in definitively closed states.
// Use a deny-list so unknown/new statuses (e.g. FinishAuditing=關閉審核中)
// are shown by default instead of being silently dropped.
const CLOSED_STATUSES = new Set([
  'Finished', 'Closed', 'Cancelled', 'Rejected', 'Deleted',
  'FinishAuditing',  // 關閉審核中
]);

// ── Get task list via QSVD ────────────────────────────────
// Uses POST /ecp/qsvd-list/Ecp.Task.getListData.data with QS JSESSIONID.
// listId / schemaId are from the browser network capture of the real e-Contact UI.
// After fetching, filter by FUserId === userId so each user sees only their own tasks.
const QSVD_LIST_ID   = '296aa935-f6c0-4a8e-9ab9-32254ea39861';
const QSVD_SCHEMA_ID = 'b158be99-606a-4dc9-aa7f-53f50b16059a';

async function fetchTaskList(jar, _tokenId, userId) {
  const allTasks = [];
  const MAX_PAGES = 20;   // up to 1000 records

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await post('/ecp/qsvd-list/Ecp.Task.getListData.data', {
      listId:         QSVD_LIST_ID,
      schemaId:       QSVD_SCHEMA_ID,
      keyword:        '',
      queryFormRecent: {},
      start:          page * 50,
      limit:          50,
    }, jar);
    const records = r.data?.data?.records || [];
    allTasks.push(...records);
    if (records.length < 50) break;
  }

  // Filter: exclude only definitively closed tasks.
  // QSVD with the correct listId/schemaId already scopes results to the logged-in
  // user's own tasks via the QS JSESSIONID — no extra userId comparison needed.
  // Deny-list approach: unknown statuses (e.g. FinishAuditing) are included by default.
  const activeTasks = allTasks.filter(t =>
    !t.FStatus || !CLOSED_STATUSES.has(t.FStatus)
  );

  // Auto-detect the user's actual TsUser.FId from the QSVD results.
  // Since listId/schemaId scope results to the current user's own tasks,
  // the FUserId of any returned task IS the logged-in user's TsUser.FId.
  const detectedUserId = activeTasks.length > 0 ? activeTasks[0].FUserId : null;

  console.log(`[econtact] fetchTaskList: ${allTasks.length} total → ${activeTasks.length} active, detectedUserId=${detectedUserId || '-'}`);

  return {
    tasks: activeTasks.map(t => ({
      id:               t.FId,
      name:             t.FName,
      departmentId:     t.FAssignDepartmentId || t.FDepartmentId || '',
      project:          t['FProjectId$'] || '',
      assignee:         t['FAssignUserId$'] || '',
      owner:            t['FUserId$'] || '',
      status:           t['FStatus$'] || t.FStatus || '',
      statusCode:       t.FStatus || '',
      predictEndDate:   t.FPredictEndDate || '',
      predictStartDate: t.FPredictStartDate || '',
      predictHour:      t.FPredictHour || '',
      progress:         t.FProgress || '0',
      priority:         t['FPriority$'] || t.FPriority || '',
      description:      t.FTaskDescription || '',
      serialNumber:     t.FSerialNumber || '',
    })),
    detectedUserId,
  };
}

// ── Get task detail (full entity data, needed for close/finish-audit) ──
async function getTaskDetail(jar, taskId) {
  const res = await qsPost('Ecp.Task.getItem.data', { entityId: taskId }, jar);
  if (res.data?._failed) throw new Error(res.data.message || '取得任務詳情失敗');
  return res.data;
}

// ── Get current user's open tasks, sorted by due date ascending ──
// Returns: [{ id, name, project, status, predictEndDate, predictHour, progress,
//             priority, description, serialNumber, isOverdue, daysUntilDue }]
async function getMyOpenTasks(username, password, ecUserId = null) {
  try {
    const { jar } = await qsLogin(username, password);
    const { tasks, detectedUserId } = await fetchTaskList(jar, null, null);

    // Sort by due date ascending; tasks without due date go to the end
    const sorted = tasks.slice().sort((a, b) => {
      if (!a.predictEndDate && !b.predictEndDate) return 0;
      if (!a.predictEndDate) return 1;
      if (!b.predictEndDate) return -1;
      return a.predictEndDate.localeCompare(b.predictEndDate);
    });

    // Tag each task with overdue / days-until-due (Taiwan date)
    const todayStr = taiwanDateStr(0);
    const enriched = sorted.map(t => {
      const dueDate = (t.predictEndDate || '').slice(0, 10);
      const daysUntilDue = dueDate
        ? Math.floor((new Date(dueDate + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z')) / 86400000)
        : null;
      return {
        ...t,
        isOverdue: daysUntilDue !== null && daysUntilDue < 0,
        daysUntilDue,
      };
    });

    console.log(`[econtact] getMyOpenTasks: ${enriched.length} open tasks, detectedUserId=${detectedUserId || '-'}`);
    return { tasks: enriched, detectedUserId };
  } catch (err) {
    console.error('[econtact] getMyOpenTasks error:', err.message);
    return { tasks: [], detectedUserId: null };
  }
}

// ── Generic HTTPS GET (used for HTML pages like Ecp.ProlongTask.Form.page) ──
function get(path, jar) {
  return new Promise((resolve, reject) => {
    https.request({
      hostname: HOST, path, method: 'GET',
      headers: { ...(jar ? { Cookie: jar } : {}) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ raw, status: res.statusCode }));
    }).on('error', reject).end();
  });
}

// ── ProlongTask form constants (from HAR capture) ─────────
const PROLONG_MASTER_UNIT_ID = '47a60f3c-165f-4fbb-a877-1a5baafb48a1';
const PROLONG_RELATION_ID    = '8ce693e6-b482-46a9-8dfc-ca2bfb40948a';

// ── Submit prolong task (延時申請) ────────────────────────
// args: { taskId, taskStatus, prolongDate ('YYYY-MM-DD HH:mm'), prolongTime (number), prolongReason }
// Flow: load form page → parse editId + pre-filled data → submit
async function submitProlongTask(username, password, { taskId, taskStatus, prolongDate, prolongTime, prolongReason = '' }) {
  try {
    const { jar } = await qsLogin(username, password);

    // Step 1: load form page to get FEditId + pre-filled task data
    const args = encodeURIComponent(JSON.stringify({
      masterUnitId:    PROLONG_MASTER_UNIT_ID,
      masterEntityId:  taskId,
      unitCode:        'Ecp.ProlongTask',
      relationId:      PROLONG_RELATION_ID,
      masterStatus:    taskStatus || 'Executing',
      addToLastOpen:   false,
    }));
    const pageRes = await get(`/ecp/Ecp.ProlongTask.Form.page?args=${args}`, jar);
    const html    = pageRes.raw;

    // Regex-extract the fields we need from clientData
    const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
    const editId      = pick(/"editId":"([0-9a-f-]+)"/);
    const fUserId     = pick(/"FUserId":"([^"]+)"/);
    const fUserName   = pick(/"FUserId\$":"([^"]+)"/);
    const fDeptId     = pick(/"FDepartmentId":"([^"]+)"/);
    const fDeptName   = pick(/"FDepartmentId\$":"([^"]+)"/);
    const fTaskName   = pick(/"FTaskId\$":"([^"]+)"/);
    const fPredictCompletedDate = pick(/"FPredictCompletedDate":"([^"]+)"/).slice(0, 16);
    const fPredictHour = pick(/"FPredictHour":([0-9.]+)/);

    if (!editId || !fUserId || !fTaskName) {
      console.log(`[econtact] submitProlongTask: failed to parse form page (editId=${editId}, fUserId=${fUserId})`);
      return { success: false, message: '無法載入延時申請表單，請稍後再試' };
    }

    // Step 2: build & submit
    const payload = {
      entityIds: [null],
      forms: [{
        FName:                   `${fTaskName}延時申請`,
        FProlongType:            'delay',
        FProlongDate:            prolongDate,
        FPredictCompletedDate:   fPredictCompletedDate,
        FProlongTime:            String(prolongTime),
        FPredictHour:            fPredictHour || String(prolongTime),
        FProlongReason:          prolongReason || '',
        FStatus:                 'New',
        FUserId:                 fUserId,
        'FUserId$':              fUserName,
        FDepartmentId:           fDeptId,
        'FDepartmentId$':        fDeptName,
        FTaskId:                 taskId,
        'FTaskId$':              fTaskName,
        FCreateUserId:           null,
        'FCreateUserId$':        '',
        FCreateDepartmentId:     null,
        'FCreateDepartmentId$':  '',
        FCreateTime:             null,
        'FProlongType$':         '延時申請',
        'FStatus$':              '新增',
        FEditId:                 editId,
        $FAvatarId:              null,
      }],
    };

    console.log(`[econtact] submitProlongTask ${taskId}: ${fPredictCompletedDate} → ${prolongDate} (+${prolongTime}h)`);
    const res = await qsPost('Ecp.ProlongTask.submit.data', payload, jar);

    if (res.data?._failed) {
      return { success: false, message: res.data.message || res.data._msg || '延時申請送出失敗' };
    }
    if (!res.data?.entityIds?.length && !res.data?.processIds?.length) {
      return { success: false, message: '延時申請失敗：' + (res.raw || '').substring(0, 200) };
    }
    console.log(`[econtact] submitProlongTask OK: entityId=${res.data.entityIds?.[0]} processId=${res.data.processIds?.[0]}`);
    return { success: true, message: '🕒 延時申請已送出，等待主管審核' };
  } catch (err) {
    console.error('[econtact] submitProlongTask error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ── Close a task (送出結案審核 → FinishAudit workflow) ──
// 1. Fetch full task detail (needed for submit payload)
// 2. doFinishCheck preflight
// 3. submit with workflowCode=Ecp.Task.FinishAudit
async function closeTask(username, password, taskId, finishDescription = '') {
  try {
    const { jar } = await qsLogin(username, password);

    // Step 1: get full task data
    const taskData = await getTaskDetail(jar, taskId);
    const predictEndDate = taskData.FPredictEndDate || taskData['FPredictEndDate$'] || '';

    console.log(`[econtact] closeTask ${taskId}: ${taskData.FName} predictEndDate=${predictEndDate}`);

    // Step 2: preflight check — must return allFinished:true
    const checkRes = await qsPost('Ecp.Task.doFinishCheck.data', {
      taskId,
      unitCode:       'Ecp.Task',
      predictEndDate,
    }, jar);
    if (!checkRes.data?.allFinished) {
      const msg = checkRes.data?.message || '此任務尚有未完成的前置條件，無法結案';
      console.log(`[econtact] closeTask preflight FAIL: ${msg}`);
      return { success: false, message: msg };
    }

    // Step 3: build close payload — original task data + close-specific fields
    const nowTW = new Date(Date.now() + 8 * 3600 * 1000);
    const completedDate = nowTW.toISOString().slice(0, 16).replace('T', ' ');         // 'YYYY-MM-DD HH:mm'
    const taskCloseDate = nowTW.toISOString().slice(0, 19).replace('T', ' ');         // 'YYYY-MM-DD HH:mm:ss'

    const closeData = {
      ...taskData,
      FCompletedDate:        completedDate,
      FFinishReason:         null,
      FFinishDescription:    finishDescription || '',
      FTaskCloseDate:        taskCloseDate,
      FinishCommentRequire:  '0',
      FDiffirentHour:        Number(taskData.FPredictHour) || 0,
    };

    const submitRes = await qsPost('Ecp.Task.submit.data', {
      entityIds:    [taskId],
      data:         closeData,
      workflowCode: 'Ecp.Task.FinishAudit',
    }, jar);

    if (submitRes.data?._failed) {
      return { success: false, message: submitRes.data.message || '結案送出失敗' };
    }
    const ok = (submitRes.data?.entityIds || []).includes(taskId)
            || submitRes.data?.processIds?.length > 0;
    if (!ok) {
      return { success: false, message: '結案送出失敗：' + (submitRes.raw || '').substring(0, 200) };
    }

    console.log(`[econtact] closeTask OK: ${taskId} processId=${submitRes.data.processIds?.[0]}`);
    return { success: true, message: '✅ 任務已送出結案審核，等待主管簽核' };
  } catch (err) {
    console.error('[econtact] closeTask error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ── Get work hours form data (tasks + types) ───────────
// Returns { tasks, types, detectedUserId } — detectedUserId is the user's actual
// TsUser.FId inferred from the QSVD task data (more reliable than AIFF token).
async function getWorkHoursFormData(username, password, ecUserId = null) {
  const { jar, tokenId, userId } = await fullLogin(username, password, ecUserId);
  const { tasks, detectedUserId } = await fetchTaskList(jar, tokenId, userId);

  // Activity types from TsDictionaryItem (FEnabled=1 only, sorted by FIndex)
  const types = [
    '拜訪客戶', '撰寫文件', '專案實施', '撰寫規格', '產品研發',
    '系統測試', '系統安裝', '系統維護', '技術評估', '簡報',
    '文件維護', '休假', '會議', '訓練', '行政', '其他',
  ].map(t => ({ value: t, label: t }));

  // Expose detectedUserId so server.js can persist it to DB for submitWorkHours
  return { tasks, types, detectedUserId: detectedUserId || ecUserId || userId };
}

// ── Fetch current user's TimeReport list (session-scoped) ─
// The userId param in getListData is ignored by the API — it returns global records.
// CurrentUser condition correctly scopes to the logged-in session user.
// Returns: { records, detectedUserId }
async function fetchTimeReportList(jar, limit = 60) {
  const res = await qsPost('Ecp.TimeReport.getListData.data', {
    conditions: [{ fieldName: 'FUserId', value: '', operator: 'CurrentUser' }],
    start: 0, limit,
  }, jar);
  const records = res.data?.data?.records || [];
  const detectedUserId = records[0]?.FUserId || null;
  return { records, detectedUserId };
}

// ── Get existing work hours for a specific date ───────
// Returns { exists, entityId, totalHours, detectedUserId }
async function getWorkHoursForDate(username, password, date, ecUserId = null) {
  try {
    const { jar } = await qsLogin(username, password);
    const { records, detectedUserId } = await fetchTimeReportList(jar);
    const record = records.find(r => r.FDate === date);
    if (!record) return { exists: false, detectedUserId };
    console.log(`[econtact] getWorkHoursForDate ${date} → entityId=${record.FId} totalHours=${record.FRealityTime_Day}`);
    return { exists: true, entityId: record.FId, totalHours: record.FRealityTime_Day, detectedUserId };
  } catch (err) {
    console.error('[econtact] getWorkHoursForDate error:', err.message);
    return { exists: false };
  }
}

// ── Delete existing work hours entity for a date ──────
async function deleteWorkHoursEntity(jar, entityId) {
  const res = await qsPost('Ecp.TimeReport.delete.data', { entityIds: [entityId] }, jar);
  console.log(`[econtact] deleteWorkHoursEntity ${entityId} → raw=${res.raw.substring(0, 100)}`);
}

// ── Submit work hours (batch) ─────────────────────────
// items: [{ taskId, taskName, taskDeptId, type, workTime, description }]
// Calls addMainUnitEntity ONCE with the day's total hours,
// then addDetails ONCE with all items — so the daily total is always correct.
async function submitWorkHoursBatch(username, password, date, items, ecUserId = null) {
  try {
    const { jar, userId } = await fullLogin(username, password, ecUserId);

    // 查詢執行者本人的所屬部門（用於工時明細 departmentId）
    // 應記錄「執行人的部門」，而非任務指派部門（FAssignDepartmentId）
    let userDeptId = '';
    try {
      const selfRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
        listId:     DEPUTY_LIST_ID,
        conditions: [{ fieldName: 'FId', value: userId, operator: 'Equal' }],
        pageSize:   1,
      }, jar);
      userDeptId = selfRes.data?.data?.records?.[0]?.FDepartmentId || '';
    } catch (_) {}
    console.log(`[econtact] submitWorkHoursBatch userDeptId=${userDeptId || '-'}`);

    const dateStr    = date;
    const dateISO    = dateStr + 'T12:00:00.000Z';
    const totalHours = items.reduce((s, it) => s + parseFloat(it.workTime), 0);
    const pad        = n => String(Math.floor(n)).padStart(2, '0');

    console.log(`[econtact] submitWorkHoursBatch userId=${userId} date=${dateStr} totalHours=${totalHours} items=${items.length}`);

    // Step 1: delete existing entity for this date (if any) so we replace cleanly
    // Use CurrentUser condition — the userId param is ignored by the API
    const { records: existingRecords } = await fetchTimeReportList(jar);
    const existing = existingRecords.find(r => r.FDate === dateStr);
    if (existing?.FId) {
      await deleteWorkHoursEntity(jar, existing.FId);
    }

    // Step 2: create main time report record with total hours for the day
    const mainRes = await qsPost('Ecp.TimeReport.addMainUnitEntity.data', {
      userId,
      actualWorktime:  String(totalHours),
      actualWorkvalue: '0.0',
      date:            dateISO,
      couldSave:       1,
    }, jar);

    console.log(`[econtact] addMainUnitEntity → state=${mainRes.data?.state} _failed=${mainRes.data?._failed} raw=${mainRes.raw.substring(0, 200)}`);

    if (mainRes.data?.state === 'bad' || mainRes.data?._failed) {
      return { success: false, message: mainRes.data.message || '建立工時記錄失敗（日期可能超出範圍）' };
    }

    const entityId = mainRes.data?.entityIds?.[0] || mainRes.data?.entityId || mainRes.data?.id;
    if (!entityId) {
      return { success: false, message: '無法取得工時記錄 ID：' + mainRes.raw.substring(0, 200) };
    }

    // Step 2: build detail arrays — consecutive time slots starting at 09:00
    let startH = 9;
    const jsonData   = [];
    const allDetails = [];

    for (const it of items) {
      const hours  = parseFloat(it.workTime);
      const endH   = startH + hours;
      const startDT = `${dateStr} ${pad(startH)}:00:00`;
      const endDT   = `${dateStr} ${pad(endH)}:00:00`;
      const fname   = it.taskName ? `${it.taskName}:${it.type}` : it.type;

      jsonData.push({
        taskId:          it.taskId,
        type:            it.type,
        workTime:        String(hours),
        progress:        '0',
        outputValue:     '0.00',
        WorkDescription: it.description || '',
        fname,
        fdatetime:       startDT,
        fenddatetime:    endDT,
        userId,
        departmentId:    userDeptId,  // 執行者所屬部門
      });

      allDetails.push({
        trpDetail:   '',
        taskId:      it.taskId,
        type:        it.type,
        workHours:   String(hours),
        progress:    '0',
        outputValue: '0.00',
        description: it.description || '',
        fname,
        userId,
        date:        dateISO,
      });

      startH = endH;
    }

    // Step 3: submit all details in one call
    const detailRes = await qsPost('Ecp.TimeReport.addDetails.data', {
      entityId,
      jsonData,
      allDetails,
    }, jar);

    console.log(`[econtact] addDetails(${items.length}) → _failed=${detailRes.data?._failed} raw=${detailRes.raw.substring(0, 200)}`);

    if (detailRes.data?._failed) {
      return { success: false, message: detailRes.data.message || '新增工時明細失敗' };
    }

    return { success: true, message: `工時已記錄（共 ${totalHours} 小時，${items.length} 筆明細）` };
  } catch (err) {
    console.error('[econtact] submitWorkHoursBatch error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ── Get work hours for last N days ────────────────────
// Returns array (most recent first): [{ date:'YYYY-MM-DD', hours:Number, filled:Boolean }]
// Uses Taiwan time (UTC+8) for "today" calculation.
function taiwanDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

async function getWorkHoursLast7Days(username, password, ecUserId = null) {
  try {
    const { jar } = await qsLogin(username, password);
    const { records, detectedUserId } = await fetchTimeReportList(jar);

    // Build date→hours map from fetched records (session-scoped to current user)
    const dateMap = {};
    for (const r of records) {
      if (r.FDate) dateMap[r.FDate] = parseFloat(r.FRealityTime_Day) || 0;
    }

    // Generate last 7 days in Taiwan time, most recent first
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = taiwanDateStr(i);
      days.push({
        date:   dateStr,
        hours:  dateMap[dateStr] || 0,
        filled: !!dateMap[dateStr],
      });
    }

    console.log(`[econtact] getWorkHoursLast7Days: ${days.filter(d => d.filled).length}/7 filled, detectedUserId=${detectedUserId || '-'}`);
    return { days, detectedUserId };
  } catch (err) {
    console.error('[econtact] getWorkHoursLast7Days error:', err.message);
    return { days: [], detectedUserId: null };
  }
}

// ── Check-in QSVD constants ──────────────────────────
const CHECKIN_LIST_ID   = '7573f36d-4cb0-4828-90e5-f4073d456bfd';
const CHECKIN_SCHEMA_ID = 'e981de70-7d32-4464-a9b3-27004e7ecf47';

// ── Get punch records from e-Contact ──────────────────
// Returns [{ punchType:'clock_in'|'clock_out', punchTime:'YYYY-MM-DD HH:mm'(UTC), status }]
// FExType: '上班'=clock_in / '下班'=clock_out
// FPreOrReCheckInDate: 'YYYY-MM-DD HH:mm' in UTC
async function getCheckInRecords(username, password, ecUserId = null, limit = 20) {
  try {
    const { jar } = await fullLogin(username, password, ecUserId);
    const pageSize = Math.min(limit, 50);

    const r = await post('/ecp/qsvd-list/Ecp.CheckIn.getListData.data', {
      listId:   CHECKIN_LIST_ID,
      schemaId: CHECKIN_SCHEMA_ID,
      keyword:  '',
      start:    0,
      limit:    pageSize,
    }, jar);

    const records = r.data?.data?.records || [];
    console.log(`[econtact] getCheckInRecords: ${records.length} records`);

    return records.slice(0, limit).map(rec => {
      // 一般打卡：FExType = '上班' | '下班'
      // 補打卡（FCheckinType='5'）：FExType 為空，改用 F_CheckIncategory$（'上班'/'下班'）或 FPreOrReCheckInType（'1'=上班/'2'=下班）
      const isIn = rec.FExType === '上班'
                || rec['F_CheckIncategory$'] === '上班'
                || rec.FPreOrReCheckInType === '1';
      return {
        punchType: isIn ? 'clock_in' : 'clock_out',
        punchTime: rec.FPreOrReCheckInDate || '',  // 'YYYY-MM-DD HH:mm' 台北時間
        status:    rec.FStatus$ || rec.FStatus || '',
      };
    });
  } catch (err) {
    console.error('[econtact] getCheckInRecords error:', err.message);
    return [];
  }
}

// ── Submit work hours (single, kept for compatibility) ─
// data: { date, workTime, taskId, taskName, taskDeptId, type, description }
async function submitWorkHours(username, password, data, ecUserId = null) {
  try {
    const { jar, userId } = await fullLogin(username, password, ecUserId);

    // 查詢執行者本人的所屬部門（用於工時明細 departmentId）
    let userDeptId = '';
    try {
      const selfRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
        listId:     DEPUTY_LIST_ID,
        conditions: [{ fieldName: 'FId', value: userId, operator: 'Equal' }],
        pageSize:   1,
      }, jar);
      userDeptId = selfRes.data?.data?.records?.[0]?.FDepartmentId || '';
    } catch (_) {}

    const dateStr  = data.date;                               // 'YYYY-MM-DD'
    // Use noon UTC so the date is unambiguous regardless of server timezone parsing.
    // T00:00:00+08:00 would become T16:00:00Z (previous day in UTC) and get mis-recorded.
    const dateISO  = dateStr + 'T12:00:00.000Z';
    const startH   = 9;  // fixed 09:00; no longer user-configurable
    const hours    = parseFloat(data.workTime);
    const endH     = startH + hours;
    const pad      = n => String(Math.floor(n)).padStart(2, '0');
    const startDT  = `${dateStr} ${pad(startH)}:00:00`;
    const endDT    = `${dateStr} ${pad(endH)}:00:00`;
    const fname    = data.taskName ? `${data.taskName}:${data.type}` : data.type;

    console.log(`[econtact] submitWorkHours userId=${userId} date=${dateStr} hours=${hours} taskId=${data.taskId}`);

    // Step 1: create main time report record
    const mainRes = await qsPost('Ecp.TimeReport.addMainUnitEntity.data', {
      userId,
      actualWorktime:  String(hours),
      actualWorkvalue: '0.0',
      date:            dateISO,
      couldSave:       1,   // 1 = save, 0 = validate-only (dry-run)
    }, jar);

    console.log(`[econtact] addMainUnitEntity → state=${mainRes.data?.state} _failed=${mainRes.data?._failed} raw=${mainRes.raw.substring(0, 200)}`);

    if (mainRes.data?.state === 'bad' || mainRes.data?._failed) {
      return { success: false, message: mainRes.data.message || '建立工時記錄失敗（日期可能超出範圍）' };
    }

    const entityId = mainRes.data?.entityIds?.[0] || mainRes.data?.entityId || mainRes.data?.id;
    if (!entityId) {
      return { success: false, message: '無法取得工時記錄 ID：' + mainRes.raw.substring(0, 200) };
    }

    // Step 2: add detail record
    const detail = {
      taskId:          data.taskId,
      type:            data.type,
      workTime:        String(hours),
      progress:        '0',
      outputValue:     '0.00',
      WorkDescription: data.description || '',
      fname,
      fdatetime:       startDT,
      fenddatetime:    endDT,
      userId,
      departmentId:    userDeptId,  // 執行者所屬部門
    };

    const allDetail = {
      trpDetail:   '',
      taskId:      data.taskId,
      type:        data.type,
      workHours:   String(hours),
      progress:    '0',
      outputValue: '0.00',
      description: data.description || '',
      fname,
      userId,
      date:        dateISO,
    };

    const detailRes = await qsPost('Ecp.TimeReport.addDetails.data', {
      entityId,
      jsonData:   [detail],
      allDetails: [allDetail],
    }, jar);

    console.log(`[econtact] addDetails → _failed=${detailRes.data?._failed} raw=${detailRes.raw.substring(0, 200)}`);

    if (detailRes.data?._failed) {
      return { success: false, message: detailRes.data.message || '新增工時明細失敗' };
    }

    return { success: true, message: `工時已記錄（${hours} 小時）` };
  } catch (err) {
    console.error('[econtact] submitWorkHours error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ══════════════════════════════════════════════════════
// 會議室 API
// ══════════════════════════════════════════════════════

const MEETING_ROOM_LIST_ID      = 'dc749022-d79c-43ee-83e0-38a0d91d92ca';
const MEETING_BOOKING_LIST_ID   = 'ba239049-d1d8-4062-b061-2c13a36856f2';
const MEETING_BOOKING_SCHEMA_ID = 'ffffff19-de74-d439-2802-38af463cf204';

// ── 查詢所有會議室 ─────────────────────────────────────
async function getMeetingRooms(username, password) {
  try {
    const { jar } = await fullLogin(username, password);
    const r = await post('/ecp/qsvd-list/OCS.MeetingRoom.getListData.data', {
      listId:    MEETING_ROOM_LIST_ID,
      pageSize:  100,
      keyword:   '',
      isRefresh: true,
    }, jar);
    const records = r.data?.data?.records || [];
    console.log(`[econtact] getMeetingRooms: ${records.length} rooms`);
    return records.map(rec => ({
      id:           rec.FId,
      name:         rec['FMeetingRoomName$'] || rec.FMeetingRoomName || '',
      location:     rec['FMeetingRoomLocation$'] || '',
      floor:        rec['FMeetingRoomFloor$'] || '',
      fullName:     rec.FName || '',
      capacity:     rec.FCapacity || 0,
      devices:      rec.FDevices || '',
      // raw codes needed for booking body
      locationCode: rec.FMeetingRoomLocation || '',
      floorCode:    rec.FMeetingRoomFloor || '',
      roomNumber:   rec.FMeetingRoomName || '',
    }));
  } catch (err) {
    console.error('[econtact] getMeetingRooms error:', err.message);
    return [];
  }
}

// ── 查詢會議室預約紀錄 ──────────────────────────────────
// datePrefix: 'YYYY-MM-DD' or 'YYYY-MM' to filter, null for all
async function getMeetingRoomBookings(username, password, ecUserId = null, datePrefix = null) {
  try {
    const { jar } = await fullLogin(username, password, ecUserId);
    const r = await post('/ecp/qsvd-list/OCS.MeetingRoomApply.getListData.data', {
      listId:   MEETING_BOOKING_LIST_ID,
      schemaId: MEETING_BOOKING_SCHEMA_ID,
      keyword:  '',
      start:    0,
      limit:    100,
    }, jar);
    const records = r.data?.data?.records || [];
    const bookings = records.map(rec => ({
      id:        rec.FId,
      topic:     rec.FTopic || '',
      roomName:  rec['FMeetingRoomName$'] || '',
      location:  rec['FMeetingRoomLocation$'] || '',
      floor:     rec['FMeetingRoomFloor$'] || '',
      fullName:  rec.FName || '',
      startTime: rec.FNormalMeetingStartDateTime || '',  // 'YYYY-MM-DD HH:mm'
      endTime:   rec.FNormalMeetingEndDateTime   || '',
      organizer: rec['FUserId$'] || '',
    }));
    console.log(`[econtact] getMeetingRoomBookings: ${bookings.length} total${datePrefix ? ` (filter: ${datePrefix})` : ''}`);
    if (datePrefix) return bookings.filter(b => b.startTime.startsWith(datePrefix));
    return bookings;
  } catch (err) {
    console.error('[econtact] getMeetingRoomBookings error:', err.message);
    return [];
  }
}

// ── 預約會議室 ─────────────────────────────────────────
// booking: { roomId, roomFullName, locationCode, floorCode, roomNumber,
//            locationName, floorName, roomName, devices,
//            topic, startDateTime, endDateTime, numbers, content }
async function bookMeetingRoom(username, password, ecUserId, displayName, booking) {
  try {
    const { jar } = await fullLogin(username, password, ecUserId);

    const formData = {
      FMeetingRoom:              booking.roomId,
      'FMeetingRoom$':           booking.roomFullName,
      FMeetingRoomLocation:      booking.locationCode,
      FMeetingRoomFloor:         booking.floorCode,
      FMeetingRoomName:          booking.roomNumber,
      'FMeetingRoomLocation$':   booking.locationName,
      'FMeetingRoomFloor$':      booking.floorName,
      'FMeetingRoomName$':       booking.roomName,
      FDevices:                  booking.devices || null,
      FTopic:                    booking.topic,
      FUserId:                   ecUserId || '',
      'FUserId$':                displayName || '',
      FExtNo:                    booking.extNo || '',
      FNumbers:                  String(booking.numbers || 0),
      FContent:                  booking.content || '',
      FApplyType:                '0',
      FNormalMeetingStartDateTime: booking.startDateTime,  // 'YYYY-MM-DD HH:mm'
      FNormalMeetingEndDateTime:   booking.endDateTime,
      // Recurring meeting fields — all null for a normal one-off meeting
      FLoopMeetingStartHour:    null, FLoopMeetingStartMinute: null,
      FLoopMeetingEndHour:      null, FLoopMeetingEndMinute:   null,
      FDayInWeek: null, FMonthType: null, FDayInMonth: null,
      FWeekTypeSection: null, FWeekSection: null,
      FPeriod: null, FRepeatBeginDate: null,
      FRepeatEndType: null, FRepeatCount: null, FRepeatEndDate: null,
      FCreateUserId: null, 'FCreateUserId$': null,
      FCreateDepartmentId: null, 'FCreateDepartmentId$': null,
      FCreateTime: null, FMonthSection: null, FMonthSelect: null,
      FName: booking.roomFullName,
    };

    console.log(`[econtact] bookMeetingRoom: room=${booking.roomFullName} ${booking.startDateTime}～${booking.endDateTime} topic=${booking.topic}`);
    const res = await post('/ecp/OCS.MeetingRoomApply.saveDate.data', { datas: formData }, jar);

    if (res.data?._failed) {
      const code = res.data.code || '';
      let msg = res.data.message || '預約失敗';
      if (code === 'OCS.MeetingRoomApply.MeetingRoomApplyExist') {
        // Extract time range from server message if possible
        const m = msg.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}～\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
        msg = m
          ? `此時段（${m[1]}）已有人預約，請選擇其他時段。`
          : '此時段已有人預約，請選擇其他時段。';
      }
      return { success: false, message: msg, conflict: code === 'OCS.MeetingRoomApply.MeetingRoomApplyExist' };
    }

    return { success: true, message: `✅ 會議室預約成功！` };
  } catch (err) {
    console.error('[econtact] bookMeetingRoom error:', err.message);
    return { success: false, message: `系統操作失敗：${err.message}` };
  }
}

// ── 查詢可用會議室（單一 session：一次抓房間清單 + 一次抓當日預約，全部 in-memory 比對）──
// 以 locationCode + floorCode + roomNumber（原始 code，非 display name）做跨表匹配，避免顯示名稱差異問題
// Returns: { sameSlot: [room,...], nextSlot: { start, end, rooms:[room,...] } | null }
async function findAvailableRooms(username, password, ecUserId, date, startTime, endTime) {
  // Use qsLogin only (skip AIFF token): the AIFF token call narrows the QS session scope
  // and causes Finance-room bookings (created by other departments) to be hidden from QSVD.
  const { jar } = await qsLogin(username, password);

  // ── 1. 取得所有南港會議室 ────────────────────────────
  const roomRes = await post('/ecp/qsvd-list/OCS.MeetingRoom.getListData.data', {
    listId: MEETING_ROOM_LIST_ID, pageSize: 100, keyword: '', isRefresh: true,
  }, jar);
  const allRooms = (roomRes.data?.data?.records || []).map(rec => ({
    id:           rec.FId,
    name:         rec['FMeetingRoomName$'] || '',
    location:     rec['FMeetingRoomLocation$'] || '',
    floor:        rec['FMeetingRoomFloor$'] || '',
    fullName:     rec.FName || '',
    capacity:     rec.FCapacity || 0,
    locationCode: rec.FMeetingRoomLocation || '',   // raw code, e.g. "nanB"
    floorCode:    rec.FMeetingRoomFloor    || '',   // raw code, e.g. "nn9F"
    roomNumber:   rec.FMeetingRoomName     || '',   // raw code, e.g. "9"
  }));
  const rooms = allRooms.filter(r =>
    (r.location || '').includes('南港') || (r.fullName || '').includes('南港')
  );

  // ── 3. 取得目標日期所有預約（queryFormRecent:{} 取消日期視窗限制）──
  const bookRes = await post('/ecp/qsvd-list/OCS.MeetingRoomApply.getListData.data', {
    listId:          MEETING_BOOKING_LIST_ID,
    schemaId:        MEETING_BOOKING_SCHEMA_ID,
    keyword:         '',
    queryFormRecent: {},
    start:           0,
    limit:           500,
  }, jar);
  const dayBookings = (bookRes.data?.data?.records || [])
    .filter(rec => (rec.FNormalMeetingStartDateTime || '').startsWith(date))
    .map(rec => ({
      locationCode: rec.FMeetingRoomLocation || '',
      floorCode:    rec.FMeetingRoomFloor    || '',
      roomCode:     rec.FMeetingRoomName     || '',
      startTime:    rec.FNormalMeetingStartDateTime || '',
      endTime:      rec.FNormalMeetingEndDateTime   || '',
    }));
  // ── 4. 比對函式 ──────────────────────────────────────
  function overlaps(bStart, bEnd, sStart, sEnd) { return bStart < sEnd && bEnd > sStart; }

  function freeAt(slotStart, slotEnd) {
    const s = `${date} ${slotStart}`;
    const e = `${date} ${slotEnd}`;
    return rooms.filter(room => {
      const conflict = dayBookings.find(b =>
        b.locationCode === room.locationCode &&
        b.floorCode    === room.floorCode    &&
        b.roomCode     === room.roomNumber   &&
        overlaps(b.startTime, b.endTime, s, e)
      );
      return !conflict;
    });
  }

  function addMins(hhmm, mins) {
    const [h, m] = hhmm.split(':').map(Number);
    const t = h * 60 + m + mins;
    return `${String(Math.floor(t / 60)).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`;
  }

  // ── 5. 檢查請求時段 ──────────────────────────────────
  const sameSlot = freeAt(startTime, endTime);
  if (sameSlot.length) return { sameSlot, nextSlot: null };

  // ── 6. 往後掃（相同時長，每 30 分鐘一格）────────────
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const dur = (eh * 60 + em) - (sh * 60 + sm);

  let cursor = endTime;
  while (cursor <= '21:30') {
    const slotEnd = addMins(cursor, dur);
    if (slotEnd > '22:00') break;
    const free = freeAt(cursor, slotEnd);
    if (free.length) {
      return { sameSlot: [], nextSlot: { start: cursor, end: slotEnd, rooms: free } };
    }
    cursor = addMins(cursor, 30);
  }

  return { sameSlot: [], nextSlot: null };
}

// ── 查詢餘假（Ecp.LeaveProvided）─────────────────────────
// 回傳欄位：FName$（假別）、FPresetHour（配額h）、FConsumeHour（已用h）、FRemainHour（剩餘h）
// FStartDate / FExpiryDate（效期）、FStatus（Audited = 有效）
const LEAVE_LIST_ID   = 'f7c8f14b-b1ba-4793-bebf-60e0e594dc4a';
const LEAVE_SCHEMA_ID = 'ffffff19-de9d-32a9-3802-38af463cf204';

async function getLeaveBalance(username, password) {
  // 使用 qsLogin（不帶 AIFF token）以取得完整資料範圍
  const { jar } = await qsLogin(username, password);
  const r = await post('/ecp/qsvd-list/Ecp.LeaveProvided.getListData.data', {
    listId:   LEAVE_LIST_ID,
    schemaId: LEAVE_SCHEMA_ID,
    keyword:  '',
  }, jar);
  const records = r.data?.data?.records || [];
  // 只回傳狀態為 Audited（審核通過）的有效假別
  return records
    .filter(rec => rec.FStatus === 'Audited')
    .map(rec => ({
      name:       rec['FName$']  || rec.FNName || rec.FName || '未知假別',
      preset:     rec.FPresetHour  || 0,   // 配額（小時）
      consumed:   rec.FConsumeHour || 0,   // 已用（小時）
      remaining:  rec.FRemainHour  || 0,   // 剩餘（小時）
      startDate:  (rec.FStartDate  || '').slice(0, 10),
      expiryDate: (rec.FExpiryDate || '').slice(0, 10),
    }));
}

// ── Leave type code → display name mapping ────────────────
const LEAVE_TYPE_NAMES = {
  'Personal Leave':         '事假',
  'Sick Leave':             '病假',
  'Inductrial injury Leave':'公傷假',
  'Offical Leave':          '公假',
  'Marriage Leave':         '婚假',
  'Maternity Leave':        '產假',
  'Paternity Leave':        '產檢假',
  'Annual Leave':           '特休',
  'Compensatory Leave':     '補休',
  'Funeral Leave':          '喪假',
  'Family care Leave':      '家庭照顧假',
  'Home Leave':             '返台假',
  'Honor Leave':            '榮譽假',
  'Seized Leave':           '陪產檢及陪產假',
  'Physiological Leave':    '生理假',
  'Birthday Leave':         '生日假',
  '防疫照顧假':              '防疫照顧假',
  '疫苗接種假':              '疫苗接種假',
  '防疫隔離假(公假)':        '防疫隔離假(公假)',
  '防疫隔離假':              '防疫隔離假',
  'zg':                     '志工假',
  '志工假-3小時':            '志工假-3小時',
  '志工假-4小時':            '志工假-4小時',
  '志工假-5小時':            '志工假-5小時',
  '無薪病假':               '無薪病假',
  '有薪病假':               '全薪病假',
  '小一新生入學假':          '小一新生入學假',
};

const DEPUTY_FIELD_ID     = 'df625d98-6143-4327-b519-d14172f1eefd';
const DEPUTY_LIST_ID      = '5be1aa3f-3472-4ccb-8c7f-424d1c913586';
const DEPUTY_RELATION_ID  = '8ced85ec-7850-4b20-b6da-7e18d1e5b437';
const DEPUTY_EDIT_ID      = 'ffd89819-7a61-4676-bfd2-84dcefea1e02';
const LEAVE_AVAIL_LIST_ID = '1389bd7e-f246-455d-9878-6b956b917035';

// ── Get leave application form data ───────────────────────
// Returns { leaveTypes, deputies, deptId, deptName, yearFakeHour }
async function getLeaveFormData(username, password, ecUserId, year) {
  const { jar } = await qsLogin(username, password);

  // Always detect the true TsUser.FId from TimeReport (CurrentUser-scoped).
  // The stored ecUserId from DB may be a stale/wrong AIFF value — don't trust it blindly.
  // fetchTimeReportList uses the JSESSIONID to scope results to the logged-in user only.
  let effectiveUserId = ecUserId || '';
  try {
    const { detectedUserId } = await fetchTimeReportList(jar);
    if (detectedUserId) {
      if (detectedUserId !== ecUserId) {
        console.log(`[econtact] getLeaveFormData: correcting userId ${ecUserId || '-'} → ${detectedUserId} for ${username}`);
      }
      effectiveUserId = detectedUserId;
    }
  } catch (_) {}
  // Fallback: detect from task list if TimeReport returned no records
  if (!effectiveUserId) {
    try {
      const { detectedUserId } = await fetchTaskList(jar, null, null);
      if (detectedUserId) effectiveUserId = detectedUserId;
    } catch (_) {}
  }

  // 1. Get enabled leave type codes for this year/user
  const leaveItemsRes = await qsPost('Ecp.LeavePermit.getLeaveItems.data', {
    year, userId: effectiveUserId,
  }, jar);
  const enableCodes = leaveItemsRes.data?.enableDicItems?.[0] || [];

  // 2. Get current leave balance records (for remaining hours and Chinese names)
  const leaveBalRes = await post('/ecp/qsvd-list/Ecp.LeaveProvided.getListData.data', {
    listId: LEAVE_LIST_ID, schemaId: LEAVE_SCHEMA_ID, keyword: '',
  }, jar);
  const balRecords = (leaveBalRes.data?.data?.records || []).filter(r => r.FStatus === 'Audited');

  // Build code → {name, remaining} map (merge multiple entries for same code)
  const nameMap = {};
  for (const r of balRecords) {
    const code = r.FName || '';
    const name = r.FNName || r['FName$'] || LEAVE_TYPE_NAMES[code] || code;
    if (!nameMap[code]) {
      nameMap[code] = { name, remaining: Number(r.FRemainHour) || 0 };
    } else {
      nameMap[code].remaining += Number(r.FRemainHour) || 0;
    }
  }

  // Combine with enableCodes (preserve order), only include types with balance > 0
  const leaveTypes = enableCodes
    .map(code => ({
      code,
      name:      nameMap[code]?.name || LEAVE_TYPE_NAMES[code] || code,
      remaining: nameMap[code]?.remaining ?? 0,
    }))
    .filter(lt => lt.remaining > 0);

  // 3. Get current user's own record to extract their FDepartmentId.
  //    The entity-box list excludes the current user (can't be own deputy), so
  //    we use a plain conditions query filtered by FId.
  let deptId   = '';
  let deptName = '';
  if (effectiveUserId) {
    try {
      const selfRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
        listId:     DEPUTY_LIST_ID,
        conditions: [{ fieldName: 'FId', value: effectiveUserId, operator: 'Equal' }],
        pageSize:   1,
      }, jar);
      const selfRecord = selfRes.data?.data?.records?.[0];
      deptId   = selfRecord?.FDepartmentId      || '';
      deptName = selfRecord?.['FDepartmentId$'] || '';
    } catch (e) { console.log('[econtact] self-lookup error:', e.message); }
  }

  // 4. Build deputy list: current dept + child depts (one level).
  //    Qs.Department.getListData.data supports conditions without listId.
  let deputies = [];
  if (deptId) {
    // Get child departments (FParentId = deptId)
    const relatedDeptIds = [deptId];
    try {
      const childRes = await post('/ecp/Qs.Department.getListData.data', {
        conditions: [{ fieldName: 'FParentId', value: deptId, operator: 'Equal' }],
        pageSize:   50,
      }, jar);
      const childDepts = childRes.data?.data?.records || [];
      for (const d of childDepts) {
        if (d.FId) relatedDeptIds.push(d.FId);
      }
      console.log(`[econtact] deputy depts: [${relatedDeptIds.map((id,i) => (i===0?deptName:childDepts.find(d=>d.FId===id)?.FName)||id).join(', ')}]`);
    } catch (e) { console.log('[econtact] child dept query error:', e.message); }

    // Fetch users from each related dept
    // Collect all records first, then deduplicate:
    // same person may appear as both "王育文" and "王育文 (高級系統分析師)" with different FIds.
    // Keep the record with a role title (longer FName) when base names collide.
    const allCandidates = [];
    const seenIds = new Set([effectiveUserId]);
    for (const targetDeptId of relatedDeptIds) {
      try {
        const usersRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
          listId:     DEPUTY_LIST_ID,
          conditions: [
            { fieldName: 'FDepartmentId', value: targetDeptId, operator: 'Equal' },
            { fieldName: 'FEnabled',      value: true,          operator: 'Equal' },
          ],
          pageSize:   100,
        }, jar);
        for (const u of (usersRes.data?.data?.records || [])) {
          if (!seenIds.has(u.FId)) {
            seenIds.add(u.FId);
            allCandidates.push(u);
          }
        }
      } catch (e) { console.log('[econtact] users for dept', targetDeptId, 'error:', e.message); }
    }
    // Deduplicate by base name (part before " ("), prefer record with role title
    const byBaseName = new Map();
    for (const u of allCandidates) {
      const base = u.FName.split(' (')[0].trim();
      const existing = byBaseName.get(base);
      if (!existing || u.FName.length > existing.FName.length) {
        byBaseName.set(base, u);
      }
    }
    deputies = [...byBaseName.values()].map(u => ({ text: u.FName, value: u.FId }));
  }
  // Fallback: if no results, use entity-box list (cross-org deputies)
  if (!deputies.length) {
    try {
      const ebRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
        listId:           DEPUTY_LIST_ID,
        relationId:       DEPUTY_RELATION_ID,
        editId:           DEPUTY_EDIT_ID,
        entityBoxFieldId: DEPUTY_FIELD_ID,
        forms:            { form: { FUserId: effectiveUserId } },
        pageSize:         200,
        keyword:          '',
        isRefresh:        true,
      }, jar);
      const allUsers = ebRes.data?.data?.records || [];
      deputies = allUsers
        .filter(u => u.FId !== effectiveUserId)
        .map(u => ({ text: u.FName, value: u.FId }));
    } catch (_) {}
  }
  // Final fallback: dropdown API
  if (!deputies.length) {
    try {
      const depRes = await qsPost('Qs.QuerySchema.getEntityBoxDropdownListData.data', {
        isQueryDropdown: true,
        fieldId: DEPUTY_FIELD_ID,
        forms: { form: { FUserId: effectiveUserId } },
      }, jar);
      deputies = depRes.data?.data || [];
    } catch (_) {}
  }

  // 5. Year fake-hour (annual remaining — included in save payload)
  let yearFakeHour = 0;
  try {
    const yfRes = await qsPost('Ecp.LeavePermit.getYearFakeHour.data', { userId: effectiveUserId, year }, jar);
    yearFakeHour = yfRes.data?.fakeHour ?? 0;
  } catch (_) {}

  console.log(`[econtact] getLeaveFormData: ${leaveTypes.length} types, ${deputies.length} deputies, dept=${deptId || '-'}, userId=${effectiveUserId || '-'}`);
  return { leaveTypes, deputies, deptId, deptName, yearFakeHour, detectedUserId: effectiveUserId };
}

// ── Get available leave records for a date range ──────────
// Uses conditions-filtered QSVD: remaining>0, audited, valid for the range
async function getAvailableLeaveRecords(username, password, startDate, endDate) {
  const { jar } = await qsLogin(username, password);
  const r = await post('/ecp/qsvd-list/Ecp.LeaveProvided.getListData.data', {
    conditions: [
      { fieldName: 'FRemainHour', value: '0.0',                operator: 'Great'       },
      { fieldName: 'FStatus',     value: 'Audited',            operator: 'Equal'       },
      { fieldName: 'FUserId',     value: '',                   operator: 'CurrentUser' },
      { fieldName: 'FExpiryDate', value: `${endDate} 23:59`,   operator: 'GreatEqual'  },
      { fieldName: 'FStartDate',  value: `${startDate} 00:00`, operator: 'LessEqual'   },
    ],
    listId:   LEAVE_AVAIL_LIST_ID,
    pageSize: 50,
  }, jar);
  const records = r.data?.data?.records || [];
  console.log(`[econtact] getAvailableLeaveRecords [${startDate}~${endDate}]: ${records.length} records`);
  return records.map(rec => ({
    id:         rec.FId,
    code:       rec.FName || '',
    name:       rec.FNName || rec['FName$'] || LEAVE_TYPE_NAMES[rec.FName] || rec.FName || '',
    remaining:  Number(rec.FRemainHour)  || 0,
    startDate:  (rec.FStartDate  || '').slice(0, 16),
    expiryDate: (rec.FExpiryDate || '').slice(0, 16),
  }));
}

// ── Submit leave application ───────────────────────────────
// slaveEntities: [{ FLeaveProvidedId, 'FLeaveProvidedId$', FStartDate, FExpiryDate, FRemainHour, FDeductHour, FIndex }]
async function submitLeaveApplication(username, password, ecUserId, displayName, {
  leaveType, startDateTime, endDateTime, totalHour,
  deputyId, deputyName,
  deptId, deptName,
  reason, yearFakeHour, slaveEntities,
}) {
  const { jar }  = await qsLogin(username, password);

  // Fetch the Chinese display name from e-Contact (DB display_name may be the login username)
  let ecName = displayName;
  if (ecUserId) {
    try {
      const selfRes = await post('/ecp/qsvd-list/Qs.User.getListData.data', {
        listId:     DEPUTY_LIST_ID,
        conditions: [{ fieldName: 'FId', value: ecUserId, operator: 'Equal' }],
        pageSize:   1,
      }, jar);
      const fn = selfRes.data?.data?.records?.[0]?.FName;
      if (fn) ecName = fn;
    } catch (_) {}
  }

  const nowTW    = new Date(Date.now() + 8 * 3600 * 1000);
  const nowStr   = nowTW.toISOString().slice(0, 16).replace('T', ' ');
  const year     = startDateTime.slice(0, 4);
  const hoursStr = parseFloat(totalHour).toFixed(1);

  const payload = {
    FSerialNo:         null,
    FYear:             year,
    F_FillDate:        nowStr,
    F_FillerId:        ecUserId,
    'F_FillerId$':     ecName,
    FUserId:           ecUserId,
    'FUserId$':        ecName,
    FDepartmentId:     deptId   || null,
    'FDepartmentId$':  deptName || null,
    FStatus:           'New',
    FReason:           reason || '',
    FLeaveType2:       leaveType,
    F_Unit:            '0.5',
    FRemainHour:       null,
    F_RelationType:    null,
    FStartDate:        startDateTime,
    FEndDate:          endDateTime,
    FTotalHour:        hoursStr,
    FDeputyUserId:     deputyId,
    'FDeputyUserId$':  deputyName,
    FCancelReason:     null,
    FMark:             '0',
    FEditId:           'ca46a8d7-7958-4527-9811-4b045186b852',
    'FStatus$':        '新增',
    FLeaveUserDuty:    ecName,
    'FLeaveUserDuty$': ecName,
    FTYNotUsedHour:    Number(yearFakeHour) || 0,
    F_Name:            `${ecName}，請假${hoursStr}小時，${startDateTime}~${endDateTime}`,
    slaveUnitId:       'd6003e39-64ba-4350-ae1b-3a3f363d316f',
    slaveRelationId:   'bd4cd66e-5531-4e70-90de-3856bd8d393f',
    slaveEntities,
    $FAvatarId:        null,
  };

  console.log(`[econtact] submitLeaveApplication: ${leaveType} ${startDateTime}~${endDateTime} ${hoursStr}h deputies=${deputyId}`);
  const res = await qsPost('Ecp.LeavePermit.save.data', { data: [payload] }, jar);

  if (res.data?._failed) {
    return { success: false, message: res.data.message || res.data._msg || '請假申請失敗' };
  }
  if (!res.data?.entityIds?.length) {
    return { success: false, message: '請假申請失敗：' + (typeof res.raw === 'string' ? res.raw.substring(0, 200) : '未知錯誤') };
  }
  console.log(`[econtact] submitLeaveApplication OK → entityId=${res.data.entityIds[0]}`);
  return { success: true, message: '請假申請已送出，待主管審核', entityId: res.data.entityIds[0] };
}

// ── TimeReportDetail QSVD listId ─────────────────────────
const TIMEREPORT_DETAIL_LIST_ID = '158470cc-fcf0-0448-0d70-c65444558360';

// ── Get work hours detail for a specific date ─────────────
// Uses QSVD + CurrentUser operator to scope to the logged-in user only.
// The plain getListData endpoint returns all users' records for the date;
// only the QSVD approach with CurrentUser correctly filters to the session user.
// Returns: [{ id, taskId, taskName, type, hours, description }]
async function getWorkHoursDetail(username, password, date) {
  try {
    const { jar } = await qsLogin(username, password);
    const r = await post('/ecp/qsvd-list/Ecp.TimeReportDetail.getListData.data', {
      listId:     TIMEREPORT_DETAIL_LIST_ID,
      conditions: [
        { fieldName: 'FDate',   value: date, operator: 'Equal' },
        { fieldName: 'FUserId', value: '',   operator: 'CurrentUser' },
      ],
      start: 0, limit: 50,
    }, jar);
    const records = r.data?.data?.records || [];
    console.log(`[econtact] getWorkHoursDetail ${date}: ${records.length} records`);
    return records.map(rec => ({
      id:          rec.FId          || '',
      taskId:      rec.FTaskId      || '',
      taskName:    rec['FTaskId$']  || '',
      type:        rec.FType        || '',
      hours:       Number(rec.FWorkTime) || 0,
      description: rec.FWorkDescription || '',
    }));
  } catch (err) {
    console.error('[econtact] getWorkHoursDetail error:', err.message);
    return [];
  }
}

// ── Get leave history (last N days) ───────────────────────
// Returns array of leave records sorted by startDate descending.
const LEAVE_PERMIT_LIST_ID   = '8555dfc0-b914-41c8-bbf4-7bfe26071e1b';
const LEAVE_PERMIT_SCHEMA_ID = '896068db-971c-4617-8a5c-438d4c6ed8ed';

async function getLeaveHistory(username, password, limit = 5) {
  try {
    const { jar } = await qsLogin(username, password);

    const r = await post('/ecp/qsvd-list/Ecp.LeavePermit.getListData.data', {
      listId:   LEAVE_PERMIT_LIST_ID,
      schemaId: LEAVE_PERMIT_SCHEMA_ID,
      conditions: [],
      pageSize:  limit,
      keyword:  '',
    }, jar);

    const records = r.data?.data?.records || [];
    console.log(`[econtact] getLeaveHistory: ${records.length} records (limit=${limit})`);

    return records.map(rec => ({
      id:        rec.FId,
      serialNo:  rec.FSerialNo   || '',
      leaveType: rec['FLeaveType2$'] || LEAVE_TYPE_NAMES[rec.FLeaveType2] || rec.FLeaveType2 || '',
      startDate: rec.FStartDate  || '',
      endDate:   rec.FEndDate    || '',
      totalHour: Number(rec.FTotalHour) || 0,
      status:    rec['FStatus$'] || rec.FStatus || '',
    }));
  } catch (err) {
    console.error('[econtact] getLeaveHistory error:', err.message);
    return [];
  }
}

// ── 補打卡（Ecp.CheckIn.newCheckInForManual）──────────────
// type: 'clock_in' | 'clock_out'
// date: 'YYYY-MM-DD', time: 'HH:mm', displayName: 使用者中文姓名
async function makeupPunch(username, password, { type, date, time, displayName }) {
  const isClockIn       = type === 'clock_in';
  const preOrReCheckType = isClockIn ? '1' : '2';
  const punchLabel      = isClockIn ? '預補上班卡' : '預補下班卡';
  const memo            = isClockIn ? '補打上班卡' : '補打下班卡';
  const preOrReCheckDate = `${date} ${time}`;                         // "YYYY-MM-DD HH:mm"
  const name            = `${displayName}的[${punchLabel}], 預補的打卡日期為：${preOrReCheckDate}`;

  const { jar } = await qsLogin(username, password);
  const r = await post('/ecp/Ecp.CheckIn.newCheckInForManual.data', {
    name,
    checkType:          '5',
    memo,
    confirmRst:         { isConfirmed: true, confirmValue: null },
    endOverTime:        null,
    startOverTime:      null,
    overTimeReq:        null,
    preOrReCheckType,
    preOrReCheckDate,
    preOrReCheckOverType: null,
  }, jar);

  if (r.data?._failed) {
    return { success: false, message: r.data._msg || '補打卡申請失敗' };
  }
  if (!r.data?.entityId) {
    return { success: false, message: '補打卡失敗：' + (typeof r.raw === 'string' ? r.raw.substring(0, 120) : '未知錯誤') };
  }
  console.log(`[econtact] makeupPunch ${punchLabel}: ${preOrReCheckDate} → entityId=${r.data.entityId}`);
  return { success: true, message: `${punchLabel}申請已送出，待主管審核`, entityId: r.data.entityId };
}

module.exports = {
  punch, testLogin, getWorkHoursFormData, getWorkHoursForDate, getWorkHoursDetail,
  submitWorkHours, submitWorkHoursBatch, resolveEmployeeId,
  getCheckInRecords, getWorkHoursLast7Days,
  getMeetingRooms, getMeetingRoomBookings, bookMeetingRoom, findAvailableRooms,
  getLeaveBalance, makeupPunch,
  getLeaveFormData, getAvailableLeaveRecords, submitLeaveApplication,
  getLeaveHistory,
  getMyOpenTasks, closeTask, submitProlongTask,
};
