'use strict';
/**
 * Rich Menu 建立腳本
 * 執行方式：node scripts/setup-rich-menu.js
 *
 * 執行前請確認：
 *  1. .env 已填入 LINE_CHANNEL_ACCESS_TOKEN
 *  2. rich-menu.png 已放在 scripts/ 目錄下
 *     （可用本專案提供的 rich-menu.svg 轉換，或使用任何 2500x1686 px 圖片）
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ 請先設定 LINE_CHANNEL_ACCESS_TOKEN'); process.exit(1); }

// ── Helper：呼叫 LINE API ──────────────────────────────
function lineAPI(method, endpoint, body, isJSON = true) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.line.me',
      path:     endpoint,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(isJSON && body ? { 'Content-Type': 'application/json' } : {}),
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);

    if (body) {
      if (isJSON) req.write(JSON.stringify(body));
      else        req.write(body);
    }
    req.end();
  });
}

// ── 圖片版面說明 ──────────────────────────────────────────
// 圖片尺寸：2500 × 1686 px（LINE 標準大尺寸）
//
//  ┌─────────────────────────────────────────────────────┐
//  │  Banner: "Hi! 我是你的智能助理"  y=0  h=474  (無動作) │
//  ├─────────────────┬─────────────────┬─────────────────┤
//  │  上班打卡        │  下班打卡        │  打卡紀錄        │  y=474 h=606
//  ├─────────────────┼─────────────────┼─────────────────┤
//  │  填寫工時        │  常用選單        │  使用說明        │  y=1080 h=606
//  └─────────────────┴─────────────────┴─────────────────┘
//       x=0 w=833       x=833 w=834     x=1667 w=833
//
// Banner 區域「不放入 areas」→ 點擊無反應（LINE 只對有定義 area 的區域有反應）

// ── Rich Menu 定義（Banner 不可點選 + 2 列 × 3 欄，共 6 格）──
const IMG_W         = 2500;
const IMG_H         = 1686;
const BANNER_HEIGHT = 474;   // Banner 佔高（不含此區域 = 不可點擊）
const ROW_HEIGHT    = 606;   // 每列按鈕高度  (474 + 606 + 606 = 1686)
const COL_WIDTHS    = [833, 834, 833];  // 三欄寬度（合計 2500）

function col(i) { return COL_WIDTHS.slice(0, i).reduce((s, w) => s + w, 0); }

const richMenuBody = {
  size:     { width: IMG_W, height: IMG_H },
  selected: true,
  name:     '智能助理選單',
  chatBarText: '📋 打卡選單',
  areas: [
    // ── 第一列（y = BANNER_HEIGHT）───────────────────────
    // 上班打卡（左）
    {
      bounds: { x: col(0), y: BANNER_HEIGHT, width: COL_WIDTHS[0], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=clock_in',  displayText: '上班打卡' }
    },
    // 下班打卡（中）
    {
      bounds: { x: col(1), y: BANNER_HEIGHT, width: COL_WIDTHS[1], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=clock_out', displayText: '下班打卡' }
    },
    // 打卡紀錄（右）
    {
      bounds: { x: col(2), y: BANNER_HEIGHT, width: COL_WIDTHS[2], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=my_record', displayText: '打卡紀錄' }
    },
    // ── 第二列（y = BANNER_HEIGHT + ROW_HEIGHT）──────────
    // 填寫工時（左）
    {
      bounds: { x: col(0), y: BANNER_HEIGHT + ROW_HEIGHT, width: COL_WIDTHS[0], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=work_hours', displayText: '填寫工時' }
    },
    // 常用選單（中）
    {
      bounds: { x: col(1), y: BANNER_HEIGHT + ROW_HEIGHT, width: COL_WIDTHS[1], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=quick_menu', displayText: '常用選單' }
    },
    // 使用說明（右）
    {
      bounds: { x: col(2), y: BANNER_HEIGHT + ROW_HEIGHT, width: COL_WIDTHS[2], height: ROW_HEIGHT },
      action: { type: 'postback', data: 'action=help', displayText: '使用說明' }
    }
  ]
};

async function main() {
  console.log('🔧 開始建立 Rich Menu...\n');

  // 1. 刪除舊的 Rich Menu
  console.log('1️⃣  清除舊 Rich Menu...');
  const listRes = await lineAPI('GET', '/v2/bot/richmenu/list', null, false);
  if (listRes.body.richmenus) {
    for (const rm of listRes.body.richmenus) {
      await lineAPI('DELETE', `/v2/bot/richmenu/${rm.richMenuId}`, null, false);
      console.log(`   ✅ 已刪除舊選單：${rm.richMenuId}`);
    }
  }

  // 2. 建立新 Rich Menu
  console.log('\n2️⃣  建立新 Rich Menu...');
  const createRes = await lineAPI('POST', '/v2/bot/richmenu', richMenuBody);
  if (createRes.status !== 200) {
    console.error('❌ 建立失敗：', createRes.body);
    process.exit(1);
  }
  const richMenuId = createRes.body.richMenuId;
  console.log(`   ✅ Rich Menu ID：${richMenuId}`);

  // 3. 上傳圖片
  console.log('\n3️⃣  上傳 Rich Menu 圖片...');
  const imgPath = fs.existsSync(path.join(__dirname, 'rich-menu.jpg'))
    ? path.join(__dirname, 'rich-menu.jpg')
    : path.join(__dirname, 'rich-menu.png');
  const imgMime = imgPath.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  if (!fs.existsSync(imgPath)) {
    console.warn('   ⚠️  找不到 rich-menu.jpg / rich-menu.png，跳過上傳圖片步驟。');
    console.warn('      請手動至 LINE Developers Console 上傳圖片後再繼續。');
  } else {
    console.log(`   使用圖片：${path.basename(imgPath)}`);
    const imgData = fs.readFileSync(imgPath);
    const uploadRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api-data.line.me',
        path:     `/v2/bot/richmenu/${richMenuId}/content`,
        method:   'POST',
        headers:  {
          Authorization:  `Bearer ${TOKEN}`,
          'Content-Type': imgMime,
          'Content-Length': imgData.length
        }
      };
      const req = https.request(options, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(imgData);
      req.end();
    });
    console.log(`   ${uploadRes.status === 200 ? '✅' : '❌'} 圖片上傳結果：HTTP ${uploadRes.status}`);
  }

  // 4. 設為預設選單
  console.log('\n4️⃣  設定為預設 Rich Menu...');
  const defaultRes = await lineAPI('POST', `/v2/bot/user/all/richmenu/${richMenuId}`, null, false);
  console.log(`   ${defaultRes.status === 200 ? '✅' : '❌'} 設定結果：HTTP ${defaultRes.status}`);

  console.log('\n🎉 Rich Menu 設定完成！');
  console.log(`   Rich Menu ID：${richMenuId}`);
  console.log('\n📌 下一步：');
  console.log('   1. 若跳過圖片上傳，請至 LINE Developers Console → Messaging API → Rich Menu 上傳圖片');
  console.log('   2. 在 LINE App 確認選單是否出現');
}

main().catch(console.error);
