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
    API_CACHE_TTL: 21600000,     // API内存缓存6小时
    MAX_API_CACHE_SIZE: 1000     // 最多缓存500个API响应（内存缓存，不含弹幕）
};

// R2 弹幕缓存配置
const R2_CACHE_CONFIG = {
    TTL: 12 * 60 * 60 * 1000,              // 12小时过期
    MAX_STORAGE_BYTES: 9 * 1024 * 1024 * 1024, // 9GB 阈值
    KEY_PREFIX: 'comment/',                 // R2 key 前缀
    EXPIRE_POLL_INTERVAL: 5 * 60 * 1000,   // 过期轮询间隔：5分钟（请求路径被动清理）
    WRITE_CHECK_INTERVAL: 500,             // 每写入 500 次触发一次容量检查
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
        ipWhitelist: [],
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
    r2WriteCount: 0,                // R2 写入计数（用于触发写入路径容量检查）
    r2EstimatedBytes: 0,            // R2 已写入数据量估算（由 r2ScheduledCleanup 校准）
    // API响应缓存（用于搜索和番剧接口）
    apiCache: new Map(), // 格式: { "cache_key": { data: response, timestamp: Date.now() } }
    // OAuth token 验证缓存（避免每次请求都做 crypto 运算）
    oauthTokenCache: new Map(), // 格式: { "token_hash": { payload, expireAt } }
    lastControlConfigPull: 0,
    lastStatsReport: 0,
    lastLogReport: 0,
};

// 数据中心集成配置（新架构：仅保留 Worker 标识与初始化标志，旧 HTTP 同步字段已废弃）
let DATA_CENTER_CONFIG = {
    workerId: 'worker-1',
    initialized: false // 初始化标志
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
// � ControlHub 长连接辅助函数（Worker 侧）
// ========================================

// 需要本地化的接口（200 时 cache.upsert，429 时 cache.get 兜底）
const LOCAL_CACHE_PATTERNS = [
    '/api/v2/search/anime',
    '/api/v2/search/episodes',
    '/api/v2/bangumi/',
    '/api/v2/match',
];

// 判断某接口是否需要走本地缓存（记录 / 兜底）
function shouldUseLocalCache(apiPath, method) {
    return method === 'GET' && LOCAL_CACHE_PATTERNS.some(p => apiPath.startsWith(p));
}

// 构造标准化 cache key：METHOD:PATH?sorted_query（剔除 _t/timestamp）
function buildLocalCacheKey(method, apiPath, searchParams) {
    const sorted = [...searchParams.entries()]
        .filter(([k]) => !['_t', 'timestamp'].includes(k))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return sorted ? `${method}:${apiPath}?${sorted}` : `${method}:${apiPath}`;
}

// 通过 ControlHub DO 向本地端发起 RPC；DO 不可用/超时返回 null，不阻塞主流程
async function controlHubRpc(env, type, payload, timeoutMs) {
    if (!env.CONTROL_HUB) return null;
    try {
        const id = env.CONTROL_HUB.idFromName('control-hub');
        const stub = env.CONTROL_HUB.get(id);
        const resp = await stub.fetch('https://control-hub/control/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, payload, timeoutMs: timeoutMs || 800 }),
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        console.log(`⚠️ ControlHub RPC 失败: ${type}, ${e.message}`);
        return null;
    }
}

// 从 ControlHub DO 拉取运行配置并应用到当前 Worker 实例内存
async function pullControlConfig(env) {
    if (!env.CONTROL_HUB) return null;
    try {
        const id = env.CONTROL_HUB.idFromName('control-hub');
        const stub = env.CONTROL_HUB.get(id);
        const resp = await stub.fetch('https://control-hub/control/config');
        if (!resp.ok) return null;
        const cfg = await resp.json();
        applyRuntimeConfig(cfg);
        return cfg;
    } catch (e) {
        console.log(`⚠️ 拉取 ControlHub 配置失败: ${e.message}`);
        return null;
    }
}

function applyRuntimeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.ua_configs) memoryCache.configCache.uaConfigs = cfg.ua_configs;
    if (cfg.ip_blacklist) memoryCache.configCache.ipBlacklist = cfg.ip_blacklist;
    if (cfg.ip_whitelist) memoryCache.configCache.ipWhitelist = cfg.ip_whitelist;
    memoryCache.configCache.lastUpdate = Date.now();
}

