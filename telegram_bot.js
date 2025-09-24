// ========================================
// 🤖 Telegram机器人管理功能
// ========================================

// 日志存储配置
const LOG_RETENTION_HOURS = 24; // 保留24小时的日志
const MAX_LOG_ENTRIES = 1000; // 最多保留1000条日志

// 全局日志存储
let logStorage = {
    entries: [],
    lastCleanup: Date.now()
};

// IP违规记录存储
let ipViolationStorage = {
    violations: new Map(), // IP -> { count, firstViolation, lastViolation, banned, banExpiry }
    lastCleanup: Date.now()
};

// 自动封禁配置
const AUTO_BAN_CONFIG = {
    violationThreshold: 5, // 5次违规后自动封禁
    banDuration: 24 * 60 * 60 * 1000, // 封禁24小时
    violationWindow: 60 * 60 * 1000, // 1小时内的违规计数
    cleanupInterval: 60 * 60 * 1000 // 每小时清理一次过期记录
};

// 路径满载封禁配置
const PATH_OVERLOAD_BAN_CONFIG = {
    consecutiveHours: 6, // 连续6小时满载
    banDuration: 3 * 24 * 60 * 60 * 1000, // 封禁3天
    checkThreshold: 0.95 // 达到限制的95%视为满载
};

// IP路径满载记录存储
let pathOverloadStorage = {
    records: new Map(), // IP -> { pathHourlyRecords: Map<path, hourlyData[]> }
    lastCleanup: Date.now()
};

// 日志记录函数
export function logToBot(level, message, metadata = {}) {
    const entry = {
        timestamp: Date.now(),
        level: level, // 'info', 'warn', 'error', 'debug'
        message: message,
        metadata: metadata,
        id: Date.now() + Math.random().toString(36).substr(2, 9)
    };
    
    logStorage.entries.push(entry);
    
    // 限制日志数量
    if (logStorage.entries.length > MAX_LOG_ENTRIES) {
        logStorage.entries = logStorage.entries.slice(-MAX_LOG_ENTRIES);
    }
    
    // 定期清理过期日志和违规记录
    const now = Date.now();
    if (now - logStorage.lastCleanup > 60 * 60 * 1000) { // 每小时清理一次
        cleanupOldLogs();
        cleanupViolationRecords();
        cleanupPathOverloadRecords();
        logStorage.lastCleanup = now;
        ipViolationStorage.lastCleanup = now;
        pathOverloadStorage.lastCleanup = now;
    }
}

function cleanupOldLogs() {
    const cutoffTime = Date.now() - (LOG_RETENTION_HOURS * 60 * 60 * 1000);
    logStorage.entries = logStorage.entries.filter(entry => entry.timestamp > cutoffTime);
}

// IP违规记录函数
export function recordIpViolation(ip, violationType, metadata = {}) {
    const now = Date.now();

    if (!ipViolationStorage.violations.has(ip)) {
        ipViolationStorage.violations.set(ip, {
            count: 0,
            firstViolation: now,
            lastViolation: now,
            banned: false,
            banExpiry: null,
            violations: []
        });
    }

    const record = ipViolationStorage.violations.get(ip);

    // 清理过期的违规记录（只计算时间窗口内的违规）
    const windowStart = now - AUTO_BAN_CONFIG.violationWindow;
    record.violations = record.violations.filter(v => v.timestamp > windowStart);

    // 添加新的违规记录
    record.violations.push({
        timestamp: now,
        type: violationType,
        metadata: metadata
    });

    record.count = record.violations.length;
    record.lastViolation = now;

    // 检查是否需要自动封禁
    if (!record.banned && record.count >= AUTO_BAN_CONFIG.violationThreshold) {
        record.banned = true;
        record.banExpiry = now + AUTO_BAN_CONFIG.banDuration;

        logToBot('warn', `IP自动封禁`, {
            ip: ip,
            violationCount: record.count,
            banDuration: AUTO_BAN_CONFIG.banDuration / (60 * 60 * 1000) + '小时',
            violationType: violationType
        });

        return { autoBanned: true, banExpiry: record.banExpiry };
    }

    logToBot('info', `IP违规记录`, {
        ip: ip,
        violationType: violationType,
        currentCount: record.count,
        threshold: AUTO_BAN_CONFIG.violationThreshold,
        ...metadata
    });

    return { autoBanned: false, currentCount: record.count };
}

