// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// 弹弹play 接口分组（密钥限流状态按分组独立维护）
const DDP_API_GROUPS = {
    'search_anime': '/api/v2/search/anime',
    'search_episodes': '/api/v2/search/episodes',
    'bangumi': '/api/v2/bangumi/',
    'comment': '/api/v2/comment/',
    'match': '/api/v2/match',
};

// 把 apiPath 归一化为接口分组 key；不匹配返回 'other'
function resolveApiGroup(apiPath) {
    for (const [group, prefix] of Object.entries(DDP_API_GROUPS)) {
        if (apiPath.startsWith(prefix)) return group;
    }
    return 'other';
}

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

// 非法路由滥用检测：缺少目标域名的 /cors/ 请求，累计超阈值临时封禁该 IP
const ABUSE_CONFIG = {
    MAX_INVALID_REQUESTS: 10,        // 1 小时内允许的非法路由次数
    WINDOW_MS: 60 * 60 * 1000,       // 统计窗口：1 小时
    BAN_DURATION_MS: 60 * 60 * 1000, // 封禁时长：1 小时
    MAX_TRACKED_IPS: 50000,          // 最多跟踪的 IP 数（防内存泄漏）
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
    // 弹弹play 密钥池运行时状态（纯内存，每实例独立）
    keyPool: {
        keys: [],            // 合并后的密钥列表 [{ id, appId, appSecret, authUaKeys:[] }]
        envKeys: [],         // env 基线密钥（启动时解析缓存，本地端下发时作为合并底座）
        localKeys: [],       // 本地端最近一次下发的密钥
        keysSource: 'none',  // 'env' | 'local' | 'merged'
        lastMerge: 0,        // 上次合并时间
        // 限流状态：keyState[keyId][apiGroup] = { limited, limitedAt }
        keyState: {},
        resetDate: '',       // 当前状态对应的 UTC+8 日期，跨天清空 limited
    },
    lastSyncTime: Date.now(),
    pendingRequests: 0,
    totalRequests: 0, // 总请求计数（不会重置）
    // IP请求统计数据（定期清理，防止内存泄漏）
    ipRequestStats: {}, // 格式: { "192.168.1.1": { total_count: 100, violations: 5, paths: {...}, lastAccess: timestamp } }
    lastIpStatsCleanup: Date.now(),
    // 配置缓存（env 基线兜底 + 后端下发增量合并）
    configCache: {
        uaConfigs: {},
        ipBlacklist: [],
        ipWhitelist: [],
        lastUpdate: 0
    },
    // env 兜底基线（启动时加载，永不被下发覆盖；下发只在其之上做增量合并）
    envBaseline: {
        uaConfigs: {},
        ipBlacklist: [],
        ipWhitelist: []
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
    // 非法路由滥用追踪：记录每个 IP 的非法请求计数与临时封禁到期时间
    abuseTracker: new Map(), // 格式: { ip: { count, windowStart, bannedUntil } }
    lastAbuseReport: 0,
    lastKeyStateReport: 0,  // 上次上报密钥限流状态时间
    // 运行指标聚合（周期上报本地端，上报后增量清零，累计趋势由本地端落库）
    metrics: {
        totalRequests: 0,   // 进入处理的请求数
        totalResponses: 0,  // 完成响应数
        bytesIn: 0,         // 入流量（请求体估算字节）
        bytesOut: 0,        // 出流量（响应体字节）
        memCacheHits: 0,    // 内存缓存命中
        r2CacheHits: 0,     // R2 弹幕缓存命中
        cacheMiss: 0,       // 可缓存请求未命中（回源）
        blockedIp: 0,       // IP 黑名单拦截
        blockedUa: 0,       // UA 限制拦截
        blockedAbuse: 0,    // 非法路由临时封禁拦截
        invalidRoute: 0,    // 非法路由命中（含未达封禁阈值）
        upstream429: 0,     // 上游 429 次数
        status2xx: 0, status4xx: 0, status5xx: 0, // 响应状态码分布
    },
    lastMetricsReport: 0,
};

// 指标累加辅助：字段自增，避免散落的 ++ 写法出错
function bumpMetric(key, delta = 1) {
    if (memoryCache.metrics[key] === undefined) return;
    memoryCache.metrics[key] += delta;
}

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

// 把 IP 规则（数组或对象 key）归一化为 IP 字符串数组
function normalizeIpList(src) {
    if (!src) return [];
    if (Array.isArray(src)) return src.filter(x => typeof x === 'string');
    if (typeof src === 'object') return Object.keys(src);
    return [];
}

// 应用运行配置：env 基线为底，后端下发做增量合并；下发为空绝不清掉 env 兜底
function applyRuntimeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;

    // UA 配置：env 基线 ∪ 下发（同 key 以下发为准，可用 enabled:false 禁用 env 项）
    const incomingUa = (cfg.ua_configs && typeof cfg.ua_configs === 'object') ? cfg.ua_configs : {};
    memoryCache.configCache.uaConfigs = {
        ...memoryCache.envBaseline.uaConfigs,
        ...incomingUa,
    };

    // IP 黑名单：env 基线 ∪ 下发，去重成数组
    memoryCache.configCache.ipBlacklist = Array.from(new Set([
        ...normalizeIpList(memoryCache.envBaseline.ipBlacklist),
        ...normalizeIpList(cfg.ip_blacklist),
    ]));

    // IP 白名单：env 基线 ∪ 下发，去重成数组
    memoryCache.configCache.ipWhitelist = Array.from(new Set([
        ...normalizeIpList(memoryCache.envBaseline.ipWhitelist),
        ...normalizeIpList(cfg.ip_whitelist),
    ]));

    // 密钥池：本地端下发的密钥列表，与 env 基线合并去重（本地端为主）
    if (Array.isArray(cfg.key_pool)) {
        mergeKeyPool(null, cfg.key_pool);
    }

    memoryCache.configCache.lastUpdate = Date.now();
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

// 组装运行指标快照；上报后清零累计型字段（窗口内增量），便于本地端按窗口落库
function buildMetricsReportPayload(now) {
    const m = memoryCache.metrics;
    const payload = {
        worker_id: DATA_CENTER_CONFIG.workerId,
        timestamp: now,
        metrics: { ...m },
        // 附带瞬时态：当前总请求数（不清零）与缓存规模，便于展示
        total_requests_lifetime: memoryCache.totalRequests,
        api_cache_size: memoryCache.apiCache.size,
    };
    // 清零窗口累计指标
    memoryCache.metrics = {
        totalRequests: 0, totalResponses: 0, bytesIn: 0, bytesOut: 0,
        memCacheHits: 0, r2CacheHits: 0, cacheMiss: 0,
        blockedIp: 0, blockedUa: 0, blockedAbuse: 0, invalidRoute: 0,
        upstream429: 0, status2xx: 0, status4xx: 0, status5xx: 0,
    };
    return payload;
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

    // 每15秒批量上报新增 Worker 日志（缩短间隔提升实时性；SSE 才能更快看到）
    if (env?.CONTROL_HUB && now - memoryCache.lastLogReport > 15000) {
        const payload = buildLogReportPayload(now);
        if (payload.logs.length > 0) {
            tasks.push(controlHubRpc(env, 'log.report', payload, 3000));
        }
    }

    // 每60秒上报"封禁中"IP 给中心端去重合并，并清理过期追踪项
    if (env?.CONTROL_HUB && now - memoryCache.lastAbuseReport > 60000) {
        memoryCache.lastAbuseReport = now;
        cleanupAbuseTracker(now);
        const payload = buildAbuseReportPayload();
        if (payload.banned.length > 0) {
            tasks.push(controlHubRpc(env, 'abuse.report', payload, 3000));
        }
    }

    // 每60秒上报运行指标快照（请求/响应/流量/命中/拦截），上报后窗口清零
    if (env?.CONTROL_HUB && now - memoryCache.lastMetricsReport > 60000) {
        memoryCache.lastMetricsReport = now;
        tasks.push(controlHubRpc(env, 'metrics.report', buildMetricsReportPayload(now), 3000));
    }

    // 每60秒上报一次密钥限流状态，供本地端展示
    if (env?.CONTROL_HUB && now - memoryCache.lastKeyStateReport > 60000) {
        memoryCache.lastKeyStateReport = now;
        tasks.push(controlHubRpc(env, 'keypool.report', buildKeyStateSnapshot(), 3000));
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

        // 解析 env 基线密钥池（APP_KEY_POOL 或老的 APP_ID/APP_SECRET）
        mergeKeyPool(env, null);

        // 加载UA配置（env 兜底基线）
        if (env.USER_AGENT_LIMITS_CONFIG) {
            const uaCfg = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
            memoryCache.configCache.uaConfigs = uaCfg;
            memoryCache.envBaseline.uaConfigs = uaCfg;
            console.log('✅ 从环境变量加载UA配置（兜底基线）');
        }

        // 加载IP黑名单（env 兜底基线）
        if (env.IP_BLACKLIST_CONFIG) {
            const ipBl = JSON.parse(env.IP_BLACKLIST_CONFIG);
            memoryCache.configCache.ipBlacklist = ipBl;
            memoryCache.envBaseline.ipBlacklist = ipBl;
            console.log('✅ 从环境变量加载IP黑名单（兜底基线）');
        }

        // 加载IP白名单（env 兜底基线）
        if (env.IP_WHITELIST_CONFIG) {
            const ipWl = JSON.parse(env.IP_WHITELIST_CONFIG);
            memoryCache.configCache.ipWhitelist = ipWl;
            memoryCache.envBaseline.ipWhitelist = ipWl;
            console.log('✅ 从环境变量加载IP白名单（兜底基线）');
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

// ========================================
// 🛡️ 非法路由滥用追踪与临时封禁
// ========================================
// 设计意图：每实例独立内存计数 + 即时封禁；每分钟把"封禁中"IP 上报中心端去重合并，
// 再经 pullControlConfig 把合并后的黑名单拉回各实例。校验优先查本实例内存（零延迟）。

// 校验：本实例是否已临时封禁该 IP（命中且未过期返回 true）
function isAbuseBanned(clientIp) {
    const rec = memoryCache.abuseTracker.get(clientIp);
    if (!rec) return false;
    if (rec.bannedUntil && rec.bannedUntil > Date.now()) return true;
    // 已过期：惰性清理封禁标记（保留计数窗口逻辑由 recordInvalidRoute 处理）
    if (rec.bannedUntil && rec.bannedUntil <= Date.now()) {
        memoryCache.abuseTracker.delete(clientIp);
    }
    return false;
}

// 记录一次非法路由命中；返回 true 表示本次命中触发了封禁（调用方据此返回 403）
function recordInvalidRoute(clientIp) {
    if (!clientIp || clientIp === 'unknown') return false;
    // 白名单 IP 不计数、不封禁
    if (isIpWhitelisted(clientIp)) return false;

    const now = Date.now();
    let rec = memoryCache.abuseTracker.get(clientIp);

    // 已在封禁期内：直接判定为封禁
    if (rec && rec.bannedUntil && rec.bannedUntil > now) return true;

    // 容量保护：达到上限时先清理过期项，仍满则丢弃最旧项
    if (!rec && memoryCache.abuseTracker.size >= ABUSE_CONFIG.MAX_TRACKED_IPS) {
        cleanupAbuseTracker(now);
        if (memoryCache.abuseTracker.size >= ABUSE_CONFIG.MAX_TRACKED_IPS) {
            const oldestKey = memoryCache.abuseTracker.keys().next().value;
            if (oldestKey !== undefined) memoryCache.abuseTracker.delete(oldestKey);
        }
    }

    // 窗口过期或首次：重置计数窗口
    if (!rec || (now - rec.windowStart) > ABUSE_CONFIG.WINDOW_MS) {
        rec = { count: 0, windowStart: now, bannedUntil: 0 };
    }
    rec.count += 1;

    // 超阈值 → 触发封禁
    if (rec.count > ABUSE_CONFIG.MAX_INVALID_REQUESTS) {
        rec.bannedUntil = now + ABUSE_CONFIG.BAN_DURATION_MS;
        memoryCache.abuseTracker.set(clientIp, rec);
        return true;
    }
    memoryCache.abuseTracker.set(clientIp, rec);
    return false;
}

// 清理 abuseTracker 中已过期的封禁与计数窗口（防内存泄漏）
function cleanupAbuseTracker(now) {
    now = now || Date.now();
    for (const [ip, rec] of memoryCache.abuseTracker) {
        const bannedExpired = !rec.bannedUntil || rec.bannedUntil <= now;
        const windowExpired = (now - rec.windowStart) > ABUSE_CONFIG.WINDOW_MS;
        // 未在封禁中且计数窗口已过期 → 可清理
        if (bannedExpired && windowExpired) memoryCache.abuseTracker.delete(ip);
    }
}

// 组装"封禁中"IP 列表，用于上报中心端去重合并
function buildAbuseReportPayload() {
    const now = Date.now();
    const banned = [];
    for (const [ip, rec] of memoryCache.abuseTracker) {
        if (rec.bannedUntil && rec.bannedUntil > now) {
            banned.push({ ip, banned_until: rec.bannedUntil });
        }
    }
    return { worker_id: DATA_CENTER_CONFIG.workerId, timestamp: now, banned };
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

    // 指标：请求计数 + 入流量估算（请求头长度近似）
    bumpMetric('totalRequests');
    const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (cl > 0) bumpMetric('bytesIn', cl);

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

    // 临时封禁检查（非法路由滥用）：白名单跳过，本实例内存命中立即 403（零延迟）
    if (!ipWhitelisted && isAbuseBanned(clientIP)) {
        // 计算剩余封禁时间，提示客户端何时可重试
        const banRec = memoryCache.abuseTracker.get(clientIP);
        const remainMs = banRec && banRec.bannedUntil ? Math.max(0, banRec.bannedUntil - Date.now()) : 0;
        const remainMin = Math.ceil(remainMs / 60000);
        const retryAfterSec = Math.ceil(remainMs / 1000);
        console.log(`🚫 [${clientIP}] IP临时封禁中，剩余 ${remainMin} 分钟`);
        bumpMetric('blockedAbuse'); bumpMetric('status4xx');
        addMemoryLog('warn', 'IP临时封禁拦截', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 403,
            userAgent: request.headers.get('X-User-Agent') || '',
            remainMinutes: remainMin,
        });
        return new Response(JSON.stringify({
            status: 403,
            type: 'IP临时封禁',
            message: `IP ${clientIP} 因频繁请求非法路由已被临时封禁，请于约 ${remainMin} 分钟后再试`,
            retryAfterSeconds: retryAfterSec
        }), {
            status: 403,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Retry-After': String(retryAfterSec)
            }
        });
    }

    // 检查永久黑名单（白名单命中则跳过）
    const ipBlacklist = getIpBlacklist();
    if (!ipWhitelisted && isIpBlacklisted(clientIP, ipBlacklist)) {
        console.log(`🚫 [${clientIP}] IP在黑名单中，拒绝访问`);
        bumpMetric('blockedIp'); bumpMetric('status4xx');

        // 记录到内存日志（补全 method/path/status，便于日志页展示）
        addMemoryLog('warn', 'IP黑名单拦截', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 403,
            userAgent: request.headers.get('X-User-Agent') || ''
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
        // 记录非法路由命中：同一 IP 1 小时内累计超阈值 → 临时封禁该 IP 1 小时
        const justBanned = recordInvalidRoute(clientIP);
        bumpMetric('invalidRoute');
        if (justBanned) {
            const banMin = Math.ceil(ABUSE_CONFIG.BAN_DURATION_MS / 60000);
            console.log(`🚫 [${clientIP}] 非法路由超阈值，已临时封禁 ${banMin} 分钟`);
            bumpMetric('blockedAbuse'); bumpMetric('status4xx');
            addMemoryLog('warn', '非法路由滥用封禁', {
                ip: clientIP,
                method: request.method,
                path: urlObj.pathname,
                responseStatus: 403,
                userAgent: request.headers.get('X-User-Agent') || '',
                invalidUrl: url.substring(0, 100),
            });
            return new Response(JSON.stringify({
                status: 403,
                type: 'IP临时封禁',
                message: `IP ${clientIP} 因频繁请求非法路由已被临时封禁，请于约 ${banMin} 分钟后再试`,
                retryAfterSeconds: Math.ceil(ABUSE_CONFIG.BAN_DURATION_MS / 1000)
            }), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Retry-After': String(Math.ceil(ABUSE_CONFIG.BAN_DURATION_MS / 1000))
                }
            });
        }
        // 未达封禁阈值：记录一次非法路由（INFO 级），便于日志页观察滥用趋势
        bumpMetric('status4xx');
        addMemoryLog('info', '非法路由请求', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 400,
            invalidUrl: url.substring(0, 100),
        });
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
        bumpMetric('blockedUa'); bumpMetric('status4xx');
        // 记录访问控制拦截日志，便于日志页排查（此前仅 console，未落库）
        addMemoryLog('warn', '访问控制拦截', {
            ip: clientIP,
            method: request.method,
            path: tUrlObj.pathname,
            responseStatus: accessCheck.status,
            userAgent,
            reason: accessCheck.reason,
        });

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
            // 指标：内存缓存命中 + 出流量 + 响应/2xx
            bumpMetric('memCacheHits'); bumpMetric('totalResponses');
            bumpMetric('status2xx');
            bumpMetric('bytesOut', (cached.data && cached.data.length) ? cached.data.length : 0);
            addMemoryLog('INFO', '内存缓存命中', {
                ip: clientIP,
                path: apiPath,
                method: request.method,
                responseStatus: 200,
                cacheSource: 'MEM',
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

        // 内存未命中：先查本地端缓存，命中则直接返回，避免每次都打弹弹触发 429
        if (env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
            const localCacheKey = buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
            const local = await controlHubRpc(env, 'cache.get', {
                cache_key: localCacheKey,
                api_path: apiPath,
                method: request.method,
                client_ip: clientIP,
                worker_request_id: request.headers.get('cf-ray') || '',
                prefetch: true,
            }, 1500);
            if (local && local.hit && local.body) {
                console.log(`📦 [${clientIP}] 本地端缓存命中${local.stale ? '(stale)' : ''}: ${apiPath}`);
                bumpMetric('memCacheHits'); bumpMetric('totalResponses'); bumpMetric('status2xx');
                bumpMetric('bytesOut', local.body.length || 0);
                // 命中即回填本实例内存，降低后续同 key 的 DO RPC
                memoryCache.apiCache.set(cacheKey, { data: local.body, timestamp: Date.now() });
                addMemoryLog('INFO', '本地端缓存命中', { ip: clientIP, path: apiPath, method: request.method, responseStatus: local.status || 200, cacheSource: local.stale ? 'LOCAL-STALE' : 'LOCAL', stale: !!local.stale });
                return new Response(local.body, {
                    status: local.status || 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache': local.stale ? 'HIT-LOCAL-STALE' : 'HIT-LOCAL',
                    }
                });
            }
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
            // 指标：R2 命中 + 出流量 + 响应/2xx
            bumpMetric('r2CacheHits'); bumpMetric('totalResponses');
            bumpMetric('status2xx');
            bumpMetric('bytesOut', (cachedData && cachedData.length) ? cachedData.length : 0);
            addMemoryLog('INFO', 'R2弹幕缓存命中', { ip: clientIP, path: apiPath, method: request.method, responseStatus: 200, cacheSource: 'R2' });
            return new Response(cachedData, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT-R2',
                }
            });
        }

        // R2 无对象：查本地端兜底持久化（架构B），命中则回填 R2 并返回
        if (env.CONTROL_HUB) {
            const local = await controlHubRpc(env, 'comment.get', { episode_id: episodeId }, 1500);
            if (local && local.hit && local.body) {
                console.log(`📦 [${clientIP}] 本地端弹幕兜底命中: ${episodeId} (${local.comment_count}条)`);
                bumpMetric('r2CacheHits'); bumpMetric('totalResponses'); bumpMetric('status2xx');
                bumpMetric('bytesOut', local.body.length || 0);
                addMemoryLog('INFO', '本地端弹幕兜底命中', { ip: clientIP, path: apiPath, method: request.method, responseStatus: 200, cacheSource: 'LOCAL-COMMENT' });
                // 回填 R2 一级缓存，下次走边缘
                const r2Promise = r2PutComment(env, r2Key, local.body).catch(() => {});
                if (ctx && ctx.waitUntil) ctx.waitUntil(r2Promise);
                return new Response(local.body, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache': 'HIT-LOCAL-COMMENT',
                    }
                });
            }
        }
    }

    // ========================================
    // 🔑 密钥池选择：按 ua_key + 接口分组挑选可用密钥
    // ========================================
    // 启动/本地端未下发时，用 env 基线初始化密钥池
    if (memoryCache.keyPool.keys.length === 0) {
        mergeKeyPool(env, null);
    }
    const apiGroup = resolveApiGroup(apiPath);
    const uaKey = accessCheck.uaConfig?.type || '';
    let selectedKey = selectKey(uaKey, apiGroup);

    if (!selectedKey) {
        // 全部密钥该接口已限流：缓存已在前面查过，直接返回流控
        console.log(`🚫 [${clientIP}] 接口 ${apiGroup} 所有密钥已限流，返回流控`);
        addMemoryLog('warn', '密钥全限流', { ip: clientIP, path: apiPath, apiGroup, uaKey });
        bumpMetric('upstream429'); bumpMetric('status4xx');
        return new Response(JSON.stringify({
            errorCode: 429, success: false,
            errorMessage: '当前接口所有密钥已达调用配额上限，请稍后再试',
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'X-Cache': 'KEY-POOL-EXHAUSTED',
            },
        });
    }

    // 增加待同步请求计数
    memoryCache.pendingRequests++;
    memoryCache.totalRequests++;

    console.log(`📊 [${clientIP}] 请求计数更新: 待处理=${memoryCache.pendingRequests} 总数=${memoryCache.totalRequests}`);
    console.log(`🔑 [${clientIP}] 选中密钥: ${selectedKey.id} (appId=${selectedKey.appId}, group=${apiGroup}, uaKey=${uaKey || '公共'})`);

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

    // 用指定密钥签名并转发；返回 { response, responseText, errorCode, limited }
    const doForwardWithKey = async (keyObj) => {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await generateSignature(keyObj.appId, ts, apiPath, keyObj.appSecret);
        const headers = {
            ...forwardHeaders,
            "X-AppId": keyObj.appId,
            "X-Signature": sig,
            "X-Timestamp": ts,
            "X-Auth": "1",
        };
        if (ACCESS_CONFIG.logging.enabled) {
            console.log(`📤 [${clientIP}] 转发请求头(key=${keyObj.id}):`, JSON.stringify(headers, null, 2));
        }
        const resp = await fetch(url, { headers, body: request.body, method: request.method });
        const text = await resp.text();
        let ec = 0;
        try {
            const _peek = JSON.parse(text);
            if (_peek && typeof _peek.errorCode === 'number') ec = _peek.errorCode;
        } catch (_) { /* 非 JSON 忽略 */ }
        return { response: resp, responseText: text, errorCode: ec, limited: resp.status === 429 || ec === 429 };
    };

    // 首次转发
    const upstreamStart = Date.now();
    let fwd = await doForwardWithKey(selectedKey);
    console.log(`📥 [${clientIP}] dandanplay API响应状态:`, fwd.response.status, fwd.response.statusText);

    // 🔁 撞限流：标记当前密钥该接口，立即尝试切换一次（仅 GET 无 body 时安全重试）
    if (fwd.limited) {
        markKeyLimited(selectedKey.id, apiGroup);
        const canRetry = request.method === 'GET';
        if (canRetry) {
            const retryKey = selectKey(uaKey, apiGroup);
            if (retryKey && retryKey.id !== selectedKey.id) {
                console.log(`🔁 [${clientIP}] 密钥 ${selectedKey.id} 限流，切换到 ${retryKey.id} 重试`);
                selectedKey = retryKey;
                fwd = await doForwardWithKey(retryKey);
                console.log(`📥 [${clientIP}] 重试响应状态:`, fwd.response.status, fwd.response.statusText);
                if (fwd.limited) markKeyLimited(retryKey.id, apiGroup);
            } else {
                console.log(`ℹ️ [${clientIP}] 无其他可用密钥，不重试`);
            }
        }
    }

    let response = fwd.response;
    const responseText = fwd.responseText;
    const upstreamErrorCode = fwd.errorCode;
    const isUpstreamRateLimited = fwd.limited;
    if (isUpstreamRateLimited) {
        console.log(`🚫 [${clientIP}] 检测到上游限流 (HTTP ${response.status}, errorCode=${upstreamErrorCode})`);
    }

    // 指标：回源响应（可缓存请求走到这里即未命中）+ 状态码分布 + 429
    bumpMetric('totalResponses');
    if (isCacheable || isCommentApi) bumpMetric('cacheMiss');
    if (isUpstreamRateLimited) { bumpMetric('upstream429'); bumpMetric('status4xx'); }
    else if (response.status >= 200 && response.status < 300) bumpMetric('status2xx');
    else if (response.status >= 400 && response.status < 500) bumpMetric('status4xx');
    else if (response.status >= 500) bumpMetric('status5xx');

    // 记录API请求到内存日志（含缓存来源/密钥/上游状态/耗时，便于排查）
    addMemoryLog(isUpstreamRateLimited ? 'WARN' : 'INFO', 'API请求处理', {
        ip: clientIP,
        method: request.method,
        path: apiPath,
        userAgent: request.headers.get('X-User-Agent') || '',
        responseStatus: response.status,
        cacheSource: isUpstreamRateLimited ? 'UPSTREAM-429' : 'MISS',
        upstreamStatus: upstreamErrorCode || response.status,
        keyId: selectedKey ? selectedKey.id : '',
        durationMs: Date.now() - upstreamStart,
        timestamp: Date.now()
    });

    // 指标：出流量（回源响应体字节）
    if (responseText) bumpMetric('bytesOut', responseText.length);
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
    if (response.status === 200 && !isUpstreamRateLimited) {
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

                    // 架构B：同时归档到本地端兜底持久化（以弹幕条数为准更新）
                    if (env.CONTROL_HUB) {
                        const archivePromise = controlHubRpc(env, 'comment.archive', {
                            episode_id: episodeId,
                            body: responseText,
                            source: 'origin',
                        }, 3000).catch(e => console.log(`⚠️ [${clientIP}] comment.archive 失败: ${e.message}`));
                        if (ctx && ctx.waitUntil) ctx.waitUntil(archivePromise);
                    }
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
    if (isUpstreamRateLimited && env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
        const localCacheKey = buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
        console.log(`🛟 [${clientIP}] 上游限流，尝试本地缓存兜底: ${localCacheKey}`);
        const cached = await controlHubRpc(env, 'cache.get', {
            cache_key: localCacheKey,
            api_path: apiPath,
            method: request.method,
            client_ip: clientIP,
            worker_request_id: request.headers.get('cf-ray') || '',
        }, 1500);
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

    // 上游 429 且为弹幕接口：查本地端弹幕兜底持久化（R2 可能也无对象）
    if (isUpstreamRateLimited && isCommentApi && env.CONTROL_HUB) {
        const episodeId = apiPath.replace('/api/v2/comment/', '').split('?')[0];
        console.log(`🛟 [${clientIP}] 弹幕上游限流，尝试本地端弹幕兜底: ${episodeId}`);
        const local = await controlHubRpc(env, 'comment.get', { episode_id: episodeId }, 1500);
        if (local && local.hit && local.body) {
            console.log(`✅ [${clientIP}] 命中本地端弹幕兜底: ${episodeId} (${local.comment_count}条)`);
            return new Response(local.body, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT-LOCAL-COMMENT',
                    'X-Upstream-Status': '429',
                },
            });
        }
        console.log(`ℹ️ [${clientIP}] 本地端无弹幕兜底，原样返回 429`);
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
        // 重置计数器（密钥状态独立维护，无需在此同步）
        memoryCache.pendingRequests = 0;
        memoryCache.lastSyncTime = Date.now();

    } catch (error) {
        console.error('批量同步失败:', error);
    }
}



