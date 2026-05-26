#!/bin/bash
# =============================================================
# 部署後設定腳本（在 deploy.sh 完成後執行）
# 用途：設定 Rich Menu、轉換圖片
# =============================================================

SERVER="192.168.20.151"
USER="ec2-user"
KEY="./ai3-root-6626-master-key"
REMOTE_DIR="/home/ec2-user/line-punch-system"
SSH_OPT="-i $KEY -o StrictHostKeyChecking=no"

echo "🎨 [1/2] 轉換 Rich Menu 圖片..."
ssh $SSH_OPT $USER@$SERVER "
  if ! command -v inkscape &>/dev/null; then
    sudo yum install -y inkscape 2>/dev/null || \
    sudo apt-get install -y inkscape 2>/dev/null || \
    echo '⚠️  請手動安裝 inkscape 或用其他工具將 SVG 轉為 PNG'
  fi

  cd $REMOTE_DIR
  if command -v inkscape &>/dev/null; then
    inkscape scripts/rich-menu.svg \
      --export-type=png \
      --export-filename=scripts/rich-menu.png \
      --export-width=2500 --export-height=843
    echo '✅ 圖片轉換完成：scripts/rich-menu.png'
  fi
"

echo ""
echo "📋 [2/2] 建立 LINE Rich Menu..."
ssh $SSH_OPT $USER@$SERVER "
  cd $REMOTE_DIR
  docker compose exec -T app node scripts/setup-rich-menu.js
"

echo ""
echo "======================================"
echo "✅ Rich Menu 設定完成！"
echo ""
echo "📌 請至 LINE Developers Console 完成最後設定："
echo "   Webhook URL → https://您的網域/webhook"
echo "   LIFF Endpoint → https://您的網域/liff"
echo "======================================"
