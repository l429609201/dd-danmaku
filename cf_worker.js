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
    pendingRequests: 0,
    // 配置缓存（优先使用数据中心配置，否则使用环境变量）
    configCache: {
        uaConfigs: {},
        ipBlacklist: [],
        lastUpdate: 0
    },
    // 环境变量缓存（启动时复制，APP_ID/APP_SECRET除外）
    envCache: {
        ENABLE_ASYMMETRIC_AUTH_ENV: false,
        ENABLE_DETAILED_LOGGING: false,
        PRIVATE_KEY_HEX: ''
    },
    // 内存日志存储（只保存1天）
    logs: [],
    lastLogCleanup: Date.now()
};

// 数据中心集成配置
let DATA_CENTER_CONFIG = {
    url: '',
    apiKey: '',
    workerId: 'worker-1',
    lastConfigSync: 0,
    lastStatsSync: 0,
    syncInterval: 3600000, // 1小时同步一次
    enabled: false
};

// ========================================
// 📝 内存数据配置
// ========================================
// 数据清理配置
const DATA_RETENTION_HOURS = 24; // 内存日志只保留1天

// ========================================
// 📝 内存日志管理
// ========================================

// 添加日志到内存
function addMemoryLog(level, message, data = {}) {
    const now = Date.now();

    // 清理过期日志（每小时清理一次）
    if (now - memoryCache.lastLogCleanup > 3600000) {
        const cutoffTime = now - (DATA_RETENTION_HOURS * 60 * 60 * 1000);
        memoryCache.logs = memoryCache.logs.filter(log => log.timestamp > cutoffTime);
        memoryCache.lastLogCleanup = now;
    }

    // 添加新日志
    memoryCache.logs.push({
        timestamp: now,
        level,
        message,
        data,
        id: `${now}-${Math.random().toString(36).substring(2, 11)}`
    });

    // 限制日志数量（最多保存1000条）
    if (memoryCache.logs.length > 1000) {
        memoryCache.logs = memoryCache.logs.slice(-1000);
    }
}

// 获取内存日志
function getMemoryLogs(limit = 100) {
    return memoryCache.logs
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
}

// ========================================
// 🔄 内存频率限制
// ========================================

// 内存频率限制检查
function checkMemoryRateLimit(clientIP, uaType, limits) {
    const now = Date.now();
    const key = `${uaType}-${clientIP}`;

    // 获取或创建计数器
    if (!memoryCache.rateLimitCounts.has(key)) {
        memoryCache.rateLimitCounts.set(key, {
            count: 0,
            windowStart: now,
            lastRequest: now
        });
    }

    const counter = memoryCache.rateLimitCounts.get(key);
    const windowDuration = limits.windowMs || 60000; // 默认1分钟窗口
    const maxRequests = limits.maxRequests || 100;

    // 检查是否需要重置窗口
    if (now - counter.windowStart >= windowDuration) {
        counter.count = 0;
        counter.windowStart = now;
    }

    // 增加计数
    counter.count++;
    counter.lastRequest = now;

    // 检查是否超限
    if (counter.count > maxRequests) {
        return {
            allowed: false,
            reason: `频率限制: ${counter.count}/${maxRequests} 在 ${Math.round(windowDuration/1000)}秒内`,
            count: counter.count,
            limit: maxRequests
        };
    }

    return {
        allowed: true,
        count: counter.count,
        limit: maxRequests
    };
}

// 清理过期的频率限制计数器
function cleanupRateLimitCounters() {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5分钟过期

    for (const [key, counter] of memoryCache.rateLimitCounts.entries()) {
        if (now - counter.lastRequest > expireTime) {
            memoryCache.rateLimitCounts.delete(key);
        }
    }
}

// ========================================
// 🔗 数据中心集成功能
// ========================================

// 初始化配置缓存（优先数据中心，环境变量兜底）
async function initializeConfigCache(env) {
    try {
        // 复制环境变量到内存缓存（APP_ID/APP_SECRET始终从env读取）
        memoryCache.envCache.ENABLE_ASYMMETRIC_AUTH_ENV = env.ENABLE_ASYMMETRIC_AUTH_ENV === 'true';
        memoryCache.envCache.ENABLE_DETAILED_LOGGING = env.ENABLE_DETAILED_LOGGING === 'true';
        memoryCache.envCache.PRIVATE_KEY_HEX = env.PRIVATE_KEY_HEX || '';
        console.log('✅ 环境变量已复制到内存缓存（APP相关变量始终从env读取）');

        // 加载UA配置（兜底方案）
        if (env.USER_AGENT_LIMITS_CONFIG) {
            memoryCache.configCache.uaConfigs = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
            console.log('✅ 从环境变量加载UA配置（兜底）');
        }

        // 加载IP黑名单（兜底方案）
        if (env.IP_BLACKLIST_CONFIG) {
            memoryCache.configCache.ipBlacklist = JSON.parse(env.IP_BLACKLIST_CONFIG);
            console.log('✅ 从环境变量加载IP黑名单（兜底）');
        }

        memoryCache.configCache.lastUpdate = Date.now();

        // 清理过期的频率限制计数器
        cleanupRateLimitCounters();

        console.log('✅ 配置缓存初始化完成，将优先从数据中心同步');
    } catch (error) {
        console.error('❌ 初始化配置缓存失败:', error);
    }
}

