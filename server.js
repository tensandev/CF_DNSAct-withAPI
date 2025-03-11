require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Cloudflare設定 (環境変数から取得)
const cloudflareZoneId = process.env.CF_ZONE_ID;
const cloudflareApiToken = process.env.CF_API_TOKEN;
const cloudflareDnsName = process.env.CF_DNS_NAME;
const cloudflareDnsProxied = process.env.CF_DNS_PROXIED === 'true';
const cloudflareDnsTtl = parseInt(process.env.CF_DNS_TTL, 10) || 3600;
const enableIPv6 = process.env.CF_ENABLE_IPV6 === 'true'; // IPv6 有効フラグ

let currentIPv4 = null;
let currentIPv6 = null;

// ログディレクトリとファイルのパス
const logDirectory = path.join(__dirname, 'log');
const logFilePath = path.join(logDirectory, 'latest.json');

/**
 * ログファイルが存在しない場合に作成する
 */
function ensureLogFile() {
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory, { recursive: true });
    }
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, JSON.stringify({ metadata: {}, logs: [] }, null, 2), 'utf8');
    }
}

/**
 * ログファイルにデータを追記する
 * @param {string} level - ログレベル (INFO, ERROR, WARN など)
 * @param {object} data - ログデータ
 */
function appendToLogFile(level, data) {
    ensureLogFile();
    try {
        let logData = { metadata: { lastUpdated: new Date().toISOString() }, logs: [] };
        if (fs.existsSync(logFilePath)) {
            try {
                logData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
            } catch (parseError) {
                console.warn('ログファイルのJSONパースに失敗しました。新規作成します。', parseError.message);
            }
        }
        logData.logs.push({ level, ...data }); // ログレベルをログデータに含める
        logData.metadata.lastUpdated = new Date().toISOString();
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf8');
    } catch (error) {
        console.error('ログファイルの更新に失敗しました:', error.message);
    }
}

/**
 * 指定されたDNSレコードタイプ (A, AAAA) のレコードIDを取得する
 * @param {string} type - DNSレコードタイプ (A or AAAA)
 * @returns {Promise<string|null>} レコードID, 見つからない場合は null
 */
async function getDnsRecordId(type) {
    const url = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records`;
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${cloudflareApiToken}`, 'Content-Type': 'application/json' },
            params: { name: cloudflareDnsName, type },
        });
        if (response.data.success && response.data.result.length > 0) {
            return response.data.result[0].id;
        } else {
            // DNSレコードが見つからない場合、警告ログを出力
            appendToLogFile('WARN', {
                timestamp: new Date().toISOString(),
                message: `${type}レコードが見つかりませんでした (name: ${cloudflareDnsName})。作成は試みません。`,
            });
            return null;
        }
    } catch (error) {
        // APIエラー時のログ出力
        appendToLogFile('ERROR', {
            timestamp: new Date().toISOString(),
            message: `${type}レコードの取得に失敗しました (name: ${cloudflareDnsName})`,
            error: error.response?.data || error.message,
        });
        console.error(`[getDnsRecordId] ${type} DNS records fetch error:`, error.response?.data || error.message);
        return null;
    }
}

/**
 * 公開IPアドレスをIPアドレス取得サービスから取得する (リトライ処理付き)
 * @param {number} version - IPバージョン (4 or 6)
 * @param {number} retryCount - リトライ回数
 * @returns {Promise<string|null>} IPアドレス, 取得失敗時は null
 */
async function fetchPublicIP(version = 4, retryCount = 3) {
    let attempts = 0;
    while (attempts < retryCount) {
        attempts++;
        const url = version === 6 ? 'https://api64.ipify.org?format=json' : 'https://api.ipify.org?format=json';
        try {
            const response = await axios.get(url, { timeout: 5000 }); // 5秒タイムアウト設定
            return response.data.ip;
        } catch (error) {
            const errorMessage = `IPv${version}アドレスの取得に失敗しました (試行 ${attempts}/${retryCount}): ${error.message}`;
            appendToLogFile('WARN', {
                timestamp: new Date().toISOString(),
                message: errorMessage,
            });
            console.warn(`[fetchPublicIP] ${errorMessage}`);
            if (attempts >= retryCount) {
                appendToLogFile('ERROR', {
                    timestamp: new Date().toISOString(),
                    message: `IPv${version}アドレスの取得に最大リトライ回数(${retryCount})を超過しました。`,
                });
                console.error(`[fetchPublicIP] IPv${version}アドレスの取得に最大リトライ回数(${retryCount})を超過しました。`);
                return null; // リトライ後も失敗
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // リトライ間隔を調整
        }
    }
    return null; // リトライ処理後もIP取得失敗
}


/**
 * DNSレコードを更新する
 * @param {string} type - DNSレコードタイプ (A or AAAA)
 * @param {string} ip - 更新するIPアドレス
 */
async function updateDNSRecord(type, ip) {
    const recordId = await getDnsRecordId(type);
    if (!recordId) {
        // recordId が null の場合は getDnsRecordId でログ出力済みのため、ここではログ出力しない
        return; // DNSレコードIDが取得できない場合は更新処理をスキップ
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records/${recordId}`;
    const data = { type, name: cloudflareDnsName, content: ip, ttl: cloudflareDnsTtl, proxied: cloudflareDnsProxied };

    try {
        const response = await axios.put(url, data, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cloudflareApiToken}` },
            timeout: 10000, // 10秒タイムアウト設定
        });
        if (response.data.success) {
            appendToLogFile('INFO', {
                timestamp: new Date().toISOString(),
                message: `${type}レコードを ${ip} に更新成功`,
                type,
                newIP: ip,
                response: response.data,
            });
            console.log(`[updateDNSRecord] ${type} record updated successfully to ${ip}`);
        } else {
            appendToLogFile('ERROR', {
                timestamp: new Date().toISOString(),
                message: `${type}レコードの更新に失敗`,
                type,
                newIP: ip,
                response: response.data,
            });
            console.error(`[updateDNSRecord] ${type} record update failed:`, response.data);
        }
    } catch (error) {
        appendToLogFile('ERROR', {
            timestamp: new Date().toISOString(),
            message: `${type}レコードの更新中にエラー発生`,
            type,
            newIP: ip,
            error: error.response?.data || error.message,
        });
        console.error(`[updateDNSRecord] ${type} record update error:`, error.response?.data || error.message);
    }
}

