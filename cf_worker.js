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

// 内存限制配置
const MEMORY_LIMITS = {
    MAX_IP_STATS: 50000,        // 最多保存50000个IP的统计
    MAX_RATE_LIMIT_COUNTERS: 100000, // 最多100000个频率限制计数器（IP+UA+路径组合）
    IP_STATS_CLEANUP_INTERVAL: 3600000, // 每小时检查一次IP统计清理
    RATE_LIMIT_CLEANUP_INTERVAL: 300000,  // 每5分钟检查一次频率限制计数器清理
    RATE_LIMIT_COUNTER_EXPIRE: 3600000,   // 频率限制计数器1小时过期（与小时限制对应）
    API_CACHE_TTL: 7200000,     // API缓存2小时
    MAX_API_CACHE_SIZE: 1000     // 最多缓存500个API响应（内存缓存，不含弹幕）
};

// R2 弹幕缓存配置
const R2_CACHE_CONFIG = {
    TTL: 12 * 60 * 60 * 1000,              // 12小时过期
    MAX_STORAGE_BYTES: 9 * 1024 * 1024 * 1024, // 9GB 阈值
    KEY_PREFIX: 'comment/',                 // R2 key 前缀
    CLEANUP_BATCH_SIZE: 100,                // 每次写入清理：批量删除最旧的数量
    EXPIRE_POLL_INTERVAL: 5 * 60 * 1000,   // 过期轮询间隔：5分钟
};

// ========================================
// 🔐 OAuth 通用认证配置
// ========================================
// 全部通过 CF Dashboard 环境变量 OAUTH_CONFIG（类型：文本）配置，代码无需修改。
// 格式示例（Trakt）：
// {
//   "enabled": true,
//   "jwtSecret": "随机长字符串",
//   "jwtExpireHours": 720,
//   "allowedUsers": {},
//   "providers": {
//     "trakt": {
//       "clientId": "",
//       "clientSecret": "",
//       "authorizeUrl": "https://trakt.tv/oauth/authorize",
//       "tokenUrl": "https://api.trakt.tv/oauth/token",
//       "tokenContentType": "json",
//       "userInfoUrl": "https://api.trakt.tv/users/me",
//       "scopes": "",
//       "extraHeaders": { "trakt-api-key": "$clientId", "trakt-api-version": "2" },
//       "userMapping": { "id": "user.ids.slug", "name": "user.name", "avatar": "user.images.avatar.full" },
//       "userFallback": { "id": "username", "name": "username" }
//     }
//   }
// }
//
// tokenContentType: "json" 时用 JSON body 请求 token（Trakt 需要），不设或其他值用 form-urlencoded（GitHub/Google）
// userMapping:  JSON 路径，从用户信息响应提取字段（"user.ids.slug" → response.user.ids.slug）
// userFallback: userMapping 路径取不到值时的回退字段
// extraHeaders: 获取用户信息时附加的 header，$clientId 会替换为实际值

const OAUTH_TOKEN_CACHE_MAX = 5000;

// 全局内存缓存
let memoryCache = {
    rateLimitCounts: new Map(), // 频率限制计数缓存
    appSecretUsage: { count1: 0, count2: 0, current: '1' }, // AppSecret使用缓存
    lastSyncTime: Date.now(),
    pendingRequests: 0,
    totalRequests: 0, // 总请求计数（不会重置）
    // IP请求统计数据（定期清理，防止内存泄漏）
    ipRequestStats: {}, // 格式: { "192.168.1.1": { total_count: 100, violations: 5, paths: {...}, lastAccess: timestamp } }
    lastIpStatsCleanup: Date.now(),
    // 配置缓存（优先使用数据中心配置，否则使用环境变量）
    configCache: {
        uaConfigs: {},
        ipBlacklist: [],
        lastUpdate: 0
    },
    // 环境变量缓存（启动时复制，APP_ID/APP_SECRET除外）
    envCache: {
        ENABLE_DETAILED_LOGGING: false
    },
    // 内存日志存储（只保存1天）
    logs: [],
    lastLogCleanup: Date.now(),
    lastRateLimitCleanup: Date.now(),
    lastR2ExpireCleanup: Date.now(), // R2 过期轮询上次执行时间
    // API响应缓存（用于搜索和番剧接口）
    apiCache: new Map(), // 格式: { "cache_key": { data: response, timestamp: Date.now() } }
    // OAuth token 验证缓存（避免每次请求都做 crypto 运算）
    oauthTokenCache: new Map(), // 格式: { "token_hash": { payload, expireAt } }
};

// 数据中心集成配置
let DATA_CENTER_CONFIG = {
    url: '',
    apiKey: '',
    workerId: 'worker-1',
    lastConfigSync: 0,
    lastStatsSync: 0,
    syncInterval: 3600000, // 1小时同步一次
    enabled: false,
    initialized: false, // 添加初始化标志
    syncTimer: null, // 添加定时器引用
    workerApiKey: '' // 数据中心访问Worker时使用的API Key
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

    console.log(`🔢 频率限制检查详情:`);
    console.log(`   - 限制键: ${key}`);
    console.log(`   - 限制配置: ${JSON.stringify(limits)}`);

    // 获取或创建计数器
    if (!memoryCache.rateLimitCounts.has(key)) {
        console.log(`   - 创建新计数器`);
        memoryCache.rateLimitCounts.set(key, {
            count: 0,
            windowStart: now,
            lastRequest: now
        });
    }

    const counter = memoryCache.rateLimitCounts.get(key);
    const windowDuration = limits.windowMs || 60000; // 默认1分钟窗口

    // 正确获取最大请求数，支持-1表示无限制
    let maxRequests = limits.hourlyLimit || limits.maxRequestsPerHour;
    if (maxRequests === undefined || maxRequests === null) {
        maxRequests = limits.maxRequests || 100; // 兼容旧字段名
    }

    // 如果是-1，表示无限制
    const isUnlimited = maxRequests === -1;

    console.log(`   - 窗口持续时间: ${windowDuration}ms (${Math.round(windowDuration/1000)}秒)`);
    console.log(`   - 最大请求数: ${isUnlimited ? '无限制' : maxRequests}`);
    console.log(`   - 当前计数器: ${JSON.stringify(counter)}`);

    // 检查是否需要重置窗口
    const timeSinceWindowStart = now - counter.windowStart;
    console.log(`   - 距离窗口开始时间: ${timeSinceWindowStart}ms`);

    if (timeSinceWindowStart >= windowDuration) {
        console.log(`   - 重置窗口 (超过${Math.round(windowDuration/1000)}秒)`);
        counter.count = 0;
        counter.windowStart = now;
    }

    // 增加计数
    counter.count++;
    counter.lastRequest = now;

    console.log(`   - 更新后计数: ${counter.count}/${isUnlimited ? '无限制' : maxRequests}`);

    // 累积IP统计数据（定期清理，防止内存泄漏）
    if (!memoryCache.ipRequestStats[clientIP]) {
        memoryCache.ipRequestStats[clientIP] = {
            total_count: 0,
            violations: 0,
            paths: {},
            lastAccess: now
        };
    }
    memoryCache.ipRequestStats[clientIP].total_count++;
    memoryCache.ipRequestStats[clientIP].lastAccess = now;

    // 记录路径访问统计
    const pathKey = uaType.includes('-path-') ? uaType.split('-path-')[1] : 'global';
    if (!memoryCache.ipRequestStats[clientIP].paths[pathKey]) {
        memoryCache.ipRequestStats[clientIP].paths[pathKey] = 0;
    }
    memoryCache.ipRequestStats[clientIP].paths[pathKey]++;

    // 如果超限，记录违规
    if (!isUnlimited && counter.count > maxRequests) {
        memoryCache.ipRequestStats[clientIP].violations++;
    }

    // 如果是无限制，直接通过
    if (isUnlimited) {
        return {
            allowed: true,
            reason: '无限制',
            count: counter.count,
            limit: '无限制'
        };
    }

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
    // 使用配置的过期时间（默认1小时，与小时限制对应）
    const expireTime = MEMORY_LIMITS.RATE_LIMIT_COUNTER_EXPIRE || 3600000;

    let deletedCount = 0;
    for (const [key, counter] of memoryCache.rateLimitCounts.entries()) {
        if (now - counter.lastRequest > expireTime) {
            memoryCache.rateLimitCounts.delete(key);
            deletedCount++;
        }
    }

    // 如果超过上限，删除最旧的计数器
    if (memoryCache.rateLimitCounts.size > MEMORY_LIMITS.MAX_RATE_LIMIT_COUNTERS) {
        const entries = Array.from(memoryCache.rateLimitCounts.entries())
            .sort((a, b) => a[1].lastRequest - b[1].lastRequest);
        const toDelete = entries.slice(0, entries.length - MEMORY_LIMITS.MAX_RATE_LIMIT_COUNTERS);
        toDelete.forEach(([key]) => {
            memoryCache.rateLimitCounts.delete(key);
            deletedCount++;
        });
    }

    if (deletedCount > 0) {
        console.log(`🧹 清理了 ${deletedCount} 个过期的频率限制计数器，当前剩余: ${memoryCache.rateLimitCounts.size}`);
    }

    memoryCache.lastRateLimitCleanup = now;
}

