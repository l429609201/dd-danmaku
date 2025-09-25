// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// AppSecret轮换配置
const SECRET_ROTATION_LIMIT = 500; // 每个secret使用500次后切换

// 批量同步配置 - 减少DO调用次数
const BATCH_SYNC_THRESHOLD = 100; // 每100次请求同步一次到DO
const BATCH_SYNC_INTERVAL = 60000; // 或每60秒强制同步一次

// 全局内存缓存
let memoryCache = {
    rateLimitCounts: new Map(), // 频率限制计数缓存
    appSecretUsage: { count1: 0, count2: 0, current: '1' }, // AppSecret使用缓存
    lastSyncTime: Date.now(),
    pendingRequests: 0
};

// ========================================
// ⚙️ Durable Object 配置
// ========================================
const ALARM_INTERVAL_SECONDS = 60; // 每60秒强制将内存中的计数写入存储，以确保在免费额度内

// 数据清理配置
const DATA_RETENTION_HOURS = 168; // 保留一周(7天×24小时)的数据
const CLEANUP_INTERVAL_HOURS = 24; // 每24小时执行一次清理

// 从环境变量获取IP黑名单配置
function getIpBlacklist(env) {
    if (!env.IP_BLACKLIST_CONFIG) {
        console.log('IP_BLACKLIST_CONFIG 环境变量未配置，不启用IP黑名单');
        return [];
    }

    try {
        const blacklist = JSON.parse(env.IP_BLACKLIST_CONFIG);
        console.log('IP黑名单配置加载成功，包含', blacklist.length, '个规则');
        return blacklist;
    } catch (error) {
        console.error('解析IP黑名单配置失败:', error);
        return [];
    }
}

// 检查IP是否在黑名单中
function isIpBlacklisted(clientIp, blacklist) {
    if (!blacklist || blacklist.length === 0) {
        return false;
    }

    for (const rule of blacklist) {
        if (rule.includes('/')) {
            // CIDR格式
            if (isIpInCidr(clientIp, rule)) {
                return true;
            }
        } else {
            // 单个IP
            if (clientIp === rule) {
                return true;
            }
        }
    }
    return false;
}

// 检查IP是否在CIDR范围内
function isIpInCidr(ip, cidr) {
    try {
        const [network, prefixLength] = cidr.split('/');
        const prefix = parseInt(prefixLength, 10);

        // 简单的IPv4 CIDR检查
        const ipParts = ip.split('.').map(Number);
        const networkParts = network.split('.').map(Number);

        if (ipParts.length !== 4 || networkParts.length !== 4) {
            return false;
        }

        const ipInt = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
        const networkInt = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];
        const mask = (-1 << (32 - prefix)) >>> 0;

        return (ipInt & mask) === (networkInt & mask);
    } catch (error) {
        console.error('CIDR检查失败:', error);
        return false;
    }
}

// 从环境变量获取 User-Agent 限制配置
function getUserAgentLimits(env) {
    // 必须从环境变量获取配置
    if (!env.USER_AGENT_LIMITS_CONFIG) {
        console.error('USER_AGENT_LIMITS_CONFIG 环境变量未配置，拒绝所有请求');
        return {};
    }

    try {
        const limits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
        console.log('使用环境变量配置');

        // 过滤出启用的客户端
        const enabledLimits = {};
        Object.keys(limits).forEach(key => {
            const config = limits[key];
            if (config && config.enabled !== false) { // 默认启用，除非明确设置为 false
                enabledLimits[key] = config;
            }
        });

        return enabledLimits;
    } catch (error) {
        console.error('解析 USER_AGENT_LIMITS_CONFIG 失败，拒绝所有请求:', error);
        return {};
    }
}



// 获取访问控制配置
function getAccessConfig(env) {
    const ENABLE_ASYMMETRIC_AUTH = env.ENABLE_ASYMMETRIC_AUTH_ENV === 'true';
    const ENABLE_DETAILED_LOGGING = env.ENABLE_DETAILED_LOGGING !== 'false'; // 默认开启日志

    return {
        // 基于User-Agent的分级限制配置（从环境变量动态获取）
        get userAgentLimits() {
            return getUserAgentLimits(env);
        },



        // 日志配置
        logging: {
            enabled: ENABLE_DETAILED_LOGGING
        },

        // 非对称密钥验证配置
        asymmetricAuth: {
            enabled: ENABLE_ASYMMETRIC_AUTH, // 从环境变量控制是否启用
            privateKeyHex: env.PRIVATE_KEY_HEX || null, // Worker端私钥（十六进制格式，从环境变量获取）
            challengeEndpoint: '/auth/challenge' // 挑战端点
        }
    };
}



// 全局变量，标记是否已经设置过Webhook
let webhookInitialized = false;

export default {
  async fetch(request, env, ctx) {
    // 只在第一次请求时设置Webhook
    if (!webhookInitialized && env.TG_BOT_TOKEN && env.WORKER_DOMAIN) {
      webhookInitialized = true;
      ctx.waitUntil(setupWebhookOnce(env));
    }

    return await handleRequest(request, env, ctx);
  }
};