/**
 * IPアドレスを監視し、変更があればDNSレコードを更新する
 */
async function monitorIP() {
    // IPv4 アドレスの監視と更新
    const newIPv4 = await fetchPublicIP(4);
    if (newIPv4) {
        if (newIPv4 !== currentIPv4) {
            currentIPv4 = newIPv4;
            await updateDNSRecord('A', newIPv4);
        } else {
            appendToLogFile('INFO', {
                timestamp: new Date().toISOString(),
                message: 'IPv4アドレスに変更はありません',
            });
            console.log('[monitorIP] IPv4 address unchanged');
        }
    } else {
        // IPv4アドレス取得失敗時のエラーログ
        appendToLogFile('ERROR', {
            timestamp: new Date().toISOString(),
            message: 'IPv4アドレスの取得に失敗しました。DNS更新をスキップします。',
        });
        console.error('[monitorIP] Failed to fetch IPv4 address, skipping DNS update.');
    }

    // IPv6 アドレスの監視と更新 (IPv6 が有効な場合のみ)
    if (enableIPv6) {
        const newIPv6 = await fetchPublicIP(6);
        if (newIPv6) {
            if (newIPv6 !== currentIPv6) {
                currentIPv6 = newIPv6;
                await updateDNSRecord('AAAA', newIPv6);
            } else {
                appendToLogFile('INFO', {
                    timestamp: new Date().toISOString(),
                    message: 'IPv6アドレスに変更はありません',
                });
                console.log('[monitorIP] IPv6 address unchanged');
            }
        } else {
            // IPv6アドレス取得失敗時のエラーログ
            appendToLogFile('ERROR', {
                timestamp: new Date().toISOString(),
                message: 'IPv6アドレスの取得に失敗しました。DNS更新をスキップします。',
            });
            console.error('[monitorIP] Failed to fetch IPv6 address, skipping DNS update.');
        }
    }
}

// ヘルスチェック用エンドポイント
app.get('/', (req, res) => res.send('Cloudflare DNS 更新サーバーが動作中です'));

/**
 * サーバー起動処理
 */
async function startServer() {
    // 環境変数の確認
    if (!cloudflareZoneId || !cloudflareApiToken || !cloudflareDnsName) {
        console.error('環境変数 CF_ZONE_ID, CF_API_TOKEN, CF_DNS_NAME が設定されていません。');
        process.exit(1); // 必須環境変数が設定されていない場合はサーバーを停止
    }

    ensureLogFile(); // ログファイル初期化

    // 初回IPアドレス取得
    currentIPv4 = await fetchPublicIP(4);
    if (enableIPv6) {
        currentIPv6 = await fetchPublicIP(6);
    }

    console.log(`サーバーが起動しました: http://localhost:${port}`);
    appendToLogFile('INFO', { timestamp: new Date().toISOString(), message: `サーバーが起動しました: http://localhost:${port}` });

    // 1分ごとにIPアドレス監視
    setInterval(monitorIP, 60000);

    // 初回DNSレコード更新
    const dnsTypesToUpdate = ['A'];
    if (enableIPv6) {
        dnsTypesToUpdate.push('AAAA');
    }

    for (const dnsType of dnsTypesToUpdate) {
        const currentIP = dnsType === 'A' ? currentIPv4 : currentIPv6;
        if (currentIP) {
            await updateDNSRecord(dnsType, currentIP);
        } else {
            appendToLogFile('WARN', {
                timestamp: new Date().toISOString(),
                message: `${dnsType}アドレスが取得できなかったため、初回DNS更新をスキップします。`,
            });
            console.warn(`[startServer] ${dnsType} address not available at startup, skipping initial DNS update.`);
        }
    }
}

// サーバー起動
app.listen(port, startServer);