// 清理过期的IP统计数据
function cleanupIpRequestStats() {
    const now = Date.now();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时无访问则清理

    let deletedCount = 0;
    const ips = Object.keys(memoryCache.ipRequestStats);

    for (const ip of ips) {
        const stats = memoryCache.ipRequestStats[ip];
        if (stats.lastAccess && now - stats.lastAccess > expireTime) {
            delete memoryCache.ipRequestStats[ip];
            deletedCount++;
        }
    }

    // 如果超过上限，删除访问量最少的IP
    const currentCount = Object.keys(memoryCache.ipRequestStats).length;
    if (currentCount > MEMORY_LIMITS.MAX_IP_STATS) {
        const sortedIps = Object.entries(memoryCache.ipRequestStats)
            .sort((a, b) => a[1].total_count - b[1].total_count);
        const toDelete = sortedIps.slice(0, currentCount - MEMORY_LIMITS.MAX_IP_STATS);
        toDelete.forEach(([ip]) => {
            delete memoryCache.ipRequestStats[ip];
            deletedCount++;
        });
    }

    if (deletedCount > 0) {
        console.log(`🧹 清理了 ${deletedCount} 个过期的IP统计，当前剩余: ${Object.keys(memoryCache.ipRequestStats).length}`);
    }

    memoryCache.lastIpStatsCleanup = now;
}

// 清理过期的API缓存
function cleanupApiCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [key, cached] of memoryCache.apiCache.entries()) {
        if (now - cached.timestamp > MEMORY_LIMITS.API_CACHE_TTL) {
            memoryCache.apiCache.delete(key);
            deletedCount++;
        }
    }

    // 如果超过上限，删除最旧的缓存
    if (memoryCache.apiCache.size > MEMORY_LIMITS.MAX_API_CACHE_SIZE) {
        const entries = Array.from(memoryCache.apiCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, entries.length - MEMORY_LIMITS.MAX_API_CACHE_SIZE);
        toDelete.forEach(([key]) => {
            memoryCache.apiCache.delete(key);
            deletedCount++;
        });
    }

    if (deletedCount > 0) {
        console.log(`🧹 清理了 ${deletedCount} 个过期的API缓存，当前剩余: ${memoryCache.apiCache.size}`);
    }
}

// ========================================
// 📦 R2 弹幕缓存工具函数
// ========================================

/**
 * 从 R2 读取弹幕缓存
 * @returns {string|null} 缓存的响应文本，过期或不存在返回 null
 */
async function r2GetComment(env, cacheKey) {
    if (!env.DANMAKU_CACHE) return null;
    try {
        const obj = await env.DANMAKU_CACHE.get(cacheKey);
        if (!obj) return null;
        const timestamp = parseInt(obj.customMetadata?.timestamp || '0');
        if (Date.now() - timestamp > R2_CACHE_CONFIG.TTL) {
            // 已过期，异步删除不阻塞
            env.DANMAKU_CACHE.delete(cacheKey).catch(() => {});
            return null;
        }
        return await obj.text();
    } catch (e) {
        console.log(`⚠️ R2 读取失败: ${cacheKey}, ${e.message}`);
        return null;
    }
}

/**
 * 写入弹幕缓存到 R2，超阈值时清理最旧的
 */
async function r2PutComment(env, cacheKey, data) {
    if (!env.DANMAKU_CACHE) return;
    try {
        await env.DANMAKU_CACHE.put(cacheKey, data, {
            customMetadata: { timestamp: Date.now().toString() },
            httpMetadata: { contentType: 'application/json' },
        });
        // 写入清理：每次新存入后，批量删除最旧的对象（按 CLEANUP_BATCH_SIZE）
        r2WriteCleanup(env).catch(e => console.log(`⚠️ R2 写入清理失败: ${e.message}`));
    } catch (e) {
        console.log(`⚠️ R2 写入失败: ${cacheKey}, ${e.message}`);
    }
}

/**
 * 写入清理：每次新存入 R2 后触发
 * 按上传时间从旧到新，批量删除最旧的 CLEANUP_BATCH_SIZE 个对象
 * 仅在总量超过 9GB 阈值时才执行
 */