function buildStatsReportPayload() {
    const topIps = Object.entries(memoryCache.ipRequestStats)
        .sort((a, b) => (b[1].total_count || 0) - (a[1].total_count || 0))
        .slice(0, 200)
        .map(([ip, s]) => ({ ip, total_count: s.total_count || 0, violations: s.violations || 0, paths: s.paths || {}, lastAccess: s.lastAccess || 0 }));
    return {
        worker_id: DATA_CENTER_CONFIG.workerId,
        timestamp: Date.now(),
        total_requests: memoryCache.totalRequests,
        rate_limit_counters: memoryCache.rateLimitCounts.size,
        ip_stats: topIps,
    };
}

function buildLogReportPayload(now) {
    const logs = memoryCache.logs
        .filter(l => l.timestamp > memoryCache.lastLogReport)
        .slice(-100);
    memoryCache.lastLogReport = now;
    return { worker_id: DATA_CENTER_CONFIG.workerId, timestamp: now, logs };
}

// ========================================
// �📦 R2 弹幕缓存工具函数
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
        const dataSize = typeof data === 'string' ? data.length : 0;

        // 写入前检查：内存估算值超阈值时跳过写入，等待 cron/轮询清理腾出空间
        if (memoryCache.r2EstimatedBytes + dataSize > R2_CACHE_CONFIG.MAX_STORAGE_BYTES) {
            console.log(`⚠️ R2 写入跳过: 估算容量 ${(memoryCache.r2EstimatedBytes / 1024 / 1024).toFixed(1)}MB 已接近阈值，等待清理`);
            return;
        }

        await env.DANMAKU_CACHE.put(cacheKey, data, {
            customMetadata: { timestamp: Date.now().toString() },
            httpMetadata: { contentType: 'application/json' },
        });

        // 写入成功后更新内存计数器
        memoryCache.r2WriteCount++;
        memoryCache.r2EstimatedBytes += dataSize;

        // 每 N 次写入触发一次异步容量检查（不阻塞写入路径，由 waitUntil 保活）
        if (memoryCache.r2WriteCount % R2_CACHE_CONFIG.WRITE_CHECK_INTERVAL === 0) {
            console.log(`📊 R2 写入检查点: 已写入 ${memoryCache.r2WriteCount} 次, 估算大小 ${(memoryCache.r2EstimatedBytes / 1024 / 1024).toFixed(1)}MB`);
            // 返回 Promise 让调用方可以用 waitUntil 保活
            return r2ScheduledCleanup(env).catch(e => console.log(`⚠️ R2 写入路径容量检查失败: ${e.message}`));
        }
    } catch (e) {
        console.log(`⚠️ R2 写入失败: ${cacheKey}, ${e.message}`);
    }
}

/**
 * R2 定时清理：由 scheduled cron 触发（全局单实例，不存在多实例重复 list 问题）
 * 一次遍历完成两件事：
 *   1. 过期清理：删除超过 TTL（12小时）的对象
 *   2. 阈值清理：剩余对象总量超 9GB 时，按时间从旧到新删到阈值以下
 */