// 检查IP是否被临时封禁
export function isIpTempBanned(ip) {
    const record = ipViolationStorage.violations.get(ip);
    if (!record || !record.banned) return false;

    const now = Date.now();
    if (record.banExpiry && now > record.banExpiry) {
        // 封禁已过期，解除封禁
        record.banned = false;
        record.banExpiry = null;
        logToBot('info', `IP临时封禁已过期`, { ip: ip });
        return false;
    }

    return true;
}

// 清理过期的违规记录
function cleanupViolationRecords() {
    const now = Date.now();
    const cutoffTime = now - (24 * 60 * 60 * 1000); // 保留24小时的违规记录

    for (const [ip, record] of ipViolationStorage.violations.entries()) {
        // 清理过期的封禁
        if (record.banned && record.banExpiry && now > record.banExpiry) {
            record.banned = false;
            record.banExpiry = null;
        }

        // 清理过期的违规记录
        record.violations = record.violations.filter(v => v.timestamp > cutoffTime);
        record.count = record.violations.length;

        // 如果没有违规记录且未被封禁，删除整个记录
        if (record.violations.length === 0 && !record.banned) {
            ipViolationStorage.violations.delete(ip);
        }
    }
}

// 路径满载检测函数
export function checkPathOverload(ip, path, currentCount, pathLimit) {
    const now = Date.now();
    const currentHour = Math.floor(now / (60 * 60 * 1000));

    if (!pathOverloadStorage.records.has(ip)) {
        pathOverloadStorage.records.set(ip, {
            pathHourlyRecords: new Map()
        });
    }

    const ipRecord = pathOverloadStorage.records.get(ip);

    if (!ipRecord.pathHourlyRecords.has(path)) {
        ipRecord.pathHourlyRecords.set(path, []);
    }

    const pathRecords = ipRecord.pathHourlyRecords.get(path);

    // 清理过期的小时记录（保留最近24小时）
    const cutoffHour = currentHour - 24;
    const validRecords = pathRecords.filter(record => record.hour > cutoffHour);
    ipRecord.pathHourlyRecords.set(path, validRecords);

    // 查找或创建当前小时的记录
    let currentHourRecord = validRecords.find(record => record.hour === currentHour);
    if (!currentHourRecord) {
        currentHourRecord = {
            hour: currentHour,
            count: 0,
            limit: pathLimit,
            isOverloaded: false
        };
        validRecords.push(currentHourRecord);
    }

    // 更新当前小时的计数
    currentHourRecord.count = currentCount;
    currentHourRecord.limit = pathLimit;

    // 检查是否满载（达到限制的95%）
    const overloadThreshold = pathLimit * PATH_OVERLOAD_BAN_CONFIG.checkThreshold;
    currentHourRecord.isOverloaded = currentCount >= overloadThreshold;

    // 检查连续满载小时数
    const recentHours = validRecords
        .filter(record => record.hour > currentHour - PATH_OVERLOAD_BAN_CONFIG.consecutiveHours)
        .sort((a, b) => b.hour - a.hour);

    if (recentHours.length >= PATH_OVERLOAD_BAN_CONFIG.consecutiveHours) {
        const allOverloaded = recentHours
            .slice(0, PATH_OVERLOAD_BAN_CONFIG.consecutiveHours)
            .every(record => record.isOverloaded);

        if (allOverloaded) {
            // 触发路径满载封禁
            const banExpiry = now + PATH_OVERLOAD_BAN_CONFIG.banDuration;

            // 添加到违规记录中，标记为路径满载封禁
            if (!ipViolationStorage.violations.has(ip)) {
                ipViolationStorage.violations.set(ip, {
                    count: 0,
                    firstViolation: now,
                    lastViolation: now,
                    banned: false,
                    banExpiry: null,
                    violations: []
                });
            }

            const violationRecord = ipViolationStorage.violations.get(ip);
            violationRecord.banned = true;
            violationRecord.banExpiry = banExpiry;
            violationRecord.banReason = '路径满载';

            logToBot('error', `IP路径满载自动封禁`, {
                ip: ip,
                path: path,
                consecutiveHours: PATH_OVERLOAD_BAN_CONFIG.consecutiveHours,
                banDuration: PATH_OVERLOAD_BAN_CONFIG.banDuration / (24 * 60 * 60 * 1000) + '天',
                pathLimit: pathLimit,
                recentCounts: recentHours.slice(0, PATH_OVERLOAD_BAN_CONFIG.consecutiveHours).map(r => r.count)
            });

            return {
                shouldBan: true,
                banExpiry: banExpiry,
                reason: `连续${PATH_OVERLOAD_BAN_CONFIG.consecutiveHours}小时路径满载`
            };
        }
    }

    // 如果当前小时满载，记录警告
    if (currentHourRecord.isOverloaded) {
        const consecutiveCount = recentHours.filter(r => r.isOverloaded).length;

        logToBot('warn', `IP路径满载警告`, {
            ip: ip,
            path: path,
            currentCount: currentCount,
            pathLimit: pathLimit,
            consecutiveOverloadHours: consecutiveCount,
            threshold: PATH_OVERLOAD_BAN_CONFIG.consecutiveHours
        });
    }

    return { shouldBan: false };
}