async function r2WriteCleanup(env) {
    if (!env.DANMAKU_CACHE) return;
    let totalSize = 0;
    let allObjects = [];
    let cursor = undefined;
    let listCount = 0;

    do {
        const listed = await env.DANMAKU_CACHE.list({
            prefix: R2_CACHE_CONFIG.KEY_PREFIX,
            cursor,
            limit: 1000,
        });
        for (const obj of listed.objects) {
            totalSize += obj.size;
            allObjects.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded });
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        listCount++;
    } while (cursor && listCount < 50);

    console.log(`📊 R2 写入清理检查: ${allObjects.length} 个对象, 总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

    if (totalSize <= R2_CACHE_CONFIG.MAX_STORAGE_BYTES) return;

    // 超阈值，按上传时间排序（最旧在前），删除 CLEANUP_BATCH_SIZE 个
    allObjects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
    let deletedCount = 0;
    let freedSize = 0;

    for (const obj of allObjects) {
        if (deletedCount >= R2_CACHE_CONFIG.CLEANUP_BATCH_SIZE) break;
        await env.DANMAKU_CACHE.delete(obj.key);
        freedSize += obj.size;
        deletedCount++;
    }
    console.log(`🧹 R2 写入清理: 删除 ${deletedCount} 个最旧对象, 释放 ${(freedSize / 1024 / 1024).toFixed(1)} MB`);
}

/**
 * 过期轮询清理：由 periodicCleanup 每 5 分钟触发一次
 * 遍历所有 comment/ 对象，删除超过 TTL（12小时）的过期对象
 */
async function r2ExpireCleanup(env) {
    if (!env.DANMAKU_CACHE) return;
    const now = Date.now();
    let expiredKeys = [];
    let totalCount = 0;
    let cursor = undefined;
    let listCount = 0;

    do {
        const listed = await env.DANMAKU_CACHE.list({
            prefix: R2_CACHE_CONFIG.KEY_PREFIX,
            cursor,
            limit: 1000,
            include: ['customMetadata'],
        });
        for (const obj of listed.objects) {
            totalCount++;
            const timestamp = parseInt(obj.customMetadata?.timestamp || '0');
            if (timestamp > 0 && (now - timestamp > R2_CACHE_CONFIG.TTL)) {
                expiredKeys.push(obj.key);
            }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        listCount++;
    } while (cursor && listCount < 50);

    if (expiredKeys.length > 0) {
        for (const key of expiredKeys) {
            await env.DANMAKU_CACHE.delete(key);
        }
        console.log(`🧹 R2 过期轮询: 删除 ${expiredKeys.length}/${totalCount} 个过期对象 (TTL: ${R2_CACHE_CONFIG.TTL / 3600000}h)`);
    }
}

// 定期清理内存（在每个请求时检查）
// 返回需要异步执行的 R2 清理 Promise（调用方用 ctx.waitUntil 保活）
function periodicCleanup(env) {
    const now = Date.now();

    // 每分钟清理一次频率限制计数器
    if (now - memoryCache.lastRateLimitCleanup > MEMORY_LIMITS.RATE_LIMIT_CLEANUP_INTERVAL) {
        cleanupRateLimitCounters();
    }

    // 每小时清理一次IP统计
    if (now - memoryCache.lastIpStatsCleanup > MEMORY_LIMITS.IP_STATS_CLEANUP_INTERVAL) {
        cleanupIpRequestStats();
    }

    // 清理内存API缓存
    cleanupApiCache();

    // 每5分钟轮询一次 R2 过期清理
    if (env?.DANMAKU_CACHE && (now - memoryCache.lastR2ExpireCleanup > R2_CACHE_CONFIG.EXPIRE_POLL_INTERVAL)) {
        memoryCache.lastR2ExpireCleanup = now;
        return r2ExpireCleanup(env).catch(e => console.log(`⚠️ R2 过期轮询失败: ${e.message}`));
    }
    return null;
}

// ========================================
// 🔗 数据中心集成功能
// ========================================

// 初始化配置缓存（优先数据中心，环境变量兜底）
async function initializeConfigCache(env) {
    try {
        // 复制环境变量到内存缓存（APP_ID/APP_SECRET始终从env读取）
        memoryCache.envCache.ENABLE_DETAILED_LOGGING = env.ENABLE_DETAILED_LOGGING === 'true';
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

// 初始化数据中心配置（带锁防止并发初始化）
let initializationPromise = null;
async function initializeDataCenterConfig(env) {
    // 如果已经初始化过，直接返回
    if (DATA_CENTER_CONFIG.initialized) {
        return;
    }

    // 如果正在初始化中，等待初始化完成
    if (initializationPromise) {
        return initializationPromise;
    }

    // 开始初始化
    initializationPromise = (async () => {
        try {
            // 从环境变量读取配置
            DATA_CENTER_CONFIG.url = env.DATA_CENTER_URL || '';
            DATA_CENTER_CONFIG.apiKey = env.DATA_CENTER_API_KEY || '';
            DATA_CENTER_CONFIG.workerId = env.WORKER_ID || 'worker-1';
            // 使用同一个API Key进行双向认证
            DATA_CENTER_CONFIG.workerApiKey = env.DATA_CENTER_API_KEY || '';
            DATA_CENTER_CONFIG.enabled = !!(env.DATA_CENTER_URL && env.DATA_CENTER_API_KEY);

            // 初始化配置缓存（先加载环境变量配置）
            await initializeConfigCache(env);

            if (DATA_CENTER_CONFIG.enabled) {
                console.log('✅ 数据中心集成已启用');

        // 启动时尝试从数据中心恢复上次的计数状态
        await restoreCountersFromDataCenter();

        // 启动时尝试从数据中心同步配置（优先使用数据中心配置）
        await syncConfigFromDataCenter();

                // 注意：Cloudflare Workers 中不支持 setInterval，定时同步通过请求时间检查实现
                console.log('📋 定时同步将在请求处理中按时间间隔触发');
            } else {
                console.log('⚠️ 数据中心集成未启用（缺少URL或API密钥）');
            }

            // 标记为已初始化
            DATA_CENTER_CONFIG.initialized = true;
        } finally {
            initializationPromise = null;
        }
    })();

    return initializationPromise;
}

// 从数据中心恢复计数状态
async function restoreCountersFromDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    try {
        console.log('🔄 尝试从数据中心恢复计数状态...');

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/sync/stats/restore`, {
            method: 'GET',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json',
                'X-Worker-ID': DATA_CENTER_CONFIG.workerId
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('📥 从数据中心获取计数状态成功');

            if (data.success && data.counters) {
                // 恢复AppSecret使用计数
                if (data.counters.secret1_count !== undefined) {
                    memoryCache.appSecretUsage.count1 = data.counters.secret1_count;
                }
                if (data.counters.secret2_count !== undefined) {
                    memoryCache.appSecretUsage.count2 = data.counters.secret2_count;
                }
                if (data.counters.current_secret) {
                    memoryCache.appSecretUsage.current = data.counters.current_secret;
                }
                if (data.counters.total_requests !== undefined) {
                    memoryCache.totalRequests = data.counters.total_requests;
                }

                console.log('✅ 计数状态恢复成功:');
                console.log(`   - Secret1计数: ${memoryCache.appSecretUsage.count1}`);
                console.log(`   - Secret2计数: ${memoryCache.appSecretUsage.count2}`);
                console.log(`   - 当前Secret: ${memoryCache.appSecretUsage.current}`);
                console.log(`   - 总请求数: ${memoryCache.totalRequests}`);

                addMemoryLog('INFO', '从数据中心恢复计数状态成功', {
                    secret1_count: memoryCache.appSecretUsage.count1,
                    secret2_count: memoryCache.appSecretUsage.count2,
                    total_requests: memoryCache.totalRequests
                });
            } else {
                console.log('ℹ️ 数据中心没有可恢复的计数状态，使用默认值');
            }
        } else {
            console.log(`⚠️ 从数据中心恢复计数状态失败: HTTP ${response.status}`);
            console.log('ℹ️ 将使用默认计数状态（从0开始）');
        }
    } catch (error) {
        console.error('❌ 恢复计数状态异常:', error);
        console.log('ℹ️ 将使用默认计数状态（从0开始）');
        addMemoryLog('ERROR', `恢复计数状态异常: ${error.message}`, {
            data_center_url: DATA_CENTER_CONFIG.url,
            error: error.message
        });
    }
}

// 从数据中心同步配置
async function syncConfigFromDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    const now = Date.now();
    const timeSinceLastSync = now - DATA_CENTER_CONFIG.lastConfigSync;

    // 添加调试信息
    console.log(`🔄 同步检查: 距离上次同步 ${Math.round(timeSinceLastSync / 1000)} 秒, 同步间隔 ${Math.round(DATA_CENTER_CONFIG.syncInterval / 1000)} 秒`);

    if (timeSinceLastSync < DATA_CENTER_CONFIG.syncInterval) {
        console.log(`⏳ 跳过同步: 还需等待 ${Math.round((DATA_CENTER_CONFIG.syncInterval - timeSinceLastSync) / 1000)} 秒`);
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
            console.log('📥 从数据中心获取配置成功');

            // 优先使用数据中心配置，更新内存缓存
            if (config.ua_configs) {
                memoryCache.configCache.uaConfigs = config.ua_configs;
                console.log(`✅ 从数据中心更新UA配置，共${config.ua_configs.length}条`);
                addMemoryLog('INFO', '从数据中心更新UA配置', {
                    count: config.ua_configs.length,
                    data_center_url: DATA_CENTER_CONFIG.url
                });
            }

            if (config.ip_blacklist) {
                memoryCache.configCache.ipBlacklist = config.ip_blacklist;
                console.log(`✅ 从数据中心更新IP黑名单，共${config.ip_blacklist.length}条`);
                addMemoryLog('INFO', '从数据中心更新IP黑名单', {
                    count: config.ip_blacklist.length,
                    data_center_url: DATA_CENTER_CONFIG.url
                });
            }

            memoryCache.configCache.lastUpdate = now;
            DATA_CENTER_CONFIG.lastConfigSync = now;
            console.log('✅ 配置同步成功');
            addMemoryLog('INFO', '配置同步成功', {
                data_center_url: DATA_CENTER_CONFIG.url,
                worker_id: DATA_CENTER_CONFIG.workerId
            });
        } else {
            const errorText = await response.text();
            console.error('❌ 配置同步失败，HTTP状态:', response.status);
            console.error('❌ 错误详情:', errorText);
            addMemoryLog('ERROR', `配置同步失败: HTTP ${response.status}`, {
                data_center_url: DATA_CENTER_CONFIG.url,
                status: response.status,
                statusText: response.statusText,
                errorDetail: errorText,
                apiKey: DATA_CENTER_CONFIG.apiKey ? `${DATA_CENTER_CONFIG.apiKey.substring(0, 8)}...` : '未设置'
            });
        }
    } catch (error) {
        console.error('❌ 配置同步失败，继续使用环境变量配置:', error);
        addMemoryLog('ERROR', `配置同步异常: ${error.message}`, {
            data_center_url: DATA_CENTER_CONFIG.url,
            error: error.message
        });
    }
}

