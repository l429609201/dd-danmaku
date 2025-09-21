// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 弹弹play API 配置（从 Workers 环境变量获取）
const appId = APP_ID;
const appSecret = APP_SECRET;

// 功能开关配置（从环境变量获取）
const ENABLE_RATE_LIMIT = (typeof ENABLE_RATE_LIMIT_ENV !== 'undefined') ? ENABLE_RATE_LIMIT_ENV === 'true' : true; // 是否启用频率限制，默认启用
const ENABLE_ASYMMETRIC_AUTH = (typeof ENABLE_ASYMMETRIC_AUTH_ENV !== 'undefined') ? ENABLE_ASYMMETRIC_AUTH_ENV === 'true' : false; // 是否启用非对称认证，默认禁用

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// ========================================
// 🛡️ 访问控制配置 - 基于UA的分级限制
// ========================================

// 默认的 User-Agent 限制配置
const DEFAULT_USER_AGENT_LIMITS = {
    // 专属客户端 - 最高优先级
    "MisakaDanmaku": {
        enabled: true, // 是否启用此客户端
        name: "misaka-dd-danmaku",
        version: "1.0.0",
        pattern: "misaka-dd-danmaku",
        maxRequestsPerHour: 100,
        maxRequestsPerDay: 1000,
        description: "Misaka弹幕专用客户端"
    }
};

// 从环境变量获取 User-Agent 限制配置
function getUserAgentLimits() {
    let limits = DEFAULT_USER_AGENT_LIMITS;

    // 尝试从环境变量获取自定义配置
    if (typeof USER_AGENT_LIMITS_CONFIG !== 'undefined' && USER_AGENT_LIMITS_CONFIG) {
        try {
            limits = JSON.parse(USER_AGENT_LIMITS_CONFIG);
        } catch (error) {
            console.error('解析 USER_AGENT_LIMITS_CONFIG 失败，使用默认配置:', error);
        }
    }

    // 过滤出启用的客户端
    const enabledLimits = {};
    Object.keys(limits).forEach(key => {
        const config = limits[key];
        if (config && config.enabled !== false) { // 默认启用，除非明确设置为 false
            enabledLimits[key] = config;
        }
    });

    return enabledLimits;
}

const ACCESS_CONFIG = {
    // 基于User-Agent的分级限制配置（从环境变量动态获取）
    get userAgentLimits() {
        return getUserAgentLimits();
    },

    // 非对称密钥验证配置
    asymmetricAuth: {
        enabled: ENABLE_ASYMMETRIC_AUTH, // 从环境变量控制是否启用
        privateKeyHex: (typeof PRIVATE_KEY_HEX !== 'undefined') ? PRIVATE_KEY_HEX : null, // Worker端私钥（十六进制格式，从环境变量获取）
        challengeEndpoint: '/auth/challenge' // 挑战端点
    }
};