// 初始化数据中心配置
async function initializeDataCenterConfig(env) {
    // 从环境变量读取配置
    DATA_CENTER_CONFIG.url = env.DATA_CENTER_URL || '';
    DATA_CENTER_CONFIG.apiKey = env.DATA_CENTER_API_KEY || '';
    DATA_CENTER_CONFIG.workerId = env.WORKER_ID || 'worker-1';
    DATA_CENTER_CONFIG.enabled = !!(env.DATA_CENTER_URL && env.DATA_CENTER_API_KEY);

    // 初始化配置缓存（先加载环境变量配置）
    await initializeConfigCache(env);

    if (DATA_CENTER_CONFIG.enabled) {
        console.log('✅ 数据中心集成已启用');
        // 启动时尝试从数据中心同步配置（优先使用数据中心配置）
        await syncConfigFromDataCenter();

        // 设置定时同步（每小时）
        setInterval(async () => {
            await syncConfigFromDataCenter();
            await syncStatsToDataCenter();
        }, DATA_CENTER_CONFIG.syncInterval);
    } else {
        console.log('⚠️ 数据中心集成未启用（缺少URL或API密钥）');
    }
}

// 从数据中心同步配置
async function syncConfigFromDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    const now = Date.now();
    if (now - DATA_CENTER_CONFIG.lastConfigSync < DATA_CENTER_CONFIG.syncInterval) {
        return; // 还没到同步时间
    }

    try {
        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/config/export`, {
            method: 'GET',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const config = await response.json();

            // 优先使用数据中心配置，更新内存缓存
            if (config.ua_configs) {
                memoryCache.configCache.uaConfigs = config.ua_configs;
                console.log('✅ 从数据中心更新UA配置');
            }

            if (config.ip_blacklist) {
                memoryCache.configCache.ipBlacklist = config.ip_blacklist;
                console.log('✅ 从数据中心更新IP黑名单');
            }

            memoryCache.configCache.lastUpdate = now;
            DATA_CENTER_CONFIG.lastConfigSync = now;
            console.log('✅ 配置同步成功');
        }
    } catch (error) {
        console.error('❌ 配置同步失败，继续使用环境变量配置:', error);
    }
}

// 向数据中心发送统计数据
async function syncStatsToDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    try {
        const stats = await getWorkerStats();

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/sync/stats`, {
            method: 'POST',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                worker_id: DATA_CENTER_CONFIG.workerId,
                timestamp: Date.now(),
                stats: stats,
                // 同时上报当前配置状态
                config_status: {
                    ua_configs: memoryCache.configCache.uaConfigs,
                    ip_blacklist: memoryCache.configCache.ipBlacklist,
                    last_config_update: memoryCache.configCache.lastUpdate
                }
            })
        });

        if (response.ok) {
            DATA_CENTER_CONFIG.lastStatsSync = Date.now();
            console.log('✅ 统计数据和配置状态同步成功');
        }
    } catch (error) {
        console.error('❌ 统计数据同步失败:', error);
    }
}

// API密钥验证中间件
function verifyApiKey(request) {
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== DATA_CENTER_CONFIG.apiKey) {
        return new Response('Unauthorized', { status: 401 });
    }
    return null;
}

