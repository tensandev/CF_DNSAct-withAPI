const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Cloudflareの設定
const ZONE_ID = '';
const API_TOKEN = '';
const DNS_NAME = '';
const DNS_PROXIED = true;
const DNS_TTL = 3600;

// 現在のIPアドレスを保存
let currentIPv4 = null;
let currentIPv6 = null;

// ログファイルのパス
const logDirectory = path.join(__dirname, 'log');
const logFilePath = path.join(logDirectory, 'latest.json');

// ログディレクトリとファイルを確保
function ensureLogFile() {
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory, { recursive: true });
    }
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, JSON.stringify({ metadata: {}, logs: [] }, null, 2), 'utf8');
    }
}

// ログを追記する関数
function appendToLogFile(data) {
    ensureLogFile();
    try {
        let logData = { metadata: { lastUpdated: new Date().toISOString() }, logs: [] };
        if (fs.existsSync(logFilePath)) {
            try {
                logData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
            } catch {
                console.warn('ログファイルのJSONパースに失敗しました。新規作成します。');
            }
        }
        logData.logs.push(data);
        logData.metadata.lastUpdated = new Date().toISOString();
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf8');
    } catch (error) {
        console.error('ログファイルの更新に失敗しました:', error.message);
    }
}

// CloudflareのDNSレコードIDを取得
async function getDnsRecordId(type) {
    const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`;

    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
            params: { name: DNS_NAME, type },
        });

        if (response.data.success) {
            const records = response.data.result;
            return records.length > 0 ? records[0].id : null;
        } else {
            console.error(`Failed to fetch ${type} DNS records:`, response.data.errors);
        }
    } catch (error) {
        console.error(`Error fetching ${type} DNS records:`, error.response?.data || error.message);
    }
}

// 外部APIからIPv4/IPv6を取得
async function fetchPublicIP(version = 4) {
    try {
        const url = version === 6 ? 'https://api64.ipify.org?format=json' : 'https://api.ipify.org?format=json';
        const response = await axios.get(url);
        return response.data.ip;
    } catch (error) {
        console.error(`IPv${version}アドレスの取得に失敗しました:`, error.message);
        return null;
    }
}

// DNSレコードを更新
async function updateDNSRecord(type, ip) {
    const recordId = await getDnsRecordId(type);
    if (!recordId) {
        console.error(`${type}のDNSレコードが見つかりませんでした`);
        return;
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${recordId}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_TOKEN}` };
    const data = { type, name: DNS_NAME, content: ip, ttl: DNS_TTL, proxied: DNS_PROXIED };

    try {
        const response = await axios.put(url, data, { headers });
        const timestamp = new Date().toISOString();

        if (response.data.success) {
            console.log(`${type} DNSレコードを更新しました: ${ip}`);
            appendToLogFile({ timestamp, status: 'success', type, newIP: ip, response: response.data });
        } else {
            console.error(`${type} DNSレコードの更新に失敗しました:`, response.data.errors);
            appendToLogFile({ timestamp, status: 'failure', type, newIP: ip, errors: response.data.errors });
        }
    } catch (error) {
        console.error(`${type} DNSレコードの更新中にエラーが発生しました:`, error.response?.data || error.message);
        appendToLogFile({ timestamp: new Date().toISOString(), status: 'error', type, newIP: ip, error: error.response?.data || error.message });
    }
}

// 定期的にIPアドレスをチェック
async function monitorIP() {
    const newIPv4 = await fetchPublicIP(4);
    const newIPv6 = await fetchPublicIP(6);

    if (newIPv4 && newIPv4 !== currentIPv4) {
        console.log('IPv4アドレスが変更されました:', newIPv4);
        currentIPv4 = newIPv4;
        await updateDNSRecord('A', newIPv4);
    } else {
        console.log('IPv4アドレスに変更はありません');
    }

    if (newIPv6 && newIPv6 !== currentIPv6) {
        console.log('IPv6アドレスが変更されました:', newIPv6);
        currentIPv6 = newIPv6;
        await updateDNSRecord('AAAA', newIPv6);
    } else {
        console.log('IPv6アドレスに変更はありません');
    }
}

// ルートハンドラー
app.get('/', (req, res) => {
    res.send('IPv4/IPv6アドレス監視アプリが動作中です');
});

// サーバー起動
app.listen(port, async () => {
    console.log(`サーバーが起動しました: http://localhost:${port}`);
    ensureLogFile(); // サーバー起動時にログファイルを確認
    currentIPv4 = await fetchPublicIP(4);
    currentIPv6 = await fetchPublicIP(6);
    console.log('現在のIPv4アドレス:', currentIPv4);
    console.log('現在のIPv6アドレス:', currentIPv6);
    setInterval(monitorIP, 60000); // 1分ごとにチェック
    await updateDNSRecord('A', currentIPv4); // IPv4を更新
    await updateDNSRecord('AAAA', currentIPv6); // IPv6を更新
});
