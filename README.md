## **Cloudflare DNS 自動更新ツール** 🚀  

IPv4 / IPv6 の変更を検知し、CloudflareのDNSを自動更新するシンプルなツールです。  

### **✨ 特徴**  
✅ **IPv4 / IPv6 対応（A / AAAA レコード）**  
✅ **IP変更時のみCloudflareを更新**  
✅ **シンプルなログ管理（JSON）**  

### **🚀 使い方**  

#### **1️⃣ インストール**  
```sh
npm install
```

#### **2️⃣ 設定**  
`config.json` を作成：
```json
{
  "ZONE_ID": "your-zone-id",
  "API_TOKEN": "your-api-token",
  "DNS_NAME": "your.domain.com"
}
```

#### **3️⃣ 実行**  
```sh
node index.js
```

（DockerもOK ✅）  
```sh
docker build -t cloudflare-dns-updater .
docker run -d cloudflare-dns-updater
```

### **📜 ログ管理**  
更新履歴は `log/latest.json` に保存。  

### **⏳ 更新間隔**  
1分ごとにチェック。IP変更時のみCloudflareを更新。  