// 清理路径满载记录
function cleanupPathOverloadRecords() {
    const now = Date.now();
    const cutoffTime = now - (7 * 24 * 60 * 60 * 1000); // 保留7天的记录
    const cutoffHour = Math.floor(cutoffTime / (60 * 60 * 1000));

    for (const [ip, record] of pathOverloadStorage.records.entries()) {
        for (const [path, pathRecords] of record.pathHourlyRecords.entries()) {
            const validRecords = pathRecords.filter(r => r.hour > cutoffHour);

            if (validRecords.length === 0) {
                record.pathHourlyRecords.delete(path);
            } else {
                record.pathHourlyRecords.set(path, validRecords);
            }
        }

        // 如果IP没有任何路径记录，删除整个IP记录
        if (record.pathHourlyRecords.size === 0) {
            pathOverloadStorage.records.delete(ip);
        }
    }
}

// TG机器人主处理函数
export async function handleTelegramWebhook(request, env) {
    // 记录TG机器人连接状态
    console.log('🤖 TG机器人Webhook被调用');
    console.log('📋 环境变量检查:');
    console.log('- TG_BOT_TOKEN:', env.TG_BOT_TOKEN ? '已设置 (长度: ' + env.TG_BOT_TOKEN.length + ')' : '❌ 未设置');
    console.log('- TG_ADMIN_USER_ID:', env.TG_ADMIN_USER_ID ? '已设置: ' + env.TG_ADMIN_USER_ID : '❌ 未设置');
    console.log('- WORKER_DOMAIN:', env.WORKER_DOMAIN ? '已设置: ' + env.WORKER_DOMAIN : '❌ 未设置');

    if (request.method !== 'POST') {
        console.log('❌ TG机器人连接失败: 请求方法不是POST');
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        // 安全地解析JSON
        let update;
        try {
            const requestText = await request.text();
            console.log('📝 收到请求体:', requestText);

            if (!requestText || requestText.trim() === '') {
                console.log('⚠️ 请求体为空，可能是测试请求');
                return new Response('TG Bot is working! Empty request body received.', { status: 200 });
            }

            update = JSON.parse(requestText);
            console.log('📨 收到TG更新:', JSON.stringify(update, null, 2));
        } catch (jsonError) {
            console.log('❌ JSON解析失败:', jsonError.message);
            return new Response('Invalid JSON: ' + jsonError.message, { status: 400 });
        }

        // 验证是否来自授权用户
        if (!isAuthorizedUser(update, env)) {
            console.log('❌ TG机器人连接失败: 用户未授权');
            console.log('- 发送用户ID:', update.message?.from?.id);
            console.log('- 授权用户ID:', env.TG_ADMIN_USER_ID);
            logToBot('warn', 'TG机器人收到未授权访问', { userId: update.message?.from?.id });
            return new Response('Unauthorized', { status: 403 });
        }

        const message = update.message;
        if (!message || !message.text) {
            console.log('📝 TG更新无消息内容，忽略');
            return new Response('OK');
        }

        const chatId = message.chat.id;
        const text = message.text.trim();
        const userId = message.from.id;
        const username = message.from.username || message.from.first_name;

        console.log('✅ TG机器人连接成功!');
        console.log('👤 用户信息:', { userId, username, chatId });
        console.log('💬 收到命令:', text);

        logToBot('info', `TG机器人收到命令: ${text}`, { userId, username });

        // 处理命令
        const response = await processCommand(text, env);

        // 发送回复
        if (response) {
            console.log('📤 准备发送回复，长度:', response.length);
            const sendResult = await sendTelegramMessage(chatId, response, env);
            if (sendResult.success) {
                console.log('✅ 回复发送成功');
            } else {
                console.log('❌ 回复发送失败:', sendResult.error);
            }
            logToBot('info', `TG机器人发送回复`, { chatId, responseLength: response.length, success: sendResult.success });
        }

        return new Response('OK');
    } catch (error) {
        console.log('❌ TG机器人连接失败: 处理异常');
        console.log('错误详情:', error.message);
        console.log('错误堆栈:', error.stack);
        logToBot('error', 'TG webhook处理失败', { error: error.message, stack: error.stack });
        return new Response('Error', { status: 500 });
    }
}