// 向数据中心发送配置数据（带重试机制）
async function syncConfigToDataCenter(retryCount = 0) {
    if (!DATA_CENTER_CONFIG.enabled) return;
    const MAX_RETRIES = 3;

    try {
        console.log('📋 开始同步配置数据到数据中心...');

        // 深拷贝配置数据
        // 注意：ip_blacklist 可能是对象（从数据中心同步）或数组（从环境变量加载）
        const ipBlacklist = memoryCache.configCache.ipBlacklist;
        let ipBlacklistCopy;
        if (Array.isArray(ipBlacklist)) {
            ipBlacklistCopy = [...ipBlacklist];
        } else if (ipBlacklist && typeof ipBlacklist === 'object') {
            ipBlacklistCopy = JSON.parse(JSON.stringify(ipBlacklist));
        } else {
            ipBlacklistCopy = [];
        }

        const configData = {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            data: {
                ua_configs: JSON.parse(JSON.stringify(memoryCache.configCache.uaConfigs)),
                ip_blacklist: ipBlacklistCopy,
                last_update: memoryCache.configCache.lastUpdate,
                secret_usage: { ...memoryCache.appSecretUsage }
            }
        };

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/sync/config`, {
            method: 'POST',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(configData)
        });

        if (response.ok) {
            console.log('✅ 配置数据同步成功');
            addMemoryLog('INFO', '配置数据同步成功', { sync_type: 'config' });
        } else {
            const errorText = await response.text();
            console.error('❌ 配置数据同步失败，HTTP状态:', response.status, errorText);
            addMemoryLog('ERROR', `配置数据同步失败: HTTP ${response.status}`, {
                status: response.status,
                sync_type: 'config'
            });
            if (retryCount < MAX_RETRIES) {
                console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, 5000));
                return syncConfigToDataCenter(retryCount + 1);
            }
        }
    } catch (error) {
        console.error('❌ 配置数据同步异常:', error);
        addMemoryLog('ERROR', `配置数据同步异常: ${error.message}`, {
            error: error.message,
            sync_type: 'config'
        });
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, 5000));
            return syncConfigToDataCenter(retryCount + 1);
        }
    }
}

// 向数据中心发送日志数据（带重试机制）
async function syncLogsToDataCenter(retryCount = 0) {
    if (!DATA_CENTER_CONFIG.enabled) return;
    const MAX_RETRIES = 3;

    try {
        console.log('📝 开始同步日志数据到数据中心...');
        console.log('📋 当前内存日志数量:', memoryCache.logs.length);

        // 深拷贝日志数据
        const logsCopy = memoryCache.logs.slice();
        const logsData = {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            logs: logsCopy
        };

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/sync/logs`, {
            method: 'POST',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(logsData)
        });

        if (response.ok) {
            console.log(`✅ 日志数据同步成功 (${logsCopy.length}条日志)`);
            addMemoryLog('INFO', '日志数据同步成功', { logs_count: logsCopy.length });

            // 同步成功后，清理已发送的日志（保留最近的一些日志）
            if (memoryCache.logs.length > 200) {
                memoryCache.logs = memoryCache.logs.slice(-100); // 保留最近100条
                console.log('🧹 已清理旧日志，保留最近100条');
            }
        } else {
            const errorText = await response.text();
            console.error('❌ 日志数据同步失败，HTTP状态:', response.status, errorText);
            addMemoryLog('ERROR', `日志数据同步失败: HTTP ${response.status}`, {
                status: response.status,
                sync_type: 'logs'
            });
            if (retryCount < MAX_RETRIES) {
                console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, 5000));
                return syncLogsToDataCenter(retryCount + 1);
            }
        }
    } catch (error) {
        console.error('❌ 日志数据同步异常:', error);
        addMemoryLog('ERROR', `日志数据同步异常: ${error.message}`, {
            error: error.message,
            sync_type: 'logs'
        });
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, 5000));
            return syncLogsToDataCenter(retryCount + 1);
        }
    }
}

