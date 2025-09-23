// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// AppSecret轮换配置
const SECRET_ROTATION_LIMIT = 500; // 每个secret使用500次后切换

// AppSecret使用次数记录采样率，用于减少Durable Object的计算负载
const SECRET_USAGE_SAMPLING_RATE = 0.1; // 10%的请求会记录使用次数

// ========================================
// ⚙️ Durable Object 配置
// ========================================
const ALARM_INTERVAL_SECONDS = 60; // 每60秒强制将内存中的计数写入存储，以确保在免费额度内

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



export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  },
};


async function handleRequest(request, env, ctx) {
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

    // IP黑名单检查
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const ipBlacklist = getIpBlacklist(env);
    if (isIpBlacklisted(clientIP, ipBlacklist)) {
        console.log(`IP ${clientIP} 在黑名单中，拒绝访问`);
        return new Response('Access denied', { status: 403 });
    }

    // 新增：处理挑战端点
    if (ACCESS_CONFIG.asymmetricAuth.enabled && urlObj.pathname === ACCESS_CONFIG.asymmetricAuth.challengeEndpoint) {
        return handleAuthChallenge(request, env);
    }

    // 新增：访问控制检查
    const accessCheck = await checkAccess(request, env);
    if (!accessCheck.allowed) {
        // 获取客户端信息
        const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        const userAgent = request.headers.get('X-User-Agent') || '';

        // 格式化错误消息
        const errorMessage = `IP:${clientIP} UA:${userAgent} 消息：${accessCheck.reason}`;

        // 详细日志记录
        const ACCESS_CONFIG = getAccessConfig(env);
        if (ACCESS_CONFIG.logging.enabled) {
            console.log(`访问被拒绝: ${errorMessage}, 路径=${urlObj.pathname}`);
        }

        // 统一错误响应为JSON格式
        const errorResponse = {
            status: accessCheck.status,
            message: errorMessage
        };
        return new Response(JSON.stringify(errorResponse), {
            status: accessCheck.status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

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

    const appId = env.APP_ID;
    // 优化：从 AppState DO 获取密钥
    const appStateStub = env.APP_STATE.get(env.APP_STATE.idFromName("global"));
    const secretResponse = await appStateStub.fetch(new Request('https://do.internal/getSecret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getSecret', loggingEnabled: ACCESS_CONFIG.logging.enabled })
    }));
    const appSecret = await secretResponse.text();


    const timestamp = Math.floor(Date.now() / 1000);
    const apiPath = tUrlObj.pathname;
    const signature = await generateSignature(appId, timestamp, apiPath, appSecret);

    // 记录AppSecret使用次数
    ctx.waitUntil(recordAppSecretUsage(env, ACCESS_CONFIG.logging.enabled));
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

    // 新增：记录请求到KV存储
    ctx.waitUntil(accessCheck.doStub.fetch(new Request('https://do.internal/increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'increment', apiPath: accessCheck.apiPath, loggingEnabled: ACCESS_CONFIG.logging.enabled })
    })));

    return response;
}

// AppSecret轮换管理
async function getCurrentAppSecret(env) { // 此函数现在仅作为备份，主要逻辑在DO中
    const appStateStub = env.APP_STATE.get(env.APP_STATE.idFromName("global"));
    const response = await appStateStub.fetch(new Request('https://do.internal/getSecret'));
    return await response.text();
}

