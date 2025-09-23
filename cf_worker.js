// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// AppSecret轮换配置
const SECRET_ROTATION_LIMIT = 500; // 每个secret使用500次后切换

// ========================================
// 🛡️ 访问控制配置 - 基于UA的分级限制
// ========================================



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
    const appSecret = await getCurrentAppSecret(env);

    const timestamp = Math.floor(Date.now() / 1000);
    const apiPath = tUrlObj.pathname;
    const signature = await generateSignature(appId, timestamp, apiPath, appSecret);

    // 记录AppSecret使用次数
    await recordAppSecretUsage(env);
    console.log('应用ID: ' + appId);
    console.log('签名: ' + signature);
    console.log('时间戳: ' + timestamp);
    console.log('API路径: ' + apiPath);
    
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
    console.log('转发请求头:', JSON.stringify(finalHeaders, null, 2));

    let response = await fetch(url, {
        headers: finalHeaders,
        body: request.body,
        method: request.method,
    });

    // 调试日志：显示dandanplay API响应内容
    console.log('dandanplay API响应状态:', response.status, response.statusText);

    // 读取响应内容用于日志记录
    const responseText = await response.text();
    console.log('dandanplay API响应内容:', responseText);

    // 重新创建Response对象（因为body已经被读取）
    response = new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
    response.headers.set('Access-Control-Allow-Origin', '*');

    // 新增：记录请求到KV存储
    await recordRequest(request, env, apiPath);

    return response;
}

// AppSecret轮换管理
async function getCurrentAppSecret(env) {
    const appSecret1 = env.APP_SECRET;
    const appSecret2 = env.APP_SECRET_2;

    if (!appSecret1) {
        throw new Error('APP_SECRET 环境变量未配置');
    }

    if (!appSecret2) {
        console.log('APP_SECRET_2 未配置，使用单一密钥');
        return appSecret1;
    }

    try {
        // 获取当前使用计数
        const secret1Count = await env.RATE_LIMIT_KV.get('app_secret_1_count') || '0';
        const secret2Count = await env.RATE_LIMIT_KV.get('app_secret_2_count') || '0';
        const currentSecret = await env.RATE_LIMIT_KV.get('current_app_secret') || '1';

        const count1 = parseInt(secret1Count, 10);
        const count2 = parseInt(secret2Count, 10);

        console.log(`Secret1使用次数: ${count1}, Secret2使用次数: ${count2}, 当前使用: Secret${currentSecret}`);

        // 检查是否需要切换
        if (currentSecret === '1' && count1 >= SECRET_ROTATION_LIMIT) {
            // 切换到Secret2
            await env.RATE_LIMIT_KV.put('current_app_secret', '2');
            await env.RATE_LIMIT_KV.put('app_secret_1_count', '0'); // 重置计数
            console.log('切换到APP_SECRET_2');
            return appSecret2;
        } else if (currentSecret === '2' && count2 >= SECRET_ROTATION_LIMIT) {
            // 切换到Secret1
            await env.RATE_LIMIT_KV.put('current_app_secret', '1');
            await env.RATE_LIMIT_KV.put('app_secret_2_count', '0'); // 重置计数
            console.log('切换到APP_SECRET');
            return appSecret1;
        }

        // 返回当前密钥
        return currentSecret === '1' ? appSecret1 : appSecret2;
    } catch (error) {
        console.error('AppSecret轮换失败，使用默认密钥:', error);
        return appSecret1;
    }
}