// 向数据中心发送 IP 请求统计数据（带重试机制）
async function syncRequestStatsToDataCenter(retryCount = 0) {
    if (!DATA_CENTER_CONFIG.enabled) return;
    const MAX_RETRIES = 3;

    try {
        console.log('📊 开始同步 IP 请求统计数据到数据中心...');

        // 深拷贝IP统计数据，避免同步过程中数据被修改
        const byIp = JSON.parse(JSON.stringify(memoryCache.ipRequestStats));
        const totalRequests = memoryCache.totalRequests;

        const statsData = {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            stats: {
                total_requests: totalRequests,
                by_ip: byIp
            }
        };

        // 调试日志：打印IP统计数据
        console.log('📊 IP请求统计数据详情:');
        console.log('   - 总请求数:', totalRequests);
        console.log('   - 统计的IP数量:', Object.keys(byIp).length);

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/sync/request-stats`, {
            method: 'POST',
            headers: {
                'X-API-Key': DATA_CENTER_CONFIG.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(statsData)
        });

        if (response.ok) {
            console.log('✅ IP 请求统计数据同步成功');
            addMemoryLog('INFO', 'IP 请求统计数据同步成功', { sync_type: 'request-stats' });
        } else {
            const errorText = await response.text();
            console.error('❌ IP 请求统计数据同步失败，HTTP状态:', response.status, errorText);
            addMemoryLog('ERROR', `IP 请求统计数据同步失败: HTTP ${response.status}`, {
                status: response.status,
                sync_type: 'request-stats'
            });
            // 重试
            if (retryCount < MAX_RETRIES) {
                console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, 5000));
                return syncRequestStatsToDataCenter(retryCount + 1);
            }
        }
    } catch (error) {
        console.error('❌ IP 请求统计数据同步异常:', error);
        addMemoryLog('ERROR', `IP 请求统计数据同步异常: ${error.message}`, {
            error: error.message,
            sync_type: 'request-stats'
        });
        // 重试
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 将在5秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, 5000));
            return syncRequestStatsToDataCenter(retryCount + 1);
        }
    }
}

// 向数据中心发送统计数据（调用所有同步函数）
async function syncStatsToDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    try {
        console.log('🔄 开始定时同步所有数据到数据中心...');

        // 并行执行三个同步操作
        await Promise.all([
            syncConfigToDataCenter(),
            syncLogsToDataCenter(),
            syncRequestStatsToDataCenter()
        ]);

        DATA_CENTER_CONFIG.lastStatsSync = Date.now();
        console.log('✅ 所有数据同步完成');
    } catch (error) {
        console.error('❌ 定时同步异常:', error);
        addMemoryLog('ERROR', `定时同步异常: ${error.message}`, {
            error: error.message,
            sync_type: 'scheduled'
        });
    }
}

// API密钥验证中间件（验证来自数据中心的请求）
function verifyApiKey(request) {
    // 获取请求中的API Key
    const requestApiKey = request.headers.get('X-API-Key');

    // 从全局配置获取Worker API Key（数据中心访问Worker时使用的密钥）
    const workerApiKey = DATA_CENTER_CONFIG.workerApiKey;

    // 如果没有配置Worker API Key，允许通过（兼容模式）
    if (!workerApiKey) {
        console.log('⚠️ Worker API Key未配置，允许通过（兼容模式）');
        return null;
    }

    // 验证API Key
    if (!requestApiKey || requestApiKey !== workerApiKey) {
        console.log(`❌ Worker API Key验证失败: 请求Key=${requestApiKey ? requestApiKey.substring(0, 8) + '...' : '未提供'}, 配置Key=${workerApiKey.substring(0, 8)}...`);
        return new Response(JSON.stringify({
            error: 'Unauthorized',
            message: 'Invalid or missing API Key'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    console.log('✅ Worker API Key验证成功');
    return null;
}

// 处理数据中心API请求
async function handleDataCenterAPI(request, urlObj) {
    // 获取客户端IP
    const clientIP = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For') ||
                     request.headers.get('X-Real-IP') ||
                     'unknown';

    // 验证API密钥（验证数据中心访问Worker的权限）
    const authError = verifyApiKey(request);
    if (authError) return authError;

    const path = urlObj.pathname;
    const method = request.method;

    // 只在调试模式下记录数据交互端请求日志
    if (memoryCache.envCache.ENABLE_DETAILED_LOGGING) {
        console.log(`📥 [${clientIP}] 数据交互端请求: ${method} ${path}`);
    }

    try {
        // 配置更新端点（接收数据中心主动推送）
        if (path === '/worker-api/config/update' && method === 'POST') {
            const config = await request.json();

            console.log(`📦 [${clientIP}] 收到数据中心配置推送`);
            addMemoryLog('INFO', `数据中心配置推送`, {
                source_ip: clientIP,
                config_keys: Object.keys(config),
                timestamp: Date.now()
            });

            // 立即更新内存中的配置
            if (config.ua_configs) {
                memoryCache.configCache.uaConfigs = config.ua_configs;
                console.log(`✅ [${clientIP}] 已更新UA配置，共${config.ua_configs.length}条`);
                addMemoryLog('INFO', `UA配置更新成功`, {
                    source_ip: clientIP,
                    count: config.ua_configs.length
                });
            }

            if (config.ip_blacklist) {
                memoryCache.configCache.ipBlacklist = config.ip_blacklist;
                console.log(`✅ [${clientIP}] 已更新IP黑名单，共${config.ip_blacklist.length}条`);
                addMemoryLog('INFO', `IP黑名单更新成功`, {
                    source_ip: clientIP,
                    count: config.ip_blacklist.length
                });
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

        // Worker API统计端点
        if (path === '/worker-api/stats' && method === 'GET') {
            addMemoryLog('INFO', `Worker统计数据请求`, { source_ip: clientIP });

            const stats = await getWorkerStats();
            return new Response(JSON.stringify(stats), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 健康检查端点
        if (path === '/worker-api/health' && method === 'GET') {
            addMemoryLog('INFO', `健康检查请求`, { source_ip: clientIP });

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
        if (path === '/worker-api/logs' && method === 'GET') {

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
        console.error(`❌ [${clientIP}] 数据中心API处理错误:`, error);
        addMemoryLog('ERROR', `数据中心API处理错误: ${error.message}`, {
            source_ip: clientIP,
            path: path,
            method: method,
            error: error.message
        });

        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 获取Worker统计数据
async function getWorkerStats() {
    try {
        const now = Date.now();

        // 获取频率限制统计
        const rateLimitStats = getRateLimitStats();

        // 使用简单可靠的计数方式（本实例的计数）
        const currentInstanceRequests = memoryCache.totalRequests || 0;

        console.log(`📊 当前实例统计详情:`);
        console.log(`   - Secret1计数: ${memoryCache.appSecretUsage.count1}`);
        console.log(`   - Secret2计数: ${memoryCache.appSecretUsage.count2}`);
        console.log(`   - 当前Secret: ${memoryCache.appSecretUsage.current}`);
        console.log(`   - 本实例请求数: ${currentInstanceRequests}`);
        console.log(`   - 待处理请求: ${memoryCache.pendingRequests || 0}`);

        const statsData = {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: now,
            requests_total: currentInstanceRequests,
            pending_requests: memoryCache.pendingRequests || 0,
            memory_cache_size: memoryCache.rateLimitCounts.size,
            logs_count: memoryCache.logs.length,
            last_sync_time: DATA_CENTER_CONFIG.lastConfigSync,
            uptime: now - memoryCache.lastSyncTime,
            // 配置统计
            config_stats: {
                ua_configs_count: Object.keys(memoryCache.configCache.uaConfigs || {}).length,
                ip_blacklist_count: getIpBlacklistCount(),
                last_config_update: memoryCache.configCache.lastUpdate
            },
            // 秘钥轮换统计（直接使用内存缓存）
            secret_rotation: {
                secret1_count: memoryCache.appSecretUsage.count1,
                secret2_count: memoryCache.appSecretUsage.count2,
                current_secret: memoryCache.appSecretUsage.current,
                rotation_limit: SECRET_ROTATION_LIMIT
            },
            // 频率限制统计
            rate_limit_stats: rateLimitStats,
            // 内存日志（最近的日志）
            logs: memoryCache.logs.slice(-20) // 返回最近20条日志
        };

        // 详细日志打印返回的数据
        console.log('📊 Worker统计数据生成完成:');
        console.log('   - Worker ID:', statsData.worker_id);
        console.log('   - 总请求数:', statsData.requests_total);
        console.log('   - 待处理请求:', statsData.pending_requests);
        console.log('   - 内存缓存大小:', statsData.memory_cache_size);
        console.log('   - 日志数量:', statsData.logs_count);
        console.log('   - 运行时间:', statsData.uptime, 'ms');
        console.log('   - 配置统计:', JSON.stringify(statsData.config_stats));
        console.log('   - 密钥轮换统计:', JSON.stringify(statsData.secret_rotation));
        console.log('   - 频率限制统计:');
        console.log('     * 总计数器:', rateLimitStats.total_counters);
        console.log('     * 活跃IP数:', rateLimitStats.active_ips);
        console.log('     * UA类型统计:', Object.keys(rateLimitStats.ua_type_stats).length, '种类型');
        console.log('     * 路径限制统计:', Object.keys(rateLimitStats.path_limit_stats).length, '个路径');

        // 打印路径限制的详细信息
        if (Object.keys(rateLimitStats.path_limit_stats).length > 0) {
            console.log('   - 路径限制详情:');
            Object.entries(rateLimitStats.path_limit_stats).forEach(([path, stats]) => {
                console.log(`     * ${path}: 活跃IP=${stats.active_ips}, 总请求=${stats.total_requests}, UA类型=${stats.ua_types}, 配置限制=${stats.configured_limit || '未知'}`);
            });
        }

        console.log('   - 最近日志数量:', statsData.logs.length);

        return statsData;
    } catch (error) {
        console.error('获取统计数据失败:', error);
        return {
            worker_id: DATA_CENTER_CONFIG.workerId,
            timestamp: Date.now(),
            error: error.message
        };
    }
}

// 获取频率限制统计信息
function getRateLimitStats() {
    const stats = {
        total_counters: memoryCache.rateLimitCounts.size,
        active_ips: new Set(),
        ua_type_stats: {},
        path_limit_stats: {}
    };

    // 首先从配置中添加所有配置的路径限制（即使没有实际请求）
    if (memoryCache.configCache.uaConfigs) {
        Object.values(memoryCache.configCache.uaConfigs).forEach(uaConfig => {
            if (uaConfig.pathLimits && Array.isArray(uaConfig.pathLimits)) {
                uaConfig.pathLimits.forEach(pathLimit => {
                    const pathPattern = pathLimit.path;
                    if (pathPattern && !stats.path_limit_stats[pathPattern]) {
                        stats.path_limit_stats[pathPattern] = {
                            active_ips: new Set(),
                            total_requests: 0,
                            ua_types: new Set(),
                            configured_limit: pathLimit.maxRequestsPerHour || 50,
                            ua_type: uaConfig.type || 'Unknown'
                        };
                    }
                });
            }
        });
    }

    // 分析当前的频率限制计数器
    for (const [key, counter] of memoryCache.rateLimitCounts.entries()) {
        const parts = key.split('-');
        if (parts.length >= 2) {
            const uaType = parts[0];
            const ip = parts[parts.length - 1];

            stats.active_ips.add(ip);

            // UA类型统计
            if (!stats.ua_type_stats[uaType]) {
                stats.ua_type_stats[uaType] = {
                    active_ips: new Set(),
                    total_requests: 0
                };
            }
            stats.ua_type_stats[uaType].active_ips.add(ip);
            stats.ua_type_stats[uaType].total_requests += counter.count;

            // 路径限制统计
            if (key.includes('-path-')) {
                const pathPattern = parts.slice(2, -1).join('-'); // 提取路径模式
                if (!stats.path_limit_stats[pathPattern]) {
                    stats.path_limit_stats[pathPattern] = {
                        active_ips: new Set(),
                        total_requests: 0,
                        ua_types: new Set(),
                        configured_limit: 50, // 默认限制
                        ua_type: uaType
                    };
                }
                stats.path_limit_stats[pathPattern].active_ips.add(ip);
                stats.path_limit_stats[pathPattern].total_requests += counter.count;
                stats.path_limit_stats[pathPattern].ua_types.add(uaType);
            }
        }
    }

    // 转换Set为数组长度
    stats.active_ips = stats.active_ips.size;
    Object.keys(stats.ua_type_stats).forEach(uaType => {
        stats.ua_type_stats[uaType].active_ips = stats.ua_type_stats[uaType].active_ips.size;
    });
    Object.keys(stats.path_limit_stats).forEach(path => {
        const pathStats = stats.path_limit_stats[path];
        pathStats.active_ips = pathStats.active_ips.size;
        pathStats.ua_types = pathStats.ua_types.size;
        // 保留 configured_limit 和 ua_type 字段
    });

    return stats;
}

// 获取IP黑名单数量（兼容数组和对象格式）
function getIpBlacklistCount() {
    const ipBlacklist = memoryCache.configCache.ipBlacklist;
    if (!ipBlacklist) return 0;
    if (Array.isArray(ipBlacklist)) return ipBlacklist.length;
    if (typeof ipBlacklist === 'object') return Object.keys(ipBlacklist).length;
    return 0;
}

// 获取IP黑名单配置（优先使用内存缓存，兼容数组和对象格式）
function getIpBlacklist() {
    const ipBlacklist = memoryCache.configCache.ipBlacklist;

    // 如果是数组格式（从环境变量加载）
    if (Array.isArray(ipBlacklist) && ipBlacklist.length > 0) {
        console.log('使用内存缓存IP黑名单（数组格式），包含', ipBlacklist.length, '个规则');
        return ipBlacklist;
    }

    // 如果是对象格式（从数据中心同步）
    if (ipBlacklist && typeof ipBlacklist === 'object' && Object.keys(ipBlacklist).length > 0) {
        // 转换为数组格式供 isIpBlacklisted 使用
        const ipList = Object.keys(ipBlacklist);
        console.log('使用内存缓存IP黑名单（对象格式），包含', ipList.length, '个规则');
        return ipList;
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
    const ENABLE_DETAILED_LOGGING = memoryCache.envCache.ENABLE_DETAILED_LOGGING;

    return {
        // 基于User-Agent的分级限制配置（从内存缓存动态获取）
        get userAgentLimits() {
            return getUserAgentLimits();
        },

        // 日志配置
        logging: {
            enabled: ENABLE_DETAILED_LOGGING
        }
    };
}


// ========================================
// 🔧 工具文件请求处理
// ========================================

/**
 * 处理 /tools/* 路径的静态文件请求
 * 使用 Wrangler Assets 功能提供工具 JS 文件
 */
function handleToolsRequest(request, env, urlObj) {
    // 只允许 GET 请求
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 如果配置了 Assets binding，使用 Assets 服务
    if (env.ASSETS) {
        // 构建新的请求，将 /tools/xxx.js 映射到 /xxx.js
        const assetPath = urlObj.pathname.replace('/tools/', '/');
        const assetUrl = new URL(assetPath, request.url);
        const assetRequest = new Request(assetUrl.toString(), request);

        return env.ASSETS.fetch(assetRequest).then(response => {
            // 添加 CORS 和缓存头
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Access-Control-Allow-Origin', '*');
            newHeaders.set('Cache-Control', 'public, max-age=86400'); // 缓存1天

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });
        }).catch(() => {
            return new Response('Tool not found', {
                status: 404,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        });
    }

    // 如果没有配置 Assets，返回提示信息
    return new Response(JSON.stringify({
        error: 'Assets not configured',
        message: '工具文件服务未配置，请检查 wrangler.toml 中的 [assets] 配置'
    }), {
        status: 503,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}


// ========================================
// 🔐 OAuth 通用认证模块
// ========================================

// --- JWT 工具函数 (HMAC-SHA256, 纯 Web Crypto API) ---

function base64UrlEncode(data) {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return atob(str);
}
async function getJwtKey(secret) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signJwt(payload, secret) {
    const enc = new TextEncoder();
    const hB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const pB64 = base64UrlEncode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('HMAC', await getJwtKey(secret), enc.encode(`${hB64}.${pB64}`));
    return `${hB64}.${pB64}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyJwt(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from(base64UrlDecode(parts[2]), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', await getJwtKey(secret), sigBytes, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    try {
        const p = JSON.parse(base64UrlDecode(parts[1]));
        return (p.exp && p.exp < Math.floor(Date.now() / 1000)) ? null : p;
    } catch { return null; }
}
async function quickHash(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// --- OAuth 配置读取（从环境变量 OAUTH_CONFIG 解析） ---
let _oauthConfigCache = null;
function getOAuthConfig(env) {
    if (_oauthConfigCache) return _oauthConfigCache;
    try {
        _oauthConfigCache = JSON.parse(env.OAUTH_CONFIG || '{}');
    } catch {
        _oauthConfigCache = {};
    }
    return _oauthConfigCache;
}
function isOAuthEnabled(env) { return !!getOAuthConfig(env).enabled; }
function getOAuthJwtSecret(env) { return getOAuthConfig(env).jwtSecret || ''; }
function getOAuthExpireMs(env) { return (getOAuthConfig(env).jwtExpireHours || 720) * 3600 * 1000; }
function getOAuthAllowedUsers(env) { return getOAuthConfig(env).allowedUsers || {}; }
function getProviderConfig(provider, env) {
    const cfg = (getOAuthConfig(env).providers || {})[provider];
    if (!cfg?.clientId || !cfg?.clientSecret || !cfg?.authorizeUrl || !cfg?.tokenUrl || !cfg?.userInfoUrl) return null;
    return cfg;
}
// 通过 JSON 路径从对象中取值（如 "user.ids.slug" → obj.user.ids.slug）
function resolvePath(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((o, k) => o?.[k], obj);
}
// 从 Provider 的 userMapping/userFallback 配置提取用户信息
function extractUserFromConfig(userData, config) {
    const mapping = config.userMapping || {};
    const fallback = config.userFallback || {};
    return {
        id: String(resolvePath(userData, mapping.id) || resolvePath(userData, fallback.id) || 'unknown'),
        name: String(resolvePath(userData, mapping.name) || resolvePath(userData, fallback.name) || 'unknown'),
        avatar: String(resolvePath(userData, mapping.avatar) || resolvePath(userData, fallback.avatar) || ''),
    };
}
// 构建获取用户信息时的额外 header（$clientId 会被替换为实际值）
function buildExtraHeaders(config) {
    if (!config.extraHeaders) return {};
    const headers = {};
    for (const [key, val] of Object.entries(config.extraHeaders)) {
        headers[key] = String(val).replace('$clientId', config.clientId);
    }
    return headers;
}
function getAvailableProviders(env) {
    return Object.keys(getOAuthConfig(env).providers || {}).filter(p => getProviderConfig(p, env));
}

// --- OAuth 路由处理 ---
async function handleOAuthRequest(request, env, urlObj) {
    const path = urlObj.pathname;
    const origin = urlObj.origin;

    // GET /oauth/providers — 列出可用 Provider
    if (path === '/oauth/providers') {
        return oauthJson({ providers: getAvailableProviders(env) });
    }

    // GET /oauth/login?provider=xxx&redirect_uri=xxx — 重定向到授权页
    if (path === '/oauth/login') {
        const provider = urlObj.searchParams.get('provider');
        const appRedirectUri = urlObj.searchParams.get('redirect_uri') || '';
        const config = getProviderConfig(provider, env);
        if (!config) return oauthJson({ error: `Provider "${provider}" 不可用或未配置` }, 400);
        // 在 state 中编码 redirect_uri（base64），回调时取出用于跳转
        const stateData = appRedirectUri
            ? `${provider}:${crypto.randomUUID()}:${btoa(appRedirectUri)}`
            : `${provider}:${crypto.randomUUID()}`;
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: `${origin}/oauth/callback`,
            scope: config.scopes || '',
            state: stateData,
            response_type: 'code',
        });
        return Response.redirect(`${config.authorizeUrl}?${params}`, 302);
    }

    // GET /oauth/callback?code=xxx&state=provider:uuid[:base64_redirect] — Provider 回调 
    if (path === '/oauth/callback') {
        const code = urlObj.searchParams.get('code');
        const state = urlObj.searchParams.get('state') || '';
        const provider = state.split(':')[0];
        const config = getProviderConfig(provider, env);
        if (!code || !config) return oauthJson({ error: 'OAuth 回调参数错误' }, 400);
        try {
            // 1. code → access_token
            const tokenBody = {
                client_id: config.clientId, client_secret: config.clientSecret,
                code, redirect_uri: `${origin}/oauth/callback`, grant_type: 'authorization_code',
            };
            const useJson = config.tokenContentType === 'json';
            console.log(`🔐 [OAuth] token请求: useJson=${useJson}, url=${config.tokenUrl}, tokenContentType=${config.tokenContentType}`);
            const tokenRes = await fetch(config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': useJson ? 'application/json' : 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'CF-Worker-OAuth/1.0',
                },
                body: useJson ? JSON.stringify(tokenBody) : new URLSearchParams(tokenBody),
            });
            // 容错：先读文本，非 JSON 时返回详细错误
            const tokenText = await tokenRes.text();
            console.log(`🔐 [OAuth] token响应: status=${tokenRes.status}, body=${tokenText.slice(0, 500)}`);
            let tokenData;
            try {
                tokenData = JSON.parse(tokenText);
            } catch {
                return oauthJson({ error: 'Token 接口返回非 JSON', status: tokenRes.status, body: tokenText.slice(0, 300) }, 502);
            }
            const accessToken = tokenData.access_token;
            if (!accessToken) return oauthJson({ error: '获取 Token 失败', detail: tokenData }, 400);

            // 2. access_token → 用户信息（通过 JSON 路径映射提取，不依赖代码函数）
            const userInfoHeaders = {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'User-Agent': 'CF-Worker-OAuth',
                ...buildExtraHeaders(config),
            };
            const userRes = await fetch(config.userInfoUrl, { headers: userInfoHeaders });
            const userData = await userRes.json();
            const user = extractUserFromConfig(userData, config);

            // 3. 白名单校验
            const providerAllowed = (getOAuthAllowedUsers(env)[provider]) || [];
            if (providerAllowed.length > 0 && !providerAllowed.includes(user.id)) {
                addMemoryLog('WARN', 'OAuth 用户不在白名单', { provider, userId: user.id });
                return oauthJson({ error: `用户 "${user.id}" 不在白名单中` }, 403);
            }

            // 4. 签发 JWT
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJwt({
                sub: user.id, name: user.name, avatar: user.avatar, provider,
                iat: now, exp: now + Math.floor(getOAuthExpireMs(env) / 1000),
            }, getOAuthJwtSecret(env));
            addMemoryLog('INFO', 'OAuth 登录成功', { provider, userId: user.id });

            // 5. 检查是否需要 redirect 回应用
            const stateParts = state.split(':');
            const encodedRedirectUri = stateParts.length >= 3 ? stateParts.slice(2).join(':') : '';
            if (encodedRedirectUri) {
                try {
                    const appRedirectUri = atob(encodedRedirectUri);
                    const redirectParams = new URLSearchParams({
                        token: jwt,
                        user: user.id,
                        name: user.name,
                        provider,
                        access_token: accessToken,
                        client_id: config.clientId,
                    });
                    return Response.redirect(`${appRedirectUri}?${redirectParams}`, 302);
                } catch (e) {
                    addMemoryLog('WARN', 'redirect_uri decode failed', { error: e.message });
                }
            }
            // 没有 redirect_uri 或解码失败，返回 JSON
            return oauthJson({ token: jwt, user: user.id, name: user.name, provider, client_id: config.clientId });
        } catch (err) {
            addMemoryLog('ERROR', 'OAuth 回调异常', { error: err.message });
            return oauthJson({ error: `OAuth 处理异常: ${err.message}` }, 500);
        }
    }

    // GET /oauth/verify — 验证 token 有效性
    if (path === '/oauth/verify') {
        const payload = await extractAndVerifyToken(request, env);
        if (!payload) return oauthJson({ valid: false }, 401);
        return oauthJson({ valid: true, user: payload.sub, provider: payload.provider, exp: payload.exp });
    }

    return oauthJson({ error: 'OAuth 路由不存在' }, 404);
}