function isAuthorizedUser(update, env) {
    console.log('🔐 检查用户授权');

    if (!env.TG_ADMIN_USER_ID) {
        console.log('❌ 授权失败: TG_ADMIN_USER_ID 环境变量未设置');
        return false;
    }

    const userId = update.message?.from?.id;
    console.log('👤 请求用户ID:', userId);

    if (!userId) {
        console.log('❌ 授权失败: 无法获取用户ID');
        return false;
    }

    const adminIds = env.TG_ADMIN_USER_ID.split(',').map(id => parseInt(id.trim()));
    console.log('👥 授权用户ID列表:', adminIds);

    const isAuthorized = adminIds.includes(userId);
    console.log('🔐 授权结果:', isAuthorized ? '✅ 通过' : '❌ 拒绝');

    return isAuthorized;
}

async function processCommand(text, env) {
    const [command, ...args] = text.split(' ');
    
    switch (command.toLowerCase()) {
        case '/start':
            return `🤖 弹幕API管理机器人\n\n可用命令：\n/status - 查看系统状态\n/logs - 查看系统日志\n/webhook - Webhook管理\n/violations - IP违规管理\n/blacklist - IP黑名单管理\n/ua - UA配置管理\n/help - 帮助信息\n\n💡 首次使用请先运行 /webhook setup 设置Webhook`;
            
        case '/status':
            return await getSystemStatus(env);
            
        case '/logs':
            return await getSystemLogs(args);

        case '/violations':
            return await manageViolations(args, env);

        case '/pathload':
            return await managePathLoad(args, env);

        case '/blacklist':
            return await manageBlacklist(args, env);
            
        case '/ua':
            return await manageUA(args, env);
            
        case '/webhook':
            return await manageWebhook(args, env);

        case '/help':
            return `📖 命令帮助：\n\n📊 系统监控：\n/status - 查看系统状态\n/logs [level] [count] - 查看日志\n\n🔗 Webhook管理：\n/webhook setup - 自动设置Webhook\n/webhook info - 查看Webhook信息\n/webhook test - 测试Webhook连接\n/webhook delete - 删除Webhook\n\n⚠️ IP违规管理：\n/violations list - 查看违规IP\n/violations ban <IP> [hours] - 手动封禁IP\n/violations unban <IP> - 解除封禁\n/violations clear <IP> - 清除违规记录\n\n📊 路径满载监控：\n/pathload list - 查看路径满载记录\n/pathload check <IP> - 查看指定IP的路径使用情况\n\n🚫 IP黑名单管理：\n/blacklist list - 查看黑名单\n/blacklist add <IP> - 添加IP\n/blacklist remove <IP> - 移除IP\n\n👤 UA配置管理：\n/ua list - 查看UA配置\n/ua enable <name> - 启用UA\n/ua disable <name> - 禁用UA`;
            
        default:
            return `❓ 未知命令: ${command}\n使用 /help 查看可用命令`;
    }
}

async function getSystemStatus(env) {
    try {
        // 导入主文件的函数（需要在主文件中导出）
        const { getIpBlacklist, getAccessConfig, memoryCache } = await import('./cf_worker.js');
        
        const ipBlacklist = getIpBlacklist(env);
        const accessConfig = getAccessConfig(env);
        
        let status = `📊 系统状态报告\n\n`;
        status += `🚫 IP黑名单: ${ipBlacklist.length} 条规则\n`;
        status += `👤 UA配置: ${Object.keys(accessConfig.userAgentLimits).length} 个配置\n`;
        status += `📈 内存缓存: ${memoryCache.pendingRequests} 个待同步请求\n`;
        status += `🔄 AppSecret当前使用: Secret${memoryCache.appSecretUsage.current}\n`;
        status += `📅 最后同步时间: ${new Date(memoryCache.lastSyncTime).toLocaleString('zh-CN')}\n`;
        status += `📝 日志条数: ${logStorage.entries.length} 条\n`;
        status += `⚠️ 违规IP数: ${ipViolationStorage.violations.size} 个\n`;
        status += `📊 路径监控IP数: ${pathOverloadStorage.records.size} 个`;

        return status;
    } catch (error) {
        logToBot('error', '获取系统状态失败', { error: error.message });
        return `❌ 获取系统状态失败: ${error.message}`;
    }
}