// 处理数据中心API请求
async function handleDataCenterAPI(request, urlObj) {
    // 验证API密钥
    const authError = verifyApiKey(request);
    if (authError) return authError;

    const path = urlObj.pathname;
    const method = request.method;

    try {
        // 配置更新端点（接收数据中心主动推送）
        if (path === '/api/config/update' && method === 'POST') {
            const config = await request.json();

            // 立即更新内存中的配置
            if (config.ua_configs) {
                memoryCache.configCache.uaConfigs = config.ua_configs;
                console.log('✅ 收到数据中心推送，已更新UA配置');
            }

            if (config.ip_blacklist) {
                memoryCache.configCache.ipBlacklist = config.ip_blacklist;
                console.log('✅ 收到数据中心推送，已更新IP黑名单');
            }

            memoryCache.configCache.lastUpdate = Date.now();

            return new Response(JSON.stringify({
                success: true,
                message: '配置更新成功',
                updated_at: memoryCache.configCache.lastUpdate
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 统计数据导出端点
        if (path === '/api/stats/export' && method === 'GET') {
            const stats = await getWorkerStats();
            return new Response(JSON.stringify(stats), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 健康检查端点
        if (path === '/api/health' && method === 'GET') {
            return new Response(JSON.stringify({
                status: 'healthy',
                worker_id: DATA_CENTER_CONFIG.workerId,
                timestamp: Date.now(),
                data_center_enabled: DATA_CENTER_CONFIG.enabled
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 内存日志查看端点
        if (path === '/api/logs' && method === 'GET') {
            const url = new URL(request.url);
            const limit = parseInt(url.searchParams.get('limit') || '100');
            const logs = getMemoryLogs(limit);

            return new Response(JSON.stringify({
                logs: logs,
                total: memoryCache.logs.length,
                worker_id: DATA_CENTER_CONFIG.workerId,
                timestamp: Date.now()
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not Found', { status: 404 });

    } catch (error) {
        console.error('API处理错误:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 获取Worker统计数据
async function getWorkerStats() {
    try {
        return {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            requests_total: memoryCache.pendingRequests || 0,
            memory_cache_size: memoryCache.rateLimitCounts.size,
            last_sync_time: DATA_CENTER_CONFIG.lastConfigSync,
            uptime: Date.now() - memoryCache.lastSyncTime,
            // 秘钥轮换统计（直接使用内存缓存）
            secret_rotation: {
                secret1_count: memoryCache.appSecretUsage.count1,
                secret2_count: memoryCache.appSecretUsage.count2,
                current_secret: memoryCache.appSecretUsage.current,
                rotation_limit: SECRET_ROTATION_LIMIT
            }
        };
    } catch (error) {
        console.error('获取统计数据失败:', error);
        return {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            error: error.message
        };
    }
}

// 获取IP黑名单配置（优先使用内存缓存）
function getIpBlacklist() {
    // 使用内存缓存中的配置（数据中心同步的配置或环境变量兜底配置）
    if (memoryCache.configCache.ipBlacklist && memoryCache.configCache.ipBlacklist.length > 0) {
        console.log('使用内存缓存IP黑名单，包含', memoryCache.configCache.ipBlacklist.length, '个规则');
        return memoryCache.configCache.ipBlacklist;
    }

    console.log('无可用的IP黑名单配置');
    return [];
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

// 获取 User-Agent 限制配置（优先使用内存缓存）
function getUserAgentLimits() {
    // 优先使用内存缓存中的配置（数据中心同步的配置）
    if (memoryCache.configCache.uaConfigs && Object.keys(memoryCache.configCache.uaConfigs).length > 0) {
        console.log('使用内存缓存配置（数据中心或环境变量）');

        // 过滤出启用的客户端
        const enabledLimits = {};
        Object.keys(memoryCache.configCache.uaConfigs).forEach(key => {
            const config = memoryCache.configCache.uaConfigs[key];
            if (config && config.enabled !== false) { // 默认启用，除非明确设置为 false
                enabledLimits[key] = config;
            }
        });

        return enabledLimits;
    }

    console.error('无可用的UA配置，拒绝所有请求');
    return {};
}



// 获取访问控制配置
function getAccessConfig() {
    const ENABLE_ASYMMETRIC_AUTH = memoryCache.envCache.ENABLE_ASYMMETRIC_AUTH_ENV;
    const ENABLE_DETAILED_LOGGING = memoryCache.envCache.ENABLE_DETAILED_LOGGING;

    return {
        // 基于User-Agent的分级限制配置（从内存缓存动态获取）
        get userAgentLimits() {
            return getUserAgentLimits();
        },

        // 日志配置
        logging: {
            enabled: ENABLE_DETAILED_LOGGING
        },

        // 非对称密钥验证配置
        asymmetricAuth: {
            enabled: ENABLE_ASYMMETRIC_AUTH, // 从内存缓存控制是否启用
            privateKeyHex: memoryCache.envCache.PRIVATE_KEY_HEX || null, // Worker端私钥（十六进制格式，从内存缓存获取）
            challengeEndpoint: '/auth/challenge' // 挑战端点
        }
    };
}



export default {
  async fetch(request, env, ctx) {
    // 初始化数据中心配置
    await initializeDataCenterConfig(env);

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
    const ACCESS_CONFIG = getAccessConfig();

    // 数据中心API端点处理
    if (urlObj.pathname.startsWith('/api/')) {
        return await handleDataCenterAPI(request, urlObj);
    }

    // IP黑名单和临时封禁检查
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

    // 临时封禁功能已移除

    // 检查永久黑名单
    const ipBlacklist = getIpBlacklist();
    if (isIpBlacklisted(clientIP, ipBlacklist)) {
        console.log(`IP ${clientIP} 在黑名单中，拒绝访问`);

        // 记录到内存日志
        addMemoryLog('warn', 'IP黑名单拦截', {
            ip: clientIP,
            userAgent: request.headers.get('X-User-Agent')
        });

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
        return handleAuthChallenge(request);
    }

    // TG机器人功能已移除

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
    const accessCheck = await checkAccess(request, tUrlObj.pathname);
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

    // 频率限制检查已在accessCheck中完成，这里直接使用结果
    const rateLimitResult = { allowed: true }; // accessCheck已经通过，说明频率限制检查通过

    // 路径满载检查功能已移除

    if (!rateLimitResult.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        const errorMessage = `IP:${clientIP} UA:${userAgent} 频率限制：${rateLimitResult.reason}`;
        console.log(errorMessage);

        // 记录到内存日志
        addMemoryLog('warn', '频率限制触发', {
            ip: clientIP,
            userAgent,
            reason: rateLimitResult.reason
        });

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
    const { appSecret } = await getCachedAppSecret(env);


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
    if (await shouldSyncToStorage()) {
        ctx.waitUntil(syncCacheToStorage());
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
async function shouldSyncToStorage() {
    const now = Date.now();
    const timeSinceLastSync = now - memoryCache.lastSyncTime;

    // 达到请求阈值或时间间隔时触发同步
    return memoryCache.pendingRequests >= BATCH_SYNC_THRESHOLD ||
           timeSinceLastSync >= BATCH_SYNC_INTERVAL;
}

async function syncCacheToStorage() {
    if (memoryCache.pendingRequests === 0) return;

    try {
        // AppSecret使用计数现在完全在内存中管理，无需同步到DO
        console.log(`AppSecret使用统计: Secret1=${memoryCache.appSecretUsage.count1}, Secret2=${memoryCache.appSecretUsage.count2}`);

        // 重置计数器
        memoryCache.pendingRequests = 0;
        memoryCache.lastSyncTime = Date.now();

    } catch (error) {
        console.error('批量同步失败:', error);
    }
}

// 获取缓存的AppSecret信息（纯内存管理）
async function getCachedAppSecret(env) {
    // AppSecret状态完全在内存中管理，无需从DO获取
    console.log(`当前AppSecret状态: current=${memoryCache.appSecretUsage.current}, count1=${memoryCache.appSecretUsage.count1}, count2=${memoryCache.appSecretUsage.count2}`);

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
async function checkAccess(request, targetApiPath) {
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
    const ACCESS_CONFIG = getAccessConfig();

    // 1. 识别User-Agent类型并获取对应限制
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    if (!uaConfig) {
        return { allowed: false, reason: '禁止访问的UA', status: 403 };
    }

    // 2. 基于内存的频率限制
    const rateLimitCheck = checkMemoryRateLimit(clientIP, uaConfig.type, uaConfig);

    if (!rateLimitCheck.allowed) {
        // 记录频率限制日志
        addMemoryLog('warn', '频率限制触发', {
            ip: clientIP,
            userAgent,
            uaType: uaConfig.type,
            reason: rateLimitCheck.reason,
            path: apiPath
        });

        return { allowed: false, reason: rateLimitCheck.reason, status: 429 };
    }

    // 3. 非对称密钥验证（如果启用）
    if (ACCESS_CONFIG.asymmetricAuth.enabled) {
        const authCheck = await verifyAsymmetricAuth(request);
        if (!authCheck.allowed) {
            return { allowed: false, reason: authCheck.reason, status: 401 };
        }
    }

    return { allowed: true, uaConfig: uaConfig, apiPath: apiPath };
}

// 新增：处理挑战-响应认证
async function handleAuthChallenge(request) {
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

        const ACCESS_CONFIG = getAccessConfig();
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

// pemToArrayBuffer函数已移除（未使用）

// TG Webhook功能已移除



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

// base64ToArrayBuffer函数已移除（未使用）

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

// Durable Objects已完全移除，改为纯内存管理

// 导出函数供TG机器人模块使用
export { getIpBlacklist, getAccessConfig, memoryCache };
