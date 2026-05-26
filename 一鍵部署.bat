@echo off
chcp 65001 >nul
title LINE 打卡系統部署

set SERVER=192.168.20.151
set USER=ec2-user
set KEY=%~dp0ai3-root-6626-master-key
set REMOTE=/home/ec2-user/line-punch-system

echo ========================================
echo  LINE 打卡系統 - 自動部署
echo ========================================
echo.

:: ── 1. 上傳程式碼 ──────────────────────────────────
echo [1/4] 上傳程式碼到伺服器...
scp -i "%KEY%" -o StrictHostKeyChecking=no -r "%~dp0." %USER%@%SERVER%:%REMOTE%
if %errorlevel% neq 0 (
    echo [錯誤] 上傳失敗，請確認網路連線和金鑰檔案
    pause & exit /b 1
)
echo       完成！

:: ── 2. 安裝 Docker（若未安裝）──────────────────────
echo.
echo [2/4] 確認 Docker 環境...
ssh -i "%KEY%" -o StrictHostKeyChecking=no %USER%@%SERVER% "command -v docker || (sudo yum install -y docker && sudo systemctl enable --now docker && sudo usermod -aG docker ec2-user)"
echo       完成！

:: ── 3. 安裝 Docker Compose ─────────────────────────
echo.
echo [3/4] 確認 Docker Compose...
ssh -i "%KEY%" -o StrictHostKeyChecking=no %USER%@%SERVER% "docker compose version 2>/dev/null || (sudo mkdir -p /usr/local/lib/docker/cli-plugins && sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose)"
echo       完成！

:: ── 4. 啟動服務 ────────────────────────────────────
echo.
echo [4/4] 建置並啟動 Docker 服務（首次約需 5-10 分鐘）...
ssh -i "%KEY%" -o StrictHostKeyChecking=no %USER%@%SERVER% "cd %REMOTE% && docker compose down 2>/dev/null; docker compose up -d --build && sleep 5 && docker compose ps && curl -s http://localhost:3000/health"

echo.
echo ========================================
echo  部署完成！
echo.
echo  服務 Port：3000
echo  Health:  http://%SERVER%:3000/health
echo  Webhook: http://%SERVER%:3000/webhook
echo  LIFF:    http://%SERVER%:3000/liff
echo ========================================
echo.
echo  下一步：
echo  1. 填入 LINE Token（見下方）
echo  2. 請告知 Cowork 完成後續設定
echo ========================================
pause