async function getSystemLogs(args) {
    const [levelFilter, countStr] = args;
    const count = parseInt(countStr) || 20;
    const maxCount = Math.min(count, 50); // 限制最多50条
    
    let filteredLogs = logStorage.entries;
    
    // 按级别过滤
    if (levelFilter && ['info', 'warn', 'error', 'debug'].includes(levelFilter.toLowerCase())) {
        filteredLogs = filteredLogs.filter(log => log.level === levelFilter.toLowerCase());
    }
    
    // 获取最新的N条日志
    const recentLogs = filteredLogs.slice(-maxCount).reverse();
    
    if (recentLogs.length === 0) {
        return `📝 没有找到日志记录`;
    }
    
    let logText = `📝 系统日志 (最新${recentLogs.length}条${levelFilter ? `, 级别: ${levelFilter}` : ''})\n\n`;
    
    recentLogs.forEach(log => {
        const time = new Date(log.timestamp).toLocaleString('zh-CN');
        const levelEmoji = {
            'info': 'ℹ️',
            'warn': '⚠️', 
            'error': '❌',
            'debug': '🔍'
        }[log.level] || '📄';
        
        logText += `${levelEmoji} ${time}\n${log.message}\n`;
        
        if (log.metadata && Object.keys(log.metadata).length > 0) {
            logText += `📋 ${JSON.stringify(log.metadata, null, 2)}\n`;
        }
        
        logText += `\n`;
    });
    
    // 如果消息太长，截断
    if (logText.length > 4000) {
        logText = logText.substring(0, 3900) + '\n\n... (日志过长，已截断)';
    }
    
    return logText;
}

async function manageViolations(args, env) {
    const [action, ip, hours] = args;

    switch (action) {
        case 'list':
            if (ipViolationStorage.violations.size === 0) {
                return `📋 没有违规IP记录`;
            }

            let violationList = `⚠️ IP违规记录 (${ipViolationStorage.violations.size} 个):\n\n`;

            for (const [violationIp, record] of ipViolationStorage.violations.entries()) {
                const now = Date.now();
                const status = record.banned ?
                    (record.banExpiry && now < record.banExpiry ?
                        `🚫 已封禁 (${Math.ceil((record.banExpiry - now) / (60 * 60 * 1000))}小时后解封)` :
                        `🚫 已封禁`) :
                    `⚠️ 违规${record.count}次`;

                const lastViolation = new Date(record.lastViolation).toLocaleString('zh-CN');
                violationList += `${violationIp}\n${status}\n最后违规: ${lastViolation}\n\n`;
            }

            return violationList;

        case 'ban':
            if (!ip) return `❌ 请提供要封禁的IP地址`;

            const banHours = parseInt(hours) || 24;
            const banDuration = banHours * 60 * 60 * 1000;
            const banExpiry = Date.now() + banDuration;

            if (!ipViolationStorage.violations.has(ip)) {
                ipViolationStorage.violations.set(ip, {
                    count: 0,
                    firstViolation: Date.now(),
                    lastViolation: Date.now(),
                    banned: false,
                    banExpiry: null,
                    violations: []
                });
            }

            const record = ipViolationStorage.violations.get(ip);
            record.banned = true;
            record.banExpiry = banExpiry;

            logToBot('info', `管理员手动封禁IP`, { ip, banHours });
            return `✅ IP ${ip} 已封禁 ${banHours} 小时\n⏰ 解封时间: ${new Date(banExpiry).toLocaleString('zh-CN')}`;

        case 'unban':
            if (!ip) return `❌ 请提供要解封的IP地址`;

            const unbanRecord = ipViolationStorage.violations.get(ip);
            if (!unbanRecord || !unbanRecord.banned) {
                return `❌ IP ${ip} 未被封禁`;
            }

            unbanRecord.banned = false;
            unbanRecord.banExpiry = null;

            logToBot('info', `管理员手动解封IP`, { ip });
            return `✅ IP ${ip} 已解除封禁`;

        case 'clear':
            if (!ip) return `❌ 请提供要清除记录的IP地址`;

            if (ipViolationStorage.violations.has(ip)) {
                ipViolationStorage.violations.delete(ip);
                logToBot('info', `管理员清除IP违规记录`, { ip });
                return `✅ IP ${ip} 的违规记录已清除`;
            } else {
                return `❌ IP ${ip} 没有违规记录`;
            }

        default:
            return `❓ 未知操作: ${action}\n使用格式: /violations <list|ban|unban|clear> [IP] [hours]`;
    }
}

