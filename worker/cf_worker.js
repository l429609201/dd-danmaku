// ========================================
// 🔧 配置区域 - 请根据需要修改以下参数
// ========================================

// 客户端签名校验：逻辑在独立的混淆产物 sign_verify.js 中（不入公开仓库，
// 部署时与本文件一起上传）。公开仓库看不到验证算法/旁路细节。
// 构建产物由 sign-verify-src/ 经 javascript-obfuscator 混淆生成。
import { verifyClientSignature, verifyUserAllow, verifyUserIdMark } from './sign_verify.js';
import { tryLocalSearchFallback } from './local_search_fallback.mjs';

// 允许访问的主机名列表
const hostlist = { 'api.dandanplay.net': null };

// ========================================
// ⏱️ 封禁策略配置（改这里即可）
// ========================================
// 非法路由滥用：累计超阈值后的封禁时长（小时）
const BAN_HOURS_INVALID_ROUTE = 1;
// 认证类校验失败（用户标识归属不符 / 不在名单 / 实例ID不符）达阈值后的拉黑时长（小时）
const BAN_HOURS_AUTH_FAIL = 1;
// 认证类失败容错次数：同一「IP + 用户标识 + 来源UA」三元组在窗口内累计到该次数即拉黑。
// 不做一次即封，是因为配置下发延迟等会造成偶发失败。
const AUTH_FAIL_MAX_ATTEMPTS = 5;

// 弹弹play 接口分组（密钥限流状态按分组独立维护）
// 注意：resolveApiGroup 按顺序前缀匹配，更具体的前缀必须放在更宽泛的前面。
// bangumi_bgmtv(/api/v2/bangumi/bgmtv/) 必须在 bangumi(/api/v2/bangumi/) 之前，
// 否则会被 bangumi 前缀先命中，无法独立限流。
const DDP_API_GROUPS = {
    'search_anime': '/api/v2/search/anime',
    'search_episodes': '/api/v2/search/episodes',
    'bangumi_bgmtv': '/api/v2/bangumi/bgmtv/',
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
    // 封禁时长由顶部 BAN_HOURS_* 常量换算而来（小时 → 毫秒）
    BAN_DURATION_MS: BAN_HOURS_INVALID_ROUTE * 60 * 60 * 1000,
    AUTH_FAIL_BAN_MS: BAN_HOURS_AUTH_FAIL * 60 * 60 * 1000,
    AUTH_FAIL_MAX_ATTEMPTS,          // 认证失败容错次数（见顶部常量）
    AUTH_FAIL_WINDOW_MS: 60 * 60 * 1000, // 认证失败计数窗口：1 小时
    MAX_TRACKED_IPS: 50000,          // 最多跟踪的 IP 数（防内存泄漏）
};

// 日志请求/响应体截断上限（字节）：超出部分追加省略提示，防止 log.report payload 过大
const LOG_BODY_MAX_BYTES = 4096;

// 空结果负缓存配置：仅 search 接口，同一归一化搜索键空结果累计达阈值后转本地端负缓存
const EMPTY_CACHE_CONFIG = {
    THRESHOLD: 3,              // 同搜索词空结果累计 N 次后才上报本地端负缓存（防偶发空误伤）
    TTL_SECONDS: 6 * 60 * 60,  // 空结果负缓存 TTL（默认 6 小时；本地端也有全局默认，此值随上报传递）
    COUNTER_WINDOW_MS: 60 * 60 * 1000, // 计数窗口 1 小时，超窗重置
    MAX_COUNTERS: 20000,       // 计数器上限，防内存泄漏
};

