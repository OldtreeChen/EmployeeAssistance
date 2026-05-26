#!/bin/bash
# =============================================================
# LINE 打卡系統 — 一鍵部署腳本
# 在您「本機」執行此腳本，它會自動：
#   1. 上傳所有程式碼到 EC2
#   2. SSH 進入伺服器執行 docker compose
# =============================================================

set -e

SERVER="192.168.20.151"
USER="ec2-user"
KEY="./ai3-root-6626-master-key"
REMOTE_DIR="/home/ec2-user/line-punch-system"
SSH_OPT="-i $KEY -o StrictHostKeyChecking=no"

echo "🚀 開始部署 LINE 打卡系統..."
echo "   目標伺服器：$USER@$SERVER"
echo ""

# ── Step 1：上傳程式碼 ─────────────────────────────────
echo "📦 [1/4] 上傳程式碼..."
ssh $SSH_OPT $USER@$SERVER "mkdir -p $REMOTE_DIR"
rsync -avz --exclude='node_modules' --exclude='.git' \
  -e "ssh $SSH_OPT" \
  ./ $USER@$SERVER:$REMOTE_DIR/
echo "   ✅ 上傳完成"

# ── Step 2：確認 Docker 已安裝 ─────────────────────────
echo ""
echo "🐳 [2/4] 確認 Docker 環境..."
ssh $SSH_OPT $USER@$SERVER "
  if ! command -v docker &>/dev/null; then
    echo '   安裝 Docker...'
    sudo yum install -y docker
    sudo systemctl enable --now docker
    sudo usermod -aG docker ec2-user
    echo '   ✅ Docker 安裝完成'
  else
    echo '   ✅ Docker 已存在：'$(docker --version)
  fi

  if ! docker compose version &>/dev/null 2>&1; then
    echo '   安裝 Docker Compose Plugin...'
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    echo '   ✅ Docker Compose 安裝完成'
  else
    echo '   ✅ Docker Compose 已存在：'$(docker compose version)
  fi
"

# ── Step 3：Build & 啟動服務 ───────────────────────────
echo ""
echo "🔧 [3/4] 建置並啟動服務（首次 build 需要 5-10 分鐘）..."
ssh $SSH_OPT $USER@$SERVER "
  cd $REMOTE_DIR
  docker compose down --remove-orphans 2>/dev/null || true
  docker compose up -d --build
"
echo "   ✅ 服務啟動完成"

# ── Step 4：確認服務狀態 ───────────────────────────────
echo ""
echo "🏥 [4/4] 確認服務健康狀態..."
sleep 5
ssh $SSH_OPT $USER@$SERVER "
  cd $REMOTE_DIR
  docker compose ps
  echo ''
  echo '--- Health Check ---'
  curl -sf http://localhost:3000/health && echo '' || echo '⚠️  Health check 尚未就緒，等待資料庫啟動...'
"

echo ""
echo "======================================"
echo "✅ 部署完成！"
echo ""
echo "📌 服務資訊："
echo "   應用程式 Port：3000"
echo "   健康檢查：http://192.168.20.151:3000/health"
echo "   Webhook：http://192.168.20.151:3000/webhook"
echo "   LIFF 表單：http://192.168.20.151:3000/liff"
echo ""
echo "⚠️  還需要完成："
echo "   1. 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_CHANNEL_SECRET"
echo "      → ssh $SSH_OPT $USER@$SERVER"
echo "      → nano $REMOTE_DIR/.env"
echo "      → docker compose restart app"
echo ""
echo "   2. 請在您的 Nginx 設定反向代理至 port 3000"
echo "   3. 至 LINE Developers Console 設定 Webhook URL"
echo "   4. 執行 Rich Menu 設定腳本（見下方）"
echo "======================================"