async function managePathLoad(args, env) {
    const [action, ip] = args;

    switch (action) {
        case 'list':
            if (pathOverloadStorage.records.size === 0) {
                return `📋 没有路径满载监控记录`;
            }

            let pathLoadList = `📊 路径满载监控 (${pathOverloadStorage.records.size} 个IP):\n\n`;

            for (const [monitorIp, record] of pathOverloadStorage.records.entries()) {
                pathLoadList += `🔍 ${monitorIp}\n`;

                for (const [path, pathRecords] of record.pathHourlyRecords.entries()) {
                    const recentRecords = pathRecords
                        .filter(r => r.hour > Math.floor(Date.now() / (60 * 60 * 1000)) - 24)
                        .sort((a, b) => b.hour - a.hour)
                        .slice(0, 6);

                    if (recentRecords.length > 0) {
                        const overloadCount = recentRecords.filter(r => r.isOverloaded).length;
                        const status = overloadCount >= PATH_OVERLOAD_BAN_CONFIG.consecutiveHours ?
                            '🚨 满载风险' :
                            overloadCount > 0 ? '⚠️ 部分满载' : '✅ 正常';

                        pathLoadList += `  ${path}: ${status}\n`;
                        pathLoadList += `  最近${recentRecords.length}小时: ${recentRecords.map(r =>
                            `${r.count}/${r.limit}${r.isOverloaded ? '🔴' : '🟢'}`
                        ).join(' ')}\n`;
                    }
                }
                pathLoadList += `\n`;
            }

            return pathLoadList;

        case 'check':
            if (!ip) return `❌ 请提供要查看的IP地址`;

            const ipRecord = pathOverloadStorage.records.get(ip);
            if (!ipRecord) {
                return `📋 IP ${ip} 没有路径满载监控记录`;
            }

            let ipDetail = `🔍 IP ${ip} 路径使用详情:\n\n`;

            for (const [path, pathRecords] of ipRecord.pathHourlyRecords.entries()) {
                const recentRecords = pathRecords
                    .filter(r => r.hour > Math.floor(Date.now() / (60 * 60 * 1000)) - 24)
                    .sort((a, b) => b.hour - a.hour);

                if (recentRecords.length > 0) {
                    const overloadHours = recentRecords.filter(r => r.isOverloaded).length;
                    const consecutiveOverload = recentRecords
                        .slice(0, PATH_OVERLOAD_BAN_CONFIG.consecutiveHours)
                        .every(r => r.isOverloaded);

                    ipDetail += `📍 路径: ${path}\n`;
                    ipDetail += `⏰ 满载小时数: ${overloadHours}/${recentRecords.length}\n`;
                    ipDetail += `🚨 连续满载风险: ${consecutiveOverload ? '是' : '否'}\n`;
                    ipDetail += `📊 最近24小时记录:\n`;

                    recentRecords.forEach(record => {
                        const hour = new Date(record.hour * 60 * 60 * 1000).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit'
                        });
                        const percentage = Math.round((record.count / record.limit) * 100);
                        ipDetail += `  ${hour}: ${record.count}/${record.limit} (${percentage}%) ${record.isOverloaded ? '🔴' : '🟢'}\n`;
                    });

                    ipDetail += `\n`;
                }
            }

            return ipDetail;

        default:
            return `❓ 未知操作: ${action}\n使用格式: /pathload <list|check> [IP]`;
    }
}

// 获取当前Worker域名
function getWorkerDomain(request) {
    // 从请求头中提取域名
    const host = request?.headers?.get('host');
    if (host) {
        return `https://${host}`;
    }

    // 如果无法从请求中获取，尝试从环境变量获取
    return null;
}

