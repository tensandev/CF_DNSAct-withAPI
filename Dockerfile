# ベースイメージを指定
FROM node:18

# 作業ディレクトリを設定
WORKDIR /app

# 依存関係をインストール
COPY package.json package-lock.json ./
RUN npm install

# アプリケーションのソースコードをコピー
COPY . .

# コンテナがリッスンするポートを指定
EXPOSE 3000

# アプリケーションを起動
CMD ["node", "server.js"]
