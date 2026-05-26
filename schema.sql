-- =====================================================
-- LINE 打卡系統 - 資料庫 Schema (MySQL)
-- =====================================================

CREATE DATABASE IF NOT EXISTS line_punch_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE line_punch_system;

-- 員工基本資料（LINE 用戶）
CREATE TABLE IF NOT EXISTS users (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  line_user_id        VARCHAR(50)  UNIQUE NOT NULL COMMENT 'LINE userId',
  display_name        VARCHAR(100)        COMMENT 'LINE 顯示名稱',
  picture_url         VARCHAR(500)        COMMENT 'LINE 頭像網址',
  employee_id         VARCHAR(50)         COMMENT '員工編號（可選）',
  department          VARCHAR(100)        COMMENT '部門（可選）',
  -- e-Contact 帳密（員工設定後儲存）
  ec_username         VARCHAR(100)        COMMENT 'e-Contact 帳號',
  ec_password         VARCHAR(255)        COMMENT 'e-Contact 密碼（加密儲存）',
  ec_setup_done       TINYINT(1) DEFAULT 0 COMMENT '是否已完成 e-Contact 帳號設定',
  setup_state         VARCHAR(50)  DEFAULT NULL COMMENT '設定流程狀態機',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_line_user_id (line_user_id)
) ENGINE=InnoDB COMMENT='員工資料表';

-- 打卡紀錄
CREATE TABLE IF NOT EXISTS attendance (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  line_user_id  VARCHAR(50)  NOT NULL COMMENT 'LINE userId',
  punch_type    ENUM('clock_in','clock_out') NOT NULL COMMENT '上班/下班',
  punch_time    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '打卡時間',
  latitude      DECIMAL(10,8)          COMMENT '緯度（選填）',
  longitude     DECIMAL(11,8)          COMMENT '經度（選填）',
  remark        VARCHAR(255)           COMMENT '備註',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_date (line_user_id, punch_time),
  FOREIGN KEY (line_user_id) REFERENCES users(line_user_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='打卡紀錄表';

-- 工時填寫紀錄
CREATE TABLE IF NOT EXISTS work_hours (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  line_user_id  VARCHAR(50)    NOT NULL COMMENT 'LINE userId',
  work_date     DATE           NOT NULL COMMENT '工作日期',
  start_time    TIME           NOT NULL COMMENT '開始時間',
  end_time      TIME           NOT NULL COMMENT '結束時間',
  break_minutes INT  DEFAULT 60         COMMENT '休息分鐘數',
  actual_hours  DECIMAL(5,2)            COMMENT '實際工時（系統計算）',
  project_name  VARCHAR(200)            COMMENT '專案名稱',
  work_content  TEXT                    COMMENT '工作內容',
  notes         TEXT                    COMMENT '備註',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_date (line_user_id, work_date),
  FOREIGN KEY (line_user_id) REFERENCES users(line_user_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='工時填寫紀錄';

-- 系統設定（選用）
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='系統設定';

-- 插入預設設定
INSERT IGNORE INTO settings VALUES
  ('work_start_time', '09:00', NOW()),
  ('work_end_time',   '18:00', NOW()),
  ('break_minutes',   '60',    NOW());