async function r2ScheduledCleanup(env) {
    if (!env.DANMAKU_CACHE) return;
    const now = Date.now();
    let totalSize = 0;
    let liveObjects = [];
    let expiredKeys = [];
    let cursor = undefined;
    let listCount = 0;

    // 单次遍历所有对象（cron 全局单实例，list 不会被重复触发）
    do {
        const listed = await env.DANMAKU_CACHE.list({
            prefix: R2_CACHE_CONFIG.KEY_PREFIX,
            cursor,
            limit: 1000,
            include: ['customMetadata'],
        });
        for (const obj of listed.objects) {
            const timestamp = parseInt(obj.customMetadata?.timestamp || '0');
            if (timestamp > 0 && (now - timestamp > R2_CACHE_CONFIG.TTL)) {
                expiredKeys.push(obj.key); // 过期，待删
            } else {
                totalSize += obj.size;
                liveObjects.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded });
            }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        listCount++;
    } while (cursor && listCount < 50);

    // 1. 删除过期对象（delete 免费，不算 A 类）
    for (const key of expiredKeys) {
        await env.DANMAKU_CACHE.delete(key);
    }

    console.log(`📊 R2 定时清理: 过期删除 ${expiredKeys.length} 个, 剩余 ${liveObjects.length} 个有效对象, 总大小 ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

    // 校准内存估算值（每次遍历后都用真实数据覆盖，消除累积误差）
    memoryCache.r2EstimatedBytes = totalSize;
    memoryCache.r2WriteCount = 0;

    // 2. 阈值检查：剩余总量仍超 9GB，按时间从旧到新删
    if (totalSize <= R2_CACHE_CONFIG.MAX_STORAGE_BYTES) {
        console.log(`🔄 R2 估算值已校准: ${(totalSize / 1024 / 1024).toFixed(1)} MB，容量正常`);
        return;
    }

    liveObjects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
    let deletedCount = 0;
    let freedSize = 0;
    for (const obj of liveObjects) {
        if (totalSize - freedSize <= R2_CACHE_CONFIG.MAX_STORAGE_BYTES) break;
        await env.DANMAKU_CACHE.delete(obj.key);
        freedSize += obj.size;
        deletedCount++;
    }
    console.log(`🧹 R2 阈值清理: 删除 ${deletedCount} 个最旧对象, 释放 ${(freedSize / 1024 / 1024).toFixed(1)} MB`);

    // 阈值清理后再次校准估算值
    memoryCache.r2EstimatedBytes = totalSize - freedSize;
    console.log(`🔄 R2 估算值已校准（阈值清理后）: ${((totalSize - freedSize) / 1024 / 1024).toFixed(1)} MB`);
}

/**
 * R2 RPC 处理：本地端通过长连接请求 Worker 代读 R2（本地端无法直接访问 R2 binding）
 * 安全限制：只允许读取 KEY_PREFIX（comment/）下的 key，禁止任意 key
 */
async function handleR2Rpc(env, type, payload) {
    if (!env.DANMAKU_CACHE) return { hit: false, error: 'no_r2_binding' };
    try {
        if (type === 'r2.comment.get') {
            const episodeId = String(payload.episode_id || '').trim();
            if (!episodeId) return { hit: false, error: 'missing_episode_id' };
            const r2Key = R2_CACHE_CONFIG.KEY_PREFIX + episodeId;
            // 强制前缀校验，防止越权读取
            if (!r2Key.startsWith(R2_CACHE_CONFIG.KEY_PREFIX)) {
                return { hit: false, error: 'invalid_prefix' };
            }
            const body = await r2GetComment(env, r2Key);
            if (body === null) return { hit: false, r2_key: r2Key };
            return {
                hit: true, r2_key: r2Key, body,
                size: typeof body === 'string' ? body.length : 0,
                timestamp: Date.now(),
            };
        }
        if (type === 'r2.comment.list') {
            const limit = Math.min(parseInt(payload.limit || '100'), 100);
            const listed = await env.DANMAKU_CACHE.list({
                prefix: R2_CACHE_CONFIG.KEY_PREFIX,
                cursor: payload.cursor || undefined,
                limit,
                include: ['customMetadata'],
            });
            return {
                hit: true,
                objects: listed.objects.map(o => ({
                    key: o.key, size: o.size,
                    timestamp: o.customMetadata?.timestamp || '0',
                })),
                cursor: listed.truncated ? listed.cursor : null,
            };
        }
        return { hit: false, error: 'unknown_type' };
    } catch (e) {
        console.log(`⚠️ handleR2Rpc 失败: ${type}, ${e.message}`);
        return { hit: false, error: e.message };
    }
}

// 定期清理内存（在每个请求时检查）
function periodicCleanup(env) {
    const now = Date.now();
    const tasks = [];

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

    // 每60秒从 ControlHub 拉取运行配置，解决 Worker 多实例内存不一致问题
    if (env?.CONTROL_HUB && now - memoryCache.lastControlConfigPull > 60000) {
        memoryCache.lastControlConfigPull = now;
        tasks.push(pullControlConfig(env));
    }

    // 每60秒上报一次 IP/限流统计
    if (env?.CONTROL_HUB && now - memoryCache.lastStatsReport > 60000) {
        memoryCache.lastStatsReport = now;
        tasks.push(controlHubRpc(env, 'stats.report', buildStatsReportPayload(), 3000));
    }

    // 每60秒批量上报新增 Worker 日志
    if (env?.CONTROL_HUB && now - memoryCache.lastLogReport > 60000) {
        const payload = buildLogReportPayload(now);
        if (payload.logs.length > 0) {
            tasks.push(controlHubRpc(env, 'log.report', payload, 3000));
        }
    }

    // 每5分钟轮询一次 R2 过期清理（单实例内节流，多实例下 cron 兜底）
    if (env?.DANMAKU_CACHE && (now - memoryCache.lastR2ExpireCleanup > R2_CACHE_CONFIG.EXPIRE_POLL_INTERVAL)) {
        memoryCache.lastR2ExpireCleanup = now;
        tasks.push(r2ScheduledCleanup(env).catch(e => console.log(`⚠️ R2 过期轮询失败: ${e.message}`)));
    }

    return tasks.length ? Promise.allSettled(tasks) : null;
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

        // 从 ControlHub 拉取最新运行配置，覆盖环境变量兜底配置
        await pullControlConfig(env);

        memoryCache.configCache.lastUpdate = Date.now();

        // 清理过期的频率限制计数器
        cleanupRateLimitCounters();

        console.log('✅ 配置缓存初始化完成，将优先从数据中心同步');
    } catch (error) {
        console.error('❌ 初始化配置缓存失败:', error);
    }
}

// 初始化 Worker 运行配置（新架构：仅加载 env 配置，旧 HTTP 同步已废弃）
let initializationPromise = null;
async function initializeDataCenterConfig(env) {
    if (DATA_CENTER_CONFIG.initialized) {
        return;
    }
    if (initializationPromise) {
        return initializationPromise;
    }
    initializationPromise = (async () => {
        try {
            DATA_CENTER_CONFIG.workerId = env.WORKER_ID || 'worker-1';
            // 初始化配置缓存（从环境变量加载 UA 限流 / IP 黑名单）
            await initializeConfigCache(env);
            // 旧的 HTTP 推拉同步（restore/syncConfig）已废弃，
            // 配置下发改由本地端通过 ControlHub 长连接 config.apply 完成。
            DATA_CENTER_CONFIG.initialized = true;
        } finally {
            initializationPromise = null;
        }
    })();
    return initializationPromise;
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
    return isIpInList(clientIp, blacklist);
}

// 获取IP白名单配置（兼容数组和对象格式）
function getIpWhitelist() {
    const ipWhitelist = memoryCache.configCache.ipWhitelist;
    if (Array.isArray(ipWhitelist) && ipWhitelist.length > 0) return ipWhitelist;
    if (ipWhitelist && typeof ipWhitelist === 'object' && Object.keys(ipWhitelist).length > 0) {
        return Object.keys(ipWhitelist);
    }
    return [];
}

// 检查IP是否命中白名单（命中则跳过黑名单与限流）
function isIpWhitelisted(clientIp) {
    return isIpInList(clientIp, getIpWhitelist());
}

// 通用：判断 IP 是否命中规则列表（支持单 IP 与 CIDR）
function isIpInList(clientIp, list) {
    if (!list || list.length === 0) return false;
    for (const rule of list) {
        if (typeof rule !== 'string') continue;
        if (rule.includes('/')) {
            if (isIpInCidr(clientIp, rule)) return true;
        } else if (clientIp === rule) {
            return true;
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


// ========================================
// 🔌 ControlHub：本地端长连接控制中心（Durable Object）
// ========================================
// 设计意图：Worker 多实例下普通内存 WebSocket 不稳定，
// 用 Durable Object 固定汇聚所有长连接，保证任意 Worker 实例都能找到本地端。
// 启用 WebSocket Hibernation（acceptWebSocket）降低空闲成本。
export class ControlHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Worker 发起、等待本地端回包的 pending RPC：message_id -> {resolve, timer}
    this.pending = new Map();
    // ping/pong 自动应答，不唤醒 DO
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch (e) { /* 兼容旧运行时 */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/control/ws') return this.acceptLocalWs(request);
    if (url.pathname === '/control/rpc') return this.handleWorkerRpc(request);
    if (url.pathname === '/control/config') return this.handleConfigGet();
    if (url.pathname === '/control/status') {
      return new Response(JSON.stringify({ connections: this.ctx.getWebSockets().length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }


  async handleConfigGet() {
    const cfg = await this.ctx.storage.get('runtime_config') || {};
    return new Response(JSON.stringify(cfg), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 接收本地端 WebSocket 连接（带 X-Control-Token 鉴权）
  acceptLocalWs(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    const url = new URL(request.url);
    const token = request.headers.get('X-Control-Token') || url.searchParams.get('token') || '';
    const expected = this.env.CONTROL_TOKEN;
    if (expected && token !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const nodeId = url.searchParams.get('node_id') || 'local';
    server.serializeAttachment({ node_id: nodeId, connected_at: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Worker 内部 RPC：把请求转发给本地端，等待结果（带超时）
  async handleWorkerRpc(request) {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) {
      return new Response(JSON.stringify({ hit: false, error: 'no_local_connection' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const id = crypto.randomUUID();
    const msg = { id, type: body.type, timestamp: Date.now(), payload: body.payload || {} };
    // 兼容 timeoutMs（controlHubRpc 发送的字段）与 timeout 两种写法
    const timeout = body.timeoutMs || body.timeout || 800;
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeout);
      this.pending.set(id, { resolve, timer });
      try {
        sockets[0].send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(null);
      }
    });
    return new Response(JSON.stringify(result || { hit: false, timeout: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 收到本地端消息：回包唤醒 pending，或处理本地端主动发起的 R2 代读
  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : ''); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    // 1. 本地端对 Worker RPC 的回包
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg.payload || {});
      return;
    }

    // 2. 本地端下发运行配置：合并写入 DO storage，Worker 实例按周期拉取应用
    if (msg.type === 'config.apply') {
      const incoming = msg.payload || {};
      const existing = await this.ctx.storage.get('runtime_config') || {};
      const merged = { ...existing, ...incoming };
      await this.ctx.storage.put('runtime_config', merged);
      try {
        ws.send(JSON.stringify({
          id: msg.id, type: 'config.apply.result', timestamp: Date.now(),
          payload: { success: true, applied_at: Date.now(), keys: Object.keys(incoming) },
        }));
      } catch (e) { /* 忽略发送失败 */ }
      return;
    }

    // 3. 本地端主动发起 R2 代读（长连接不能直读 R2，由 Worker 代读后回传）
    if (msg.type === 'r2.comment.get' || msg.type === 'r2.comment.list') {
      const result = await handleR2Rpc(this.env, msg.type, msg.payload || {});
      try {
        ws.send(JSON.stringify({
          id: msg.id, type: msg.type + '.result',
          timestamp: Date.now(), payload: result,
        }));
      } catch (e) { /* 忽略发送失败 */ }
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) { /* 已关闭 */ }
  }
}


export default {
  async fetch(request, env, ctx) {
    // 初始化数据中心配置
    await initializeDataCenterConfig(env);

    return await handleRequest(request, env, ctx);
  },

  // Cron 定时触发（全局单实例）：R2 弹幕缓存清理
  async scheduled(event, env, ctx) {
    console.log(`⏰ [Cron] 触发 R2 定时清理: ${event.cron}`);
    ctx.waitUntil(
      r2ScheduledCleanup(env).catch(e => console.log(`⚠️ [Cron] R2 清理失败: ${e.message}`))
    );
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
    // � ControlHub 长连接路由 (/control/*)
    // ========================================
    // 本地端通过 WebSocket 主动连接 Worker ControlHub Durable Object
    if (urlObj.pathname.startsWith('/control/')) {
        if (!env.CONTROL_HUB) {
            return new Response('ControlHub 未配置', { status: 503 });
        }
        const id = env.CONTROL_HUB.idFromName('control-hub');
        const stub = env.CONTROL_HUB.get(id);
        return stub.fetch(request);
    }

    // ========================================
    // �🔐 OAuth 路由处理 (/oauth/*)
    // ========================================
    if (urlObj.pathname.startsWith('/oauth/')) {
        if (!isOAuthEnabled(env)) {
            return oauthJson({ error: 'OAuth 未启用，请在环境变量 OAUTH_CONFIG 中设置 enabled: true' }, 503);
        }
        return handleOAuthRequest(request, env, urlObj);
    }

    // IP 访问控制：白名单优先，命中则跳过黑名单与限流
    // clientIP已在函数开头声明
    const ipWhitelisted = isIpWhitelisted(clientIP);

    // 检查永久黑名单（白名单命中则跳过）
    const ipBlacklist = getIpBlacklist();
    if (!ipWhitelisted && isIpBlacklisted(clientIP, ipBlacklist)) {
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

    // 防御：如果提取出的 url 不是合法的完整 URL（缺少协议/域名），直接返回 400
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return new Response(JSON.stringify({
            status: 400,
            type: 'CORS代理',
            message: `无效的代理目标URL: 缺少协议和域名。收到: "${url.substring(0, 100)}"`
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    let tUrlObj;
    try {
        tUrlObj = new URL(url);
    } catch (e) {
        // URL 解析失败时返回明确的错误信息，而非让 Worker 抛异常
        return new Response(JSON.stringify({
            status: 400,
            type: 'CORS代理',
            message: `无法解析代理目标URL: "${url.substring(0, 100)}"`
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
    if (!(tUrlObj.hostname in hostlist)) {
        return Forbidden(tUrlObj);
    }

    // 访问控制检查，传递正确的API路径
    console.log(`🔍 [${clientIP}] 开始访问控制检查，目标路径: ${tUrlObj.pathname}`);

    const accessCheck = ipWhitelisted
        ? { allowed: true, reason: 'ip_whitelisted' }
        : await checkAccess(request, tUrlObj.pathname);
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

            // 同时异步推送到本地端 cache.upsert（不阻塞响应；本地端做 429 兜底数据源）
            if (env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
                const localCacheKey = buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
                const upsertPayload = {
                    cache_key: localCacheKey,
                    source: 'dandanplay',
                    method: request.method,
                    api_path: apiPath,
                    client_ip: clientIP,
                    query: Object.fromEntries(tUrlObj.searchParams.entries()),
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                    body: responseText,
                };
                const upsertPromise = controlHubRpc(env, 'cache.upsert', upsertPayload, 3000)
                    .catch(e => console.log(`⚠️ [${clientIP}] cache.upsert 失败: ${e.message}`));
                if (ctx && ctx.waitUntil) ctx.waitUntil(upsertPromise);
            }
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

    // ========================================
    // 🛟 上游 429 限流：尝试本地缓存兜底
    // ========================================
    if (response.status === 429 && env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
        const localCacheKey = buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
        console.log(`🛟 [${clientIP}] 上游 429，尝试本地缓存兜底: ${localCacheKey}`);
        const cached = await controlHubRpc(env, 'cache.get', {
            cache_key: localCacheKey,
            api_path: apiPath,
            method: request.method,
            client_ip: clientIP,
            worker_request_id: request.headers.get('cf-ray') || '',
        }, 800);
        if (cached && cached.hit && cached.body) {
            console.log(`✅ [${clientIP}] 命中本地兜底缓存${cached.stale ? '(stale)' : ''}: ${localCacheKey}`);
            return new Response(cached.body, {
                status: cached.status || 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT-LOCAL-STALE',
                    'X-Upstream-Status': '429',
                },
            });
        }
        console.log(`ℹ️ [${clientIP}] 本地无可用兜底缓存，原样返回 429`);
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