// 记录AppSecret使用次数
async function recordAppSecretUsage(env, loggingEnabled) {
    const appStateStub = env.APP_STATE.get(env.APP_STATE.idFromName("global"));
    await appStateStub.fetch(new Request('https://do.internal/recordUsage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recordUsage', loggingEnabled: loggingEnabled })
    }));
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
async function checkAccess(request, env) {
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
    const urlObj = new URL(request.url);
    const apiPath = urlObj.pathname.replace('/cors', ''); // 提取实际的API路径
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
        return new Response('请求方法不被允许', { status: 405 });
    }

    try {
        const { challenge } = await request.json();
        if (!challenge) {
            return new Response('缺少挑战参数', { status: 400 });
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
        return new Response('挑战处理错误', { status: 500 });
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
    return new Response(`主机名 ${url.hostname} 不被允许访问`, {
        status: 403,
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
            return new Response('无效的方法', { status: 405 });
        }
        const { action, uaConfig, apiPath, loggingEnabled } = await request.json();

        // 首次请求时，存储uaConfig
        if (uaConfig && !this.uaConfig) {
            this.uaConfig = uaConfig;
        }

        if (action === 'check') {
            return this.check(apiPath, loggingEnabled); // 确保将 apiPath 和 loggingEnabled 传递给 check 方法
        }

        if (action === 'increment') {
            return this.increment(apiPath, loggingEnabled);
        }

        return new Response('无效的操作', { status: 400 });
    }

    check(apiPath, loggingEnabled) {
        if (!this.uaConfig) {
            return new Response(JSON.stringify({ allowed: true }));
        }

        const now = Date.now();
        const currentHour = Math.floor(now / (1000 * 60 * 60));
        const currentDay = Math.floor(now / (1000 * 60 * 60 * 24));

        // 检查全局限制
        const globalHourCount = (this.data.ghts === currentHour) ? (this.data.ghc || 0) : 0;
        if (this.uaConfig.maxRequestsPerHour !== -1 && globalHourCount >= this.uaConfig.maxRequestsPerHour) {
            if (loggingEnabled) {
                const [uaType, clientIP] = this.state.id.name().split('-', 2);
                console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局小时限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`);
            }
            const reason = `${this.uaConfig.description} 全局小时请求限制已超出 (${globalHourCount}/${this.uaConfig.maxRequestsPerHour})`;
            return new Response(JSON.stringify({ allowed: false, reason }), { headers: { 'Content-Type': 'application/json' } });
        }

        const globalDayCount = (this.data.gdts === currentDay) ? (this.data.gdc || 0) : 0;
        if (this.uaConfig.maxRequestsPerDay !== -1 && globalDayCount >= this.uaConfig.maxRequestsPerDay) {
            const [uaType, clientIP] = this.state.id.name().split('-', 2);
            console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 全局每日限制已超出 (${globalDayCount}/${this.uaConfig.maxRequestsPerDay})`);
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
                    const [uaType, clientIP] = this.state.id.name().split('-', 2);
                    console.log(`频率限制拒绝: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 原因: 路径小时限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`);
                    const reason = `${this.uaConfig.description} 路径 ${apiPath} 小时请求限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})`;
                    return new Response(JSON.stringify({ allowed: false, reason }), { headers: { 'Content-Type': 'application/json' } });
                }
            }
        }

        return new Response(JSON.stringify({ allowed: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    async increment(apiPath, loggingEnabled) {
        const now = Date.now();
        const currentHour = Math.floor(now / (1000 * 60 * 60));
        const currentDay = Math.floor(now / (1000 * 60 * 60 * 24));

        // 更新全局计数器
        this.data.ghc = (this.data.ghts === currentHour) ? (this.data.ghc || 0) + 1 : 1;
        this.data.ghts = currentHour;
        this.data.gdc = (this.data.gdts === currentDay) ? (this.data.gdc || 0) + 1 : 1;
        this.data.gdts = currentDay;

        let pathHourCount = 0;
        let matchedPathRule = null;

        // 更新路径特定计数器
        if (this.uaConfig && this.uaConfig.pathLimits && Array.isArray(this.uaConfig.pathLimits)) {
            const pathLimit = this.uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit) {
                matchedPathRule = pathLimit;
                const pathKey = pathLimit.path;
                if (!this.data.paths) this.data.paths = {};
                if (!this.data.paths[pathKey]) this.data.paths[pathKey] = {};
                this.data.paths[pathKey].phc = (this.data.paths[pathKey].phts === currentHour) ? (this.data.paths[pathKey].phc || 0) + 1 : 1;
                this.data.paths[pathKey].phts = currentHour;
                pathHourCount = this.data.paths[pathKey].phc;
            }
        }

        // 日志记录
        if (loggingEnabled) {
            const [uaType, clientIP] = this.state.id.name().split('-', 2);
            const uaConfig = this.uaConfig;

            if (matchedPathRule) {
                const pathDisplay = matchedPathRule.maxRequestsPerHour === -1 ? '∞' : matchedPathRule.maxRequestsPerHour;
                const globalHourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
                const globalDayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
                console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 路径限制=${pathHourCount}/${pathDisplay}/小时, 全局限制=${this.data.ghc}/${globalHourDisplay}/小时, 每日=${this.data.gdc}/${globalDayDisplay}/天, 时间=${new Date().toISOString()}`);
            } else {
                const hourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
                const dayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
                console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 全局限制=${this.data.ghc}/${hourDisplay}/小时, 每日=${this.data.gdc}/${dayDisplay}/天, 时间=${new Date().toISOString()}`);
            }
        }

        // 设置一个定时器，在10秒后将内存中的数据写入持久化存储
        // 这可以避免每次请求都写入，从而大幅降低写入成本
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
            const alarmTime = Date.now() + ALARM_INTERVAL_SECONDS * 1000;
            await this.state.storage.setAlarm(alarmTime);
        }

        return new Response('OK');
    }

    async alarm() {
        // 定时器触发，将内存数据写入持久化存储
        await this.state.storage.put('data', this.data);
    }
}

