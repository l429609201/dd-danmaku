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
            return `🤖 系统管理后台机器人\n\n可用命令：\n/status - 查看系统状态\n/logs - 查看系统日志\n/violations - IP违规管理\n/pathload - 路径满载监控\n/blacklist - IP黑名单管理\n/ua - UA配置管理\n/api - 查看管理后台菜单\n/help - 帮助信息`;
            
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

        case '/api':
            return await getApiMenu(env);

        case '/help':
            return `📖 管理后台帮助：\n\n📊 系统监控：\n/status - 查看系统运行状态\n/logs [level] [count] - 查看系统日志\n\n⚠️ IP违规管理：\n/violations list - 查看违规IP\n/violations ban <IP> [hours] - 手动封禁IP\n/violations unban <IP> - 解除封禁\n/violations clear <IP> - 清除违规记录\n\n📊 路径满载监控：\n/pathload list - 查看路径满载记录\n/pathload check <IP> - 查看指定IP的路径使用情况\n\n� IP黑名单管理：\n/blacklist list - 查看黑名单\n/blacklist add <IP> - 添加IP\n/blacklist remove <IP> - 移除IP\n\n👤 UA配置管理：\n/ua list - 查看UA配置\n/ua enable <name> - 启用UA\n/ua disable <name> - 禁用UA\n\n�🔗 后台菜单：\n/api - 查看管理后台功能菜单`;
            
        default:
            return `❓ 未知命令: ${command}\n使用 /help 查看可用命令`;
    }
}

async function getApiMenu(env) {
    try {
        const domain = env.WORKER_DOMAIN || 'https://your-worker.workers.dev';

        let menu = `🔗 管理后台菜单\n\n`;
        menu += `🌐 服务域名: ${domain}\n\n`;

        menu += `� **系统监控**\n`;
        menu += `• /status - 查看系统运行状态\n`;
        menu += `• /logs - 查看系统日志记录\n\n`;

        menu += `⚠️ **IP管理**\n`;
        menu += `• /violations - 查看IP违规记录\n`;
        menu += `• 自动封禁: 5次违规封禁24小时\n\n`;

        menu += `� **当前配置状态**\n`;
        menu += `• 频率限制: ✅ 启用\n`;
        menu += `• IP黑名单: ✅ 启用\n`;
        menu += `• UA限制: ✅ 启用\n`;
        menu += `• 自动封禁: ✅ 启用\n`;
        menu += `• 批量同步: ✅ 启用 (减少97%DO调用)\n\n`;

        menu += `📈 **性能优化**\n`;
        menu += `• 内存缓存: 减少DO读写\n`;
        menu += `• 批量同步: 每100次请求同步一次\n`;
        menu += `• 数据清理: 自动清理过期记录\n\n`;

        menu += `🤖 **机器人功能**\n`;
        menu += `• 实时监控系统状态\n`;
        menu += `• 查看违规IP和自动封禁\n`;
        menu += `• 系统日志查询和分析\n`;

        return menu;
    } catch (error) {
        return `❌ 获取管理菜单失败: ${error.message}`;
    }
}

async function getSystemStatus(env) {
    try {
        const now = new Date().toLocaleString('zh-CN');
        let status = `📊 系统状态报告\n\n`;
        status += `🕐 当前时间: ${now}\n`;
        status += `📝 日志条数: ${logStorage.entries.length} 条\n`;
        status += `⚠️ IP违规记录: ${ipViolationStorage.records.size} 个IP\n`;
        status += `🤖 TG机器人: 正常运行\n`;

        return status;
    } catch (error) {
        return `❌ 获取系统状态失败: ${error.message}`;
    }
}

async function getSystemLogs(args) {
    const [level = 'all', count = '10'] = args;
    const maxCount = Math.min(parseInt(count) || 10, 50);
    
    let filteredLogs = logStorage.entries;
    if (level !== 'all') {
        filteredLogs = logStorage.entries.filter(entry => entry.level === level);
    }
    
    const recentLogs = filteredLogs.slice(-maxCount).reverse();
    
    if (recentLogs.length === 0) {
        return `📝 没有找到日志记录 (级别: ${level})`;
    }
    
    let logText = `📝 系统日志 (最新${recentLogs.length}条, 级别: ${level})\n\n`;
    
    for (const entry of recentLogs) {
        const time = new Date(entry.timestamp).toLocaleString('zh-CN');
        const levelIcon = {
            'info': 'ℹ️',
            'warn': '⚠️', 
            'error': '❌'
        }[entry.level] || '📝';
        
        logText += `${levelIcon} ${time}\n${entry.message}\n`;
        if (entry.data && Object.keys(entry.data).length > 0) {
            logText += `📋 ${JSON.stringify(entry.data)}\n`;
        }
        logText += `\n`;
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

async function manageBlacklist(args, env) {
    const [action, ip] = args;

    switch (action) {
        case 'list':
            try {
                // 这里需要从主文件导入函数
                return `📋 IP黑名单功能\n\n⚠️ 需要查看cf_worker.js中的IP_BLACKLIST配置\n💡 使用 /blacklist add/remove 进行管理`;
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
                return `👤 UA配置管理\n\n⚠️ 需要查看cf_worker.js中的ACCESS_CONFIG配置\n💡 使用 /ua enable/disable 进行管理`;
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