async function handleRequest(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, User-Agent, X-Challenge-Response',
            },
        });
    }

    const urlObj = new URL(request.url);

    // 新增：处理挑战端点
    if (ACCESS_CONFIG.asymmetricAuth.enabled && urlObj.pathname === ACCESS_CONFIG.asymmetricAuth.challengeEndpoint) {
        return handleAuthChallenge(request);
    }

    // 新增：访问控制检查（如果启用）
    if (ENABLE_RATE_LIMIT) {
        const accessCheck = await checkAccess(request);
        if (!accessCheck.allowed) {
            return new Response(accessCheck.reason, {
                status: accessCheck.status,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }
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

    const timestamp = Math.floor(Date.now() / 1000);
    const apiPath = tUrlObj.pathname;
    const signature = await generateSignature(appId, timestamp, apiPath, appSecret);
    console.log('应用ID: ' + appId);
    console.log('签名: ' + signature);
    console.log('时间戳: ' + timestamp);
    console.log('API路径: ' + apiPath);
    
    let response = await fetch(url, {
        headers: {
            ...request.headers,
            "X-AppId": appId,
            "X-Signature": signature,
            "X-Timestamp": timestamp,
            "X-Auth": "1",
        },
        body: request.body,
        method: request.method,
    });
    response = new Response(response.body, response);
    response.headers.set('Access-Control-Allow-Origin', '*');

    // 新增：记录请求到KV存储
    await recordRequest(request);

    return response;
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
async function checkAccess(request) {
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';

    // 1. 识别User-Agent类型并获取对应限制
    const uaConfig = identifyUserAgent(userAgent);
    if (!uaConfig) {
        return { allowed: false, reason: '未识别的用户代理', status: 403 };
    }

    // 2. 基于UA类型的频率限制检查（如果启用）
    if (ENABLE_RATE_LIMIT) {
        const rateLimitCheck = await checkRateLimitByUA(clientIP, uaConfig);
        if (!rateLimitCheck.allowed) {
            return { allowed: false, reason: rateLimitCheck.reason, status: 429 };
        }
    }

    // 3. 非对称密钥验证（如果启用）
    if (ACCESS_CONFIG.asymmetricAuth.enabled) {
        const authCheck = await verifyAsymmetricAuth(request);
        if (!authCheck.allowed) {
            return { allowed: false, reason: authCheck.reason, status: 401 };
        }
    }

    return { allowed: true, uaConfig: uaConfig };
}

// 新增：识别User-Agent类型
function identifyUserAgent(userAgent) {
    for (const [key, config] of Object.entries(ACCESS_CONFIG.userAgentLimits)) {
        if (key === 'default') continue;

        if (config.pattern && userAgent.includes(config.pattern)) {
            return { ...config, type: key };
        }
    }

    // 如果没有匹配到，使用默认配置
    return { ...ACCESS_CONFIG.userAgentLimits.default, type: 'default' };
}

// 新增：基于UA类型的频率限制检查
async function checkRateLimitByUA(clientIP, uaConfig) {
    const now = Date.now();
    const uaType = uaConfig.type;
    const hourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}`;
    const dayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}`;

    try {
        // 检查小时限制
        const hourCount = parseInt(await RATE_LIMIT_KV.get(hourKey) || '0');
        if (hourCount >= uaConfig.maxRequestsPerHour) {
            return {
                allowed: false,
                reason: `${uaConfig.description} 小时请求限制已超出 (${hourCount}/${uaConfig.maxRequestsPerHour})`
            };
        }

        // 检查日限制
        const dayCount = parseInt(await RATE_LIMIT_KV.get(dayKey) || '0');
        if (dayCount >= uaConfig.maxRequestsPerDay) {
            return {
                allowed: false,
                reason: `${uaConfig.description} 每日请求限制已超出 (${dayCount}/${uaConfig.maxRequestsPerDay})`
            };
        }

        return { allowed: true };
    } catch (error) {
        // KV存储不可用时允许通过
        console.error('频率限制检查失败:', error);
        return { allowed: true };
    }
}

// 新增：记录请求（基于UA类型）
async function recordRequest(request) {
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    const uaConfig = identifyUserAgent(userAgent);
    const uaType = uaConfig.type;

    const now = Date.now();
    const hourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}`;
    const dayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}`;

    try {
        // 更新计数器
        const hourCount = parseInt(await RATE_LIMIT_KV.get(hourKey) || '0') + 1;
        const dayCount = parseInt(await RATE_LIMIT_KV.get(dayKey) || '0') + 1;

        await RATE_LIMIT_KV.put(hourKey, hourCount.toString(), { expirationTtl: 3600 }); // 1小时过期
        await RATE_LIMIT_KV.put(dayKey, dayCount.toString(), { expirationTtl: 86400 }); // 1天过期

        // 记录访问日志（可选）
        console.log(`请求已记录: IP=${clientIP}, 用户代理=${uaType}, 小时=${hourCount}/${uaConfig.maxRequestsPerHour}, 每日=${dayCount}/${uaConfig.maxRequestsPerDay}`);
    } catch (error) {
        console.error('记录请求失败:', error);
    }
}

// 新增：处理挑战-响应认证
async function handleAuthChallenge(request) {
    if (request.method !== 'POST') {
        return new Response('请求方法不被允许', { status: 405 });
    }

    try {
        const { challenge } = await request.json();
        if (!challenge) {
            return new Response('缺少挑战参数', { status: 400 });
        }

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

addEventListener('fetch', (event) => {
    return event.respondWith(handleRequest(event.request));
});