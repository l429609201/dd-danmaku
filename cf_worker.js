// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// ========================================
// 🛡️ 访问控制配置 - 基于UA的分级限制
// ========================================



// 从环境变量获取 User-Agent 限制配置
function getUserAgentLimits(env) {
    // 必须从环境变量获取配置，没有默认配置
    if (!env.USER_AGENT_LIMITS_CONFIG) {
        console.error('USER_AGENT_LIMITS_CONFIG 环境变量未配置，拒绝所有请求');
        return {};
    }

    try {
        const limits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);

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
        return await handleRequest(request, env);
    }
};

async function handleRequest(request, env) {
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
    const ACCESS_CONFIG = getAccessConfig(env);

    // 新增：处理挑战端点
    if (ACCESS_CONFIG.asymmetricAuth.enabled && urlObj.pathname === ACCESS_CONFIG.asymmetricAuth.challengeEndpoint) {
        return handleAuthChallenge(request, env);
    }

    // 新增：访问控制检查
    const accessCheck = await checkAccess(request, env);
    if (!accessCheck.allowed) {
        // 获取客户端信息
        const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        const userAgent = request.headers.get('User-Agent') || '';

        // 格式化错误消息
        const errorMessage = `IP:${clientIP} UA:${userAgent} 消息：${accessCheck.reason}`;

        // 详细日志记录
        const ACCESS_CONFIG = getAccessConfig(env);
        if (ACCESS_CONFIG.logging.enabled) {
            console.log(`访问被拒绝: ${errorMessage}, 路径=${urlObj.pathname}`);
        }

        return new Response(errorMessage, {
            status: accessCheck.status,
            headers: { 'Access-Control-Allow-Origin': '*' }
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
    const appSecret = env.APP_SECRET;

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
    await recordRequest(request, env, apiPath);

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
async function checkAccess(request, env) {
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    const urlObj = new URL(request.url);
    const apiPath = urlObj.pathname.replace('/cors', ''); // 提取实际的API路径
    const ACCESS_CONFIG = getAccessConfig(env);

    // 1. 识别User-Agent类型并获取对应限制
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    if (!uaConfig) {
        return { allowed: false, reason: '禁止访问的UA', status: 403 };
    }

    // 2. 基于UA类型和路径的频率限制检查
    const rateLimitCheck = await checkRateLimitByUA(clientIP, uaConfig, env, apiPath);
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

    return { allowed: true, uaConfig: uaConfig };
}

// 新增：识别User-Agent类型
function identifyUserAgent(userAgent, ACCESS_CONFIG) {
    for (const [key, config] of Object.entries(ACCESS_CONFIG.userAgentLimits)) {
        if (key === 'default') continue;

        if (config.userAgent && userAgent.includes(config.userAgent)) {
            return { ...config, type: key };
        }
    }

    // 如果没有匹配到，返回 null（禁止访问）
    return null;
}

// 新增：基于UA类型和路径的频率限制检查
async function checkRateLimitByUA(clientIP, uaConfig, env, apiPath = '') {
    const now = Date.now();
    const uaType = uaConfig.type;
    const ACCESS_CONFIG = getAccessConfig(env);

    // 检查是否有路径特定限制
    let hourLimit = uaConfig.maxRequestsPerHour;
    let dayLimit = uaConfig.maxRequestsPerDay;
    let pathSpecific = false;

    // 检查UA配置中的pathLimits数组
    if (apiPath && uaConfig.pathLimits && Array.isArray(uaConfig.pathLimits)) {
        const pathLimit = uaConfig.pathLimits.find(limit => limit.path === apiPath);
        if (pathLimit) {
            if (pathLimit.maxRequestsPerHour === -1) {
                // -1 表示不限制
                if (ACCESS_CONFIG.logging.enabled) {
                    console.log(`路径特定限制: ${apiPath} 对 ${uaType} 不限制访问`);
                }
                return { allowed: true };
            } else {
                hourLimit = pathLimit.maxRequestsPerHour;
                pathSpecific = true;
            }
        }
    }

    const hourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}${pathSpecific ? '_' + apiPath.replace(/\//g, '_') : ''}`;
    const dayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}${pathSpecific ? '_' + apiPath.replace(/\//g, '_') : ''}`;

    try {
        // 检查小时限制
        const hourCount = parseInt(await env.RATE_LIMIT_KV.get(hourKey) || '0');
        if (hourCount >= hourLimit) {
            const limitType = pathSpecific ? `路径 ${apiPath} 的` : '';
            return {
                allowed: false,
                reason: `${uaConfig.description} ${limitType}小时请求限制已超出 (${hourCount}/${hourLimit})`
            };
        }

        // 检查日限制（只有非路径特定限制才检查日限制）
        if (!pathSpecific) {
            const dayCount = parseInt(await env.RATE_LIMIT_KV.get(dayKey) || '0');
            if (dayCount >= dayLimit) {
                return {
                    allowed: false,
                    reason: `${uaConfig.description} 每日请求限制已超出 (${dayCount}/${dayLimit})`
                };
            }
        }

        // 详细日志记录
        if (ACCESS_CONFIG.logging.enabled) {
            const limitInfo = pathSpecific ? `路径特定限制(${apiPath}): ${hourLimit}/小时` : `全局限制: ${hourLimit}/小时, ${dayLimit}/天`;
            console.log(`频率检查通过: IP=${clientIP}, UA=${uaType}, ${limitInfo}, 当前: ${hourCount}次/小时`);
        }

        return { allowed: true };
    } catch (error) {
        // KV存储不可用时允许通过
        console.error('频率限制检查失败:', error);
        return { allowed: true };
    }
}

// 新增：记录请求（基于UA类型和路径）
async function recordRequest(request, env, apiPath = '') {
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    const ACCESS_CONFIG = getAccessConfig(env);
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    const uaType = uaConfig.type;

    const now = Date.now();

    // 检查是否有路径特定限制
    let pathSpecific = false;
    let pathLimitValue = null;
    if (apiPath && uaConfig.pathLimits && Array.isArray(uaConfig.pathLimits)) {
        const pathLimit = uaConfig.pathLimits.find(limit => limit.path === apiPath);
        if (pathLimit) {
            pathSpecific = true;
            pathLimitValue = pathLimit.maxRequestsPerHour;
        }
    }

    const hourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}${pathSpecific ? '_' + apiPath.replace(/\//g, '_') : ''}`;
    const dayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}${pathSpecific ? '_' + apiPath.replace(/\//g, '_') : ''}`;

    try {
        // 更新计数器
        const hourCount = parseInt(await env.RATE_LIMIT_KV.get(hourKey) || '0') + 1;
        const dayCount = parseInt(await env.RATE_LIMIT_KV.get(dayKey) || '0') + 1;

        await env.RATE_LIMIT_KV.put(hourKey, hourCount.toString(), { expirationTtl: 3600 }); // 1小时过期

        // 只有非路径特定限制才记录日计数
        if (!pathSpecific) {
            await env.RATE_LIMIT_KV.put(dayKey, dayCount.toString(), { expirationTtl: 86400 }); // 1天过期
        }

        // 详细日志记录
        if (ACCESS_CONFIG.logging.enabled) {
            const pathInfo = pathSpecific ? ` 路径=${apiPath}` : '';
            const limitInfo = pathSpecific ?
                `${hourCount}/${pathLimitValue || '∞'}/小时` :
                `小时=${hourCount}/${uaConfig.maxRequestsPerHour}, 每日=${dayCount}/${uaConfig.maxRequestsPerDay}`;
            console.log(`请求已记录: IP=${clientIP}, UA=${uaType}${pathInfo}, ${limitInfo}, 时间=${new Date().toISOString()}`);
        }
    } catch (error) {
        console.error('记录请求失败:', error);
    }
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