// --- Token 验证中间件 ---
async function extractAndVerifyToken(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const hash = await quickHash(token);
    const cached = memoryCache.oauthTokenCache.get(hash);
    if (cached) {
        if (cached.expireAt > Date.now()) return cached.payload;
        memoryCache.oauthTokenCache.delete(hash);
    }
    const payload = await verifyJwt(token, getOAuthJwtSecret(env));
    if (!payload) return null;
    // 写缓存（LRU）
    if (memoryCache.oauthTokenCache.size >= OAUTH_TOKEN_CACHE_MAX) {
        const keys = [...memoryCache.oauthTokenCache.keys()];
        keys.slice(0, Math.floor(keys.length / 2)).forEach(k => memoryCache.oauthTokenCache.delete(k));
    }
    memoryCache.oauthTokenCache.set(hash, { payload, expireAt: payload.exp * 1000 });
    return payload;
}

// --- OAuth 辅助函数 ---
function oauthJson(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}



export default {
  async fetch(request, env, ctx) {
    // 初始化数据中心配置
    await initializeDataCenterConfig(env);

    return await handleRequest(request, env, ctx);
  }
};


async function handleRequest(request, env, ctx) {
    // 定期清理内存 + R2 过期轮询
    const r2CleanupPromise = periodicCleanup(env);
    if (r2CleanupPromise && ctx?.waitUntil) ctx.waitUntil(r2CleanupPromise);

    // 获取客户端IP
    const clientIP = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For') ||
                     request.headers.get('X-Real-IP') ||
                     'unknown';

    // 只在调试模式下记录请求日志
    if (memoryCache.envCache.ENABLE_DETAILED_LOGGING) {
        console.log(`📥 [${clientIP}] 收到请求:`, request.method, new URL(request.url).pathname);
    }

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

    // ========================================
    // 🔧 工具文件请求处理 (/tools/*)
    // ========================================
    if (urlObj.pathname.startsWith('/tools/')) {
        return handleToolsRequest(request, env, urlObj);
    }

    // ========================================
    // 🔐 OAuth 路由处理 (/oauth/*)
    // ========================================
    if (urlObj.pathname.startsWith('/oauth/')) {
        if (!isOAuthEnabled(env)) {
            return oauthJson({ error: 'OAuth 未启用，请在环境变量 OAUTH_CONFIG 中设置 enabled: true' }, 503);
        }
        return handleOAuthRequest(request, env, urlObj);
    }

    // 数据中心API端点处理（只处理Worker API路径）
    if (urlObj.pathname.startsWith('/worker-api/')) {
        return await handleDataCenterAPI(request, urlObj);
    }

    // IP黑名单和临时封禁检查
    // clientIP已在函数开头声明

    // 临时封禁功能已移除

    // 检查永久黑名单
    const ipBlacklist = getIpBlacklist();
    if (isIpBlacklisted(clientIP, ipBlacklist)) {
        console.log(`🚫 [${clientIP}] IP在黑名单中，拒绝访问`);

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
    console.log(`🔍 [${clientIP}] 开始访问控制检查，目标路径: ${tUrlObj.pathname}`);

    const accessCheck = await checkAccess(request, tUrlObj.pathname);
    if (!accessCheck.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        const errorMessage = `IP:${clientIP} UA:${userAgent} 消息：${accessCheck.reason}`;

        console.log(`🚫 [${clientIP}] 访问被拒绝: ${errorMessage}, 路径=${tUrlObj.pathname}`);

        return new Response(JSON.stringify({
            status: accessCheck.status,
            type: "访问控制",
            message: errorMessage
        }), {
            status: accessCheck.status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 访问控制检查通过
    console.log(`✅ [${clientIP}] 访问控制检查通过，继续处理请求`);
    console.log(`   - UA类型: ${accessCheck.uaConfig?.type || 'unknown'}`);
    console.log(`   - 目标路径: ${tUrlObj.pathname}`);

    // ========================================
    // 📦 缓存策略判断
    // ========================================
    const apiPath = tUrlObj.pathname;
    // 内存缓存：搜索、番剧、匹配、搜索分集
    const memoryCachePatterns = ['/api/v2/search/anime', '/api/v2/search/episodes', '/api/v2/bangumi/', '/api/v2/match'];
    const isCacheable = request.method === 'GET' && memoryCachePatterns.some(p => apiPath.startsWith(p));
    // R2 缓存：弹幕接口
    const isCommentApi = request.method === 'GET' && apiPath.startsWith('/api/v2/comment/');

    // --- 内存缓存命中检查 ---
    if (isCacheable) {
        const cacheKey = `api_cache_${url}`;
        const cached = memoryCache.apiCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp < MEMORY_LIMITS.API_CACHE_TTL)) {
            console.log(`📦 [${clientIP}] 内存缓存命中: ${apiPath}`);
            addMemoryLog('INFO', '内存缓存命中', {
                ip: clientIP,
                path: apiPath,
                cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's'
            });
            return new Response(cached.data, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT',
                    'X-Cache-Age': Math.round((Date.now() - cached.timestamp) / 1000).toString()
                }
            });
        }
    }

    // --- R2 弹幕缓存命中检查 ---
    if (isCommentApi) {
        // Key 只用 episodeId，如 /api/v2/comment/12345 → comment/12345
        const episodeId = apiPath.replace('/api/v2/comment/', '').split('?')[0];
        const r2Key = R2_CACHE_CONFIG.KEY_PREFIX + episodeId;
        const cachedData = await r2GetComment(env, r2Key);
        if (cachedData) {
            console.log(`📦 [${clientIP}] R2弹幕缓存命中: ${apiPath}`);
            addMemoryLog('INFO', 'R2弹幕缓存命中', { ip: clientIP, path: apiPath });
            return new Response(cachedData, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT-R2',
                }
            });
        }
    }

    const appId = env.APP_ID;
    // 使用缓存的AppSecret信息，避免每次都调用DO
    const { appSecret } = await getCachedAppSecret(env);


    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateSignature(appId, timestamp, apiPath, appSecret);

    // 在内存中记录AppSecret使用次数
    if (memoryCache.appSecretUsage.current === '1') {
        memoryCache.appSecretUsage.count1++;
        console.log(`🔢 AppSecret1计数增加: ${memoryCache.appSecretUsage.count1}`);
    } else {
        memoryCache.appSecretUsage.count2++;
        console.log(`🔢 AppSecret2计数增加: ${memoryCache.appSecretUsage.count2}`);
    }

    // 增加待同步请求计数
    memoryCache.pendingRequests++;
    memoryCache.totalRequests++;

    console.log(`📊 [${clientIP}] 请求计数更新:`);
    console.log(`   - 待处理请求: ${memoryCache.pendingRequests}`);
    console.log(`   - 总请求数: ${memoryCache.totalRequests}`);

    // 检查是否需要同步到存储（仅同步本地缓存，不涉及数据中心）
    if (await shouldSyncToStorage()) {
        ctx.waitUntil(syncCacheToStorage());
    }

    // 检查是否需要同步到数据中心（独立的定时检查，不阻塞请求）
    if (DATA_CENTER_CONFIG.enabled && await shouldSyncToDataCenter()) {
        ctx.waitUntil(syncStatsToDataCenter());
    }

    if (ACCESS_CONFIG.logging.enabled) {
        console.log(`🔐 [${clientIP}] API路径: ${apiPath}`);
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
        console.log(`📤 [${clientIP}] 转发请求头:`, JSON.stringify(finalHeaders, null, 2));
    }

    let response = await fetch(url, {
        headers: finalHeaders,
        body: request.body,
        method: request.method,
    });

    // 调试日志：显示dandanplay API响应内容
    console.log(`📥 [${clientIP}] dandanplay API响应状态:`, response.status, response.statusText);

    // 记录API请求到内存日志
    addMemoryLog('INFO', 'API请求处理', {
        ip: clientIP,
        method: request.method,
        path: apiPath,
        userAgent: request.headers.get('X-User-Agent') || '',
        responseStatus: response.status,
        timestamp: Date.now()
    });

    // 读取响应内容用于日志记录
    const responseText = await response.text();
    // 新增：根据API路径选择性地记录响应内容，避免日志超限
    if (apiPath.startsWith('/api/v2/comment/')) {
        try {
            const jsonResponse = JSON.parse(responseText);
            if (jsonResponse && Array.isArray(jsonResponse.comments)) {
                console.log(`📄 [${clientIP}] dandanplay API响应内容: (路径=${apiPath}) 弹幕数量=${jsonResponse.comments.length}, comments数组内容已省略`);
            } else {
                console.log(`📄 [${clientIP}] dandanplay API响应内容:`, responseText);
            }
        } catch (e) {
            // 如果不是有效的JSON，则记录原始文本
            console.log(`📄 [${clientIP}] dandanplay API响应内容 (非JSON):`, responseText);
        }
    } else {
        console.log(`📄 [${clientIP}] dandanplay API响应内容:`, responseText);
    }

    // ========================================
    // 📦 缓存存入
    // ========================================
    if (response.status === 200) {
        if (isCacheable) {
            // 内存缓存：搜索/番剧/匹配/分集
            const cacheKey = `api_cache_${url}`;
            memoryCache.apiCache.set(cacheKey, {
                data: responseText,
                timestamp: Date.now()
            });
            console.log(`📦 [${clientIP}] 内存缓存已存入: ${apiPath} (TTL: 2h)`);
        } else if (isCommentApi) {
            // R2 缓存：弹幕接口，只缓存有弹幕的响应
            try {
                const parsed = JSON.parse(responseText);
                if (parsed && Array.isArray(parsed.comments) && parsed.comments.length > 0) {
                    const episodeId = apiPath.replace('/api/v2/comment/', '').split('?')[0];
                    const r2Key = R2_CACHE_CONFIG.KEY_PREFIX + episodeId;
                    // 用 ctx.waitUntil 保活，确保 Worker 返回响应后 R2 写入仍能完成
                    const r2Promise = r2PutComment(env, r2Key, responseText).then(() => {
                        console.log(`📦 [${clientIP}] R2弹幕缓存已存入: ${r2Key} (${parsed.comments.length}条弹幕, TTL: 12h)`);
                    }).catch(e => {
                        console.log(`⚠️ [${clientIP}] R2弹幕缓存存入失败: ${e.message}`);
                    });
                    if (ctx && ctx.waitUntil) ctx.waitUntil(r2Promise);
                } else {
                    console.log(`📦 [${clientIP}] 弹幕为空，跳过R2缓存: ${apiPath}`);
                }
            } catch (e) {
                console.log(`⚠️ [${clientIP}] 弹幕响应解析失败，跳过R2缓存: ${e.message}`);
            }
        }
    }

    // 重新创建Response对象（因为body已经被读取）
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    if (isCacheable || isCommentApi) {
        responseHeaders.set('X-Cache', 'MISS');
    }

    return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
    });
}

