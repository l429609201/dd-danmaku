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
    totalRequests: 0, // 总请求计数（不会重置）
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

// 初始化数据中心配置
async function initializeDataCenterConfig(env) {
    // 如果已经初始化过，直接返回
    if (DATA_CENTER_CONFIG.initialized) {
        return;
    }

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

        // 设置定时同步（每小时），避免重复设置
        if (!DATA_CENTER_CONFIG.syncTimer) {
            DATA_CENTER_CONFIG.syncTimer = setInterval(async () => {
                await syncConfigFromDataCenter();
                await syncStatsToDataCenter();
            }, DATA_CENTER_CONFIG.syncInterval);
        }
    } else {
        console.log('⚠️ 数据中心集成未启用（缺少URL或API密钥）');
    }

    // 标记为已初始化
    DATA_CENTER_CONFIG.initialized = true;
}

// 从数据中心恢复计数状态
async function restoreCountersFromDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    try {
        console.log('🔄 尝试从数据中心恢复计数状态...');

        const response = await fetch(`${DATA_CENTER_CONFIG.url}/worker-api/stats/restore`, {
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

// 向数据中心发送统计数据
async function syncStatsToDataCenter() {
    if (!DATA_CENTER_CONFIG.enabled) return;

    try {
        const stats = await getWorkerStats();

        console.log('📊 开始定时同步统计数据到数据中心...');
        console.log('📋 当前内存日志数量:', memoryCache.logs.length);
        console.log('🔑 使用API Key:', DATA_CENTER_CONFIG.apiKey ? `${DATA_CENTER_CONFIG.apiKey.substring(0, 8)}...` : '未设置');
        console.log('🎯 数据中心URL:', DATA_CENTER_CONFIG.url);

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
                },
                // 同时上报内存日志
                logs: memoryCache.logs.slice() // 发送日志副本
            })
        });

        if (response.ok) {
            const responseData = await response.json();
            console.log('📥 数据中心响应:', responseData);

            DATA_CENTER_CONFIG.lastStatsSync = Date.now();
            const logCount = memoryCache.logs.length;
            console.log(`✅ 统计数据、配置状态和日志同步成功 (${logCount}条日志)`);
            addMemoryLog('INFO', '定时同步成功', {
                data_center_url: DATA_CENTER_CONFIG.url,
                worker_id: DATA_CENTER_CONFIG.workerId,
                stats_count: Object.keys(stats).length,
                logs_count: logCount,
                response: responseData
            });

            // 同步成功后，清理已发送的日志（保留最近的一些日志）
            if (memoryCache.logs.length > 200) {
                memoryCache.logs = memoryCache.logs.slice(-100); // 保留最近100条
                console.log('🧹 已清理旧日志，保留最近100条');
            }
        } else {
            const errorText = await response.text();
            console.error('❌ 定时同步失败，HTTP状态:', response.status);
            console.error('❌ 错误详情:', errorText);
            addMemoryLog('ERROR', `定时同步失败: HTTP ${response.status}`, {
                data_center_url: DATA_CENTER_CONFIG.url,
                status: response.status,
                statusText: response.statusText,
                errorDetail: errorText,
                sync_type: 'scheduled',
                apiKey: DATA_CENTER_CONFIG.apiKey ? `${DATA_CENTER_CONFIG.apiKey.substring(0, 8)}...` : '未设置'
            });
        }
    } catch (error) {
        console.error('❌ 定时同步异常:', error);
        addMemoryLog('ERROR', `定时同步异常: ${error.message}`, {
            data_center_url: DATA_CENTER_CONFIG.url,
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
                ip_blacklist_count: (memoryCache.configCache.ipBlacklist || []).length,
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



export default {
  async fetch(request, env, ctx) {
    // 初始化数据中心配置
    await initializeDataCenterConfig(env);

    return await handleRequest(request, env, ctx);
  }
};


async function handleRequest(request, env, ctx) {
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

    // 频率限制检查已在accessCheck中完成，这里直接使用结果
    const rateLimitResult = { allowed: true }; // accessCheck已经通过，说明频率限制检查通过

    // 路径满载检查功能已移除

    if (!rateLimitResult.allowed) {
        const userAgent = request.headers.get('X-User-Agent') || '';
        const errorMessage = `频率限制：${rateLimitResult.reason} UA:${userAgent}`;
        console.log(`⚠️ [${clientIP}] ${errorMessage}`);

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

    // 检查是否需要同步到存储
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
                    console.log(`❌ [${clientIP}] 路径特定频率限制失败: ${pathRateLimitCheck.reason}`);
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
                console.log(`✅ [${clientIP}] 路径特定频率限制检查通过: ${pathRateLimitCheck.count}/${pathRateLimitCheck.limit}`);
                break; // 只检查第一个匹配的路径模式
            }
        }
    } else {
        console.log(`   - 无路径特定限制配置`);
    }



    console.log(`🎉 [${clientIP}] 访问控制检查全部通过!`);
    return { allowed: true, uaConfig: uaConfig, apiPath: apiPath };
}



// pemToArrayBuffer函数已移除（未使用）

// TG Webhook功能已移除





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

// 导出函数供TG机器人模块使用
export { getIpBlacklist, getAccessConfig, memoryCache };