async function manageWebhook(args, env) {
    const [action] = args;

    if (!env.TG_BOT_TOKEN) {
        return `❌ TG_BOT_TOKEN 环境变量未设置`;
    }

    switch (action) {
        case 'setup':
            try {
                // 尝试从环境变量获取域名
                let workerDomain = env.WORKER_DOMAIN;

                console.log('🔧 Webhook设置开始');
                console.log('📋 WORKER_DOMAIN环境变量:', workerDomain || '❌ 未设置');

                if (!workerDomain) {
                    return `❌ 请设置 WORKER_DOMAIN 环境变量\n\n📝 设置方法：\n1. 进入Cloudflare Dashboard\n2. 找到Worker的环境变量设置\n3. 添加变量：\n   名称: WORKER_DOMAIN\n   值: https://your-worker.workers.dev\n   类型: 文本\n\n💡 你的Worker域名可以在部署日志中找到`;
                }

                // 确保域名格式正确
                if (!workerDomain.startsWith('http')) {
                    workerDomain = `https://${workerDomain}`;
                }

                const webhookUrl = `${workerDomain}/telegram-webhook`;
                console.log('🔗 准备设置Webhook URL:', webhookUrl);

                const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: webhookUrl,
                        allowed_updates: ['message']
                    })
                });

                const result = await response.json();
                console.log('📡 Telegram API响应:', JSON.stringify(result, null, 2));

                if (result.ok) {
                    logToBot('info', `Webhook设置成功`, { webhookUrl });
                    return `✅ Webhook设置成功！\n🔗 地址: ${webhookUrl}\n📝 现在可以正常使用机器人了\n\n🧪 测试方法：发送 /start 命令`;
                } else {
                    logToBot('error', `Webhook设置失败`, { error: result.description });
                    return `❌ Webhook设置失败: ${result.description}\n\n🔍 可能的原因：\n1. WORKER_DOMAIN设置错误\n2. TG_BOT_TOKEN无效\n3. 域名无法访问`;
                }
            } catch (error) {
                console.log('❌ Webhook设置异常:', error.message);
                logToBot('error', `Webhook设置异常`, { error: error.message });
                return `❌ Webhook设置异常: ${error.message}`;
            }

        case 'info':
            try {
                const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getWebhookInfo`);
                const result = await response.json();

                if (result.ok) {
                    const info = result.result;
                    let infoText = `🔗 Webhook信息:\n\n`;
                    infoText += `📍 URL: ${info.url || '未设置'}\n`;
                    infoText += `✅ 有效: ${info.has_custom_certificate ? '是' : '否'}\n`;
                    infoText += `📊 待处理更新: ${info.pending_update_count}\n`;

                    if (info.last_error_date) {
                        infoText += `❌ 最后错误: ${new Date(info.last_error_date * 1000).toLocaleString('zh-CN')}\n`;
                        infoText += `📝 错误信息: ${info.last_error_message}\n`;
                    }

                    if (info.max_connections) {
                        infoText += `🔗 最大连接数: ${info.max_connections}\n`;
                    }

                    return infoText;
                } else {
                    return `❌ 获取Webhook信息失败: ${result.description}`;
                }
            } catch (error) {
                return `❌ 获取Webhook信息异常: ${error.message}`;
            }

    case 'test':
        try {
            // 先获取当前Webhook信息
            const infoResponse = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getWebhookInfo`);
            const infoResult = await infoResponse.json();

            if (!infoResult.ok) {
                return `❌ 无法获取Webhook信息: ${infoResult.description}`;
            }

            const webhookInfo = infoResult.result;

            if (!webhookInfo.url) {
                return `❌ Webhook未设置\n💡 请先运行 /webhook setup`;
            }

            let testResult = `🧪 Webhook测试结果:\n\n`;
            testResult += `📍 当前URL: ${webhookInfo.url}\n`;
            testResult += `📊 待处理更新: ${webhookInfo.pending_update_count}\n`;

            // 检查是否有错误
            if (webhookInfo.last_error_date) {
                const errorDate = new Date(webhookInfo.last_error_date * 1000);
                testResult += `❌ 最后错误: ${errorDate.toLocaleString('zh-CN')}\n`;
                testResult += `📝 错误信息: ${webhookInfo.last_error_message}\n`;
                testResult += `\n🔍 可能的问题:\n`;
                testResult += `1. Worker域名设置错误\n`;
                testResult += `2. /telegram-webhook 路由不可访问\n`;
                testResult += `3. 环境变量配置问题\n`;
            } else {
                testResult += `✅ 无错误记录\n`;
            }

            // 测试Worker域名是否正确
            const expectedDomain = env.WORKER_DOMAIN;
            if (expectedDomain) {
                const expectedUrl = `${expectedDomain}/telegram-webhook`;
                if (webhookInfo.url === expectedUrl) {
                    testResult += `✅ Webhook URL匹配环境变量\n`;
                } else {
                    testResult += `⚠️ Webhook URL与环境变量不匹配\n`;
                    testResult += `   当前: ${webhookInfo.url}\n`;
                    testResult += `   期望: ${expectedUrl}\n`;
                }
            } else {
                testResult += `⚠️ WORKER_DOMAIN环境变量未设置\n`;
            }

            // 发送测试消息给自己
            testResult += `\n🔄 如果你能看到这条消息，说明Webhook工作正常！`;

            return testResult;

        } catch (error) {
            return `❌ Webhook测试异常: ${error.message}`;
        }

        case 'delete':
            try {
                const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/deleteWebhook`);
                const result = await response.json();

                if (result.ok) {
                    logToBot('info', `Webhook已删除`);
                    return `✅ Webhook已删除\n⚠️ 机器人将无法接收消息，直到重新设置Webhook`;
                } else {
                    return `❌ 删除Webhook失败: ${result.description}`;
                }
            } catch (error) {
                return `❌ 删除Webhook异常: ${error.message}`;
            }

        default:
            return `❓ 未知操作: ${action}\n使用格式: /webhook <setup|info|delete>`;
    }
}

async function manageBlacklist(args, env) {
    const [action, ip] = args;
    
    switch (action) {
        case 'list':
            try {
                const { getIpBlacklist } = await import('./cf_worker.js');
                const blacklist = getIpBlacklist(env);
                if (blacklist.length === 0) {
                    return `📋 IP黑名单为空`;
                }
                return `📋 IP黑名单 (${blacklist.length} 条):\n\n${blacklist.map((rule, i) => `${i+1}. ${JSON.stringify(rule)}`).join('\n')}`;
            } catch (error) {
                return `❌ 获取黑名单失败: ${error.message}`;
            }
            
        case 'add':
            if (!ip) return `❌ 请提供要添加的IP地址`;
            logToBot('info', `管理员请求添加IP到黑名单`, { ip });
            return `✅ IP ${ip} 已添加到黑名单\n⚠️ 注意：需要重新部署才能生效`;
            
        case 'remove':
            if (!ip) return `❌ 请提供要移除的IP地址`;
            logToBot('info', `管理员请求从黑名单移除IP`, { ip });
            return `✅ IP ${ip} 已从黑名单移除\n⚠️ 注意：需要重新部署才能生效`;
            
        default:
            return `❓ 未知操作: ${action}\n使用格式: /blacklist <list|add|remove> [IP]`;
    }
}

async function manageUA(args, env) {
    const [action, name] = args;
    
    switch (action) {
        case 'list':
            try {
                const { getAccessConfig } = await import('./cf_worker.js');
                const config = getAccessConfig(env);
                const uaList = Object.entries(config.userAgentLimits)
                    .map(([key, conf]) => `${conf.enabled ? '✅' : '❌'} ${key}: ${conf.description || 'N/A'}`)
                    .join('\n');
                return `👤 UA配置列表:\n\n${uaList}`;
            } catch (error) {
                return `❌ 获取UA配置失败: ${error.message}`;
            }
            
        case 'enable':
        case 'disable':
            if (!name) return `❌ 请提供UA配置名称`;
            logToBot('info', `管理员请求${action === 'enable' ? '启用' : '禁用'}UA配置`, { name });
            return `✅ UA配置 ${name} 已${action === 'enable' ? '启用' : '禁用'}\n⚠️ 注意：需要重新部署才能生效`;
            
        default:
            return `❓ 未知操作: ${action}\n使用格式: /ua <list|enable|disable> [name]`;
    }
}

async function sendTelegramMessage(chatId, text, env) {
    if (!env.TG_BOT_TOKEN) {
        console.log('❌ 发送消息失败: TG_BOT_TOKEN 环境变量未设置');
        logToBot('error', 'TG_BOT_TOKEN 环境变量未设置');
        return { success: false, error: 'TG_BOT_TOKEN 未设置' };
    }

    const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
    console.log('📡 发送消息到TG API:', url);

    try {
        const requestBody = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        };
        console.log('📋 请求体:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('📡 TG API响应状态:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.log('❌ TG API错误响应:', errorText);
            throw new Error(`TG API返回错误: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ TG API成功响应:', JSON.stringify(result, null, 2));
        return { success: true, result };

    } catch (error) {
        console.log('❌ 发送TG消息异常:', error.message);
        logToBot('error', '发送TG消息失败', { error: error.message, chatId });
        return { success: false, error: error.message };
    }
}
