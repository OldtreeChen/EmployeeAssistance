# LINE 打卡系統 — Claude 工作指引

## 專案簡介
LINE Bot 打卡 + 工時填寫系統，串接 e-Contact (econtact.ai3.cloud) REST API。

## 伺服器資訊
| 項目 | 值 |
|------|-----|
| EC2 IP | 192.168.20.151（需 VPN） |
| SSH 使用者 | ec2-user |
| SSH 金鑰 | `C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key` |
| App 容器名稱 | `line-punch-app` |
| DB 容器名稱 | `line-punch-db` |

## 部署指令（已授權，無需每次詢問確認）

### 部署單一檔案
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
$EC2 = "ec2-user@192.168.20.151"
$SRC = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\lib\econtact.js"  # 換成目標檔案

scp -i $KEY -o StrictHostKeyChecking=no $SRC "${EC2}:/tmp/deploy_file"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker cp /tmp/deploy_file line-punch-app:/app/lib/econtact.js"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker restart line-punch-app"
```

### 部署多檔案（lib/ 下所有 .js）
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
$EC2 = "ec2-user@192.168.20.151"
$BASE = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system"

foreach ($f in @("lib/econtact.js","lib/handler.js","lib/db.js","server.js")) {
    $leaf = Split-Path $f -Leaf
    scp -i $KEY -o StrictHostKeyChecking=no "$BASE\$f" "${EC2}:/tmp/$leaf"
    ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker cp /tmp/$leaf line-punch-app:/app/$f"
}
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker restart line-punch-app"
```

### 部署 public/ 靜態頁面
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
$EC2 = "ec2-user@192.168.20.151"
scp -i $KEY -o StrictHostKeyChecking=no "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\public\index.html" "${EC2}:/tmp/index.html"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker cp /tmp/index.html line-punch-app:/app/public/index.html"
# 靜態頁面不需要重啟
```

### 查看 container log
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
ssh -i $KEY -o StrictHostKeyChecking=no ec2-user@192.168.20.151 "sudo docker logs line-punch-app --tail 50"
```