// 批量同步管理函数
async function shouldSyncToStorage() {
    const now = Date.now();
    const timeSinceLastSync = now - memoryCache.lastSyncTime;

    // 达到请求阈值或时间间隔时触发同步
    return memoryCache.pendingRequests >= BATCH_SYNC_THRESHOLD ||
           timeSinceLastSync >= BATCH_SYNC_INTERVAL;
}

// 检查是否需要同步到数据中心（独立的定时检查）
async function shouldSyncToDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return false;

    const now = Date.now();
    const timeSinceLastSync = now - DATA_CENTER_CONFIG.lastStatsSync;

    // 每小时同步一次到数据中心
    return timeSinceLastSync >= DATA_CENTER_CONFIG.syncInterval;
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

    // 打印访问控制检查开始信息
    console.log(`🔍 [${clientIP}] 访问控制检查开始:`);
    console.log(`   - User-Agent: ${userAgent}`);
    console.log(`   - API路径: ${apiPath}`);
    console.log(`   - 可用UA配置: ${Object.keys(ACCESS_CONFIG.userAgentLimits).join(', ')}`);

    // 1. 识别User-Agent类型并获取对应限制
    const uaConfig = identifyUserAgent(userAgent, ACCESS_CONFIG);
    if (!uaConfig) {
        console.log(`❌ [${clientIP}] UA识别失败: 未找到匹配的UA配置`);
        console.log(`   - 请求UA: ${userAgent}`);
        console.log(`   - 配置的UA列表:`);
        Object.entries(ACCESS_CONFIG.userAgentLimits).forEach(([key, config]) => {
            console.log(`     * ${key}: ${config.userAgent || 'N/A'}`);
        });
        return { allowed: false, reason: '禁止访问的UA', status: 403 };
    }

    console.log(`✅ [${clientIP}] UA识别成功: ${uaConfig.type}`);
    console.log(`   - 匹配的UA配置: ${JSON.stringify(uaConfig)}`);
    console.log(`   - 最大请求数: ${uaConfig.maxRequests || 'N/A'}`);
    console.log(`   - 时间窗口: ${uaConfig.windowMs || 'N/A'}ms`);

    // 2. 基于内存的频率限制（全局限制）
    console.log(`🔄 [${clientIP}] 开始频率限制检查 (UA类型: ${uaConfig.type})`);
    const rateLimitCheck = checkMemoryRateLimit(clientIP, uaConfig.type, uaConfig);

    if (!rateLimitCheck.allowed) {
        console.log(`❌ [${clientIP}] 频率限制检查失败: ${rateLimitCheck.reason}`);
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

    console.log(`📊 [${clientIP}] 频率限制检查结果: 通过 (${rateLimitCheck.count}/${rateLimitCheck.limit})`);

    // 3. 路径特定限制检查（基于IP+UA类型+路径的组合限制）
    console.log(`🛣️ [${clientIP}] 开始路径特定限制检查`);
    if (uaConfig.pathSpecificLimits && Object.keys(uaConfig.pathSpecificLimits).length > 0) {
        console.log(`   - 路径特定限制配置: ${JSON.stringify(uaConfig.pathSpecificLimits)}`);
        for (const [pathPattern, pathLimit] of Object.entries(uaConfig.pathSpecificLimits)) {
            console.log(`   - 检查路径模式: ${pathPattern} (当前路径: ${apiPath})`);
            if (apiPath.includes(pathPattern)) {
                console.log(`   - 路径匹配! 应用路径特定限制: ${pathLimit.maxRequestsPerHour || 50}/小时`);
                // 使用IP+UA类型+路径的组合作为限制键，确保每个IP在每个UA类型下的每个路径都有独立的限制
                const pathRateLimitCheck = checkMemoryRateLimit(
                    clientIP,
                    `${uaConfig.type}-path-${pathPattern}`,
                    {
                        maxRequests: pathLimit.maxRequestsPerHour || 50,
                        windowMs: 60 * 60 * 1000 // 1小时窗口
                    }
                );

                if (!pathRateLimitCheck.allowed) {
                    console.log(`❌ [${clientIP}] 路径限制 [${pathPattern}]: 超限 (${pathRateLimitCheck.count}/${pathRateLimitCheck.limit})`);
                    addMemoryLog('warn', '路径特定频率限制触发', {
                        ip: clientIP,
                        userAgent,
                        uaType: uaConfig.type,
                        path: apiPath,
                        pathPattern: pathPattern,
                        reason: pathRateLimitCheck.reason,
                        pathLimit: pathLimit.maxRequestsPerHour,
                        currentCount: pathRateLimitCheck.count
                    });

                    return {
                        allowed: false,
                        reason: `路径 ${pathPattern} 频率限制: ${pathRateLimitCheck.reason}`,
                        status: 429
                    };
                }
                console.log(`📊 [${clientIP}] 路径限制 [${pathPattern}]: 通过 (${pathRateLimitCheck.count}/${pathRateLimitCheck.limit})`);
                break; // 只检查第一个匹配的路径模式
            }
        }
    } else {
        console.log(`   - 无路径特定限制配置`);
    }



    console.log(`🎉 [${clientIP}] 访问控制检查全部通过!`);
    return { allowed: true, uaConfig: uaConfig, apiPath: apiPath };
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

// 导出函数供TG机器人模块使用
export { getIpBlacklist, getAccessConfig, memoryCache };