async function handleRequest(request, env, ctx) {
    // 添加请求日志
    console.log('📥 收到请求:', request.method, new URL(request.url).pathname);
    console.log('🌐 完整URL:', request.url);

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, User-Agent, X-User-Agent, X-Challenge-Response',
            },
        });
    }

    const urlObj = new URL(request.url);
    const ACCESS_CONFIG = getAccessConfig(env);

    // IP黑名单和临时封禁检查
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

    // 检查临时封禁
    try {
        const { isIpTempBanned } = await import('./telegram_bot.js');
        if (isIpTempBanned(clientIP)) {
            console.log(`IP ${clientIP} 被临时封禁，拒绝访问`);
            return new Response(JSON.stringify({
                status: 403,
                type: "临时封禁",
                message: `IP ${clientIP} 因违规行为被临时封禁`
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
    } catch (e) { /* 忽略临时封禁检查错误 */ }

    // 检查永久黑名单
    const ipBlacklist = getIpBlacklist(env);
    if (isIpBlacklisted(clientIP, ipBlacklist)) {
        console.log(`IP ${clientIP} 在黑名单中，拒绝访问`);

        // 记录到TG机器人日志
        try {
            const { logToBot } = await import('./telegram_bot.js');
            logToBot('warn', `IP黑名单拦截`, { ip: clientIP, userAgent: request.headers.get('X-User-Agent') });
        } catch (e) { /* 忽略日志记录错误 */ }

        return new Response(JSON.stringify({
            status: 403,
            type: "IP黑名单",
            message: `IP ${clientIP} 已被列入黑名单`
        }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 新增：处理挑战端点
    if (ACCESS_CONFIG.asymmetricAuth.enabled && urlObj.pathname === ACCESS_CONFIG.asymmetricAuth.challengeEndpoint) {
        return handleAuthChallenge(request, env);
    }

    // 新增：处理TG机器人webhook
    if (urlObj.pathname === '/telegram-webhook') {
        console.log('🎯 TG Webhook路由被触发!');
        console.log('📍 请求路径:', urlObj.pathname);
        console.log('🔧 开始导入telegram_bot.js模块...');

        try {
            const { handleTelegramWebhook } = await import('./telegram_bot.js');
            console.log('✅ telegram_bot.js模块导入成功');
            return handleTelegramWebhook(request, env);
        } catch (error) {
            console.log('❌ telegram_bot.js模块导入失败:', error.message);
            console.log('错误堆栈:', error.stack);
            return new Response('TG Bot module import failed: ' + error.message, { status: 500 });
        }
    }

    // 提取目标URL和API路径
    let url = urlObj.href.replace(urlObj.origin + '/cors/', '').trim();
    if (0 !== url.indexOf('https://') && 0 === url.indexOf('https:')) {
        url = url.replace('https:/', 'https://');
    } else if (0 !== url.indexOf('http://') && 0 === url.indexOf('http:')) {
        url = url.replace('http:/', 'http://');
    }
    const tUrlObj = new URL(url);
    if (!(tUrlObj.hostname in hostlist)) {
        return Forbidden(tUrlObj);
    }

    // 访问控制检查，传递正确的API路径
    const accessCheck = await checkAccess(request, env, tUrlObj.pathname);
    if (!accessCheck.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        const errorMessage = `IP:${clientIP} UA:${userAgent} 消息：${accessCheck.reason}`;

        if (ACCESS_CONFIG.logging.enabled) {
            console.log(`访问被拒绝: ${errorMessage}, 路径=${tUrlObj.pathname}`);
        }

        return new Response(JSON.stringify({
            status: accessCheck.status,
            type: "访问控制",
            message: errorMessage
        }), {
            status: accessCheck.status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 同步进行频率限制检查和计数更新
    if (ACCESS_CONFIG.logging.enabled) {
        console.log(`开始频率限制检查: IP=${clientIP}, UA=${accessCheck.uaConfig.type}, 路径=${accessCheck.apiPath}`);
    }

    const rateLimitCheck = await accessCheck.doStub.fetch(new Request('https://do.internal/checkAndIncrement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'checkAndIncrement',
            uaConfig: accessCheck.uaConfig,
            apiPath: accessCheck.apiPath,
            clientIP: clientIP,
            uaType: accessCheck.uaConfig.type,
            loggingEnabled: ACCESS_CONFIG.logging.enabled
        })
    }));

    const rateLimitResult = await rateLimitCheck.json();
    if (ACCESS_CONFIG.logging.enabled) {
        console.log(`频率限制检查结果: ${JSON.stringify(rateLimitResult)}`);
    }

    // 检查路径满载情况（在频率限制通过后）
    if (rateLimitResult.allowed && rateLimitResult.pathSpecificCount && rateLimitResult.pathLimit) {
        try {
            const { checkPathOverload } = await import('./telegram_bot.js');
            const overloadResult = checkPathOverload(
                clientIP,
                tUrlObj.pathname,
                rateLimitResult.pathSpecificCount,
                rateLimitResult.pathLimit
            );

            if (overloadResult.shouldBan) {
                console.log(`IP ${clientIP} 因路径满载被自动封禁`);
                return new Response(JSON.stringify({
                    status: 403,
                    type: "路径满载封禁",
                    message: `IP ${clientIP} 因${overloadResult.reason}被封禁3天`
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        } catch (e) { /* 忽略路径满载检查错误 */ }
    }

    if (!rateLimitResult.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        const errorMessage = `IP:${clientIP} UA:${userAgent} 频率限制：${rateLimitResult.reason}`;
        console.log(errorMessage);

        // 记录违规行为和日志
        try {
            const { logToBot, recordIpViolation } = await import('./telegram_bot.js');

            // 记录IP违规
            const violationResult = recordIpViolation(clientIP, '频率限制', {
                userAgent,
                reason: rateLimitResult.reason,
                path: tUrlObj.pathname
            });

            // 记录日志
            logToBot('warn', `频率限制触发`, {
                ip: clientIP,
                userAgent,
                reason: rateLimitResult.reason,
                path: tUrlObj.pathname,
                violationCount: violationResult.currentCount,
                autoBanned: violationResult.autoBanned
            });

            // 如果触发自动封禁，返回特殊消息
            if (violationResult.autoBanned) {
                return new Response(JSON.stringify({
                    status: 403,
                    type: "自动封禁",
                    message: `IP ${clientIP} 因频繁违规已被自动封禁`
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        } catch (e) { /* 忽略违规记录错误 */ }

        return new Response(JSON.stringify({
            status: 429,
            type: "频率限制",
            message: errorMessage
        }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }



    const appId = env.APP_ID;
    // 使用缓存的AppSecret信息，避免每次都调用DO
    const { secretId, appSecret } = await getCachedAppSecret(env);


    const timestamp = Math.floor(Date.now() / 1000);
    const apiPath = tUrlObj.pathname;
    const signature = await generateSignature(appId, timestamp, apiPath, appSecret);

    // 在内存中记录AppSecret使用次数
    if (memoryCache.appSecretUsage.current === '1') {
        memoryCache.appSecretUsage.count1++;
    } else {
        memoryCache.appSecretUsage.count2++;
    }

    // 增加待同步请求计数
    memoryCache.pendingRequests++;

    // 检查是否需要同步到存储
    if (await shouldSyncToStorage(env)) {
        ctx.waitUntil(syncCacheToStorage(env));
    }

    if (ACCESS_CONFIG.logging.enabled) {
        console.log('应用ID: ' + appId);
        console.log('签名: ' + signature);
        console.log('时间戳: ' + timestamp);
        console.log('API路径: ' + apiPath);
    }
    
    // 构建转发请求的头部，排除自定义头
    const forwardHeaders = {};
    for (const [key, value] of request.headers.entries()) {
        // 排除自定义头，只转发标准头
        if (key !== 'X-User-Agent' && key !== 'X-Challenge-Response') {
            forwardHeaders[key] = value;
        }
    }

    const finalHeaders = {
        ...forwardHeaders,
        "X-AppId": appId,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
        "X-Auth": "1",
    };

    // 调试日志：显示最终的请求头
    if (ACCESS_CONFIG.logging.enabled) {
        console.log('转发请求头:', JSON.stringify(finalHeaders, null, 2));
    }

    let response = await fetch(url, {
        headers: finalHeaders,
        body: request.body,
        method: request.method,
    });

    // 调试日志：显示dandanplay API响应内容
    console.log('dandanplay API响应状态:', response.status, response.statusText);

    // 读取响应内容用于日志记录
    const responseText = await response.text();
    // 新增：根据API路径选择性地记录响应内容，避免日志超限
    if (apiPath.startsWith('/api/v2/comment/')) {
        try {
            const jsonResponse = JSON.parse(responseText);
            if (jsonResponse && Array.isArray(jsonResponse.comments)) {
                console.log(`dandanplay API响应内容: (路径=${apiPath}) 弹幕数量=${jsonResponse.comments.length}, comments数组内容已省略`);
            } else {
                console.log('dandanplay API响应内容:', responseText);
            }
        } catch (e) {
            // 如果不是有效的JSON，则记录原始文本
            console.log('dandanplay API响应内容 (非JSON):', responseText);
        }
    } else {
        console.log('dandanplay API响应内容:', responseText);
    }

    // 重新创建Response对象（因为body已经被读取）
    response = new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
    response.headers.set('Access-Control-Allow-Origin', '*');

    return response;
}

// 批量同步管理函数
async function shouldSyncToStorage(env) {
    const now = Date.now();
    const timeSinceLastSync = now - memoryCache.lastSyncTime;

    // 达到请求阈值或时间间隔时触发同步
    return memoryCache.pendingRequests >= BATCH_SYNC_THRESHOLD ||
           timeSinceLastSync >= BATCH_SYNC_INTERVAL;
}

async function syncCacheToStorage(env) {
    if (memoryCache.pendingRequests === 0) return;

    try {
        // 同步AppSecret使用计数
        if (memoryCache.appSecretUsage.count1 > 0 || memoryCache.appSecretUsage.count2 > 0) {
            const appStateStub = env.APP_STATE.get(env.APP_STATE.idFromName("global"));
            await appStateStub.fetch(new Request('https://do.internal/batchRecordUsage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'batchRecordUsage',
                    count1: memoryCache.appSecretUsage.count1,
                    count2: memoryCache.appSecretUsage.count2
                })
            }));

            // 重置缓存
            memoryCache.appSecretUsage.count1 = 0;
            memoryCache.appSecretUsage.count2 = 0;
        }

        // 重置计数器
        memoryCache.pendingRequests = 0;
        memoryCache.lastSyncTime = Date.now();

    } catch (error) {
        console.error('批量同步失败:', error);
    }
}

// 获取缓存的AppSecret信息
async function getCachedAppSecret(env) {
    // 如果缓存为空，从DO获取初始状态
    if (memoryCache.appSecretUsage.current === '1' &&
        memoryCache.appSecretUsage.count1 === 0 &&
        memoryCache.appSecretUsage.count2 === 0) {

        try {
            const appStateStub = env.APP_STATE.get(env.APP_STATE.idFromName("global"));
            const response = await appStateStub.fetch(new Request('https://do.internal/getState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getState' })
            }));
            const state = await response.json();
            memoryCache.appSecretUsage = state;
        } catch (error) {
            console.error('获取AppSecret状态失败:', error);
        }
    }

    // 检查是否需要轮换
    const current = memoryCache.appSecretUsage.current;
    const count1 = memoryCache.appSecretUsage.count1;
    const count2 = memoryCache.appSecretUsage.count2;

    if (current === '1' && count1 >= SECRET_ROTATION_LIMIT && env.APP_SECRET_2) {
        memoryCache.appSecretUsage.current = '2';
        memoryCache.appSecretUsage.count1 = 0;
        console.log('内存缓存：切换到APP_SECRET_2');
    } else if (current === '2' && count2 >= SECRET_ROTATION_LIMIT) {
        memoryCache.appSecretUsage.current = '1';
        memoryCache.appSecretUsage.count2 = 0;
        console.log('内存缓存：切换到APP_SECRET');
    }

    return {
        secretId: memoryCache.appSecretUsage.current,
        appSecret: memoryCache.appSecretUsage.current === '2' && env.APP_SECRET_2 ?
                   env.APP_SECRET_2 : env.APP_SECRET
    };
}

/**
 *
 * @param {String} appId
 * @param {Number} timestamp 使用当前的 UTC 时间生成 Unix 时间戳，单位为秒
 * @param {String} path 此处的 API 路径是指 API 地址后的路径部分，以/开头，不包括前面的协议、域名和?后面的查询参数
 * @param {String} appSecret
 * @returns signature String
 */
async function generateSignature(appId, timestamp, path, appSecret) {
    const data = appId + timestamp + path + appSecret;
    const dataUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(hashArray.map(byte => String.fromCharCode(byte)).join(''));
    return hashBase64;
}
// 新增：访问控制检查函数
async function checkAccess(request, env, targetApiPath) {
    // 内部函数：识别User-Agent类型
    function identifyUserAgent(userAgent, ACCESS_CONFIG) {
        for (const [key, config] of Object.entries(ACCESS_CONFIG.userAgentLimits)) {
            if (key !== 'default' && config.userAgent && userAgent.includes(config.userAgent)) {
                return { ...config, type: key };
            }
        }
        return null;
    }

    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('X-User-Agent') || '';
    const apiPath = targetApiPath; // 使用传入的目标API路径
    const ACCESS_CONFIG = getAccessConfig(env);

    // 1. 识别User-Agent类型并获取对应限制
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    if (!uaConfig) {
        return { allowed: false, reason: '禁止访问的UA', status: 403 };
    }

    // 2. 基于Durable Object的频率限制
    const doKey = `${uaConfig.type}-${clientIP}`;
    const doId = env.RATE_LIMITER.idFromName(doKey);
    const doStub = env.RATE_LIMITER.get(doId);

    // 将配置和请求信息传递给Durable Object
    const doRequest = new Request('https://do.internal/check', { // 使用内部URL，避免与外部请求混淆
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'check',
            uaConfig: uaConfig,
            apiPath: apiPath,
            clientIP: clientIP, // 将IP和UA类型直接传递给DO
            uaType: uaConfig.type,
            loggingEnabled: ACCESS_CONFIG.logging.enabled,
        }),
    });

    const doResponse = await doStub.fetch(doRequest);
    const rateLimitCheck = await doResponse.json();

    if (!rateLimitCheck.allowed) {
        return { allowed: false, reason: `频率限制：${rateLimitCheck.reason}`, status: 429 };
    }

    // 3. 非对称密钥验证（如果启用）
    if (ACCESS_CONFIG.asymmetricAuth.enabled) {
        const authCheck = await verifyAsymmetricAuth(request);
        if (!authCheck.allowed) {
            return { allowed: false, reason: authCheck.reason, status: 401 };
        }
    }

    return { allowed: true, uaConfig: uaConfig, doStub: doStub, apiPath: apiPath };
}

// 新增：处理挑战-响应认证
async function handleAuthChallenge(request, env) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({
            status: 405,
            type: "方法不允许",
            message: "请求方法不被允许"
        }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    try {
        const { challenge } = await request.json();
        if (!challenge) {
            return new Response(JSON.stringify({
                status: 400,
                type: "参数错误",
                message: "缺少挑战参数"
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const ACCESS_CONFIG = getAccessConfig(env);
        // 使用私钥对挑战进行签名
        const signature = await signChallenge(challenge, ACCESS_CONFIG.asymmetricAuth.privateKeyHex);

        return new Response(JSON.stringify({ signature }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        console.error('挑战处理失败:', error);
        return new Response(JSON.stringify({
            status: 500,
            type: "服务器错误",
            message: "挑战处理错误"
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 新增：非对称密钥验证（挑战-响应模式）
async function verifyAsymmetricAuth(request) {
    // 插件端需要先获取挑战，然后验证响应
    const challengeResponse = request.headers.get('X-Challenge-Response');

    if (!challengeResponse) {
        return { allowed: false, reason: '缺少挑战响应' };
    }

    try {
        // 这里可以实现更复杂的挑战验证逻辑
        // 目前简化处理，实际应用中需要验证挑战的时效性和唯一性
        return { allowed: true };
    } catch (error) {
        console.error('非对称认证验证失败:', error);
        return { allowed: false, reason: '挑战验证错误' };
    }
}

// 新增：RSA签名函数（Worker端使用私钥签名）
async function signChallenge(challenge, privateKeyHex) {
    if (!privateKeyHex) {
        throw new Error('私钥未配置');
    }

    try {
        // 将十六进制私钥转换为ArrayBuffer
        const privateKeyBuffer = hexToArrayBuffer(privateKeyHex);

        // 导入私钥
        const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            privateKeyBuffer,
            {
                name: 'RSA-PSS',
                hash: 'SHA-256',
            },
            false,
            ['sign']
        );

        // 签名挑战
        const dataBuffer = new TextEncoder().encode(challenge);
        const signatureBuffer = await crypto.subtle.sign(
            {
                name: 'RSA-PSS',
                saltLength: 32,
            },
            privateKey,
            dataBuffer
        );

        return arrayBufferToBase64(signatureBuffer);
    } catch (error) {
        console.error('挑战签名错误:', error);
        throw error;
    }
}

// 工具函数：PEM转ArrayBuffer（支持私钥和公钥）
function pemToArrayBuffer(pem) {
    const b64 = pem.replace(/-----BEGIN (PRIVATE|PUBLIC) KEY-----/, '')
                   .replace(/-----END (PRIVATE|PUBLIC) KEY-----/, '')
                   .replace(/\s/g, '');
    return base64ToArrayBuffer(b64);
}

// 部署时一次性设置Telegram Webhook
async function setupWebhookOnce(env) {
    try {
        const webhookUrl = `${env.WORKER_DOMAIN}/telegram-webhook`;
        console.log('🚀 部署时自动设置TG Webhook:', webhookUrl);

        const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                allowed_updates: ['message', 'callback_query']
            })
        });

        const result = await response.json();

        if (result.ok) {
            console.log('✅ TG Webhook设置成功! 机器人现在可以使用了');
        } else {
            console.log('❌ TG Webhook设置失败:', result.description);
        }

    } catch (error) {
        console.log('❌ 设置TG Webhook异常:', error.message);
    }
}



// 工具函数：ArrayBuffer转Base64
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binaryString);
}

// 工具函数：十六进制转ArrayBuffer
function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes.buffer;
}

// 工具函数：Base64转ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function Forbidden(url) {
    return new Response(JSON.stringify({
        status: 403,
        type: "主机名限制",
        message: `主机名 ${url.hostname} 不被允许访问`
    }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

export class RateLimiter {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.data = {};
        this.initialized = false;
        this.uaConfig = null; // 将在首次请求时设置
    }

    async initialize() {
        if (this.initialized) return;
        this.data = await this.state.storage.get('data') || {};
        this.initialized = true;
    }

    async fetch(request) {
        await this.initialize();
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({
                status: 405,
                type: "方法不允许",
                message: "无效的方法"
            }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const { action, uaConfig, apiPath, loggingEnabled, clientIP, uaType } = await request.json();

        // 每次请求都更新uaConfig，确保配置是最新的
        if (uaConfig) {
            this.uaConfig = uaConfig;
        }

        if (action === 'check') {
            return this.check(apiPath, loggingEnabled, clientIP, uaType);
        }

        if (action === 'increment') {
            return this.increment(apiPath, loggingEnabled, clientIP, uaType);
        }

        if (action === 'checkAndIncrement') {
            return this.checkAndIncrement(apiPath, loggingEnabled, clientIP, uaType);
        }

        return new Response(JSON.stringify({
            status: 400,
            type: "参数错误",
            message: "无效的操作"
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    check(apiPath, loggingEnabled, clientIP, uaType) {
        if (!this.uaConfig) {
            return new Response(JSON.stringify({ allowed: true }));
        }

        const now = Date.now();
        const currentHour = Math.floor(now / (1000 * 60 * 60));
        const currentDay = Math.floor(now / (1000 * 60 * 60 * 24));

        // 检查全局限制
        const globalHourCount = (this.data.ghts === currentHour) ? (this.data.ghc || 0) : 0;
        if (this.uaConfig.maxRequestsPerHour !== -1 && globalHourCount >= this.uaConfig.maxRequestsPerHour) {
            if (loggingEnabled && clientIP && uaType) {
                console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局小时限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`);
            }
            const reason = `${this.uaConfig.description} 全局小时请求限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`;
            return new Response(JSON.stringify({ allowed: false, reason }), { headers: { 'Content-Type': 'application/json' } });
        }

        const globalDayCount = (this.data.gdts === currentDay) ? (this.data.gdc || 0) : 0;
        if (this.uaConfig.maxRequestsPerDay !== -1 && globalDayCount >= this.uaConfig.maxRequestsPerDay) {
            if (loggingEnabled && clientIP && uaType) {
                console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局每日限制已超出 (${globalDayCount}/${this.uaConfig.maxRequestsPerDay})`);
            }
            const reason = `${this.uaConfig.description} 全局每日请求限制已超出 (${globalDayCount}/${this.uaConfig.maxRequestsPerDay})`;
            return new Response(JSON.stringify({ allowed: false, reason }), { headers: { 'Content-Type': 'application/json' } });
        }

        // 检查路径特定限制
        if (apiPath && this.uaConfig.pathLimits && Array.isArray(this.uaConfig.pathLimits)) { // 确保 apiPath 存在
            const pathLimit = this.uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit && pathLimit.maxRequestsPerHour !== -1) {
                const pathData = this.data.paths && this.data.paths[pathLimit.path] ? this.data.paths[pathLimit.path] : {};
                const pathHourCount = (pathData.phts === currentHour) ? (pathData.phc || 0) : 0;
                if (pathHourCount >= pathLimit.maxRequestsPerHour) {
                    if (loggingEnabled && clientIP && uaType) {
                        console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 路径小时限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`);
                    }
                    const reason = `${this.uaConfig.description} 路径 ${apiPath} 小时请求限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`;
                    return new Response(JSON.stringify({ allowed: false, reason }), { headers: { 'Content-Type': 'application/json' } });
                }
            }
        }

        return new Response(JSON.stringify({ allowed: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    async increment(apiPath, loggingEnabled, clientIP, uaType) {
        // 调试日志：记录increment方法被调用
        if (loggingEnabled) {
            console.log(`DO increment被调用: apiPath=${apiPath}, clientIP=${clientIP}, uaType=${uaType}, uaConfig存在=${!!this.uaConfig}`);
        }

        const now = Date.now();
        const currentHour = Math.floor(now / (1000 * 60 * 60));
        const currentDay = Math.floor(now / (1000 * 60 * 60 * 24));

        // 确保数据结构存在
        if (!this.data) this.data = {};

        // 更新全局计数器
        this.data.ghc = (this.data.ghts === currentHour) ? (this.data.ghc || 0) + 1 : 1;
        this.data.ghts = currentHour;
        this.data.gdc = (this.data.gdts === currentDay) ? (this.data.gdc || 0) + 1 : 1;
        this.data.gdts = currentDay;

        let pathHourCount = 0;
        let matchedPathRule = null;
 
        // 更新路径特定计数器
        if (this.uaConfig && this.uaConfig.pathLimits && Array.isArray(this.uaConfig.pathLimits)) {
            if (loggingEnabled) {
                console.log(`调试: 检查路径限制, API路径=${apiPath}, 配置的路径限制=${JSON.stringify(this.uaConfig.pathLimits)}`);
            }
            const pathLimit = this.uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit) {
                matchedPathRule = pathLimit;
                const pathKey = pathLimit.path;
                if (!this.data.paths) this.data.paths = {};
                if (!this.data.paths[pathKey]) this.data.paths[pathKey] = {};
                this.data.paths[pathKey].phc = (this.data.paths[pathKey].phts === currentHour) ? (this.data.paths[pathKey].phc || 0) + 1 : 1;
                this.data.paths[pathKey].phts = currentHour;
                pathHourCount = this.data.paths[pathKey].phc;
                if (loggingEnabled) {
                    console.log(`调试: 匹配到路径限制 ${pathKey}, 当前计数=${pathHourCount}, 限制=${pathLimit.maxRequestsPerHour}`);
                }
            } else if (loggingEnabled) {
                console.log(`调试: 没有匹配到路径限制`);
            }
        }
 
        // 日志记录
        if (loggingEnabled && clientIP && uaType) {
            const uaConfig = this.uaConfig;

            if (matchedPathRule && uaConfig) {
                const pathDisplay = matchedPathRule.maxRequestsPerHour === -1 ? '∞' : matchedPathRule.maxRequestsPerHour;
                const globalHourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
                const globalDayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
                console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 路径限制=${pathHourCount}/${pathDisplay}/小时, 全局限制=${this.data.ghc}/${globalHourDisplay}/小时, 每日=${this.data.gdc}/${globalDayDisplay}/天, 时间=${new Date().toISOString()}`);
            } else if (uaConfig) {
                const hourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
                const dayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
                console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 全局限制=${this.data.ghc}/${hourDisplay}/小时, 每日=${this.data.gdc}/${dayDisplay}/天, 时间=${new Date().toISOString()}`);
            } else {
                // 如果uaConfig为null，仍然记录基本信息
                console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 全局计数=${this.data.ghc}/小时, 每日=${this.data.gdc}/天, 时间=${new Date().toISOString()}`);
            }
        }
 
        // 恢复 alarm 机制，以确保日志可以被及时打印
        // alarm 会在后台将内存状态写入存储
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
            const alarmTime = Date.now() + ALARM_INTERVAL_SECONDS * 1000;
            await this.state.storage.setAlarm(alarmTime);
        }
 
        return new Response('OK');
    }

    // 新增：同步检查并更新计数器的方法
    async checkAndIncrement(apiPath, loggingEnabled, clientIP, uaType) {
        // 先检查是否超限（直接调用内部逻辑，不通过Response）
        const checkData = this.performCheck(apiPath, loggingEnabled, clientIP, uaType);

        if (!checkData.allowed) {
            return new Response(JSON.stringify(checkData), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 如果检查通过，立即更新计数器
        await this.increment(apiPath, loggingEnabled, clientIP, uaType);

        // 获取路径特定的计数信息用于满载检测
        const pathSpecificInfo = this.getPathSpecificInfo(apiPath);

        return new Response(JSON.stringify({
            allowed: true,
            pathSpecificCount: pathSpecificInfo.currentCount,
            pathLimit: pathSpecificInfo.limit
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 获取路径特定的计数信息
    getPathSpecificInfo(apiPath) {
        const now = Date.now();
        const currentHour = Math.floor(now / (60 * 60 * 1000));

        // 检查路径特定限制
        for (const [pattern, config] of Object.entries(this.uaConfig.pathLimits || {})) {
            if (apiPath.includes(pattern)) {
                const pathKey = `${pattern}_${currentHour}`;
                const currentCount = this.data.paths?.[pathKey]?.phc || 0;

                return {
                    currentCount: currentCount,
                    limit: config.hourlyLimit,
                    pattern: pattern
                };
            }
        }

        // 如果没有路径特定限制，返回全局限制信息
        return {
            currentCount: this.data.ghc || 0,
            limit: this.uaConfig.globalLimits?.hourlyLimit || 0,
            pattern: 'global'
        };
    }

    // 提取检查逻辑为独立方法
    performCheck(apiPath, loggingEnabled, clientIP, uaType) {
        if (!this.uaConfig) {
            return { allowed: true };
        }

        const now = Date.now();
        const currentHour = Math.floor(now / (1000 * 60 * 60));
        const currentDay = Math.floor(now / (1000 * 60 * 60 * 24));

        // 检查全局限制
        const globalHourCount = (this.data.ghts === currentHour) ? (this.data.ghc || 0) : 0;
        if (this.uaConfig.maxRequestsPerHour !== -1 && globalHourCount >= this.uaConfig.maxRequestsPerHour) {
            if (loggingEnabled && clientIP && uaType) {
                console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局小时限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`);
            }
            const reason = `${this.uaConfig.description} 全局小时请求限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`;
            return { allowed: false, reason };
        }

        const globalDayCount = (this.data.gdts === currentDay) ? (this.data.gdc || 0) : 0;
        if (this.uaConfig.maxRequestsPerDay !== -1 && globalDayCount >= this.uaConfig.maxRequestsPerDay) {
            if (loggingEnabled && clientIP && uaType) {
                console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局每日限制已超出 (${globalDayCount}/${this.uaConfig.maxRequestsPerDay})`);
            }
            const reason = `${this.uaConfig.description} 全局每日请求限制已超出 (${globalDayCount}/${this.uaConfig.maxRequestsPerDay})`;
            return { allowed: false, reason };
        }

        // 检查路径特定限制
        if (apiPath && this.uaConfig.pathLimits && Array.isArray(this.uaConfig.pathLimits)) {
            const pathLimit = this.uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit && pathLimit.maxRequestsPerHour !== -1) {
                const pathKey = pathLimit.path;
                const pathHourCount = (this.data.paths && this.data.paths[pathKey] && this.data.paths[pathKey].phts === currentHour)
                    ? (this.data.paths[pathKey].phc || 0) : 0;

                if (pathHourCount >= pathLimit.maxRequestsPerHour) {
                    if (loggingEnabled && clientIP && uaType) {
                        console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 路径小时限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`);
                    }
                    const reason = `${this.uaConfig.description} 路径 ${pathLimit.path} 小时请求限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`;
                    return { allowed: false, reason };
                }
            }
        }

        return { allowed: true };
    }

    async alarm() {
        // 定时器触发，将内存数据写入持久化存储
        await this.state.storage.put('data', this.data);

        // 执行数据清理
        await this.cleanupOldData();

        // 设置下一个alarm
        this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_SECONDS * 1000);
    }

    async cleanupOldData() {
        const now = Date.now();
        const cutoffTime = now - (DATA_RETENTION_HOURS * 60 * 60 * 1000);
        const currentHour = Math.floor(now / (60 * 60 * 1000));
        const cutoffHour = Math.floor(cutoffTime / (60 * 60 * 1000));
        const currentDay = Math.floor(now / (24 * 60 * 60 * 1000));
        const cutoffDay = Math.floor(cutoffTime / (24 * 60 * 60 * 1000));

        let cleaned = false;

        // 清理过期的全局小时计数
        if (this.data.ghts && this.data.ghts < cutoffHour) {
            delete this.data.ghc;
            delete this.data.ghts;
            cleaned = true;
        }

        // 清理过期的全局日计数
        if (this.data.gdts && this.data.gdts < cutoffDay) {
            delete this.data.gdc;
            delete this.data.gdts;
            cleaned = true;
        }

        // 清理过期的路径特定计数
        if (this.data.paths) {
            for (const [pathKey, pathData] of Object.entries(this.data.paths)) {
                if (pathData.phts && pathData.phts < cutoffHour) {
                    delete this.data.paths[pathKey];
                    cleaned = true;
                }
            }

            // 如果paths对象为空，删除它
            if (Object.keys(this.data.paths).length === 0) {
                delete this.data.paths;
                cleaned = true;
            }
        }

        // 如果有数据被清理，立即保存
        if (cleaned) {
            await this.state.storage.put('data', this.data);
            console.log(`RateLimiter数据清理完成，清理了${new Date(cutoffTime).toISOString()}之前的数据`);
        }
    }
}

// 简化的AppState类 - 专门处理AppSecret轮换
export class AppState {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.initialized = this.initialize();
    }

    async initialize() {
        if (!this.appState) {
            this.appState = await this.state.storage.get('app_secret_state') || {
                current: '1',
                count1: 0,
                count2: 0
            };
        }
    }

    async fetch(request) {
        await this.initialized;
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({
                status: 405,
                type: "方法不允许",
                message: "无效的方法"
            }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const requestData = await request.json();
        const { action, loggingEnabled } = requestData;

        if (action === 'getSecretId') {
            return this.getSecretId(loggingEnabled);
        }

        if (action === 'recordUsage') {
            return this.recordUsage(loggingEnabled);
        }

        if (action === 'batchRecordUsage') {
            return this.batchRecordUsage(requestData);
        }

        if (action === 'getState') {
            return this.getState();
        }

        return new Response(JSON.stringify({
            status: 400,
            type: "参数错误",
            message: "无效的操作"
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    async getSecretId(loggingEnabled) {
        if (!this.env.APP_SECRET_2) {
            return new Response('1'); // 如果没有第二个密钥，总是使用第一个
        }

        if (loggingEnabled) {
            console.log(`Secret1使用次数: ${this.appState.count1}, Secret2使用次数: ${this.appState.count2}, 当前使用: Secret${this.appState.current}`);
        }

        // 检查是否需要切换
        if (this.appState.current === '1' && this.appState.count1 >= SECRET_ROTATION_LIMIT) {
            this.appState.current = '2';
            this.appState.count1 = 0;
            await this.state.storage.put('app_secret_state', this.appState);
            if (loggingEnabled) console.log('切换到APP_SECRET_2');
            return new Response('2');
        } else if (this.appState.current === '2' && this.appState.count2 >= SECRET_ROTATION_LIMIT) {
            this.appState.current = '1';
            this.appState.count2 = 0;
            await this.state.storage.put('app_secret_state', this.appState);
            if (loggingEnabled) console.log('切换到APP_SECRET');
            return new Response('1');
        }

        return new Response(this.appState.current);
    }

    async recordUsage(loggingEnabled) {
        // 简化的使用记录，每次调用都增加计数
        if (this.appState.current === '1') {
            this.appState.count1++;
        } else {
            this.appState.count2++;
        }

        // 定期保存到持久化存储（每10次保存一次）
        if ((this.appState.count1 + this.appState.count2) % 10 === 0) {
            await this.state.storage.put('app_secret_state', this.appState);
        }

        return new Response('OK');
    }

    async batchRecordUsage({ count1, count2 }) {
        // 批量记录使用次数
        this.appState.count1 += count1 || 0;
        this.appState.count2 += count2 || 0;

        // 立即保存到持久化存储
        await this.state.storage.put('app_secret_state', this.appState);

        return new Response('OK');
    }

    async getState() {
        // 返回当前状态
        return new Response(JSON.stringify(this.appState), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    async alarm() {
        // 定期保存状态
        await this.state.storage.put('app_secret_state', this.appState);

        // AppState数据相对简单，主要是重置过高的计数器
        await this.cleanupCounters();
    }

    async cleanupCounters() {
        let needsSave = false;

        // 如果计数器过高（超过轮换限制的10倍），重置为合理值
        const maxCount = SECRET_ROTATION_LIMIT * 10;

        if (this.appState.count1 > maxCount) {
            this.appState.count1 = Math.min(this.appState.count1, SECRET_ROTATION_LIMIT);
            needsSave = true;
        }

        if (this.appState.count2 > maxCount) {
            this.appState.count2 = Math.min(this.appState.count2, SECRET_ROTATION_LIMIT);
            needsSave = true;
        }

        if (needsSave) {
            await this.state.storage.put('app_secret_state', this.appState);
            console.log('AppState计数器清理完成');
        }
    }
}

// 导出函数供TG机器人模块使用
export { getIpBlacklist, getAccessConfig, memoryCache };