### 進入 container shell
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
ssh -i $KEY -o StrictHostKeyChecking=no ec2-user@192.168.20.151 "sudo docker exec -it line-punch-app sh"
```

### 執行 probe / 診斷腳本
```powershell
$KEY = "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\ai3-root-6626-master-key"
$EC2 = "ec2-user@192.168.20.151"
scp -i $KEY -o StrictHostKeyChecking=no "C:\Claude\EmployeeAssistance\員工助理\line-punch-system\scripts\probe-tsuser.js" "${EC2}:/tmp/probe-tsuser.js"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker cp /tmp/probe-tsuser.js line-punch-app:/app/scripts/probe-tsuser.js && sudo docker exec line-punch-app node scripts/probe-tsuser.js"
```

## 專案結構
```
line-punch-system/
├── server.js           # Express + LINE webhook + REST API
├── lib/
│   ├── econtact.js     # e-Contact API（登入、打卡、工時）← 核心
│   ├── handler.js      # LINE 事件處理
│   ├── db.js           # MySQL 連線
│   └── crypto.js       # AES-256-CBC 加解密
├── public/
│   └── index.html      # LIFF 工時填寫表單
└── scripts/            # 診斷用一次性腳本（不進容器）
```

## e-Contact API 重點
- QS DataServlet: `POST /ecp/Qs.Xxx.Method.data` — 失敗時 `_failed: true`
- OpenAPI: `POST /ecp/openapi/...` — 失敗時 `_header_.success: false`
- 認證流程: `Qs.OnlineUser.login.data` → JSESSIONID → `/openapi/aile/token/apply` → tokenId
- userId 來源優先順序（fullLogin）：DB 存的 `employee_id` > QS login response > TsUser lookup > AIFF token（AIFF 會對所有人回傳同一個錯誤 userId，不可信）

### ⚠️ 已知 AIFF 問題
- **所有使用者的 AIFF token employee 都會回傳同一個 userId（aven.chen 的 bbc79376-...）**，這是系統設定錯誤，永遠不要依賴 AIFF 的 `employee.id` 作為最終 userId。

### 任務清單查詢（QSVD）— 必讀
任務清單**必須**用 QSVD 端點 + 正確的 `listId`/`schemaId`，否則會回傳所有人或部門的任務：

```
POST /ecp/qsvd-list/Ecp.Task.getListData.data
{
  "listId":   "296aa935-f6c0-4a8e-9ab9-32254ea39861",
  "schemaId": "b158be99-606a-4dc9-aa7f-53f50b16059a",
  "keyword": "",
  "queryFormRecent": {},
  "start": 0,
  "limit": 50
}
```

- 這組 listId/schemaId 是從真實瀏覽器 network 擷取，會透過 QS JSESSIONID 自動限縮為「當前登入者的任務」。
- **不需要也不應該**在 body 加 `userId` / `FUserId` 等 filter — 加了反而會回傳 0 筆。
- 回傳結果在 `data.data.records[]`。
- 第一筆 active task 的 `FUserId` 就是該使用者正確的 TsUser.FId，可直接存入 `users.employee_id`。

### userId 自動偵測與持久化
- `getWorkHoursFormData()` 呼叫後，`detectedUserId` = tasks[0].FUserId（最可靠）。
- `server.js` 的 `/api/econtact/form-data` 路由收到後，若 `detectedUserId !== user.employee_id` 就自動 UPDATE DB，確保下次提交時 userId 正確。

### 工時提交（submitWorkHours）— 關鍵細節
```
Step 1: POST /ecp/Ecp.TimeReport.addMainUnitEntity.data
  { userId, actualWorktime, actualWorkvalue:"0.0", date, couldSave: 1 }
  ⚠️ couldSave=0 是 dry-run（永遠回 state=bad），必須用 couldSave=1 才真正寫入
  回傳: { state:"ok", entityIds:["..."] }

Step 2: POST /ecp/Ecp.TimeReport.addDetails.data
  { entityId, jsonData:[detail], allDetails:[allDetail] }
  回傳: { state:"ok" }
```

### ⚠️ 日期時區陷阱
```javascript
// ❌ 錯誤：+08:00 轉 UTC 會跨日（4/23 00:00 +08:00 = 4/22 16:00 UTC）
const dateISO = new Date(dateStr + 'T00:00:00+08:00').toISOString();

// ✅ 正確：用正午 UTC，所有時區都落在同一天
const dateISO = dateStr + 'T12:00:00.000Z';
```

### 任務狀態白名單（active statuses）
```javascript
const ACTIVE_STATUSES = new Set([
  'Assigned', 'Executing', 'Auditing', 'Back',
  'AutoUpgrade', 'Prolong', 'Overdue', 'OverdueUpgrade', 'OverdueDelay',
]);
```

## 資料庫
- Host: `db`（Docker 內部）/ `192.168.20.151:3306`（VPN，可能未開放）
- User: `punchuser` / Password: `Punch@2026!`
- DB: `line_punch_system`
- 密碼加密: AES-256-CBC，金鑰在 `.env` 的 `ENCRYPT_KEY`
- `users.employee_id` — 儲存 TsUser.FId，由 QSVD 任務自動偵測並更新，工時提交必須用此值

## LINE / LIFF
- LIFF ID: `1656637613-zuZyrobC`
- Webhook: `POST /webhook`
- 工時表單資料: `GET /api/econtact/form-data?lineUserId=xxx`
- 工時提交: `POST /api/econtact/work-hours`

## Rich Menu
- 圖片尺寸: 2500×1686 px（JPEG，< 1MB）
- 版面: Banner 區（y=0~474）不放入 `areas` → 點擊無反應；6 個按鈕格（2列×3欄）從 y=474 起
- 設定腳本: `scripts/setup-rich-menu.js`
- 圖片路徑: `scripts/rich-menu.jpg`（或 .png）