// ========================================
// 🔑 弹弹play 密钥池：多密钥智能调度
// ========================================

// 取 UTC+8 当前日期字符串（YYYY-MM-DD），用于每日重置限流状态
function getUtc8DateStr() {
    const utc8 = new Date(Date.now() + 8 * 3600 * 1000);
    return utc8.toISOString().slice(0, 10);
}

// 解析 env 基线密钥池：优先 APP_KEY_POOL(JSON)，否则回退老的 APP_ID/APP_SECRET(/_2)
function parseEnvKeyPool(env) {
    const keys = [];
    if (env.APP_KEY_POOL) {
        try {
            const parsed = JSON.parse(env.APP_KEY_POOL);
            const list = Array.isArray(parsed) ? parsed : (parsed.keys || []);
            for (const k of list) {
                if (!k || !k.appId || !k.appSecret) continue;
                keys.push({
                    id: String(k.id || `env_${k.appId}`),
                    appId: String(k.appId),
                    appSecret: String(k.appSecret),
                    authUaKeys: Array.isArray(k.authUaKeys) ? k.authUaKeys.map(String) : [],
                });
            }
        } catch (e) {
            console.log(`⚠️ APP_KEY_POOL 解析失败，回退单密钥: ${e.message}`);
        }
    }
    // 兼容老配置：APP_ID + APP_SECRET / APP_SECRET_2（无授权 UA，进公共池）
    if (keys.length === 0 && env.APP_ID && env.APP_SECRET) {
        keys.push({ id: 'legacy_1', appId: env.APP_ID, appSecret: env.APP_SECRET, authUaKeys: [] });
        if (env.APP_SECRET_2) {
            keys.push({ id: 'legacy_2', appId: env.APP_ID, appSecret: env.APP_SECRET_2, authUaKeys: [] });
        }
    }
    return keys;
}