// 归一化搜索关键词：小写 + 去首尾空格 + 内部连续空白合一，让大小写/空格差异命中同一键
function normalizeSearchKeyword(kw) {
    return String(kw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// R2 弹幕缓存配置
const R2_CACHE_CONFIG = {
    TTL: 24 * 60 * 60 * 1000,              // 24小时过期
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
        signKeyPool: [],  // 签名密钥池 [{ groupId, secret, authUaKeys:[] }],按 UA 分组验签
        signPoolLoaded: false,  // 签名池是否成功下发过（冷启动放行、运行期拒绝 no_secret 的依据）
        userAllowPool: [],  // 用户允许名单池 [{ groupId, users:[] }]，按 UA 绑定的 userGroupId 过滤
        userPoolLoaded: false,  // 名单池是否成功下发过（同签名池：冷启动放行、运行期拒绝）
        // 下发的 OAuth 配置（null = 使用 env.OAUTH_CONFIG 兜底；下发后立即覆盖）
        oauthConfig: null,
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
    // 空结果计数：同一归一化搜索键累计空结果次数，达阈值后转本地端负缓存
    emptySearchCounter: new Map(), // 格式: { "normKey": { count, firstAt } }
    // OAuth token 验证缓存（避免每次请求都做 crypto 运算）
    oauthTokenCache: new Map(), // 格式: { "token_hash": { payload, expireAt } }
    lastControlConfigPull: 0,
    lastStatsReport: 0,
    lastLogReport: 0,
    // 非法路由滥用追踪：记录每个 IP 的非法请求计数与临时封禁到期时间
    abuseTracker: new Map(), // 格式: { ip: { count, windowStart, bannedUntil } }
    // 认证类校验失败追踪：按「IP|用户标识|UA」三元组独立计数，达阈值拉黑该三元组
    authFailTracker: new Map(), // 格式: { 'ip|userId|ua': { count, windowStart } }
    // 三元组黑名单：认证失败达阈值后拉黑「IP+用户标识+UA」组合（不封整个 IP，避免 NAT 误伤）
    authBanTracker: new Map(), // 格式: { 'ip|userId|ua': bannedUntil }
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

/**
 * 截断 body 文本到 LOG_BODY_MAX_BYTES，超出追加省略提示。
 * 避免大响应体（如弹幕列表）撑爆 log.report payload。
 */
function truncateBody(text) {
    if (!text) return null;
    if (text.length <= LOG_BODY_MAX_BYTES) return text;
    return text.slice(0, LOG_BODY_MAX_BYTES) + `…[已截断，原始${text.length}字节]`;
}

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

/**
 * 回源配额检查（与入口的请求限流是两套独立计数）
 *
 * 为什么要单独一层：入口的 checkAccess 统计「客户端打 Worker 的次数」，
 * 缓存命中也会计数——可是命中根本没碰上游。而真正稀缺的是弹弹play 的
 * 付费配额。所以这里只在缓存全部 miss、即将真的打上游时才递增，
 * 让上游配额只被真实回源消耗。
 *
 * 计数键前缀 origin- 与请求侧隔离，复用同一个 rateLimitCounts Map
 * 和它的清理逻辑，不新增内存结构。
 *
 * @returns {{allowed:boolean, reason?:string, count?:number, limit?:number|string}}
 */
function checkOriginQuota(clientIP, uaConfig, apiPath) {
    // 未配置或开关关闭 => 不限（旧库新列为空时行为与改动前一致）
    if (!uaConfig || !uaConfig.originLimitEnabled) {
        return { allowed: true, reason: 'origin_limit_disabled' };
    }

    const uaType = uaConfig.type || 'unknown';
    const perHour = uaConfig.originMaxRequestsPerHour;
    const perDay = uaConfig.originMaxRequestsPerDay;

    console.log(`🌐 [${clientIP}] 回源配额检查: UA=${uaType} path=${apiPath}`);

    // ① 路径级配额优先：命中某个路径模式时用它的值覆盖小时上限
    let effectiveHourly = perHour;
    let matchedPath = '';
    const originPathLimits = uaConfig.originPathLimits;
    if (Array.isArray(originPathLimits)) {
        for (const pl of originPathLimits) {
            const p = pl && (pl.path || pl.pathPattern);
            if (p && apiPath.includes(p)) {
                const v = pickLimitValue(
                    pl.maxRequestsPerHour,
                    pl.originMaxRequestsPerHour
                );
                if (v !== undefined) {
                    effectiveHourly = v;
                    matchedPath = p;
                }
                break;
            }
        }
    }

    // ② 小时窗口检查
    if (effectiveHourly !== undefined && effectiveHourly !== null) {
        const suffix = matchedPath ? `-path-${matchedPath}` : '';
        const r = checkMemoryRateLimit(clientIP, `origin-${uaType}${suffix}`, {
            windowMs: 3600000,
            maxRequestsPerHour: effectiveHourly,
        });
        if (!r.allowed) {
            return {
                allowed: false,
                reason: `回源配额超限(小时): ${r.count}/${r.limit}`,
                count: r.count,
                limit: r.limit,
            };
        }
    }

    // ③ 天窗口检查（UTC+8 自然日，与弹弹play 配额重置时区一致）
    if (perDay !== undefined && perDay !== null) {
        const r = checkMemoryRateLimit(clientIP, `origin-day-${uaType}`, {
            windowMs: 86400000,
            maxRequestsPerHour: perDay,
        });
        if (!r.allowed) {
            return {
                allowed: false,
                reason: `回源配额超限(当日): ${r.count}/${r.limit}`,
                count: r.count,
                limit: r.limit,
            };
        }
    }

    return { allowed: true };
}

/**
 * 按优先级取第一个「已配置」的限流值。
 *
 * 存在的意义：限流值 0 是合法配置（表示无限制），但 0 在 JS 里是 falsy，
 * 用 `a || b` 取值会把它当未配置而跳到兜底值上。本函数只跳过
 * undefined / null，确保本地端下发的 0 能原样生效。
 *
 * @param {...(number|undefined|null)} values 按优先级排列的候选值
 * @returns {number|undefined} 第一个非空值，全为空时返回 undefined
 */
function pickLimitValue(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
}

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

    // 取最大请求数：按 hourlyLimit → maxRequestsPerHour → maxRequests 优先级回退。
    // 必须用显式判空而非 ||，否则配置值 0 会被当 falsy 跳过（这正是
    // 「下发 maxRequests=0 却出现 100/小时」的根因）。
    let maxRequests = pickLimitValue(
        limits.hourlyLimit,
        limits.maxRequestsPerHour,
        limits.maxRequests // 兼容旧字段名
    );

    // 配置里没有任何限制字段 => 不限流。
    // 这里过去兜底成硬编码 100，等于静默篡改本地端配置，已移除。
    const isUnlimited =
        maxRequests === undefined ||
        maxRequests === null ||
        maxRequests === -1 ||
        maxRequests === 0; // 0 与 -1 同义，均表示无限制（与 UI 文案一致）

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
// GET 接口按路径白名单；match 是 POST，单独放行（缓存键由调用方用 fileName 构造）
function shouldUseLocalCache(apiPath, method) {
    if (apiPath.startsWith('/api/v2/match')) return method === 'POST';
    return method === 'GET' && LOCAL_CACHE_PATTERNS.some(p => apiPath.startsWith(p));
}

// 校验上游响应体是否「干净可缓存」：挡掉 success:false / errorCode!=0 / 空结果。
// 仅缓存真正有数据的成功响应，避免空响应/限流/错误污染缓存。
function isCacheableResponseBody(apiPath, responseText) {
    if (!responseText) return false;
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (_) {
        return false; // 非 JSON 不缓存
    }
    if (!data || typeof data !== 'object') return false;
    // dandanplay 统一约定：success=false 或 errorCode 非 0 即失败响应
    if (data.success === false) return false;
    if (typeof data.errorCode === 'number' && data.errorCode !== 0) return false;
    // 按接口校验是否含实际数据，空结果不缓存
    if (apiPath.startsWith('/api/v2/search/anime') || apiPath.startsWith('/api/v2/search/episodes')) {
        return Array.isArray(data.animes) && data.animes.length > 0;
    }
    if (apiPath.startsWith('/api/v2/bangumi/')) {
        const bangumi = data.bangumi || data;
        return !!(bangumi && (bangumi.animeId || bangumi.animeTitle));
    }
    if (apiPath.startsWith('/api/v2/match')) {
        return Array.isArray(data.matches) && data.matches.length > 0;
    }
    // 其他接口：只要不是失败响应即可缓存
    return true;
}

// 判断是否为「真实空搜索结果」：200、success 非 false、errorCode==0，但 animes 为空。
// 仅 search/anime、search/episodes 适用；明确排除 429/失败响应。
function isTrueEmptySearch(apiPath, responseText) {
    if (!apiPath.startsWith('/api/v2/search/anime') && !apiPath.startsWith('/api/v2/search/episodes')) return false;
    if (!responseText) return false;
    let data;
    try { data = JSON.parse(responseText); } catch (_) { return false; }
    if (!data || typeof data !== 'object') return false;
    if (data.success === false) return false;
    if (typeof data.errorCode === 'number' && data.errorCode !== 0) return false;
    return Array.isArray(data.animes) && data.animes.length === 0;
}

// 空结果计数：同一归一化键累计 +1，返回是否达阈值。窗口过期或超上限时重置/清理。
function bumpEmptySearchCount(normKey) {
    const now = Date.now();
    const m = memoryCache.emptySearchCounter;
    // 超上限：清理过期项，仍超则整体重置，防内存泄漏
    if (m.size > EMPTY_CACHE_CONFIG.MAX_COUNTERS) {
        for (const [k, v] of m.entries()) {
            if (now - v.firstAt > EMPTY_CACHE_CONFIG.COUNTER_WINDOW_MS) m.delete(k);
        }
        if (m.size > EMPTY_CACHE_CONFIG.MAX_COUNTERS) m.clear();
    }
    let rec = m.get(normKey);
    if (!rec || now - rec.firstAt > EMPTY_CACHE_CONFIG.COUNTER_WINDOW_MS) {
        rec = { count: 0, firstAt: now };
    }
    rec.count++;
    m.set(normKey, rec);
    return rec.count >= EMPTY_CACHE_CONFIG.THRESHOLD;
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

// 从整季 /search/episodes 响应里抽出指定集，保持上游同构结构。
// 抽不到（集号不存在/结构异常）返回 null，由调用方回退为原样返回整季，
// 不因抽取失败而让请求失败。
function extractEpisodeFromSeason(responseText, epNo) {
    if (!responseText || !epNo) return null;
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (_) {
        return null;
    }
    if (!data || !Array.isArray(data.animes)) return null;

    const want = String(epNo).trim();
    const wantNum = Number(want);
    // 多季场景：animes 每项各带自己的 episodes，需逐项过滤后保留命中的项，
    // 与本地端 entity_assemble 的 _assemble_episodes 行为保持一致
    const picked = [];
    for (const anime of data.animes) {
        if (!anime || !Array.isArray(anime.episodes)) continue;
        const animeId = String(anime.animeId || '');
        const hit = anime.episodes.filter(ep => {
            if (!ep) return false;
            // 上游集号字段形态不统一：episodeNumber 优先，缺失则从 episodeTitle 里取「第N话」
            let n = ep.episodeNumber;
            if (n === undefined || n === null || n === '') {
                const m = /第\s*(\d+)\s*[话集]/.exec(ep.episodeTitle || '');
                n = m ? m[1] : null;
            }
            // 末级兜底：从 episodeId 剥掉 animeId 前缀得集号（97710007 - 9771 → 0007 → 7）。
            // 与本地端 entity_service._episode_entity 同策略：必须校验前缀匹配，
            // 不写死「后 4 位」——集数超 9999 或 animeId 位数不同时该假设会破裂。
            if (n === null && animeId && /^\d+$/.test(animeId)) {
                const epId = String(ep.episodeId || '');
                if (epId.startsWith(animeId)) {
                    const suffix = epId.slice(animeId.length);
                    if (suffix && /^\d+$/.test(suffix)) n = String(Number(suffix));
                }
            }
            if (n === null) return false;
            const s = String(n).trim();
            // 数值比较兜住 '07' 与 '7' 这类补零差异
            return s === want || (Number.isFinite(wantNum) && Number(s) === wantNum);
        });
        if (hit.length > 0) {
            // 番剧其余字段（animeId/animeTitle/type/imageUrl 等）原样保留，只替换 episodes
            picked.push({ ...anime, episodes: hit });
        }
    }
    if (picked.length === 0) return null;
    return JSON.stringify({ ...data, animes: picked });
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

    // 密钥池：本地端下发的密钥列表为权威全量，整体替换 localKeys（与 env 基线合并）。
    // 注意：必须区分「字段存在但为空数组」与「字段缺失」——
    //   - key_pool 存在（含空数组 []）：本地端已表态，按其全量应用（空=清空本地密钥），
    //     确保删 UA/删密钥能传播，不残留旧值；
    //   - key_pool 缺失：本地端未下发密钥配置（旧版本/非密钥下发），保持现状不动。
    if ('key_pool' in cfg) {
        const pool = Array.isArray(cfg.key_pool) ? cfg.key_pool : [];
        mergeKeyPool(null, pool);
    }

    // 客户端签名校验密钥：本地端下发覆盖(字段存在才更新;缺失则保持,由 env 兜底)
    // 与 wasm 内置值一致。走 ControlHub(TLS+CONTROL_TOKEN)下发,无新增泄露面。
    // 签名密钥池：按 UA 分组的验签密钥（字段存在才更新，含空数组=清空）
    if ('sign_key_pool' in cfg) {
        memoryCache.configCache.signKeyPool = Array.isArray(cfg.sign_key_pool)
            ? cfg.sign_key_pool.filter(g => g && g.secret)
            : [];
        // 标记签名池已成功下发过至少一次：此后 no_secret 由「放行」转为「拒绝」，
        // 堵住运行期绕过；冷启动(从未下发)时仍放行，避免误伤。
        memoryCache.configCache.signPoolLoaded = true;
    }

    // 用户允许名单池：按 UA 绑定的 userGroupId 做用户名过滤（字段存在才更新，含空数组=清空）
    if ('user_allow_pool' in cfg) {
        memoryCache.configCache.userAllowPool = Array.isArray(cfg.user_allow_pool)
            ? cfg.user_allow_pool.filter(g => g && g.groupId)
            : [];
        // 同签名池策略：下发过至少一次后，组缺失由「放行」转为「拒绝」
        memoryCache.configCache.userPoolLoaded = true;
    }

    // OAuth 配置：整体替换（非合并）。OAuth 的 providers/allowedUsers 是强关联整体，
    // 逐键合并会产生「新 provider 用了旧 clientSecret」这类危险的中间态。
    // 字段缺失 => 保持现状（旧版本本地端不下发 OAuth，不能把已有配置抹掉）；
    // 字段存在但为空对象 => 视为「未配置」，回落 env 兜底，便于后台清空。
    if ('oauth_config' in cfg) {
        const oc = cfg.oauth_config;
        const valid = oc && typeof oc === 'object' && Object.keys(oc).length > 0;
        memoryCache.configCache.oauthConfig = valid ? oc : null;
        // 下发即失效 getOAuthConfig 的进程级缓存，否则本实例会继续用旧值
        _oauthConfigCache = null;
    }

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

/**
 * 组装本实例内存里的配置状态摘要（诊断用，密钥脱敏）。
 * 反映的是 env 基线与下发合并后的**最终生效值**，即校验分支实际读到的内容。
 */
function buildConfigStatePayload() {
    const cc = memoryCache.configCache;
    const mask = (s) => {
        const v = String(s || '');
        return v ? `${v.slice(0, 4)}***${v.slice(-4)}(len=${v.length})` : '';
    };
    const uaBrief = {};
    for (const [k, v] of Object.entries(cc.uaConfigs || {})) {
        uaBrief[k] = {
            userAgent: (v && v.userAgent) || '',
            enabled: !!(v && v.enabled),
            signGroupId: (v && v.signGroupId) || null,
            userGroupId: (v && v.userGroupId) || null,
        };
    }
    return {
        lastUpdate: cc.lastUpdate || 0,
        // 这两个标志决定「组缺失」是放行还是拒绝，排查冷启动放行必看
        signPoolLoaded: !!cc.signPoolLoaded,
        userPoolLoaded: !!cc.userPoolLoaded,
        uaConfigs: uaBrief,
        userAllowPool: (cc.userAllowPool || []).map(g => ({
            groupId: g && g.groupId,
            userCount: Array.isArray(g && g.users) ? g.users.length : 0,
            usersSample: Array.isArray(g && g.users) ? g.users.slice(0, 3) : [],
            brandMark: (g && g.brandMark) || null,
            obfKey: g && g.obfKey ? mask(g.obfKey) : null,
        })),
        signKeyPool: (cc.signKeyPool || []).map(g => ({
            groupId: g && g.groupId,
            secret: g && g.secret ? mask(g.secret) : null,
        })),
        ipBlacklistCount: (cc.ipBlacklist || []).length,
        ipWhitelistCount: (cc.ipWhitelist || []).length,
    };
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
        // 附带本实例内存里合并后的配置摘要（诊断用）。
        // 与 DO storage 的 config.dump 互补：DO 是「下发存成了什么」，
        // 这里是「本实例实际在用什么」——env 基线与下发合并后的最终值。
        // 排查「后台配了但没生效」时，两边对比即可定位是下发丢了还是合并覆盖了。
        config_state: buildConfigStatePayload(),
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
        cleanupAuthFailTracker(now);
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

function buildAuthKey(clientIp, userId, uaType) {
    return `${clientIp}\x1f${userId || ''}\x1f${uaType || ''}`;
}

function isAuthBanned(clientIp, userId, uaType) {
    const key = buildAuthKey(clientIp, userId, uaType);
    const until = memoryCache.authBanTracker.get(key);
    if (!until) return false;
    if (until > Date.now()) return true;
    memoryCache.authBanTracker.delete(key);
    return false;
}

/**
 * 记录一次认证类校验失败（用户标识归属不符 / 不在名单 / 实例ID不符）。
 * 按「IP + 用户标识 + 来源UA」三元组独立计数并独立拉黑：
 * 同一出口 IP（NAT）下不同用户、同一用户的不同客户端都互不牵连，误伤面最小。
 * 累计到 AUTH_FAIL_MAX_ATTEMPTS 次才拉黑，容忍配置下发延迟等偶发失败。
 * @param {String} clientIp 客户端 IP
 * @param {String} userId   客户端 X-Ddd-User（可能为空）
 * @param {String} uaType   命中的 UA 类型标识
 * @returns {{banned:Boolean, count:Number}} banned=本次是否触发拉黑，count=当前累计次数
 */
function recordAuthFail(clientIp, userId, uaType) {
    if (!clientIp || clientIp === 'unknown') return { banned: false, count: 0 };
    // 白名单 IP 不计数、不拉黑，避免误伤自己的服务器
    if (isIpWhitelisted(clientIp)) return { banned: false, count: 0 };

    const now = Date.now();
    const key = buildAuthKey(clientIp, userId, uaType);
    let rec = memoryCache.authFailTracker.get(key);

    // 容量保护：达上限先清理过期项，仍满则丢弃最旧项，防内存泄漏
    if (!rec && memoryCache.authFailTracker.size >= ABUSE_CONFIG.MAX_TRACKED_IPS) {
        cleanupAuthFailTracker(now);
        if (memoryCache.authFailTracker.size >= ABUSE_CONFIG.MAX_TRACKED_IPS) {
            const oldestKey = memoryCache.authFailTracker.keys().next().value;
            if (oldestKey !== undefined) memoryCache.authFailTracker.delete(oldestKey);
        }
    }

    // 窗口过期或首次：重置计数窗口
    if (!rec || (now - rec.windowStart) > ABUSE_CONFIG.AUTH_FAIL_WINDOW_MS) {
        rec = { count: 0, windowStart: now };
    }
    rec.count += 1;

    if (rec.count < ABUSE_CONFIG.AUTH_FAIL_MAX_ATTEMPTS) {
        memoryCache.authFailTracker.set(key, rec);
        return { banned: false, count: rec.count };
    }

    // 达阈值 → 拉黑该三元组，并清掉计数（拉黑期内不必再累计）
    memoryCache.authFailTracker.delete(key);
    // 取较晚的到期时间，避免已有更长拉黑被本次缩短
    const prevUntil = memoryCache.authBanTracker.get(key) || 0;
    memoryCache.authBanTracker.set(key, Math.max(prevUntil, now + ABUSE_CONFIG.AUTH_FAIL_BAN_MS));
    return { banned: true, count: rec.count };
}

// 清理 authFailTracker / authBanTracker 中已过期的项（防内存泄漏）
function cleanupAuthFailTracker(now) {
    now = now || Date.now();
    for (const [key, rec] of memoryCache.authFailTracker) {
        if ((now - rec.windowStart) > ABUSE_CONFIG.AUTH_FAIL_WINDOW_MS) {
            memoryCache.authFailTracker.delete(key);
        }
    }
    for (const [key, until] of memoryCache.authBanTracker) {
        if (until <= now) memoryCache.authBanTracker.delete(key);
    }
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

// --- OAuth 配置读取 ---
// 优先级：本地端下发(DO storage) > 环境变量 OAUTH_CONFIG(兜底基线)。
// 与 UA/IP 的「并集合并」不同，OAuth 走整体覆盖——见 applyRuntimeConfig 内说明。
// 缓存置 null 由 applyRuntimeConfig 触发，保证下发后本实例立即生效。
let _oauthConfigCache = null;
function getOAuthConfig(env) {
    if (_oauthConfigCache) return _oauthConfigCache;
    // 下发配置存在则直接采用，不与 env 混合，避免半新半旧的凭据组合
    const pushed = memoryCache.configCache.oauthConfig;
    if (pushed && typeof pushed === 'object' && Object.keys(pushed).length > 0) {
        _oauthConfigCache = pushed;
        return _oauthConfigCache;
    }
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
                    // 回传刷新所需字段（供应用侧落库后做临期自动刷新）
                    if (tokenData.refresh_token) redirectParams.set('refresh_token', tokenData.refresh_token);
                    if (tokenData.expires_in) redirectParams.set('expires_in', String(tokenData.expires_in));
                    return Response.redirect(`${appRedirectUri}?${redirectParams}`, 302);
                } catch (e) {
                    addMemoryLog('WARN', 'redirect_uri decode failed', { error: e.message });
                }
            }
            // 没有 redirect_uri 或解码失败，返回 JSON
            return oauthJson({
                token: jwt, user: user.id, name: user.name, provider,
                client_id: config.clientId,
                access_token: accessToken,
                refresh_token: tokenData.refresh_token || '',
                expires_in: tokenData.expires_in || 0,
            });
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

    // POST /oauth/refresh — 用 refresh_token 换新 access_token（服务端持有 client_secret）
    // body: { provider, refresh_token }
    if (path === '/oauth/refresh') {
        if (request.method !== 'POST') return oauthJson({ error: '仅支持 POST' }, 405);
        let body;
        try {
            body = await request.json();
        } catch {
            return oauthJson({ error: '请求体非 JSON' }, 400);
        }
        const provider = body?.provider;
        const refreshToken = body?.refresh_token;
        if (!provider || !refreshToken) {
            return oauthJson({ error: '缺少 provider 或 refresh_token' }, 400);
        }
        const config = getProviderConfig(provider, env);
        if (!config) return oauthJson({ error: `Provider "${provider}" 不可用或未配置` }, 400);
        try {
            const refreshBody = {
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: refreshToken,
                redirect_uri: `${origin}/oauth/callback`,
                grant_type: 'refresh_token',
            };
            const useJson = config.tokenContentType === 'json';
            const res = await fetch(config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': useJson ? 'application/json' : 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'CF-Worker-OAuth/1.0',
                },
                body: useJson ? JSON.stringify(refreshBody) : new URLSearchParams(refreshBody),
            });
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                return oauthJson({ error: 'Token 接口返回非 JSON', status: res.status, body: text.slice(0, 300) }, 502);
            }
            if (!data.access_token) {
                // 记录上游返回的错误码与描述：此前只记 status，导致日志里全是无信息的 400，
                // 无法区分 invalid_grant(令牌失效/已被轮换消费) 与配置错误(invalid_client 等)。
                // data 中不含 access_token（此分支的前提），只白名单取错误字段，避免带出敏感值。
                addMemoryLog('WARN', 'OAuth 刷新失败', {
                    provider,
                    status: res.status,
                    upstreamError: data.error || '',
                    upstreamDesc: String(data.error_description || '').slice(0, 200),
                });
                return oauthJson({ error: '刷新失败', detail: data }, 400);
            }
            addMemoryLog('INFO', 'OAuth 刷新成功', { provider });
            // 原样回传新令牌，部分 Provider 刷新后会轮换 refresh_token
            return oauthJson({
                access_token: data.access_token,
                refresh_token: data.refresh_token || refreshToken,
                expires_in: data.expires_in || 0,
                token_type: data.token_type || 'Bearer',
                created_at: data.created_at || Math.floor(Date.now() / 1000),
            });
        } catch (err) {
            addMemoryLog('ERROR', 'OAuth 刷新异常', { provider, error: err.message });
            return oauthJson({ error: `刷新异常: ${err.message}` }, 500);
        }
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

    // 3. 本地端诊断：回传 DO storage 里 runtime_config 的实际内容。
    // 用途：排查「后台配了但 Worker 没生效」——直接看下发究竟落成了什么。
    // 注意 config.apply 用的是浅合并({...existing,...incoming})，旧键不会被删，
    // 所以这里可能看到已从后台删除的陈旧字段，那本身就是需要发现的问题。
    if (msg.type === 'config.dump') {
      const cfg = await this.ctx.storage.get('runtime_config') || {};
      // 密钥类字段脱敏：只回长度与前缀，避免明文经日志/MCP 外泄
      const maskSecret = (s) => {
        const v = String(s || '');
        if (!v) return '';
        return `${v.slice(0, 4)}***${v.slice(-4)}(len=${v.length})`;
      };
      const uaConfigs = cfg.ua_configs || {};
      // UA 配置只回诊断相关字段，避免 payload 过大
      const uaBrief = {};
      for (const [k, v] of Object.entries(uaConfigs)) {
        uaBrief[k] = {
          userAgent: v && v.userAgent || '',
          enabled: !!(v && v.enabled),
          signGroupId: (v && v.signGroupId) || null,
          userGroupId: (v && v.userGroupId) || null,
        };
      }
      const payload = {
        has_runtime_config: Object.keys(cfg).length > 0,
        keys: Object.keys(cfg),
        ua_configs: uaBrief,
        // 名单池：脱敏 obfKey，users 只回数量与前若干项
        user_allow_pool: (cfg.user_allow_pool || []).map(g => ({
          groupId: g && g.groupId,
          userCount: Array.isArray(g && g.users) ? g.users.length : 0,
          usersSample: Array.isArray(g && g.users) ? g.users.slice(0, 3) : [],
          brandMark: (g && g.brandMark) || null,
          obfKey: g && g.obfKey ? maskSecret(g.obfKey) : null,
        })),
        sign_key_pool: (cfg.sign_key_pool || []).map(g => ({
          groupId: g && g.groupId,
          secret: g && g.secret ? maskSecret(g.secret) : null,
        })),
        ip_blacklist_count: Array.isArray(cfg.ip_blacklist) ? cfg.ip_blacklist.length : 0,
        ip_whitelist_count: Array.isArray(cfg.ip_whitelist) ? cfg.ip_whitelist.length : 0,
        key_pool_count: Array.isArray(cfg.key_pool) ? cfg.key_pool.length : 0,
      };
      try {
        ws.send(JSON.stringify({
          id: msg.id, type: 'config.dump.result',
          timestamp: Date.now(), payload,
        }));
      } catch (e) { /* 忽略发送失败 */ }
      return;
    }

    // 4. 本地端主动发起 R2 代读（长连接不能直读 R2，由 Worker 代读后回传）
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
    try {
      // 初始化数据中心配置
      await initializeDataCenterConfig(env);

      return await handleRequest(request, env, ctx);
    } catch (e) {
      // 顶层兜底：任何未捕获异常都返回 JSON，避免 Cloudflare 1101（Worker threw exception）
      console.error(`❌ Worker 顶层异常: ${e && e.stack ? e.stack : e}`);
      try {
        addMemoryLog('ERROR', 'Worker 顶层异常', {
          path: (() => { try { return new URL(request.url).pathname; } catch (_) { return ''; } })(),
          method: request.method,
          message: String(e && e.message ? e.message : e),
        });
      } catch (_) { /* 日志失败不阻塞 */ }
      return new Response(JSON.stringify({
        errorCode: 500, success: false,
        errorMessage: `Worker 内部错误: ${e && e.message ? e.message : e}`,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
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

    // 在 handleRequest 入口记录起始时间，所有路径共享
    const reqStartMs = Date.now();
    // 客户端用户标识（ede.js 无条件签名，每次请求都带 X-Ddd-User）；供所有日志记录，方便按用户标识
    const clientUserId = request.headers.get('X-Ddd-User') || '';
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
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, User-Agent, X-User-Agent, X-Challenge-Response, X-Ddd-User, X-Ddd-Ts, X-Ddd-Sign',
            },
        });
    }

    // 窗口内请求计数：OPTIONS 预检不算业务请求，故放在预检分支之后。
    // 此前漏调用导致上报的 metrics.totalRequests 恒为 0，仪表盘"流量趋势"请求线一直是空。
    bumpMetric('totalRequests');

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

    // 统一预读请求体（GET/HEAD 无 body 跳过）：供日志记录 + 后续转发复用。
    // 流只能读一次，这里读成文本后，match/其他 POST 转发时用文本重建 body。
    // 放在 tools/control/oauth 早退路由之后，这些路由不需要 body。
    let reqBodyText = null;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        try { reqBodyText = await request.text(); } catch (_) { /* 读取失败留 null */ }
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
        const banBody = JSON.stringify({
            status: 403,
            type: 'IP临时封禁',
            message: `IP ${clientIP} 因频繁请求非法路由已被临时封禁，请于约 ${remainMin} 分钟后再试`,
            retryAfterSeconds: retryAfterSec
        });
        addMemoryLog('warn', 'IP临时封禁拦截', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 403,
            userAgent: request.headers.get('X-User-Agent') || '',
            userId: clientUserId,
            remainMinutes: remainMin,
            durationMs: Date.now() - reqStartMs,
            responseBytes: banBody.length,
            requestBody: truncateBody(reqBodyText),
            responseBody: truncateBody(banBody),
        });
        return new Response(banBody, {
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

        const blBody = JSON.stringify({
            status: 403,
            type: "IP黑名单",
            message: `IP ${clientIP} 已被列入黑名单`
        });
        // 记录到内存日志（补全 method/path/status/body，便于日志页展示）
        addMemoryLog('warn', 'IP黑名单拦截', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 403,
            userAgent: request.headers.get('X-User-Agent') || '',
            userId: clientUserId,
            durationMs: Date.now() - reqStartMs,
            responseBytes: blBody.length,
            requestBody: truncateBody(reqBodyText),
            responseBody: truncateBody(blBody),
        });

        return new Response(blBody, {
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
            const banBody2 = JSON.stringify({
                status: 403,
                type: 'IP临时封禁',
                message: `IP ${clientIP} 因频繁请求非法路由已被临时封禁，请于约 ${banMin} 分钟后再试`,
                retryAfterSeconds: Math.ceil(ABUSE_CONFIG.BAN_DURATION_MS / 1000)
            });
            addMemoryLog('warn', '非法路由滥用封禁', {
                ip: clientIP,
                method: request.method,
                path: urlObj.pathname,
                responseStatus: 403,
                userAgent: request.headers.get('X-User-Agent') || '',
                userId: clientUserId,
                invalidUrl: url.substring(0, 100),
                durationMs: Date.now() - reqStartMs,
                responseBytes: banBody2.length,
                requestBody: truncateBody(reqBodyText),
                responseBody: truncateBody(banBody2),
            });
            return new Response(banBody2, {
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
        const invalidBody = JSON.stringify({
            status: 400,
            type: 'CORS代理',
            message: `无效的代理目标URL: 缺少协议和域名。收到: "${url.substring(0, 100)}"`
        });
        addMemoryLog('info', '非法路由请求', {
            ip: clientIP,
            method: request.method,
            path: urlObj.pathname,
            responseStatus: 400,
            userId: clientUserId,
            invalidUrl: url.substring(0, 100),
            durationMs: Date.now() - reqStartMs,
            responseBytes: invalidBody.length,
            requestBody: truncateBody(reqBodyText),
            responseBody: truncateBody(invalidBody),
        });
        return new Response(invalidBody, {
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

    // ========================================
    // 🎯 指定集数搜索：剥离 episode 转全季回源
    // ========================================
    // 问题：/search/episodes?anime=X&episode=7 的集号进了缓存键，
    // 一部 12 集番 = 12 个独立 key，每集都 miss 打上游，而整季数据其实一次就能拿全。
    // 做法：这里就把 episode 摘掉，让「上游请求 + 内存键 + 本地端键」统一归到全季形态，
    // 上游返回整季后，再在响应出口按原集号抽出那一集还给客户端。
    // 收益：同番第 2 集起直接命中整季缓存；上游请求量降到 1/N。
    let strippedEpisode = null;   // 原始请求的集号，非空表示出口需要抽取
    // 别名改写记录：非空表示本次回源用的是别名表给出的规范词而非客户端原词。
    // 仅用于日志与响应头标记，便于排查「为什么搜到的标题和请求的不一样」。
    let aliasRewritten = null;
    if (request.method === 'GET'
        && tUrlObj.pathname.startsWith('/api/v2/search/episodes')
        && tUrlObj.searchParams.has('episode')) {
        const epRaw = (tUrlObj.searchParams.get('episode') || '').trim();
        // 仅对纯数字集号生效：movie/sp 等特殊值语义由上游定义，剥离后可能取不回来，保持原样透传
        if (/^\d+$/.test(epRaw)) {
            strippedEpisode = epRaw;
            tUrlObj.searchParams.delete('episode');
            // url 同时是上游 fetch 目标与内存缓存键(api_cache_${url})的来源，必须同步改写
            url = tUrlObj.toString();
            console.log(`🎯 [${clientIP}] 指定集数搜索转全季回源: episode=${epRaw} 已剥离`);
        }
    }

    // 出口统一收口：把整季响应裁成客户端要的那一集。
    // 缓存里始终存整季，只在返回瞬间裁剪，因此不影响缓存复用。
    // 抽不到就原样返回整季——客户端能自行找集，比报错好。
    const narrowToEpisode = (text) => {
        if (!strippedEpisode || !text) return text;
        const picked = extractEpisodeFromSeason(text, strippedEpisode);
        if (picked) {
            console.log(`🎯 [${clientIP}] 已从整季抽取 episode=${strippedEpisode}`);
            return picked;
        }
        console.log(`⚠️ [${clientIP}] 整季中未找到 episode=${strippedEpisode}，返回完整结果`);
        return text;
    };

    // 访问控制检查，传递正确的API路径
    console.log(`🔍 [${clientIP}] 开始访问控制检查，目标路径: ${tUrlObj.pathname}`);

    // 白名单 IP 传 skipRateLimit=true：免限流但仍走 UA 识别。
    // 此前白名单直接短路返回不带 uaConfig 的对象，导致后续
    // 用户标识/签名校验（条件都是 accessCheck.uaConfig）被整体绕过。
    const accessCheck = await checkAccess(
        request, tUrlObj.pathname, reqStartMs, reqBodyText, clientUserId, ipWhitelisted
    );
    if (!accessCheck.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        // 对外消息只用 UA 配置名称，绝不回显原始 UA：
        // 原始 UA 形如 "misaka10876/&7Y4c#4#"，斜杠后是身份校验密钥，
        // 直接吐给客户端等于泄露凭据。原始 UA 仅进服务端日志。
        const uaLabel = accessCheck.uaName || accessCheck.uaConfig?.type || '未识别';
        // IP 同样只对外打码，完整值留在下方 addMemoryLog 里供排查
        const errorMessage = `IP:${maskIp(clientIP)} UA:${uaLabel} 消息：${accessCheck.reason}`;

        console.log(`🚫 [${clientIP}] 访问被拒绝: ${errorMessage}, 路径=${tUrlObj.pathname}`);
        bumpMetric('blockedUa'); bumpMetric('status4xx');
        const acBody = JSON.stringify({
            status: accessCheck.status,
            type: "访问控制",
            message: errorMessage
        });
        // 记录访问控制拦截日志，便于日志页排查（此前仅 console，未落库）
        addMemoryLog('warn', '访问控制拦截', {
            ip: clientIP,
            method: request.method,
            path: tUrlObj.pathname,
            responseStatus: accessCheck.status,
            userAgent,
            userId: clientUserId,
            reason: accessCheck.reason,
            durationMs: Date.now() - reqStartMs,
            responseBytes: acBody.length,
            requestBody: truncateBody(reqBodyText),
            responseBody: truncateBody(acBody),
        });

        return new Response(acBody, {
            status: accessCheck.status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 访问控制检查通过
    console.log(`✅ [${clientIP}] 访问控制检查通过，继续处理请求`);
    console.log(`   - UA类型: ${accessCheck.uaConfig?.type || 'unknown'}`);
    console.log(`   - 目标路径: ${tUrlObj.pathname}`);

    if (accessCheck.uaConfig) {
        const _uaCfg = accessCheck.uaConfig;
        const denyAsSign = (logName, reason, ban = false) => {
            bumpMetric('blockedUa'); bumpMetric('status4xx');
            let banned = false;
            let failCount = 0;
            if (ban) {
                // 三元组计数：IP + 用户标识 + 来源UA
                const r = recordAuthFail(clientIP, clientUserId, _uaCfg.type);
                banned = r.banned;
                failCount = r.count;
                const who = `用户: ${clientUserId || '空'}, UA: ${_uaCfg.type || '空'}`;
                if (banned) {
                    bumpMetric('blockedAbuse');
                    console.log(`⛔ [${clientIP}] ${logName} 累计 ${failCount} 次，已拉黑 ${BAN_HOURS_AUTH_FAIL} 小时 (${who})`);
                } else if (failCount > 0) {
                    console.log(`⚠️ [${clientIP}] ${logName} 第 ${failCount}/${ABUSE_CONFIG.AUTH_FAIL_MAX_ATTEMPTS} 次 (${who})`);
                }
            }
            const body = JSON.stringify({
                status: 401,
                type: '签名校验',
                message: '签名验证失败',
            });
            addMemoryLog('warn', logName, {
                ip: clientIP,
                method: request.method,
                path: tUrlObj.pathname,
                responseStatus: 401,
                userAgent: request.headers.get('X-User-Agent') || '',
                userId: clientUserId,
                uaType: _uaCfg.type || '',
                reason,
                banned,
                failCount,
                banHours: banned ? BAN_HOURS_AUTH_FAIL : 0,
                durationMs: Date.now() - reqStartMs,
                responseBytes: body.length,
                requestBody: truncateBody(reqBodyText),
                responseBody: truncateBody(body),
            });
            console.log(`🚫 [${clientIP}] ${logName}: ${reason}, 路径=${tUrlObj.pathname}`);
            return new Response(body, {
                status: 401,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        };

        if (_uaCfg.userGroupId) {
            if (isAuthBanned(clientIP, clientUserId, _uaCfg.type)) {
                return denyAsSign('认证失败拉黑期内', 'auth_banned', false);
            }
 

            const markCheck = await verifyUserIdMark(
                clientUserId, _uaCfg.userGroupId,
                memoryCache.configCache.userAllowPool,
                memoryCache.configCache.userPoolLoaded
            );
            if (!markCheck.ok) {
                return denyAsSign('用户标识校验失败', markCheck.reason, true);
            }

            // ② 用户名单精确匹配（名单留空 = 不限制具体用户，只靠上面的归属校验把关）
            const userCheck = verifyUserAllow(
                clientUserId, _uaCfg.userGroupId,
                memoryCache.configCache.userAllowPool,
                memoryCache.configCache.userPoolLoaded
            );
            if (userCheck.reason === 'user_group_missing') {
                console.log(`⚠️ [用户名过滤] 用户组 ${_uaCfg.userGroupId} 未找到,冷启动放行(名单池尚未下发)`);
            }
            if (!userCheck.ok) {
                return denyAsSign('用户名校验失败', userCheck.reason, true);
            }
            console.log(`✅ [${clientIP}] 用户名校验通过 (UA: ${_uaCfg.type})`);
        }
    }

    // ========================================
    // 🔏 客户端签名校验(按 UA 开关 signRequired 决定是否校验)
    // ========================================
    // 客户端(ede.js)无条件签名,此处仅当该 UA 规则绑定了签名组(signGroupId)时才强制校验。
    // 白名单 IP 与未绑定签名组的 UA 不校验,保证灰度与兜底安全。
    if (accessCheck.uaConfig && accessCheck.uaConfig.signGroupId) {
        // 签名池从 memoryCache 传入（验证逻辑在独立混淆模块，不直接访问全局）
        // signPoolLoaded：签名池是否已下发过，决定 no_secret 放行(冷启动)还是拒绝(运行期)
        const sigCheck = await verifyClientSignature(
            request, tUrlObj.pathname, accessCheck.uaConfig.signGroupId,
            memoryCache.configCache.signKeyPool,
            memoryCache.configCache.signPoolLoaded
        );
        if (sigCheck.reason === 'no_secret') {
            console.log(`⚠️ [签名校验] 签名组 ${accessCheck.uaConfig.signGroupId} 未找到或无密钥,冷启动放行(签名池尚未下发)`);
        }
        if (!sigCheck.ok) {
            bumpMetric('blockedUa'); bumpMetric('status4xx');
            // 对外只回笼统提示，不暴露具体失败原因（缺头/时间戳/签名不匹配等）；
            // 具体 reason 仅记录到内部日志与 console，便于排查而不泄露给客户端
            const sigBody = JSON.stringify({
                status: 401,
                type: '签名校验',
                message: '签名验证失败',
            });
            addMemoryLog('warn', '签名校验失败', {
                ip: clientIP,
                method: request.method,
                path: tUrlObj.pathname,
                responseStatus: 401,
                userAgent: request.headers.get('X-User-Agent') || '',
                userId: clientUserId,
                uaType: accessCheck.uaConfig.type || '',
                reason: sigCheck.reason,
                durationMs: Date.now() - reqStartMs,
                responseBytes: sigBody.length,
                requestBody: truncateBody(reqBodyText),
                responseBody: truncateBody(sigBody),
            });
            console.log(`🚫 [${clientIP}] 签名校验失败: ${sigCheck.reason}, 路径=${tUrlObj.pathname}`);
            return new Response(sigBody, {
                status: 401,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }
        console.log(`✅ [${clientIP}] 签名校验通过 (UA: ${accessCheck.uaConfig.type})`);
    }

    // ========================================
    // 📦 缓存策略判断
    // ========================================
    const apiPath = tUrlObj.pathname;
    const isMatchApi = apiPath.startsWith('/api/v2/match');

    // match 是 POST，参数在 body 里。转发前先把 body 读成文本（流只能读一次），
    // 解析出 fileName 作为缓存键的唯一依据（fileHash/fileSize 多变，不纳入键）。
    // matchBodyText 同时用于重建转发 body，避免流被消费后无法转发。
    // matchBodyText 复用入口预读的 reqBodyText（流已在入口消费，不能再读）
    let matchBodyText = null;
    let matchFileName = '';
    let matchPayloadObj = null;  // 完整 match 请求参数（fileName/fileHash/fileSize/videoDuration/matchMode），随缓存一并保存
    if (isMatchApi && request.method === 'POST' && reqBodyText !== null) {
        try {
            matchBodyText = reqBodyText;
            const mp = JSON.parse(matchBodyText);
            matchPayloadObj = (mp && typeof mp === 'object') ? mp : null;
            matchFileName = (mp && typeof mp.fileName === 'string') ? mp.fileName.trim() : '';
        } catch (_) { /* body 非 JSON 或读取失败：matchFileName 留空，不缓存 */ }
    }

    // match 专用缓存键：仅用 fileName，同一集视频缓存键恒定，429 必命中兜底
    const matchCacheKeyOf = () => matchFileName
        ? `POST:/api/v2/match?fileName=${encodeURIComponent(matchFileName)}`
        : null;

    // 内存缓存：搜索、番剧、匹配、搜索分集
    const memoryCachePatterns = ['/api/v2/search/anime', '/api/v2/search/episodes', '/api/v2/bangumi/', '/api/v2/match'];
    // GET 接口按路径判定；match(POST) 仅在成功解析出 fileName 时才视为可缓存
    const isCacheable = (request.method === 'GET' && memoryCachePatterns.some(p => apiPath.startsWith(p)))
        || (isMatchApi && request.method === 'POST' && !!matchFileName);
    // R2 缓存：弹幕接口
    const isCommentApi = request.method === 'GET' && apiPath.startsWith('/api/v2/comment/');
    // 内存缓存键：match 用 fileName 区分（POST 的 url 无 query，否则不同文件会脏命中）
    const memCacheKey = (isMatchApi && matchFileName)
        ? `api_cache_match_${matchFileName}`
        : `api_cache_${url}`;

    // --- 内存缓存命中检查 ---
    if (isCacheable) {
        const cacheKey = memCacheKey;
        const cached = memoryCache.apiCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp < MEMORY_LIMITS.API_CACHE_TTL)) {
            console.log(`📦 [${clientIP}] 内存缓存命中: ${apiPath}`);
            // 缓存存的是整季，按原始请求的集号裁剪后再返回
            const memBody = narrowToEpisode(cached.data);
            // 指标：内存缓存命中 + 出流量 + 响应/2xx
            bumpMetric('memCacheHits'); bumpMetric('totalResponses');
            bumpMetric('status2xx');
            bumpMetric('bytesOut', (memBody && memBody.length) ? memBody.length : 0);
            addMemoryLog('INFO', '内存缓存命中', {
                ip: clientIP,
                path: apiPath,
                method: request.method,
                userAgent: request.headers.get('X-User-Agent') || '',
                userId: clientUserId,
                responseStatus: 200,
                cacheSource: 'MEM',
                cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
                durationMs: Date.now() - reqStartMs,
                responseBytes: (memBody && memBody.length) ? memBody.length : 0,
                requestBody: truncateBody(reqBodyText),
                responseBody: truncateBody(memBody),
            });
            return new Response(memBody, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT',
                    'X-Cache-Age': Math.round((Date.now() - cached.timestamp) / 1000).toString()
                }
            });
        }

        // 空结果负缓存命中检查：仅 search 接口，用归一化搜索词键。
        // 命中且未过期 → 直接返回当初的空响应，不打上游（挡重复无效搜索）。
        if (env.CONTROL_HUB && request.method === 'GET'
            && (apiPath.startsWith('/api/v2/search/anime') || apiPath.startsWith('/api/v2/search/episodes'))) {
            const rawKw = tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '';
            const normKw = normalizeSearchKeyword(rawKw);
            if (normKw) {
                const emptyKey = `EMPTY:${apiPath}?anime=${encodeURIComponent(normKw)}`;
                const neg = await controlHubRpc(env, 'cache.get', {
                    cache_key: emptyKey, api_path: apiPath, method: request.method,
                    client_ip: clientIP, worker_request_id: request.headers.get('cf-ray') || '',
                }, 1500);
                // 双重校验：EMPTY: 只是探测键，只有本地端明确标记 is_empty 才能短路。
                // 避免异常返回或旧逻辑的实体拼装 hit 被误当成负缓存直接吐给客户端。
                if (neg && neg.hit && neg.is_empty === true && neg.body) {
                    console.log(`🕳️ [${clientIP}] 空结果负缓存命中，直接返回空: ${normKw}`);
                    bumpMetric('memCacheHits'); bumpMetric('totalResponses'); bumpMetric('status2xx');
                    addMemoryLog('INFO', '空结果负缓存命中', {
                        ip: clientIP,
                        path: apiPath,
                        query: normKw,  // 归一化后的搜索词
                        method: request.method,
                        userAgent: request.headers.get('X-User-Agent') || '',
                        userId: clientUserId,
                        responseStatus: 200,
                        cacheSource: 'LOCAL-EMPTY',
                        durationMs: Date.now() - reqStartMs,
                        responseBytes: neg.body ? neg.body.length : 0,
                        requestBody: truncateBody(reqBodyText),
                        responseBody: truncateBody(neg.body)
                    });
                    return new Response(neg.body, {
                        status: 200,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT-EMPTY' },
                    });
                }
                // 负缓存未命中，但本地端在这次 RPC 里顺带解析出了别名：客户端搜的词
                // dandanplay 搜不到，而库里有等价的规范标题。必须在这里立即改写，
                // 否则这份别名信息会被丢弃——下面第二次 RPC 用的是另一个 cache_key。
                // 只改 tUrlObj + url（字符串），与剥离 episode 的处理方式保持一致；
                // 内存缓存键在上面已用 const 固定，不在此处改写。
                if (neg && !neg.hit && neg.alias_hit && neg.canonical) {
                    const kwName = tUrlObj.searchParams.has('keyword') ? 'keyword' : 'anime';
                    if (tUrlObj.searchParams.has(kwName)) {
                        aliasRewritten = { from: neg.term || normKw, to: neg.canonical };
                        tUrlObj.searchParams.set(kwName, neg.canonical);
                        url = tUrlObj.toString();
                        console.log(`🔤 [${clientIP}] 别名改写搜索词: ${aliasRewritten.from} → ${aliasRewritten.to}`);
                    }
                }
            }
        }

        // 内存未命中：先查本地端缓存，命中则直接返回，避免每次都打弹弹触发 429
        // match(POST) 用 fileName 专用键；其他 GET 用 query 键
        if (env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
            const localCacheKey = isMatchApi
                ? matchCacheKeyOf()
                : buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
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
                // 回填内存必须用整季原文（local.body），裁剪后的只用于本次响应，
                // 否则后续请求别的集会从内存拿到被裁过的脏数据
                memoryCache.apiCache.set(cacheKey, { data: local.body, timestamp: Date.now() });
                const localBody = narrowToEpisode(local.body);
                bumpMetric('bytesOut', localBody.length || 0);
                addMemoryLog('INFO', '本地端缓存命中', {
                    ip: clientIP,
                    path: apiPath,
                    query: tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '',
                    method: request.method,
                    userAgent: request.headers.get('X-User-Agent') || '',
                    userId: clientUserId,
                    responseStatus: local.status || 200,
                    cacheSource: local.stale ? 'LOCAL-STALE' : 'LOCAL',
                    stale: !!local.stale,
                    durationMs: Date.now() - reqStartMs,
                    responseBytes: localBody ? localBody.length : 0,
                    requestBody: truncateBody(reqBodyText),
                    responseBody: truncateBody(localBody)
                });
                return new Response(localBody, {
                    status: local.status || 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache': local.stale ? 'HIT-LOCAL-STALE' : 'HIT-LOCAL',
                    }
                });
            }
            // 本地无缓存，但本地端在同一次 RPC 里顺带做了别名解析：
            // 客户端搜的词 dandanplay 搜不到（如「无职转生 第三季」），而库里
            // 有等价的规范标题（「无职转生Ⅲ ～…～」）。用规范词改写回源 URL，
            // 把原本注定为空的请求变成能拿到数据的请求。
            // 只改 tUrlObj + url：两者同时是上游 fetch 目标与内存缓存键的来源，
            // 与上面剥离 episode 的处理方式一致。
            if (local && !local.hit && local.alias_hit && local.canonical
                && request.method === 'GET' && !isMatchApi) {
                const kwName = tUrlObj.searchParams.has('keyword') ? 'keyword' : 'anime';
                if (tUrlObj.searchParams.has(kwName)) {
                    aliasRewritten = { from: local.term || '', to: local.canonical };
                    tUrlObj.searchParams.set(kwName, local.canonical);
                    url = tUrlObj.toString();
                    console.log(`🔤 [${clientIP}] 别名改写搜索词: ${aliasRewritten.from} → ${local.canonical}`);
                }
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
            addMemoryLog('INFO', 'R2弹幕缓存命中', {
                ip: clientIP,
                path: apiPath,
                query: tUrlObj.searchParams.get('episodeId') || '',
                method: request.method,
                userAgent: request.headers.get('X-User-Agent') || '',
                userId: clientUserId,
                responseStatus: 200,
                cacheSource: 'R2',
                durationMs: Date.now() - reqStartMs,
                responseBytes: cachedData ? cachedData.length : 0,
                requestBody: truncateBody(reqBodyText),
                responseBody: truncateBody(cachedData)
            });
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
                addMemoryLog('INFO', '本地端弹幕兜底命中', {
                    ip: clientIP,
                    path: apiPath,
                    query: tUrlObj.searchParams.get('episodeId') || '',
                    method: request.method,
                    userAgent: request.headers.get('X-User-Agent') || '',
                    userId: clientUserId,
                    responseStatus: 200,
                    cacheSource: 'LOCAL-COMMENT',
                    durationMs: Date.now() - reqStartMs,
                    responseBytes: local.body ? local.body.length : 0,
                    requestBody: truncateBody(reqBodyText),
                    responseBody: truncateBody(local.body)
                });
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
    // 🌐 回源配额检查：所有缓存均未命中，即将真正打上游
    // ========================================
    // 走到这里说明内存/本地端/R2 全部 miss，是唯一会产生上游调用的位置。
    // 超限时不直接报错，先降级取过期缓存（allow_stale），拿不到才返回 429。
    const originQuota = checkOriginQuota(clientIP, accessCheck.uaConfig, apiPath);
    if (!originQuota.allowed) {
        console.log(`🚫 [${clientIP}] 回源配额超限: ${originQuota.reason} (${originQuota.count}/${originQuota.limit})`);

        // 降级档：容忍过期的本地端缓存，过期数据胜过直接失败
        if (env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
            const staleKey = isMatchApi
                ? matchCacheKeyOf()
                : buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
            const staleHit = await controlHubRpc(env, 'cache.get', {
                cache_key: staleKey,
                api_path: apiPath,
                method: request.method,
                client_ip: clientIP,
                worker_request_id: request.headers.get('cf-ray') || '',
                prefetch: true,
                allow_stale: true,
            }, 1500);
            if (staleHit && staleHit.hit && staleHit.body) {
                bumpMetric('totalResponses'); bumpMetric('status2xx');
                // 与其他命中出口保持一致：过期缓存存的也是整季，需按原集号裁剪后返回
                const staleBody = narrowToEpisode(staleHit.body);
                addMemoryLog('WARN', '回源配额超限-返回过期缓存', {
                    ip: clientIP, path: apiPath, method: request.method,
                    userAgent: request.headers.get('X-User-Agent') || '',
                    userId: clientUserId, responseStatus: 200,
                    cacheSource: 'STALE-QUOTA', durationMs: Date.now() - reqStartMs,
                    responseBytes: staleBody.length,
                    responseBody: truncateBody(staleBody),
                });
                return new Response(staleBody, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache': 'HIT-STALE-QUOTA',
                    },
                });
            }
        }

        // 连过期缓存都没有：返回 429（沿用密钥全限流的 200+errorCode 约定，
        // 客户端按 errorCode 判断，避免播放器把非 200 当网络错误）
        const quotaBody = JSON.stringify({
            errorCode: 429, success: false,
            errorMessage: '回源请求已达配额上限，请稍后再试',
        });
        addMemoryLog('WARN', '回源配额超限', {
            ip: clientIP, path: apiPath,
            userAgent: request.headers.get('X-User-Agent') || '',
            userId: clientUserId, reason: originQuota.reason,
            durationMs: Date.now() - reqStartMs,
            responseBytes: quotaBody.length,
            requestBody: truncateBody(reqBodyText),
            responseBody: truncateBody(quotaBody),
        });
        bumpMetric('totalResponses'); bumpMetric('status4xx');
        return new Response(quotaBody, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'X-Cache': 'ORIGIN-QUOTA-EXCEEDED',
            },
        });
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
        // 全部密钥该接口已限流：先尝试本地别名兜底，再返回流控
        console.log(`🚫 [${clientIP}] 接口 ${apiGroup} 所有密钥已限流`);

        // 密钥池耗尽与上游 429 共用同一兜底契约，避免两处响应结构漂移。
        if (env.CONTROL_HUB && (apiPath === '/api/v2/search/episodes' || apiPath === '/api/v2/search/anime')) {
            const rawKw = tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '';
            const normKw = normalizeSearchKeyword(rawKw);
            if (normKw) {
                console.log(`🔄 [${clientIP}] 密钥池耗尽，尝试本地别名兜底: ${normKw}`);
                const fallback = await tryLocalSearchFallback({
                    keyword: normKw,
                    rpc: (type, payload, timeoutMs) => controlHubRpc(env, type, payload, timeoutMs),
                    extraHeaders: { 'X-Key-Pool': 'EXHAUSTED' },
                });
                if (fallback) {
                    console.log(`✅ [${clientIP}] 密钥池耗尽时本地别名兜底命中: ${fallback.count} 个作品`);
                    bumpMetric('totalResponses'); bumpMetric('status2xx');
                    addMemoryLog('INFO', '密钥池耗尽-别名兜底命中', {
                        ip: clientIP, path: apiPath, query: normKw, method: request.method,
                        userAgent: request.headers.get('X-User-Agent') || '', userId: clientUserId,
                        responseStatus: 200, cacheSource: 'LOCAL-ALIAS-FALLBACK',
                        durationMs: Date.now() - reqStartMs, responseBytes: fallback.body.length,
                        requestBody: truncateBody(reqBodyText), responseBody: truncateBody(fallback.body)
                    });
                    return fallback.response;
                }
                console.log(`ℹ️ [${clientIP}] 密钥池耗尽且本地别名无匹配或不可用，返回 429`);
            }
        }

        // 本地别名也无结果，返回流控提示
        const exhaustBody = JSON.stringify({
            errorCode: 429, success: false,
            errorMessage: '当前接口所有密钥已达调用配额上限，请稍后再试',
        });
        addMemoryLog('warn', '密钥全限流', { ip: clientIP, path: apiPath, apiGroup, uaKey, userId: clientUserId, durationMs: Date.now() - reqStartMs, responseBytes: exhaustBody.length, requestBody: truncateBody(reqBodyText), responseBody: truncateBody(exhaustBody) });
        bumpMetric('upstream429'); bumpMetric('status4xx');
        return new Response(exhaustBody, {
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
        // 排除自定义头，只转发标准头(含本插件签名/身份头 X-Ddd-*,不污染上游请求)
        const lk = key.toLowerCase();
        if (key !== 'X-User-Agent' && key !== 'X-Challenge-Response'
            && !lk.startsWith('x-ddd-')) {
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
        // 密钥配置了 forwardUa 则覆盖 User-Agent；留空则保持请求者原 UA。
        // forwardHeaders 来自 headers.entries()（key 为小写），先删小写键再设标准键，避免重复头
        if (keyObj.forwardUa) {
            delete headers['user-agent'];
            headers['User-Agent'] = keyObj.forwardUa;
        }
        if (ACCESS_CONFIG.logging.enabled) {
            console.log(`📤 [${clientIP}] 转发请求头(key=${keyObj.id}):`, JSON.stringify(headers, null, 2));
        }
        // GET/HEAD 不能带 body，否则 fetch 抛 TypeError（Worker 1101）
        const fetchInit = { headers, method: request.method };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            // match body 已预读为 matchBodyText；其他 POST 用 reqBodyText（已提前读取），
            // 两者都是文本，支持限流切换密钥时的安全重试
            fetchInit.body = (matchBodyText !== null) ? matchBodyText : (reqBodyText !== null ? reqBodyText : request.body);
        }
        const resp = await fetch(url, fetchInit);
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
    let responseText = fwd.responseText;
    const upstreamErrorCode = fwd.errorCode;
    let isUpstreamRateLimited = fwd.limited;
    if (isUpstreamRateLimited) {
        console.log(`🚫 [${clientIP}] 检测到上游限流 (HTTP ${response.status}, errorCode=${upstreamErrorCode})`);
        // 上游 429 与密钥池耗尽复用同一纯契约函数，仅保留本分支状态更新。
        if (env.CONTROL_HUB && (apiPath === '/api/v2/search/episodes' || apiPath === '/api/v2/search/anime')) {
            const rawKw = tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '';
            const normKw = normalizeSearchKeyword(rawKw);
            if (normKw) {
                console.log(`🔄 [${clientIP}] 尝试本地端别名兜底: ${normKw}`);
                const fallback = await tryLocalSearchFallback({
                    keyword: normKw,
                    rpc: (type, payload, timeoutMs) => controlHubRpc(env, type, payload, timeoutMs),
                    extraHeaders: { 'X-Upstream-Status': '429' },
                });
                if (fallback) {
                    console.log(`✅ [${clientIP}] 本地端别名兜底命中: ${fallback.count} 条结果`);
                    response = fallback.response;
                    responseText = fallback.body;
                    isUpstreamRateLimited = false;
                } else {
                    console.log(`ℹ️ [${clientIP}] 本地端别名无匹配或不可用，保持 429 响应`);
                }
            }
        }
    }

    // 指标：回源响应（可缓存请求走到这里即未命中）+ 状态码分布 + 429
    bumpMetric('totalResponses');
    if (isCacheable || isCommentApi) bumpMetric('cacheMiss');
    if (isUpstreamRateLimited) { bumpMetric('upstream429'); bumpMetric('status4xx'); }
    else if (response.status >= 200 && response.status < 300) bumpMetric('status2xx');
    else if (response.status >= 400 && response.status < 500) bumpMetric('status4xx');
    else if (response.status >= 500) bumpMetric('status5xx');

    // 记录API请求到内存日志（含缓存来源/密钥/上游状态/耗时/响应字节/请求响应体，便于排查）
    addMemoryLog(isUpstreamRateLimited ? 'WARN' : 'INFO', 'API请求处理', {
        ip: clientIP,
        method: request.method,
        path: apiPath,
        // 提取 URL 参数中的搜索词，便于日志查看（GET 请求的参数在 query 而非 body）
        query: tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '',
        userAgent: request.headers.get('X-User-Agent') || '',
        userId: clientUserId,
        responseStatus: response.status,
        cacheSource: isUpstreamRateLimited ? 'UPSTREAM-429' : 'MISS',
        upstreamStatus: upstreamErrorCode || response.status,
        keyId: selectedKey ? selectedKey.id : '',
        durationMs: Date.now() - reqStartMs,
        responseBytes: responseText ? responseText.length : 0,
        // 请求体：match 用 matchBodyText，其他 POST 用 reqBodyText，截断到 4 KB
        requestBody: truncateBody(matchBodyText !== null ? matchBodyText : reqBodyText),
        // 响应体：截断到 4 KB（弹幕响应可达数百 KB，全量会撑爆 log.report）
        responseBody: truncateBody(responseText),
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
            // 脏响应过滤：空结果/success:false/errorCode!=0 一律不缓存，避免污染
            if (!isCacheableResponseBody(apiPath, responseText)) {
                // 空结果负缓存：仅对「真实空搜索」（非 429/失败）做累计计数，
                // 同一归一化搜索词达阈值后转本地端负缓存，挡重复无效搜索。
                if (env.CONTROL_HUB && isTrueEmptySearch(apiPath, responseText)) {
                    const rawKw = tUrlObj.searchParams.get('anime') || tUrlObj.searchParams.get('keyword') || '';
                    const normKw = normalizeSearchKeyword(rawKw);
                    if (normKw && bumpEmptySearchCount(`${apiPath}|${normKw}`)) {
                        // 达阈值：上报本地端负缓存（键用归一化搜索词，跨大小写/空格聚合）
                        const emptyKey = `EMPTY:${apiPath}?anime=${encodeURIComponent(normKw)}`;
                        const emptyPayload = {
                            cache_key: emptyKey,
                            source: 'dandanplay',
                            method: request.method,
                            api_path: apiPath,
                            client_ip: clientIP,
                            query: { anime: normKw },
                            status: 200,
                            headers: { 'content-type': 'application/json' },
                            body: responseText,
                            is_empty: true,
                            ttl: EMPTY_CACHE_CONFIG.TTL_SECONDS,
                        };
                        const p = controlHubRpc(env, 'cache.upsert', emptyPayload, 3000)
                            .catch(e => console.log(`⚠️ [${clientIP}] 空结果负缓存上报失败: ${e.message}`));
                        if (ctx && ctx.waitUntil) ctx.waitUntil(p);
                        console.log(`🕳️ [${clientIP}] 空结果达阈值，已转负缓存: ${normKw}`);
                    } else {
                        console.log(`🧹 [${clientIP}] 空搜索结果计数中，未达阈值: ${normKw || apiPath}`);
                    }
                } else {
                    console.log(`🧹 [${clientIP}] 响应无有效数据或为失败响应，跳过缓存: ${apiPath}`);
                }
            } else {
            // 内存缓存：搜索/番剧/匹配/分集（match 用 fileName 专用键）
            const cacheKey = memCacheKey;
            memoryCache.apiCache.set(cacheKey, {
                data: responseText,
                timestamp: Date.now()
            });
            console.log(`📦 [${clientIP}] 内存缓存已存入: ${apiPath} (TTL: 2h)`);

            // 同时异步推送到本地端 cache.upsert（不阻塞响应；本地端做 429 兜底数据源）
            if (env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)) {
                // match(POST) 用 fileName 专用键与 query，其他 GET 用 URL query
                const localCacheKey = isMatchApi
                    ? matchCacheKeyOf()
                    : buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
                const upsertPayload = {
                    cache_key: localCacheKey,
                    source: 'dandanplay',
                    method: request.method,
                    api_path: apiPath,
                    client_ip: clientIP,
                    // match：缓存键只用 fileName，但完整请求参数(fileHash/fileSize/
                    // videoDuration/matchMode)一并保存，保留当初匹配上下文
                    query: isMatchApi
                        ? (matchPayloadObj || { fileName: matchFileName })
                        : Object.fromEntries(tUrlObj.searchParams.entries()),
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                    body: responseText,
                };
                // match 原始请求体也存入，供本地端 request_body_json 落库
                if (isMatchApi && matchBodyText !== null) {
                    upsertPayload.request_body = matchBodyText;
                }
                const upsertPromise = controlHubRpc(env, 'cache.upsert', upsertPayload, 3000)
                    .catch(e => console.log(`⚠️ [${clientIP}] cache.upsert 失败: ${e.message}`));
                if (ctx && ctx.waitUntil) ctx.waitUntil(upsertPromise);
            }
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
    if (isUpstreamRateLimited && env.CONTROL_HUB && shouldUseLocalCache(apiPath, request.method)
        && !(isMatchApi && !matchFileName)) {
        // match(POST) 用 fileName 专用键；其他 GET 用 query 键
        const localCacheKey = isMatchApi
            ? matchCacheKeyOf()
            : buildLocalCacheKey(request.method, apiPath, tUrlObj.searchParams);
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
            // 兜底缓存同样是整季，按原始集号裁剪后返回
            return new Response(narrowToEpisode(cached.body), {
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

    // 缓存写入已在上面用整季原文完成，这里只裁剪返回给客户端的副本。
    // Content-Length 若存在会与裁剪后长度不符，交给运行时重算
    const finalBody = narrowToEpisode(responseText);
    if (finalBody !== responseText) {
        responseHeaders.delete('Content-Length');
        responseHeaders.set('X-Episode-Extracted', strippedEpisode);
    }
    // 别名改写标记：本次回源用的是规范词而非客户端原词。
    // 排查「请求 A 却返回 B 的数据」时，看这个头就知道是别名表在起作用。
    if (aliasRewritten) {
        responseHeaders.set('X-Alias-Rewritten', encodeURIComponent(aliasRewritten.to));
    }

    return new Response(finalBody, {
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
                    forwardUa: k.forwardUa ? String(k.forwardUa) : '',
                });
            }
        } catch (e) {
            console.log(`⚠️ APP_KEY_POOL 解析失败，回退单密钥: ${e.message}`);
        }
    }
    // 兼容老配置：APP_ID + APP_SECRET / APP_SECRET_2（无授权 UA，进公共池）
    if (keys.length === 0 && env.APP_ID && env.APP_SECRET) {
        keys.push({ id: 'legacy_1', appId: env.APP_ID, appSecret: env.APP_SECRET, authUaKeys: [], forwardUa: '' });
        if (env.APP_SECRET_2) {
            keys.push({ id: 'legacy_2', appId: env.APP_ID, appSecret: env.APP_SECRET_2, authUaKeys: [], forwardUa: '' });
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
                forwardUa: k.forwardUa ? String(k.forwardUa) : '',
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

// ========================================
// 🔏 客户端请求签名校验
// ========================================
// 验证逻辑已抽到独立混淆模块 sign_verify.js（顶部 import），公开仓库不含细节。
// 调用见 verifyClientSignature(request, apiPath, signGroupId, signKeyPool)。

/**
 * IP 中间段打码，仅用于对外响应；服务端日志始终保留完整 IP 以便排查。
 * IPv4：保留首尾段     38.207.184.219            → 38.*.*.219
 * IPv6：保留首两组+末组 2001:db8:85a3::1319:7348  → 2001:db8:*:*:*:7348
 * 含端口 / IPv4-mapped / 无法识别的值一律走保守分支，不泄露中间信息。
 */
function maskIp(ip) {
    if (!ip || typeof ip !== 'string') return 'unknown';
    const raw = ip.trim();
    if (!raw || raw === 'unknown') return 'unknown';

    // X-Forwarded-For 可能是 "a, b, c"，只取第一跳（真实客户端）
    const first = raw.split(',')[0].trim();
    // 去掉 IPv6 字面量方括号与端口，如 [::1]:8080
    let addr = first.replace(/^\[/, '').replace(/\](:\d+)?$/, '');

    // IPv4（可能带端口 1.2.3.4:5678）
    const v4 = addr.split(':')[0];
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) {
        const p = v4.split('.');
        return `${p[0]}.*.*.${p[3]}`;
    }

    // IPv6：按组处理，:: 先展开成显式空组再打码
    if (addr.includes(':')) {
        const parts = addr.split(':');
        if (parts.length <= 3) return '*:*:*';          // 过短，无法安全保留
        const head = parts.slice(0, 2).join(':');
        const tail = parts[parts.length - 1] || '*';
        const midCount = Math.max(parts.length - 3, 1);
        return `${head}:${'*:'.repeat(midCount)}${tail}`;
    }

    return '*';  // 既非 v4 也非 v6，整体隐藏
}

// 新增：访问控制检查函数
// reqStartMs 由 handleRequest 传入（用于日志耗时统计），缺省则以当前时间兜底
// reqBodyText 为预读的请求体文本（用于限流日志记录请求体）
// clientUserId 为客户端 X-Ddd-User（用于限流日志记录用户标识）
// skipRateLimit：白名单 IP 免限流，但仍需识别 UA 以便后续身份校验（签名/用户标识）生效
async function checkAccess(request, targetApiPath, reqStartMs = Date.now(), reqBodyText = null, clientUserId = '', skipRateLimit = false) {
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
        // 白名单 IP 保留原有豁免：UA 不在配置里也放行（自有服务器可能用任意 UA）。
        // 无 uaConfig 意味着没有绑定任何组，身份校验本就不适用。
        if (skipRateLimit) {
            console.log(`⏭️ [${clientIP}] 白名单 IP，UA 未匹配也放行`);
            return { allowed: true, reason: 'ip_whitelisted_ua_unmatched' };
        }
        // uaName 供外层拼错误消息用：此处 UA 未匹配任何配置，没有名称可用，
        // 给固定占位，避免外层回退到原始 UA（原始 UA 含密钥片段）。
        return { allowed: false, reason: '禁止访问的UA', status: 403, uaName: '未识别' };
    }

    console.log(`✅ [${clientIP}] UA识别成功: ${uaConfig.type}`);
    console.log(`   - 匹配的UA配置: ${JSON.stringify(uaConfig)}`);
    // 0/-1 语义为无限制，直接输出原值避免 || 把 0 显示成 N/A 干扰排查
    console.log(`   - 最大请求数: ${uaConfig.maxRequests === undefined || uaConfig.maxRequests === null ? 'N/A' : uaConfig.maxRequests}`);
    console.log(`   - 时间窗口: ${uaConfig.windowMs || 'N/A'}ms`);

    // 2. 基于内存的频率限制（全局限制）
    // 白名单 IP 跳过限流，但前面的 UA 识别照常执行——身份校验(签名/用户标识)
    // 依赖返回的 uaConfig，不能因为免限流就把身份校验一起绕过。
    if (skipRateLimit) {
        console.log(`⏭️ [${clientIP}] 白名单 IP，跳过频率限制（身份校验仍生效）`);
        return { allowed: true, uaConfig, reason: 'ip_whitelisted' };
    }
    console.log(`🔄 [${clientIP}] 开始频率限制检查 (UA类型: ${uaConfig.type})`);
    const rateLimitCheck = checkMemoryRateLimit(clientIP, uaConfig.type, uaConfig);

    if (!rateLimitCheck.allowed) {
        console.log(`❌ [${clientIP}] 频率限制检查失败: ${rateLimitCheck.reason}`);
        // 记录频率限制日志
        addMemoryLog('warn', '频率限制触发', {
            ip: clientIP,
            userAgent,
            userId: clientUserId,
            uaType: uaConfig.type,
            reason: rateLimitCheck.reason,
            path: apiPath,
            durationMs: Date.now() - reqStartMs,
            requestBody: truncateBody(reqBodyText),
        });

        // 带上 uaConfig / uaName：外层错误消息要显示配置名称而非原始 UA，
        // 原始 UA 形如 "misaka10876/&7Y4c#4#"，后半段是校验密钥，不能对外回显。
        return {
            allowed: false, reason: rateLimitCheck.reason, status: 429,
            uaConfig, uaName: uaConfig.type
        };
    }

    console.log(`📊 [${clientIP}] 频率限制检查结果: 通过 (${rateLimitCheck.count}/${rateLimitCheck.limit})`);

    // 3. 路径特定限制检查（基于IP+UA类型+路径的组合限制）
    console.log(`🛣️ [${clientIP}] 开始路径特定限制检查`);
    if (uaConfig.pathSpecificLimits && Object.keys(uaConfig.pathSpecificLimits).length > 0) {
        console.log(`   - 路径特定限制配置: ${JSON.stringify(uaConfig.pathSpecificLimits)}`);
        for (const [pathPattern, pathLimit] of Object.entries(uaConfig.pathSpecificLimits)) {
            console.log(`   - 检查路径模式: ${pathPattern} (当前路径: ${apiPath})`);
            if (apiPath.includes(pathPattern)) {
                // 路径上限同样用显式判空取值：0 表示该路径不限，不能被 || 兜底成 50
                const pathHourly = pickLimitValue(pathLimit.maxRequestsPerHour);
                console.log(`   - 路径匹配! 应用路径特定限制: ${pathHourly === undefined || pathHourly === 0 || pathHourly === -1 ? '无限制' : pathHourly + '/小时'}`);
                // 使用IP+UA类型+路径的组合作为限制键，确保每个IP在每个UA类型下的每个路径都有独立的限制
                const pathRateLimitCheck = checkMemoryRateLimit(
                    clientIP,
                    `${uaConfig.type}-path-${pathPattern}`,
                    {
                        maxRequests: pathHourly,
                        windowMs: 60 * 60 * 1000 // 1小时窗口
                    }
                );

                if (!pathRateLimitCheck.allowed) {
                    console.log(`❌ [${clientIP}] 路径限制 [${pathPattern}]: 超限 (${pathRateLimitCheck.count}/${pathRateLimitCheck.limit})`);
                    addMemoryLog('warn', '路径特定频率限制触发', {
                        ip: clientIP,
                        userAgent,
                        userId: clientUserId,
                        uaType: uaConfig.type,
                        path: apiPath,
                        pathPattern: pathPattern,
                        reason: pathRateLimitCheck.reason,
                        pathLimit: pathLimit.maxRequestsPerHour,
                        currentCount: pathRateLimitCheck.count,
                        durationMs: Date.now() - reqStartMs,
                        requestBody: truncateBody(reqBodyText),
                    });

                    return {
                        allowed: false,
                        reason: `路径 ${pathPattern} 频率限制: ${pathRateLimitCheck.reason}`,
                        status: 429,
                        uaConfig, uaName: uaConfig.type
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
