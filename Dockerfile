FROM node:20-alpine

# 安裝 Chromium 與 Puppeteer 所需系統套件
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    # 支援中文字型
    font-noto-cjk

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 設定工作目錄
WORKDIR /app

# 複製 package 檔案並安裝依賴（利用 cache layer）
COPY package*.json ./
RUN npm install --omit=dev

# 複製程式碼
COPY . .

# 不以 root 執行（安全性）
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