// 合并 env 基线 + 本地端下发，按 appId+appSecret 去重，本地端为主（覆盖同项）
// env 传入时刷新 env 基线缓存；env=null 时用已缓存的 envKeys；localKeys=null 时用已缓存的 localKeys
function mergeKeyPool(env, localKeys) {
    if (env) {
        memoryCache.keyPool.envKeys = parseEnvKeyPool(env);
    }
    if (Array.isArray(localKeys)) {
        memoryCache.keyPool.localKeys = localKeys
            .filter(k => k && k.appId && k.appSecret)
            .map(k => ({
                id: String(k.id || `local_${k.appId}`),
                appId: String(k.appId),
                appSecret: String(k.appSecret),
                authUaKeys: Array.isArray(k.authUaKeys) ? k.authUaKeys.map(String) : [],
            }));
    }
    const envKeys = memoryCache.keyPool.envKeys || [];
    const lKeys = memoryCache.keyPool.localKeys || [];
    const map = new Map();
    // 先放 env 基线
    for (const k of envKeys) map.set(`${k.appId}::${k.appSecret}`, k);
    // 本地端覆盖（以本地端为主）
    for (const k of lKeys) map.set(`${k.appId}::${k.appSecret}`, k);
    const merged = Array.from(map.values());
    memoryCache.keyPool.keys = merged;
    memoryCache.keyPool.keysSource = lKeys.length > 0 ? 'merged' : (envKeys.length ? 'env' : 'none');
    memoryCache.keyPool.lastMerge = Date.now();
    console.log(`🔑 密钥池合并: env=${envKeys.length} local=${lKeys.length} 合计=${merged.length}`);
    return merged;
}

