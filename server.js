require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// 環境変数
const cloudflareZoneId = process.env.CF_ZONE_ID;
const cloudflareApiToken = process.env.CF_API_TOKEN;
const cloudflareDnsName = process.env.CF_DNS_NAME;
const isCloudflareProxyEnabled = process.env.CF_DNS_PROXIED === 'true';
const cloudflareDnsTtl = parseInt(process.env.CF_DNS_TTL, 10) || 3600;
const isIPv6Enabled = process.env.CF_ENABLE_IPV6 === 'true';
const ipFetchRetryCount = parseInt(process.env.CF_IP_FETCH_RETRY_COUNT, 10) || 3; // IP取得リトライ回数
const logRotationEnabled = process.env.CF_LOG_ROTATION === 'true'; // ログローテーション機能フラグ

let currentIPv4 = null;
let currentIPv6 = null;

// 定数
const MONITOR_INTERVAL = 60000; // 監視間隔 (ミリ秒)
const IPV4_FETCH_URL = 'https://api.ipify.org?format=json';
const IPV6_FETCH_URL = 'https://api64.ipify.org?format=json';
const LOG_DIRECTORY = path.join(__dirname, 'log');
const LOG_FILE_PATH = path.join(LOG_DIRECTORY, 'latest.json');
const LOG_ROTATION_FILE_PATH = path.join(LOG_DIRECTORY, 'log-%DATE%.json'); // ローテーション時のファイル名


/**
 * 必須環境変数が設定されているか確認する
 */
function ensureRequiredEnvVars() {
    const requiredEnvVars = ['CF_ZONE_ID', 'CF_API_TOKEN', 'CF_DNS_NAME'];
    const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);
    if (missingEnvVars.length > 0) {
        const errorMessage = `必須環境変数 ${missingEnvVars.join(', ')} が設定されていません。`;
        console.error(errorMessage);
        appendToLogFile('ERROR', { message: errorMessage }); // ログファイルにもエラー出力
        process.exit(1); // 必須環境変数が設定されていない場合はサーバーを停止
    }
}


/**
 * ログディレクトリが存在しない場合に作成し、ログファイルが存在しない場合は初期化する
 */
function ensureLogFile() {
    if (!fs.existsSync(LOG_DIRECTORY)) {
        fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE_PATH)) {
        fs.writeFileSync(LOG_FILE_PATH, JSON.stringify({ metadata: {}, logs: [] }, null, 2), 'utf8');
    }
}


/**
 * ログファイルにデータを追記する
 * @param {string} level - ログレベル (INFO, ERROR, WARN など)
 * @param {object} data - ログデータ
 */
function appendToLogFile(level, data) {
    ensureLogFile(); // ログファイル存在確認・作成

    try {
        let logData = { metadata: { lastUpdated: new Date().toISOString() }, logs: [] };

        // 既存のログファイルを読み込む
        if (fs.existsSync(LOG_FILE_PATH)) {
            const logFileContent = fs.readFileSync(LOG_FILE_PATH, 'utf8');
            try {
                logData = JSON.parse(logFileContent);
            } catch (parseError) {
                const errorMessage = 'ログファイルのJSONパースに失敗しました。新規作成します。';
                console.warn(errorMessage, parseError);
                // パースエラー詳細をログ出力
                appendToLogFile('WARN', { message: errorMessage, error: parseError.message });
                // 必要であれば、古いログファイルをバックアップする処理を追加
                // 例: fs.renameSync(LOG_FILE_PATH, LOG_FILE_PATH + '.backup');
            }
        }

        // ログデータを追加
        logData.logs.push({
            timestamp: new Date().toISOString(), // タイムスタンプをログデータに含めるように修正
            level,
            ...data
        });
        logData.metadata.lastUpdated = new Date().toISOString();

        // ログファイルに書き込み
        fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(logData, null, 2), 'utf8');


    } catch (error) {
        console.error('ログファイルの更新に失敗しました:', error);
    }
}


/**
 * Cloudflare API を使用して指定されたDNSレコードタイプ (A, AAAA) のレコードIDを取得する
 * @param {string} type - DNSレコードタイプ (A or AAAA)
 * @returns {Promise<string|null>} レコードID、見つからない場合は null
 */