export class AppState {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.appState = {};
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        this.appState = await this.state.storage.get('app_secret_state') || { current: '1', count1: 0, count2: 0 };
        this.initialized = true;
    }

    async fetch(request) {
        await this.initialize();
        if (request.method !== 'POST') {
            return new Response('无效的方法', { status: 405 });
        }
        const { action, loggingEnabled } = await request.json();

        if (action === 'getSecret') {
            return this.getSecret(loggingEnabled);
        }

        if (action === 'recordUsage') {
            return this.recordUsage(loggingEnabled);
        }

        return new Response('无效的操作', { status: 400 });
    }

    async getSecret(loggingEnabled) {
        const appSecret1 = this.env.APP_SECRET;
        const appSecret2 = this.env.APP_SECRET_2;

        if (!appSecret2) return new Response(appSecret1);
        if (loggingEnabled) {
            console.log(`Secret1使用次数: ${this.appState.count1}, Secret2使用次数: ${this.appState.count2}, 当前使用: Secret${this.appState.current}`);
        }

        if (this.appState.current === '1' && this.appState.count1 >= SECRET_ROTATION_LIMIT) {
            this.appState.current = '2';
            this.appState.count1 = 0;
            console.log('切换到APP_SECRET_2');
            // 立即写入状态，因为这是一个重要变更
            await this.state.storage.put('app_secret_state', this.appState);
            return new Response(appSecret2);
        } else if (this.appState.current === '2' && this.appState.count2 >= SECRET_ROTATION_LIMIT) {
            this.appState.current = '1';
            this.appState.count2 = 0;
            console.log('切换到APP_SECRET');
            await this.state.storage.put('app_secret_state', this.appState);
            return new Response(appSecret1);
        }

        return new Response(this.appState.current === '1' ? appSecret1 : appSecret2);
    }

    async recordUsage(loggingEnabled) {
        if (Math.random() > SECRET_USAGE_SAMPLING_RATE) {
            return new Response('OK');
        }

        const increment = Math.round(1 / SECRET_USAGE_SAMPLING_RATE);
        if (this.appState.current === '1') {
            this.appState.count1 += increment;
        } else {
            this.appState.count2 += increment;
        }

        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
            await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_SECONDS * 1000);
        }

        return new Response('OK');
    }

    async alarm() {
        await this.state.storage.put('app_secret_state', this.appState);
        console.log('AppState 已持久化存储');
    }
}