// 每日重置（UTC+8 跨天清空所有 limited 标记）
function ensureKeyStateFresh() {
    const today = getUtc8DateStr();
    if (memoryCache.keyPool.resetDate !== today) {
        memoryCache.keyPool.keyState = {};
        memoryCache.keyPool.resetDate = today;
        console.log(`🔄 密钥限流状态已按 UTC+8 重置: ${today}`);
    }
}

// 判断密钥在某接口分组是否被限流
function isKeyLimited(keyId, apiGroup) {
    const st = memoryCache.keyPool.keyState[keyId];
    return !!(st && st[apiGroup] && st[apiGroup].limited);
}

// 标记密钥在某接口分组限流
function markKeyLimited(keyId, apiGroup) {
    ensureKeyStateFresh();
    if (!memoryCache.keyPool.keyState[keyId]) memoryCache.keyPool.keyState[keyId] = {};
    memoryCache.keyPool.keyState[keyId][apiGroup] = {
        limited: true,
        limitedAt: Math.floor(Date.now() / 1000),
    };
    console.log(`🚫 密钥限流标记: key=${keyId} group=${apiGroup}`);
}

// 从候选密钥中随机选一个未限流的；无可用返回 null
function pickAvailable(candidates, apiGroup) {
    const usable = candidates.filter(k => !isKeyLimited(k.id, apiGroup));
    if (usable.length === 0) return null;
    return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * 选择密钥：专属(authUaKeys含uaKey)随机 → 公共池(authUaKeys=[])随机 → null(全限流)
 * @param {String} uaKey 由 identifyUserAgent 得到的 ua_key
 * @param {String} apiGroup 接口分组
 * @returns {Object|null} 选中的密钥
 */
function selectKey(uaKey, apiGroup) {
    ensureKeyStateFresh();
    const keys = memoryCache.keyPool.keys;
    if (!keys || keys.length === 0) return null;

    // 1. 专属密钥（authUaKeys 命中当前 uaKey）
    if (uaKey) {
        const dedicated = keys.filter(k => Array.isArray(k.authUaKeys) && k.authUaKeys.includes(uaKey));
        const pick = pickAvailable(dedicated, apiGroup);
        if (pick) return pick;
    }
    // 2. 公共池（authUaKeys 为空）
    const pool = keys.filter(k => !k.authUaKeys || k.authUaKeys.length === 0);
    return pickAvailable(pool, apiGroup);
}

// 导出当前密钥状态快照（用于上报本地端）
function buildKeyStateSnapshot() {
    ensureKeyStateFresh();
    return {
        worker_id: DATA_CENTER_CONFIG.workerId,
        reset_date: memoryCache.keyPool.resetDate,
        keys_source: memoryCache.keyPool.keysSource,
        key_count: memoryCache.keyPool.keys.length,
        key_state: memoryCache.keyPool.keyState,
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