// 记录AppSecret使用次数
async function recordAppSecretUsage(env) {
    try {
        const currentSecret = await env.RATE_LIMIT_KV.get('current_app_secret') || '1';
        const countKey = currentSecret === '1' ? 'app_secret_1_count' : 'app_secret_2_count';
        const currentCount = await env.RATE_LIMIT_KV.get(countKey) || '0';
        const newCount = parseInt(currentCount, 10) + 1;

        await env.RATE_LIMIT_KV.put(countKey, newCount.toString());
        console.log(`AppSecret${currentSecret}使用次数: ${newCount}`);
    } catch (error) {
        console.error('记录AppSecret使用次数失败:', error);
    }
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
    const userAgent = request.headers.get('X-User-Agent') || '';
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
    const ACCESS_CONFIG = getAccessConfig(env);
    const uaType = uaConfig.type;
    const now = Date.now();

    try {
        // 1. 检查全局限制
        const globalHourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}`;
        const globalDayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}`;

        const globalHourCount = parseInt(await env.RATE_LIMIT_KV.get(globalHourKey) || '0');
        if (uaConfig.maxRequestsPerHour !== -1 && globalHourCount >= uaConfig.maxRequestsPerHour) {
            return { allowed: false, reason: `${uaConfig.description} 全局小时请求限制已超出 (${globalHourCount}/${uaConfig.maxRequestsPerHour})` };
        }

        const globalDayCount = parseInt(await env.RATE_LIMIT_KV.get(globalDayKey) || '0');
        if (uaConfig.maxRequestsPerDay !== -1 && globalDayCount >= uaConfig.maxRequestsPerDay) {
            return { allowed: false, reason: `${uaConfig.description} 全局每日请求限制已超出 (${globalDayCount}/${uaConfig.maxRequestsPerDay})` };
        }

        // 2. 检查路径特定限制
        if (apiPath && uaConfig.pathLimits && Array.isArray(uaConfig.pathLimits)) {
            const pathLimit = uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit) {
                if (pathLimit.maxRequestsPerHour === -1) {
                    // -1 表示不限制，直接通过
                    if (ACCESS_CONFIG.logging.enabled) {
                        console.log(`频率检查通过: IP=${clientIP}, UA=${uaType}, 路径(${apiPath})无限制, 全局: ${globalHourCount}/${uaConfig.maxRequestsPerHour}/小时, ${globalDayCount}/${uaConfig.maxRequestsPerDay}/天`);
                    }
                    return { allowed: true };
                }

                const matchedPath = pathLimit.path.replace(/\//g, '_');
                const pathHourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}_${matchedPath}`;
                const pathHourCount = parseInt(await env.RATE_LIMIT_KV.get(pathHourKey) || '0');

                if (pathHourCount >= pathLimit.maxRequestsPerHour) {
                    return { allowed: false, reason: `${uaConfig.description} 路径 ${apiPath} 小时请求限制已超出 (${pathHourCount}/${pathLimit.maxRequestsPerHour})` };
                }

                if (ACCESS_CONFIG.logging.enabled) {
                    console.log(`频率检查通过: IP=${clientIP}, UA=${uaType}, 路径(${apiPath}): ${pathHourCount}/${pathLimit.maxRequestsPerHour}/小时, 全局: ${globalHourCount}/${uaConfig.maxRequestsPerHour}/小时, ${globalDayCount}/${uaConfig.maxRequestsPerDay}/天`);
                }
                return { allowed: true };
            }
        }

        // 如果没有匹配到路径特定限制，只记录全局检查结果
        if (ACCESS_CONFIG.logging.enabled) {
            const hourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
            const dayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
            console.log(`频率检查通过: IP=${clientIP}, UA=${uaType}, 全局限制: ${globalHourCount}/${hourDisplay}/小时, ${globalDayCount}/${dayDisplay}/天`);
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
    const userAgent = request.headers.get('X-User-Agent') || '';
    const ACCESS_CONFIG = getAccessConfig(env);
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    if (!uaConfig) return; // 如果UA不被允许，则不记录
    const uaType = uaConfig.type;
    const now = Date.now();

    try {
        // 1. 始终更新全局计数器
        const globalHourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}`;
        const globalDayKey = `rate_day_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60 * 24))}`;

        const newGlobalHourCount = (parseInt(await env.RATE_LIMIT_KV.get(globalHourKey) || '0')) + 1;
        const newGlobalDayCount = (parseInt(await env.RATE_LIMIT_KV.get(globalDayKey) || '0')) + 1;

        await env.RATE_LIMIT_KV.put(globalHourKey, newGlobalHourCount.toString(), { expirationTtl: 3600 });
        await env.RATE_LIMIT_KV.put(globalDayKey, newGlobalDayCount.toString(), { expirationTtl: 86400 });

        // 2. 如果匹配，则额外更新路径特定计数器
        if (apiPath && uaConfig.pathLimits && Array.isArray(uaConfig.pathLimits)) {
            const pathLimit = uaConfig.pathLimits.find(limit => apiPath.startsWith(limit.path));
            if (pathLimit) {
                const matchedPath = pathLimit.path.replace(/\//g, '_');
                const pathHourKey = `rate_hour_${uaType}_${clientIP}_${Math.floor(now / (1000 * 60 * 60))}_${matchedPath}`;
                const newPathHourCount = (parseInt(await env.RATE_LIMIT_KV.get(pathHourKey) || '0')) + 1;
                await env.RATE_LIMIT_KV.put(pathHourKey, newPathHourCount.toString(), { expirationTtl: 3600 });

                // 详细日志
                if (ACCESS_CONFIG.logging.enabled) {
                    const pathDisplay = pathLimit.maxRequestsPerHour === -1 ? '∞' : pathLimit.maxRequestsPerHour;
                    const globalHourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
                    const globalDayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
                    console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 路径=${apiPath}, 路径限制=${newPathHourCount}/${pathDisplay}/小时, 全局限制=${newGlobalHourCount}/${globalHourDisplay}/小时, 每日=${newGlobalDayCount}/${globalDayDisplay}, 时间=${new Date().toISOString()}`);
                }
                return; // 记录完毕，退出函数
            }
        }

        // 如果没有匹配到路径特定限制，只记录全局日志
        if (ACCESS_CONFIG.logging.enabled) {
            const hourDisplay = uaConfig.maxRequestsPerHour === -1 ? '∞' : uaConfig.maxRequestsPerHour;
            const dayDisplay = uaConfig.maxRequestsPerDay === -1 ? '∞' : uaConfig.maxRequestsPerDay;
            console.log(`请求已记录: IP=${clientIP}, UA=${uaType}, 全局限制: 小时=${newGlobalHourCount}/${hourDisplay}, 每日=${newGlobalDayCount}/${dayDisplay}, 时间=${new Date().toISOString()}`);
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
