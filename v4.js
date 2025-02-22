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
let currentIP = null;

// ログファイルのパス
const logDirectory = path.join(__dirname, 'log');
const logFilePath = path.join(logDirectory, 'latest.json');

// ログディレクトリとファイルを確保
function ensureLogFile() {
    try {
        if (!fs.existsSync(logDirectory)) {
            fs.mkdirSync(logDirectory, { recursive: true });
            console.log('ログディレクトリを作成しました:', logDirectory);
        }

        if (!fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, JSON.stringify({ metadata: {}, logs: [] }, null, 2), 'utf8');
            console.log('ログファイルを作成しました:', logFilePath);
        }
    } catch (error) {
        console.error('ログディレクトリまたはファイルの作成中にエラーが発生しました:', error.message);
    }
}

// ログを追記する関数
function appendToLogFile(data) {
    ensureLogFile();

    try {
        let logData = {
            metadata: {
                lastUpdated: new Date().toISOString(), // 更新日時をメタ情報として追加
            },
            logs: [],
        };

        // ログファイルを読み込み
        if (fs.existsSync(logFilePath)) {
            const existingData = fs.readFileSync(logFilePath, 'utf8');

            // JSONパース時のエラーハンドリング
            try {
                logData = JSON.parse(existingData);
            } catch (error) {
                console.warn('ログファイルのJSONパースに失敗しました。新しいログファイルを上書きします。');
            }
        }

        logData.logs.push(data); // 新しいログを追加
        logData.metadata.lastUpdated = new Date().toISOString(); // 更新日時を更新

        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf8');
        console.log('ログファイルに更新結果を追記しました');
    } catch (error) {
        console.error('ログファイルの更新に失敗しました:', error.message);
    }
}

// Cloudflareの"dns_records"を取得
async function getDnsRecordId() {
    const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            params: {
                name: DNS_NAME,
            },
        });

        if (response.data.success) {
            const records = response.data.result;
            if (records.length > 0) {
                return records[0].id;
            } else {
                console.log('No matching DNS record found.');
                return null;
            }
        } else {
            console.error('Failed to fetch DNS records:', response.data.errors);
        }
    } catch (error) {
        console.error('Error fetching DNS records:', error.response?.data || error.message);
    }
}

// 外部APIからIPアドレスを取得
async function fetchPublicIP() {
    try {
        const response = await axios.get('https://api.ipify.org?format=json');
        return response.data.ip;
    } catch (error) {
        console.error('IPアドレスの取得に失敗しました:', error.message);
        return null;
    }
}

// DNSを更新
async function updateDNSRecord() {
    const recordId = await getDnsRecordId();
    if (!recordId) {
        console.error('DNSレコードが見つかりませんでした');
        return;
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${recordId}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
    };
    const ip = await fetchPublicIP();
    if (!ip) return;

    const data = {
        type: 'A',
        name: DNS_NAME,
        content: ip,
        ttl: DNS_TTL,
        proxied: DNS_PROXIED,
    };

    try {
        const response = await axios.put(url, data, { headers });
        const timestamp = new Date().toISOString();

        if (response.data.success) {
            console.log('DNSレコードを更新しました');

            // 成功結果をログに保存
            appendToLogFile({
                timestamp,
                status: 'success',
                newIP: ip,
                response: response.data,
            });
        } else {
            console.error('DNSレコードの更新に失敗しました:', response.data.errors);

            // 失敗結果をログに保存
            appendToLogFile({
                timestamp,
                status: 'failure',
                newIP: ip,
                errors: response.data.errors,
            });
        }
    } catch (error) {
        const timestamp = new Date().toISOString();
        console.error('DNSレコードの更新中にエラーが発生しました:', error.response?.data || error.message);

        // エラー結果をログに保存
        appendToLogFile({
            timestamp,
            status: 'error',
            newIP: ip,
            error: error.response?.data || error.message,
        });
    }
}

// 定期的にIPアドレスをチェック
async function monitorIP() {
    const newIP = await fetchPublicIP();
    if (newIP) {
        if (newIP !== currentIP) {
            console.log('IPアドレスが変更されました:', newIP);
            currentIP = newIP;
            await updateDNSRecord();
        } else {
            console.log('IPアドレスに変更はありません');
        }
    }
}

// ルートハンドラー
app.get('/', (req, res) => {
    res.send('IPアドレス監視アプリが動作中です');
});

// サーバー起動
app.listen(port, async () => {
    console.log(`サーバーが起動しました: http://localhost:${port}`);
    ensureLogFile(); // サーバー起動時にログファイルを確認
    currentIP = await fetchPublicIP();
    console.log('現在のIPアドレス:', currentIP);
    setInterval(monitorIP, 60000); // 1分ごとにチェック
    await updateDNSRecord(); // サーバー起動時にも一度更新を実施
});