async function fetchDnsRecordId(type) {
    const apiUrl = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records`;
    const headers = {
        'Authorization': `Bearer ${cloudflareApiToken}`,
        'Content-Type': 'application/json'
    };
    const params = {
        name: cloudflareDnsName,
        type
    };

    try {
        const response = await axios.get(apiUrl, { headers, params });

        if (response.data.success && response.data.result.length > 0) {
            return response.data.result[0].id; // レコードIDを返す
        } else {
            // DNSレコードが見つからない場合は null を返す (作成処理へ)
            return null;
        }

    } catch (error) {
        const errorMessage = `${type}レコードの取得に失敗しました (name: ${cloudflareDnsName})`;
        console.error(`[fetchDnsRecordId] ${errorMessage}`, error.response?.data || error.message);
        // APIエラー詳細をログ出力
        appendToLogFile('ERROR', {
            message: errorMessage,
            type,
            dnsName: cloudflareDnsName,
            error: error.response?.data || error.message
        });
        return null;
    }
}


/**
 * Cloudflare API を使用してDNSレコードを作成する
 * @param {string} type - DNSレコードタイプ (A or AAAA)
 * @param {string} ipAddress - 作成するIPアドレス
 */
async function createDnsRecord(type, ipAddress) {
    const apiUrl = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudflareApiToken}`
    };
    const data = {
        type,
        name: cloudflareDnsName,
        content: ipAddress,
        ttl: cloudflareDnsTtl,
        proxied: isCloudflareProxyEnabled
    };

    try {
        const response = await axios.post(apiUrl, data, { headers, timeout: 10000 });

        if (response.data.success) {
            console.log(`[createDnsRecord] ${type}レコードを ${ipAddress} に作成成功`);
            // INFOログ出力
            appendToLogFile('INFO', {
                message: `${type}レコードを ${ipAddress} に作成成功`,
                type,
                ipAddress,
                response: response.data
            });
        } else {
            const errorMessage = `${type}レコードの作成に失敗`;
            console.error(`[createDnsRecord] ${errorMessage}`, response.data);
            // ERRORログ出力
            appendToLogFile('ERROR', {
                message: errorMessage,
                type,
                ipAddress,
                response: response.data
            });
        }

    } catch (error) {
        const errorMessage = `${type}レコードの作成中にエラー発生`;
        console.error(`[createDnsRecord] ${errorMessage}`, error.response?.data || error.message);
        // ERRORログ出力
        appendToLogFile('ERROR', {
            message: errorMessage,
            type,
            ipAddress,
            error: error.response?.data || error.message
        });
    }
}


/**
 * Cloudflare API を使用してDNSレコードを更新する
 * @param {string} type - DNSレコードタイプ (A or AAAA)
 * @param {string} ipAddress - 更新するIPアドレス
 */
async function updateDnsRecord(type, ipAddress) {
    const recordId = await fetchDnsRecordId(type); // レコードIDを取得

    if (!recordId) {
        // レコードIDが取得できない = レコードが存在しない -> 作成処理に移行
        appendToLogFile('WARN', {
            message: `${type}レコードが見つからなかったため、作成を試みます (name: ${cloudflareDnsName})。`,
            type,
            dnsName: cloudflareDnsName
        });
        console.warn(`[updateDnsRecord] ${type} record not found, attempting to create (name: ${cloudflareDnsName}).`);
        await createDnsRecord(type, ipAddress); // レコード作成
        return; // 作成処理後、更新処理は終了
    }


    const apiUrl = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records/${recordId}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudflareApiToken}`
    };
    const data = {
        type,
        name: cloudflareDnsName,
        content: ipAddress,
        ttl: cloudflareDnsTtl,
        proxied: isCloudflareProxyEnabled
    };

    try {
        const response = await axios.put(apiUrl, data, { headers, timeout: 10000 });

        if (response.data.success) {
            console.log(`[updateDnsRecord] ${type}レコードを ${ipAddress} に更新成功`);
            // INFOログ出力
            appendToLogFile('INFO', {
                message: `${type}レコードを ${ipAddress} に更新成功`,
                type,
                ipAddress,
                response: response.data
            });
        } else {
            const errorMessage = `${type}レコードの更新に失敗`;
            console.error(`[updateDnsRecord] ${errorMessage}`, response.data);
            // ERRORログ出力
            appendToLogFile('ERROR', {
                message: errorMessage,
                type,
                ipAddress,
                response: response.data
            });
        }

    } catch (error) {
        const errorMessage = `${type}レコードの更新中にエラー発生`;
        console.error(`[updateDnsRecord] ${errorMessage}`, error.response?.data || error.message);
        // ERRORログ出力
        appendToLogFile('ERROR', {
            message: errorMessage,
            type,
            ipAddress,
            error: error.response?.data || error.message
        });
    }
}


/**
 * 公開IPアドレスをIPアドレス取得サービスから取得する (リトライ処理付き)
 * @param {number} version - IPバージョン (4 or 6)
 * @param {number} retryCount - リトライ回数
 * @returns {Promise<string|null>} IPアドレス、取得失敗時は null
 */
async function fetchPublicIpAddress(version = 4, retryCount = ipFetchRetryCount) {
    let attempts = 0;
    const fetchUrl = version === 6 ? IPV6_FETCH_URL : IPV4_FETCH_URL; // IPバージョンに応じてURLを切り替え

    while (attempts < retryCount) {
        attempts++;
        try {
            const response = await axios.get(fetchUrl, { timeout: 5000 }); // 5秒タイムアウト
            return response.data.ip; // IPアドレスを返す

        } catch (error) {
            const errorMessage = `IPv${version}アドレスの取得に失敗しました (試行 ${attempts}/${retryCount})`;
            console.warn(`[fetchPublicIpAddress] ${errorMessage}`, error.message);
            // WARNログ出力
            appendToLogFile('WARN', {
                message: errorMessage,
                ipVersion: version,
                attempt: attempts,
                retryCount,
                error: error.message
            });

            if (attempts >= retryCount) {
                const errorMessageMaxRetry = `IPv${version}アドレスの取得に最大リトライ回数(${retryCount})を超過しました。`;
                console.error(`[fetchPublicIpAddress] ${errorMessageMaxRetry}`);
                // ERRORログ出力（リトライ回数超過）
                appendToLogFile('ERROR', {
                    message: errorMessageMaxRetry,
                    ipVersion: version,
                    retryCount
                });
                return null; // リトライ後も失敗した場合は null を返す
            }


            // リトライ間隔を調整 (attempts回数に応じて間隔を長くする 例: 1回目: 1秒, 2回目: 2秒, ... )
            const delaySeconds = attempts * 1;
            console.log(`[fetchPublicIpAddress] ${delaySeconds}秒後にリトライします...`);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
    }

    return null; // リトライ処理後もIP取得失敗
}


/**
 * IPアドレスを監視し、変更があればDNSレコードを更新する
 */
async function monitorIpAddress() {
    // IPv4アドレスの監視と更新
    const newIPv4 = await fetchPublicIpAddress(4);
    if (newIPv4) {
        if (newIPv4 !== currentIPv4) {
            currentIPv4 = newIPv4;
            await updateDnsRecord('A', newIPv4); // DNSレコード更新
        } else {
            console.log('[monitorIpAddress] IPv4アドレスに変更はありません');
            // INFOログ出力（変更なし）
            appendToLogFile('INFO', { message: 'IPv4アドレスに変更はありません' });
        }
    } else {
        const errorMessage = 'IPv4アドレスの取得に失敗しました。DNS更新をスキップします。';
        console.error(`[monitorIpAddress] ${errorMessage}`);
        // ERRORログ出力（IPアドレス取得失敗）
        appendToLogFile('ERROR', { message: errorMessage, ipVersion: 4 });
    }


    // IPv6アドレスの監視と更新 (IPv6 が有効な場合のみ)
    if (isIPv6Enabled) {
        const newIPv6 = await fetchPublicIpAddress(6);
        if (newIPv6) {
            if (newIPv6 !== currentIPv6) {
                currentIPv6 = newIPv6;
                await updateDnsRecord('AAAA', newIPv6); // DNSレコード更新
            } else {
                console.log('[monitorIpAddress] IPv6アドレスに変更はありません');
                // INFOログ出力（変更なし）
                appendToLogFile('INFO', { message: 'IPv6アドレスに変更はありません' });
            }
        } else {
            const errorMessage = 'IPv6アドレスの取得に失敗しました。DNS更新をスキップします。';
            console.error(`[monitorIpAddress] ${errorMessage}`);
            // ERRORログ出力（IPアドレス取得失敗）
            appendToLogFile('ERROR', { message: errorMessage, ipVersion: 6 });
        }
    }
}


// ヘルスチェック用エンドポイント
app.get('/', (req, res) => res.send('Cloudflare DNS 更新サーバーが動作中です'));


/**
 * サーバー起動処理
 */
async function startServer() {
    ensureRequiredEnvVars(); // 必須環境変数の確認
    ensureLogFile(); // ログファイル初期化

    // 起動時のログ出力
    console.log(`サーバーが起動しました: http://localhost:${port}`);
    appendToLogFile('INFO', { message: `サーバーが起動しました: http://localhost:${port}` });


    // 初回IPアドレス取得
    currentIPv4 = await fetchPublicIpAddress(4);
    if (isIPv6Enabled) {
        currentIPv6 = await fetchPublicIpAddress(6);
    }


    // 監視間隔を設定 (環境変数から取得できるようにしても良い)
    setInterval(monitorIpAddress, MONITOR_INTERVAL); // IPアドレス監視を定期的に実行


    // 初回DNSレコード更新
    const dnsRecordTypesToUpdate = ['A'];
    if (isIPv6Enabled) {
        dnsRecordTypesToUpdate.push('AAAA');
    }

    for (const dnsType of dnsRecordTypesToUpdate) {
        const currentIpAddress = dnsType === 'A' ? currentIPv4 : currentIPv6;
        if (currentIpAddress) {
            await updateDnsRecord(dnsType, currentIpAddress); // DNSレコード更新
        } else {
            const errorMessageInitialUpdate = `${dnsType}アドレスが取得できなかったため、初回DNS更新をスキップします。`;
            console.warn(`[startServer] ${errorMessageInitialUpdate}`);
            // WARNログ出力（初回DNS更新スキップ）
            appendToLogFile('WARN', { message: errorMessageInitialUpdate, dnsType });
        }
    }
}


// サーバー起動
app.listen(port, startServer);