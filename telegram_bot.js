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

// 全局变量用于跟踪是否已设置命令菜单
let commandsInitialized = false;

// TG机器人主处理函数
export async function handleTelegramWebhook(request, env) {
    console.log('🤖 TG机器人Webhook被调用');
    console.log('📋 环境变量检查:');
    console.log('- TG_BOT_TOKEN:', env.TG_BOT_TOKEN ? '已设置 (长度: ' + env.TG_BOT_TOKEN.length + ')' : '❌ 未设置');
    console.log('- TG_ADMIN_USER_ID:', env.TG_ADMIN_USER_ID ? '已设置: ' + env.TG_ADMIN_USER_ID : '❌ 未设置');
    console.log('- WORKER_DOMAIN:', env.WORKER_DOMAIN ? '已设置: ' + env.WORKER_DOMAIN : '❌ 未设置');

    // 首次启动时设置机器人命令菜单
    if (!commandsInitialized && env.TG_BOT_TOKEN) {
        console.log('🔧 首次启动，设置机器人命令菜单...');
        const setupResult = await setupBotCommands(env);
        if (setupResult.success) {
            console.log('✅ 机器人命令菜单设置成功');
            commandsInitialized = true;
        } else {
            console.log('❌ 机器人命令菜单设置失败:', setupResult.error);
        }
    }

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

        // 处理内联键盘回调
        if (update.callback_query) {
            return await handleCallbackQuery(update.callback_query, env);
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
            // 检查响应是否包含内联键盘
            if (typeof response === 'object' && response.text) {
                console.log('📤 准备发送带键盘回复，长度:', response.text.length);
                const sendResult = await sendTelegramMessage(chatId, response.text, env, {
                    parse_mode: 'Markdown',
                    reply_markup: response.reply_markup
                });
                if (sendResult.success) {
                    console.log('✅ 带键盘回复发送成功');
                } else {
                    console.log('❌ 带键盘回复发送失败:', sendResult.error);
                }
                logToBot('info', `TG机器人发送带键盘回复`, { chatId, responseLength: response.text.length, success: sendResult.success });
            } else {
                console.log('📤 准备发送回复，长度:', response.length);
                const sendResult = await sendTelegramMessage(chatId, response, env);
                if (sendResult.success) {
                    console.log('✅ 回复发送成功');
                } else {
                    console.log('❌ 回复发送失败:', sendResult.error);
                }
                logToBot('info', `TG机器人发送回复`, { chatId, responseLength: response.length, success: sendResult.success });
            }
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
    
    // 支持消息和回调查询
    const userId = update.message?.from?.id || update.callback_query?.from?.id;
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
            return await getStartMessage(env);
            
        case '/status':
            return await getSystemStatus(env);
            
        case '/logs':
            return await getSystemLogs(args);

        case '/violations':
            if (args.length === 0) {
                return await showViolationsManagementInterface(env);
            } else {
                return await manageViolations(args, env);
            }



        case '/pathload':
            return await managePathLoad(args, env);

        case '/blacklist':
            return await showBlacklistManagementInterface(env);

        case '/ua':
            return await showUAManagementInterface(env);

        case '/menu':
            return await getMainMenu(env);

        case '/api':
            return await getApiMenu(env);

        case '/ua_add':
            return await addNewUAConfig(args, env);

        case '/ua_edit_ua':
            return await editUAString(args, env);

        case '/ua_edit_limit':
            return await editUALimit(args, env);

        case '/ua_edit_path':
            return await editUAPathLimit(args, env);

        case '/blacklist_add':
            return await addNewIPToBlacklist(args, env);

        case '/help':
            return `📖 管理后台帮助：\n\n📊 系统监控：\n/status - 查看系统运行状态\n/logs [level] [count] - 查看系统日志\n\n⚠️ IP违规管理：\n/violations list - 查看违规IP\n/violations ban [IP] [hours] - 手动封禁IP\n/violations unban [IP] - 解除封禁\n/violations clear [IP] - 清除违规记录\n\n📊 路径满载监控：\n/pathload list - 查看路径满载记录\n/pathload check [IP] - 查看指定IP的路径使用情况\n\n� IP黑名单管理：\n/blacklist list - 查看黑名单\n/blacklist add [IP] - 添加IP\n/blacklist remove [IP] - 移除IP\n\n👤 UA配置管理：\n/ua list - 查看UA配置\n/ua enable [name] - 启用UA\n/ua disable [name] - 禁用UA\n\n�🔗 后台菜单：\n/api - 查看管理后台功能菜单`;
            
        default:
            return `❓ 未知命令: ${command}\n使用 /help 查看可用命令`;
    }
}

async function getMainMenu(env) {
    try {
        const domain = env.WORKER_DOMAIN || 'https://your-worker.workers.dev';

        let menu = `🎛️ **系统管理控制台**\n\n`;
        menu += `🌐 服务域名: ${domain}\n\n`;
        menu += `请选择要执行的操作：`;

        // 创建内联键盘
        const keyboard = [
            // 系统监控行
            [
                {
                    text: '📊 系统状态',
                    callback_data: 'menu_status'
                },
                {
                    text: '📝 系统日志',
                    callback_data: 'menu_logs'
                }
            ],
            // 安全管理行
            [
                {
                    text: '⚠️ IP违规管理',
                    callback_data: 'menu_violations'
                },
                {
                    text: '🚫 IP黑名单',
                    callback_data: 'menu_blacklist'
                }
            ],
            [
                {
                    text: '👤 UA配置管理',
                    callback_data: 'menu_ua'
                },
                {
                    text: '📈 路径满载监控',
                    callback_data: 'menu_pathload'
                }
            ],
            // 系统信息行
            [
                {
                    text: '🔧 详细配置信息',
                    callback_data: 'menu_api'
                },
                {
                    text: '📖 命令帮助',
                    callback_data: 'menu_help'
                }
            ],
            // 刷新按钮
            [
                {
                    text: '🔄 刷新菜单',
                    callback_data: 'menu_refresh'
                }
            ]
        ];

        return {
            text: menu,
            reply_markup: {
                inline_keyboard: keyboard
            }
        };
    } catch (error) {
        return `❌ 获取主菜单失败: ${error.message}`;
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
        status += `⚠️ IP违规记录: ${ipViolationStorage.violations.size} 个IP\n`;
        status += `📊 路径监控IP数: ${pathOverloadStorage.records.size} 个\n`;
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

    if (!action) {
        return `⚠️ IP违规管理\n\n当前违规记录: ${ipViolationStorage.violations.size} 个IP\n\n📋 可用操作：\n• /violations list - 查看违规IP列表\n• /violations ban [IP] [hours] - 手动封禁IP\n• /violations unban [IP] - 解除IP封禁\n• /violations clear [IP] - 清除违规记录`;
    }

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
            if (!ip) return `🚫 **手动封禁IP**\n\n请使用以下格式封禁IP：\n\`/violations ban [IP地址] [小时数]\`\n\n📝 **示例:**\n• \`/violations ban 192.168.1.100 24\` - 封禁24小时\n• \`/violations ban 10.0.0.1 12\` - 封禁12小时\n\n💡 **说明:**\n• 小时数可选，默认24小时\n• 封禁后立即生效\n• 可使用 /violations unban 解除封禁`;

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
            if (!ip) return `✅ **解除IP封禁**\n\n请使用以下格式解除封禁：\n\`/violations unban [IP地址]\`\n\n📝 **示例:**\n• \`/violations unban 192.168.1.100\`\n• \`/violations unban 10.0.0.1\`\n\n💡 **说明:**\n• 解除封禁后立即生效\n• 可使用 /violations list 查看当前封禁列表`;

            const unbanRecord = ipViolationStorage.violations.get(ip);
            if (!unbanRecord || !unbanRecord.banned) {
                return `❌ IP ${ip} 未被封禁`;
            }

            unbanRecord.banned = false;
            unbanRecord.banExpiry = null;

            logToBot('info', `管理员手动解封IP`, { ip });
            return `✅ IP ${ip} 已解除封禁`;

        case 'clear':
            if (!ip) return `🗑️ **清除违规记录**\n\n请使用以下格式清除记录：\n\`/violations clear [IP地址]\`\n\n📝 **示例:**\n• \`/violations clear 192.168.1.100\`\n• \`/violations clear 10.0.0.1\`\n\n💡 **说明:**\n• 清除该IP的所有违规记录\n• 不会解除当前封禁状态\n• 如需解除封禁请使用 /violations unban`;

            if (ipViolationStorage.violations.has(ip)) {
                ipViolationStorage.violations.delete(ip);
                logToBot('info', `管理员清除IP违规记录`, { ip });
                return `✅ IP ${ip} 的违规记录已清除`;
            } else {
                return `❌ IP ${ip} 没有违规记录`;
            }

        default:
            return `❓ 未知操作: ${action}\n使用格式: /violations [list|ban|unban|clear] [IP] [hours]`;
    }
}

async function managePathLoad(args, env) {
    const [action, ip] = args;

    if (!action) {
        return `📊 路径满载监控\n\n当前监控IP数: ${pathOverloadStorage.records.size} 个\n\n📋 可用操作：\n• /pathload list - 查看路径满载记录\n• /pathload check [IP] - 查看指定IP的路径使用情况\n\n💡 系统会自动监控API路径使用情况，连续6小时满载将自动封禁3天`;
    }

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
            return `❓ 未知操作: ${action}\n使用格式: /pathload [list|check] [IP]`;
    }
}

async function manageBlacklist(args, env) {
    const [action, ip] = args;

    if (!action) {
        return `🚫 IP黑名单管理\n\n📋 可用操作：\n• /blacklist list - 查看当前黑名单\n• /blacklist add [IP] - 添加IP到黑名单\n• /blacklist remove [IP] - 从黑名单移除IP\n\n⚠️ 注意：黑名单修改需要重新部署才能生效\n💡 黑名单配置存储在cf_worker.js的IP_BLACKLIST中`;
    }

    switch (action) {
        case 'list':
            try {
                const blacklist = getIpBlacklistFromEnv(env);
                if (blacklist.length === 0) {
                    return `� IP黑名单列表：\n\n暂无黑名单记录\n\n💡 使用 /blacklist add [IP] 添加IP到黑名单`;
                }

                let result = `🚫 IP黑名单列表 (${blacklist.length}个)：\n\n`;
                blacklist.forEach((ip, index) => {
                    result += `${index + 1}. ${ip}\n`;
                });
                result += `\n💡 使用 /blacklist add [IP] 添加新IP\n💡 使用 /blacklist remove [IP] 移除IP`;
                return result;
            } catch (error) {
                return `❌ 获取黑名单失败: ${error.message}`;
            }

        case 'add':
            if (!ip) return `❌ 请提供要添加的IP地址`;
            try {
                const result = await addIpToBlacklist(ip, env);
                logToBot('info', `管理员添加IP到黑名单`, { ip, success: result.success });
                return result.success ?
                    `✅ IP ${ip} 已添加到黑名单\n⚠️ 注意：需要重新部署才能生效\n\n当前黑名单: ${result.blacklist.join(', ')}` :
                    `❌ 添加失败: ${result.error}`;
            } catch (error) {
                return `❌ 添加IP到黑名单失败: ${error.message}`;
            }

        case 'remove':
            if (!ip) return `❌ 请提供要移除的IP地址`;
            try {
                const result = await removeIpFromBlacklist(ip, env);
                logToBot('info', `管理员从黑名单移除IP`, { ip, success: result.success });
                return result.success ?
                    `✅ IP ${ip} 已从黑名单移除\n⚠️ 注意：需要重新部署才能生效\n\n当前黑名单: ${result.blacklist.join(', ') || '(空)'}` :
                    `❌ 移除失败: ${result.error}`;
            } catch (error) {
                return `❌ 从黑名单移除IP失败: ${error.message}`;
            }

        default:
            return `❓ 未知操作: ${action}\n使用格式: /blacklist [list|add|remove] [IP]`;
    }
}

async function manageUA(args, env) {
    const [action, name] = args;

    if (!action) {
        return `👤 UA配置管理\n\n📋 可用操作：\n• /ua list - 查看当前UA配置\n• /ua enable [name] - 启用指定UA配置\n• /ua disable [name] - 禁用指定UA配置\n\n⚠️ 注意：UA配置修改需要重新部署才能生效\n💡 UA配置存储在cf_worker.js的ACCESS_CONFIG中`;
    }

    switch (action) {
        case 'list':
            try {
                const uaLimits = getUserAgentLimitsFromEnv(env);
                const uaKeys = Object.keys(uaLimits);

                if (uaKeys.length === 0) {
                    return `👤 UA配置列表：\n\n暂无UA配置记录\n\n💡 使用 /ua enable/disable [name] 管理UA配置`;
                }

                let result = `👤 UA配置列表 (${uaKeys.length}个)：\n\n`;
                uaKeys.forEach((key, index) => {
                    const config = uaLimits[key];
                    const status = config.enabled !== false ? '✅' : '❌';
                    const userAgent = config.userAgent || 'N/A';
                    result += `${index + 1}. ${status} ${key}: ${userAgent}\n`;
                });
                result += `\n💡 使用 /ua enable [name] 启用配置\n💡 使用 /ua disable [name] 禁用配置`;
                return result;
            } catch (error) {
                return `❌ 获取UA配置失败: ${error.message}`;
            }

        case 'enable':
            if (!name) return `❌ 请提供要启用的UA配置名称`;
            try {
                const result = await enableUAConfig(name, env);
                return result.success ?
                    `✅ UA配置 ${name} 已启用\n⚠️ 注意：需要重新部署才能生效\n\n💡 请查看日志获取具体的环境变量更新指令` :
                    `❌ 启用失败: ${result.error}`;
            } catch (error) {
                return `❌ 启用UA配置失败: ${error.message}`;
            }

        case 'disable':
            if (!name) return `❌ 请提供要禁用的UA配置名称`;
            try {
                const result = await disableUAConfig(name, env);
                return result.success ?
                    `✅ UA配置 ${name} 已禁用\n⚠️ 注意：需要重新部署才能生效\n\n💡 请查看日志获取具体的环境变量更新指令` :
                    `❌ 禁用失败: ${result.error}`;
            } catch (error) {
                return `❌ 禁用UA配置失败: ${error.message}`;
            }

        default:
            return `❓ 未知操作: ${action}\n使用格式: /ua [list|enable|disable] [name]`;
    }
}

async function getStartMessage(env) {
    const domain = env.WORKER_DOMAIN || 'https://your-worker.workers.dev';

    let message = `🤖 **dandanplay跨域代理管理机器人**\n\n`;
    message += `🌐 服务域名: ${domain}\n\n`;
    message += `📋 **主要功能**\n`;
    message += `📊 系统监控 - 实时查看系统状态和日志\n`;
    message += `⚠️ IP管理 - 违规记录和自动封禁管理\n`;
    message += `📈 性能监控 - 路径满载检测和优化\n`;
    message += `🛡️ 安全配置 - 黑名单和UA限制管理\n\n`;
    message += `🔧 专业的系统管理和监控工具\n\n`;
    message += `点击下方按钮开始使用：`;

    // 创建快速开始内联键盘
    const keyboard = [
        [
            {
                text: '📋 功能菜单',
                callback_data: 'menu_refresh'
            },
            {
                text: '📊 系统状态',
                callback_data: 'menu_status'
            }
        ],
        [
            {
                text: '📖 使用帮助',
                callback_data: 'menu_help'
            }
        ]
    ];

    return {
        text: message,
        reply_markup: {
            inline_keyboard: keyboard
        }
    };
}

async function setupBotCommands(env) {
    if (!env.TG_BOT_TOKEN) {
        return { success: false, error: 'TG_BOT_TOKEN 未设置' };
    }

    const commands = [
        { command: 'start', description: '🏠 开始使用机器人' },
        { command: 'menu', description: '📋 显示功能菜单' },
        { command: 'status', description: '📊 查看系统状态' },
        { command: 'logs', description: '📝 查看系统日志' },
        { command: 'violations', description: '⚠️ IP违规管理' },
        { command: 'pathload', description: '📈 路径满载监控' },
        { command: 'blacklist', description: '🚫 IP黑名单管理' },
        { command: 'ua', description: '👤 UA配置管理' },
        { command: 'api', description: '🔗 管理后台菜单' },
        { command: 'help', description: '❓ 帮助信息' }
    ];

    try {
        const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commands })
        });

        const result = await response.json();
        if (result.ok) {
            logToBot('info', 'TG机器人命令菜单设置成功', { commandCount: commands.length });
            return { success: true, result };
        } else {
            logToBot('error', 'TG机器人命令菜单设置失败', { error: result.description });
            return { success: false, error: result.description };
        }
    } catch (error) {
        logToBot('error', 'TG机器人命令菜单设置异常', { error: error.message });
        return { success: false, error: error.message };
    }
}

async function sendTelegramMessage(chatId, text, env, options = {}) {
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
            ...options
        };

        // 如果有内联键盘，添加到请求体中
        if (options.reply_markup) {
            requestBody.reply_markup = options.reply_markup;
        }

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

// 配置管理辅助函数
function getIpBlacklistFromEnv(env) {
    if (!env.IP_BLACKLIST_CONFIG) {
        return [];
    }

    try {
        return JSON.parse(env.IP_BLACKLIST_CONFIG);
    } catch (error) {
        console.error('解析IP黑名单配置失败:', error);
        return [];
    }
}

function getUserAgentLimitsFromEnv(env) {
    if (!env.USER_AGENT_LIMITS_CONFIG) {
        return {};
    }

    try {
        const limits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
        // 过滤出启用的客户端
        const enabledLimits = {};
        Object.keys(limits).forEach(key => {
            const config = limits[key];
            if (config && config.enabled !== false) {
                enabledLimits[key] = config;
            }
        });
        return enabledLimits;
    } catch (error) {
        console.error('解析UA配置失败:', error);
        return {};
    }
}

// 获取所有UA配置（包括禁用的）
function getAllUserAgentLimitsFromEnv(env) {
    if (!env.USER_AGENT_LIMITS_CONFIG) {
        return {};
    }

    try {
        return JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
    } catch (error) {
        console.error('解析UA限制配置失败:', error);
        return {};
    }
}

// 获取启用的UA配置（兼容旧版本）
function getUserAgentLimitsFromEnv(env) {
    if (!env.USER_AGENT_LIMITS_CONFIG) {
        return {};
    }

    try {
        const limits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG);
        // 过滤出启用的客户端
        const enabledLimits = {};
        Object.keys(limits).forEach(key => {
            const config = limits[key];
            if (config && config.enabled !== false) {
                enabledLimits[key] = config;
            }
        });
        return enabledLimits;
    } catch (error) {
        console.error('解析UA配置失败:', error);
        return {};
    }
}

async function addIpToBlacklist(ip, env) {
    try {
        const currentBlacklist = getIpBlacklistFromEnv(env);

        if (currentBlacklist.includes(ip)) {
            return { success: false, error: 'IP已在黑名单中' };
        }

        const newBlacklist = [...currentBlacklist, ip];

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'IP_BLACKLIST_CONFIG', JSON.stringify(newBlacklist));

        logToBot('info', 'IP黑名单添加请求', {
            ip,
            action: 'add',
            cloudflareResult: updateResult,
            newConfig: JSON.stringify(newBlacklist)
        });

        return {
            success: updateResult.success,
            blacklist: newBlacklist,
            message: updateResult.success ? '已通过Cloudflare API更新' : updateResult.error
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function removeIpFromBlacklist(ip, env) {
    try {
        const currentBlacklist = getIpBlacklistFromEnv(env);

        if (!currentBlacklist.includes(ip)) {
            return { success: false, error: 'IP不在黑名单中' };
        }

        const newBlacklist = currentBlacklist.filter(item => item !== ip);

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'IP_BLACKLIST_CONFIG', JSON.stringify(newBlacklist));

        logToBot('info', 'IP黑名单移除请求', {
            ip,
            action: 'remove',
            cloudflareResult: updateResult,
            newConfig: JSON.stringify(newBlacklist)
        });

        return {
            success: updateResult.success,
            blacklist: newBlacklist,
            message: updateResult.success ? '已通过Cloudflare API更新' : updateResult.error
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function enableUAConfig(name, env) {
    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return { success: false, error: 'UA配置不存在' };
        }

        currentLimits[name].enabled = true;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA配置启用请求', {
            name,
            action: 'enable',
            cloudflareResult: updateResult,
            newConfig: JSON.stringify(currentLimits)
        });

        return {
            success: updateResult.success,
            message: updateResult.success ? '已通过Cloudflare API更新' : updateResult.error
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function disableUAConfig(name, env) {
    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return { success: false, error: 'UA配置不存在' };
        }

        currentLimits[name].enabled = false;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA配置禁用请求', {
            name,
            action: 'disable',
            cloudflareResult: updateResult,
            newConfig: JSON.stringify(currentLimits)
        });

        return {
            success: updateResult.success,
            message: updateResult.success ? '已通过Cloudflare API更新' : updateResult.error
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Cloudflare API调用函数
async function updateCloudflareEnvVar(env, varName, varValue) {
    try {
        // 需要的环境变量
        if (!env.CLOUDFLARE_API_TOKEN) {
            return { success: false, error: 'CLOUDFLARE_API_TOKEN 环境变量未设置' };
        }

        if (!env.CLOUDFLARE_ACCOUNT_ID) {
            return { success: false, error: 'CLOUDFLARE_ACCOUNT_ID 环境变量未设置' };
        }

        if (!env.CLOUDFLARE_WORKER_NAME) {
            return { success: false, error: 'CLOUDFLARE_WORKER_NAME 环境变量未设置' };
        }

        const accountId = env.CLOUDFLARE_ACCOUNT_ID;
        const workerName = env.CLOUDFLARE_WORKER_NAME;
        const apiToken = env.CLOUDFLARE_API_TOKEN;

        // 1. 首先获取当前的环境变量
        const getUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`;

        const getResponse = await fetch(getUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!getResponse.ok) {
            const errorText = await getResponse.text();
            return { success: false, error: `获取当前环境变量失败: ${getResponse.status} - ${errorText}` };
        }

        const currentSettings = await getResponse.json();
        const currentEnvVars = currentSettings.result?.bindings?.filter(b => b.type === 'plain_text') || [];

        // 2. 更新或添加指定的环境变量
        const updatedEnvVars = currentEnvVars.filter(v => v.name !== varName);
        updatedEnvVars.push({
            type: 'plain_text',
            name: varName,
            text: varValue
        });

        // 3. 保留其他类型的绑定（如DO绑定）
        const otherBindings = currentSettings.result?.bindings?.filter(b => b.type !== 'plain_text') || [];
        const allBindings = [...updatedEnvVars, ...otherBindings];

        // 4. 更新环境变量
        const updateUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`;

        const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bindings: allBindings
            })
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            return { success: false, error: `更新环境变量失败: ${updateResponse.status} - ${errorText}` };
        }

        const updateResult = await updateResponse.json();

        logToBot('info', 'Cloudflare API环境变量更新成功', {
            varName,
            accountId,
            workerName,
            result: updateResult.success
        });

        return {
            success: true,
            message: `环境变量 ${varName} 已通过Cloudflare API更新`,
            result: updateResult
        };

    } catch (error) {
        logToBot('error', 'Cloudflare API调用异常', {
            varName,
            error: error.message
        });
        return { success: false, error: `Cloudflare API调用失败: ${error.message}` };
    }
}

// UA管理界面
async function showUAManagementInterface(env) {
    try {
        console.log('🔧 开始获取UA配置...');
        console.log('📋 环境变量USER_AGENT_LIMITS_CONFIG:', env.USER_AGENT_LIMITS_CONFIG);

        const uaLimits = getAllUserAgentLimitsFromEnv(env);
        console.log('📋 解析后的UA配置:', uaLimits);

        const uaKeys = Object.keys(uaLimits);
        console.log('📋 UA配置键列表:', uaKeys);

        let message = `👤 UA配置管理\n\n`;

        if (uaKeys.length === 0) {
            message += `暂无UA配置\n\n`;
        } else {
            message += `当前配置 (${uaKeys.length}个)：\n\n`;
            uaKeys.forEach((key, index) => {
                const config = uaLimits[key];
                const status = config.enabled !== false ? '✅' : '❌';
                const userAgent = config.userAgent || 'N/A';
                message += `${index + 1}. ${status} **${key}**\n`;
                message += `   UA: \`${userAgent}\`\n`;
                message += `   限制: ${config.hourlyLimit || 'N/A'}/小时\n`;

                // 显示路径特定限制
                if (config.pathSpecificLimits && Object.keys(config.pathSpecificLimits).length > 0) {
                    Object.entries(config.pathSpecificLimits).forEach(([path, limit]) => {
                        message += `   - 路径 \`${path}\`: ${limit}/小时\n`;
                    });
                }
                message += `\n`;
            });
        }

        // 创建内联键盘
        const keyboard = [];

        // 为每个UA配置创建按钮行（使用配置名称）
        uaKeys.forEach((key, index) => {
            const config = uaLimits[key];
            const isEnabled = config.enabled !== false;
            const num = index + 1;

            const row = [
                {
                    text: isEnabled ? `❌ 禁用 ${num}` : `✅ 启用 ${num}`,
                    callback_data: `ua_toggle_${key}`
                },
                {
                    text: `✏️ 编辑 ${num}`,
                    callback_data: `ua_edit_${key}`
                },
                {
                    text: `🗑️ 删除 ${num}`,
                    callback_data: `ua_delete_${key}`
                }
            ];
            keyboard.push(row);
        });

        // 添加管理按钮
        keyboard.push([
            {
                text: '➕ 添加新UA',
                callback_data: 'ua_add_new'
            },
            {
                text: '🔄 刷新列表',
                callback_data: 'ua_refresh'
            }
        ]);

        return {
            text: message,
            reply_markup: {
                inline_keyboard: keyboard
            }
        };

    } catch (error) {
        console.error('❌ showUAManagementInterface异常:', error);
        console.error('❌ 异常堆栈:', error.stack);
        return `❌ 获取UA配置失败: ${error.message}`;
    }
}

// IP黑名单管理界面
async function showBlacklistManagementInterface(env) {
    try {
        const blacklist = getIpBlacklistFromEnv(env);

        let message = `🚫 IP黑名单管理\n\n`;

        if (blacklist.length === 0) {
            message += `暂无黑名单记录\n\n`;
        } else {
            message += `当前黑名单 (${blacklist.length}个)：\n\n`;
            blacklist.forEach((ip, index) => {
                message += `${index + 1}. \`${ip}\`\n`;
            });
            message += `\n`;
        }

        // 创建内联键盘
        const keyboard = [];

        // 为每个IP创建按钮行（限制显示数量避免消息过长，使用索引参数）
        const displayLimit = 10;
        blacklist.slice(0, displayLimit).forEach((ip, index) => {
            const num = index + 1;
            const row = [
                {
                    text: `🗑️ 移除 ${num}`,
                    callback_data: `blacklist_remove_${index}`
                },
                {
                    text: `📊 详情 ${num}`,
                    callback_data: `blacklist_info_${index}`
                }
            ];
            keyboard.push(row);
        });

        if (blacklist.length > displayLimit) {
            keyboard.push([{
                text: `📋 查看全部 (${blacklist.length}个)`,
                callback_data: 'blacklist_show_all'
            }]);
        }

        // 添加管理按钮
        keyboard.push([
            {
                text: '➕ 添加IP',
                callback_data: 'blacklist_add_'
            },
            {
                text: '🔄 刷新列表',
                callback_data: 'blacklist_refresh_'
            }
        ]);

        return {
            text: message,
            reply_markup: {
                inline_keyboard: keyboard
            }
        };

    } catch (error) {
        return `❌ 获取黑名单失败: ${error.message}`;
    }
}

// 处理内联键盘回调
async function handleCallbackQuery(callbackQuery, env) {
    // 验证授权
    if (!isAuthorizedUser({ callback_query: callbackQuery }, env)) {
        console.log('❌ 回调查询用户未授权');
        await answerCallbackQuery(callbackQuery.id, '未授权访问', env);
        return new Response('Unauthorized', { status: 403 });
    }

    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const callbackData = callbackQuery.data;
    const userId = callbackQuery.from.id;

    console.log('🔘 收到回调查询:', callbackData);
    console.log('👤 回调用户ID:', userId);
    console.log('💬 回调聊天ID:', chatId);
    console.log('📋 完整回调查询对象:', JSON.stringify(callbackQuery, null, 2));
    logToBot('info', 'TG机器人收到回调查询', { callbackData, userId, chatId });

    try {
        let response = '';
        let newKeyboard = null;

        console.log('🔍 开始解析回调数据:', callbackData);

        // 解析回调数据
        const parts = callbackData.split('_');
        console.log('🔍 分割结果:', parts);

        const action = parts[0];
        const operation = parts[1];
        const target = parts.slice(2).join('_') || ''; // 支持包含下划线的目标名称，允许为空

        console.log('🔍 回调数据解析:', { callbackData, parts, action, operation, target });

        if (action === 'ua') {
            console.log('🔧 处理UA回调:', { operation, target });

            if (operation === 'refresh') {
                const uaInterface = await showUAManagementInterface(env);
                response = uaInterface.text;
                newKeyboard = uaInterface.reply_markup;
            } else if (operation === 'toggle') {
                // 处理启用/禁用操作
                const index = parseInt(target);
                const uaLimits = getAllUserAgentLimitsFromEnv(env);
                const uaKeys = Object.keys(uaLimits);

                if (index >= 0 && index < uaKeys.length) {
                    const key = uaKeys[index];
                    const config = uaLimits[key];
                    config.enabled = !config.enabled;

                    // 更新配置
                    const result = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(uaLimits));

                    if (result.success) {
                        response = `✅ UA配置 "${key}" 已${config.enabled ? '启用' : '禁用'}`;
                    } else {
                        response = `❌ 更新失败: ${result.error}`;
                    }
                } else {
                    response = `❌ 无效的配置索引: ${index}`;
                }

                // 刷新界面
                const uaInterface = await showUAManagementInterface(env);
                newKeyboard = uaInterface.reply_markup;
                response = uaInterface.text;
            } else {
                response = `✅ UA操作: ${operation} ${target}`;
                // 刷新界面
                const uaInterface = await showUAManagementInterface(env);
                newKeyboard = uaInterface.reply_markup;
                response = uaInterface.text;
            }
        } else if (action === 'blacklist') {
            const callbackResult = await handleBlacklistCallback(operation, target, env);

            if (typeof callbackResult === 'object' && callbackResult.text) {
                // 如果返回的是带键盘的对象，直接使用
                response = callbackResult.text;
                newKeyboard = callbackResult.reply_markup;
            } else {
                // 如果返回的是字符串，检查是否需要刷新界面
                response = callbackResult;
                if (operation === 'remove' || operation === 'refresh') {
                    // 刷新黑名单管理界面
                    const blacklistInterface = await showBlacklistManagementInterface(env);
                    newKeyboard = blacklistInterface.reply_markup;
                    response = blacklistInterface.text;
                }
            }
        } else if (action === 'violations') {
            console.log('🔧 处理violations回调:', { operation, target });

            // 简化处理逻辑
            if (operation === 'refresh') {
                const violationsInterface = await showViolationsManagementInterface(env);
                response = violationsInterface.text;
                newKeyboard = violationsInterface.reply_markup;
            } else if (operation === 'list') {
                response = `📋 违规列表操作: ${operation}`;
            } else {
                response = `✅ 违规操作: ${operation} ${target}`;
            }
        } else if (action === 'menu') {
            console.log('🔧 处理菜单回调:', { operation, target });

            // 处理主菜单回调
            if (operation === 'refresh') {
                const mainMenu = await getMainMenu(env);
                response = mainMenu.text;
                newKeyboard = mainMenu.reply_markup;
            } else if (operation === 'status') {
                response = await getSystemStatus(env);
            } else if (operation === 'logs') {
                response = await getSystemLogs([], env);
            } else if (operation === 'violations') {
                const violationsInterface = await showViolationsManagementInterface(env);
                response = violationsInterface.text;
                newKeyboard = violationsInterface.reply_markup;
            } else if (operation === 'blacklist') {
                const blacklistInterface = await showBlacklistManagementInterface(env);
                response = blacklistInterface.text;
                newKeyboard = blacklistInterface.reply_markup;
            } else if (operation === 'ua') {
                console.log('🔧 开始调用showUAManagementInterface...');
                const uaInterface = await showUAManagementInterface(env);
                console.log('🔧 showUAManagementInterface返回结果:', typeof uaInterface, uaInterface);

                if (typeof uaInterface === 'string') {
                    // 如果返回的是错误字符串
                    response = uaInterface;
                } else {
                    response = uaInterface.text;
                    newKeyboard = uaInterface.reply_markup;
                }
            } else if (operation === 'pathload') {
                response = await managePathLoad(['list'], env);
            } else if (operation === 'api') {
                response = await getApiMenu(env);
            } else if (operation === 'help') {
                response = await processCommand('/help', [], env);
            } else {
                response = `✅ 菜单操作: ${operation}`;
            }
        } else {
            console.log('❓ 未知回调数据:', callbackData);
            response = `❓ 未知操作: ${callbackData}`;
        }

        // 如果需要更新消息
        if (newKeyboard) {
            await editMessageWithKeyboard(chatId, messageId, response, newKeyboard, env);
        } else {
            // 发送新消息
            await sendTelegramMessage(chatId, response, env, {
                parse_mode: 'Markdown'
            });
        }

        // 必须回答回调查询，否则用户会看到持续的加载状态
        await answerCallbackQuery(callbackQuery.id, '操作完成', env);
        return new Response('OK');

    } catch (error) {
        console.error('处理回调查询失败:', error);
        await answerCallbackQuery(callbackQuery.id, '操作失败: ' + error.message, env);
        return new Response('Callback handling failed', { status: 500 });
    }
}

// 处理UA相关回调
async function handleUACallback(operation, target, env) {
    console.log('🔧 处理UA回调:', { operation, target });

    switch (operation) {
        case 'toggle':
        case 'edit':
        case 'delete':
            // 通过索引获取配置名称
            const uaLimits = getAllUserAgentLimitsFromEnv(env);
            const uaKeys = Object.keys(uaLimits);
            const targetIndex = parseInt(target);

            if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= uaKeys.length) {
                return `❌ 无效的配置索引: ${target}`;
            }

            const configName = uaKeys[targetIndex];
            console.log('🎯 通过索引找到配置:', { targetIndex, configName });

            if (operation === 'toggle') {
                const isEnabled = uaLimits[configName].enabled !== false;
                if (isEnabled) {
                    const result = await disableUAConfig(configName, env);
                    return result.success ? `✅ 已禁用 ${configName}` : `❌ 禁用失败: ${result.error}`;
                } else {
                    const result = await enableUAConfig(configName, env);
                    return result.success ? `✅ 已启用 ${configName}` : `❌ 启用失败: ${result.error}`;
                }
            } else if (operation === 'edit') {
                return await editUAConfig(configName, env);
            } else if (operation === 'delete') {
                return await deleteUAConfig(configName, env);
            }
            break;

        case 'add':
            return await showAddUAInterface(env);

        case 'refresh':
            return `🔄 已刷新UA配置列表`;

        default:
            return `❓ 未知操作: ${operation}`;
    }
}

// 处理黑名单相关回调
async function handleBlacklistCallback(operation, target, env) {
    console.log('🔧 处理黑名单回调:', { operation, target });

    switch (operation) {
        case 'remove':
        case 'info':
            // 通过索引获取IP地址
            const blacklist = getIpBlacklistFromEnv(env);
            const targetIndex = parseInt(target);

            if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= blacklist.length) {
                return `❌ 无效的IP索引: ${target}`;
            }

            const ipAddress = blacklist[targetIndex];
            console.log('🎯 通过索引找到IP:', { targetIndex, ipAddress });

            if (operation === 'remove') {
                const result = await removeIpFromBlacklist(ipAddress, env);
                return result.success ?
                    `✅ 已从黑名单移除 ${ipAddress}` :
                    `❌ 移除失败: ${result.error}`;
            } else if (operation === 'info') {
                return await getIPDetails(ipAddress, env);
            }
            break;

        case 'add':
            return await showAddIPInterface(env);

        case 'refresh':
            return `🔄 已刷新黑名单列表`;

        case 'show':
            if (target === 'all') {
                const blacklist = getIpBlacklistFromEnv(env);
                let message = `📋 完整黑名单 (${blacklist.length}个)：\n\n`;
                blacklist.forEach((ip, index) => {
                    message += `${index + 1}. \`${ip}\`\n`;
                });
                return message;
            }
            return `❓ 未知显示操作: ${target}`;

        default:
            return `❓ 未知操作: ${operation}`;
    }
}

// 回答回调查询
async function answerCallbackQuery(callbackQueryId, text, env) {
    console.log('🔧 开始回答回调查询:', { callbackQueryId, text });

    const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/answerCallbackQuery`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('回答回调查询API错误:', response.status, errorText);
        } else {
            console.log('✅ 回调查询回答成功');
        }
    } catch (error) {
        console.error('回答回调查询失败:', error);
    }
}

// 编辑消息和键盘
async function editMessageWithKeyboard(chatId, messageId, text, keyboard, env) {
    console.log('🔧 开始编辑消息:', { chatId, messageId, textLength: text.length, keyboardRows: keyboard?.inline_keyboard?.length });

    const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/editMessageText`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('编辑消息API错误:', response.status, errorText);
        } else {
            console.log('✅ 消息编辑成功');
        }
    } catch (error) {
        console.error('编辑消息失败:', error);
    }
}

// 编辑UA配置
async function editUAConfig(name, env) {
    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return `❌ UA配置 ${name} 不存在`;
        }

        const config = currentLimits[name];

        let details = `✏️ **编辑 ${name} 配置**\n\n` +
                     `当前配置：\n` +
                     `• UA字符串: \`${config.userAgent || 'N/A'}\`\n` +
                     `• 小时限制: ${config.hourlyLimit || 'N/A'}\n` +
                     `• 状态: ${config.enabled !== false ? '启用' : '禁用'}\n`;

        // 显示路径特定限制
        if (config.pathSpecificLimits && Object.keys(config.pathSpecificLimits).length > 0) {
            details += `• 路径限制 (${Object.keys(config.pathSpecificLimits).length}个):\n`;
            Object.entries(config.pathSpecificLimits).forEach(([path, limit]) => {
                details += `  - \`${path}\`: ${limit}/小时\n`;
            });
        } else {
            details += `• 路径限制: 无\n`;
        }

        details += `\n💡 使用以下命令修改：\n` +
                  `• /ua_edit_ua ${name} [新UA字符串]\n` +
                  `• /ua_edit_limit ${name} [新小时限制]\n` +
                  `• /ua_edit_path ${name} [路径] [限制]`;

        return details;

    } catch (error) {
        return `❌ 获取UA配置失败: ${error.message}`;
    }
}

// 删除UA配置
async function deleteUAConfig(name, env) {
    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return `❌ UA配置 ${name} 不存在`;
        }

        // 不能删除default配置
        if (name === 'default') {
            return `❌ 不能删除默认配置 'default'`;
        }

        delete currentLimits[name];

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA配置删除请求', {
            name,
            action: 'delete',
            cloudflareResult: updateResult,
            newConfig: JSON.stringify(currentLimits)
        });

        return updateResult.success ?
            `✅ 已删除UA配置 ${name}` :
            `❌ 删除失败: ${updateResult.error}`;

    } catch (error) {
        return `❌ 删除UA配置失败: ${error.message}`;
    }
}

// 添加新UA配置
async function addNewUAConfig(args, env) {
    const [name, userAgent, hourlyLimit] = args;

    if (!name || !userAgent) {
        return `❌ 使用格式: /ua_add [名称] [UA字符串] [小时限制(可选)]`;
    }

    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (currentLimits[name]) {
            return `❌ UA配置 ${name} 已存在，请使用其他名称`;
        }

        const newConfig = {
            userAgent: userAgent,
            hourlyLimit: parseInt(hourlyLimit) || 100,
            enabled: true
        };

        currentLimits[name] = newConfig;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA配置添加请求', {
            name,
            userAgent,
            hourlyLimit: newConfig.hourlyLimit,
            cloudflareResult: updateResult
        });

        return updateResult.success ?
            `✅ 已添加UA配置 ${name}\n• UA: ${userAgent}\n• 小时限制: ${newConfig.hourlyLimit}` :
            `❌ 添加失败: ${updateResult.error}`;

    } catch (error) {
        return `❌ 添加UA配置失败: ${error.message}`;
    }
}

// 编辑UA字符串
async function editUAString(args, env) {
    const [name, newUserAgent] = args;

    if (!name || !newUserAgent) {
        return `❌ 使用格式: /ua_edit_ua [名称] [新UA字符串]`;
    }

    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return `❌ UA配置 ${name} 不存在`;
        }

        const oldUserAgent = currentLimits[name].userAgent;
        currentLimits[name].userAgent = newUserAgent;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA字符串编辑请求', {
            name,
            oldUserAgent,
            newUserAgent,
            cloudflareResult: updateResult
        });

        return updateResult.success ?
            `✅ 已更新 ${name} 的UA字符串\n• 旧值: ${oldUserAgent}\n• 新值: ${newUserAgent}` :
            `❌ 更新失败: ${updateResult.error}`;

    } catch (error) {
        return `❌ 编辑UA字符串失败: ${error.message}`;
    }
}

// 编辑UA限制
async function editUALimit(args, env) {
    const [name, newLimit] = args;

    if (!name || !newLimit) {
        return `❌ 使用格式: /ua_edit_limit [名称] [新小时限制]`;
    }

    const limitNumber = parseInt(newLimit);
    if (isNaN(limitNumber) || limitNumber <= 0) {
        return `❌ 小时限制必须是大于0的数字`;
    }

    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return `❌ UA配置 ${name} 不存在`;
        }

        const oldLimit = currentLimits[name].hourlyLimit;
        currentLimits[name].hourlyLimit = limitNumber;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA限制编辑请求', {
            name,
            oldLimit,
            newLimit: limitNumber,
            cloudflareResult: updateResult
        });

        return updateResult.success ?
            `✅ 已更新 ${name} 的小时限制\n• 旧值: ${oldLimit}\n• 新值: ${limitNumber}` :
            `❌ 更新失败: ${updateResult.error}`;

    } catch (error) {
        return `❌ 编辑UA限制失败: ${error.message}`;
    }
}

// 添加新IP到黑名单
async function addNewIPToBlacklist(args, env) {
    const [ip] = args;

    if (!ip) {
        return `❌ 使用格式: /blacklist_add [IP地址]`;
    }

    // 简单的IP格式验证
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        return `❌ IP地址格式不正确: ${ip}`;
    }

    return await addIpToBlacklist(ip, env);
}

// 违规管理界面
async function showViolationsManagementInterface(env) {
    try {
        let message = `⚠️ **IP违规管理**\n\n`;

        // 显示当前违规记录统计
        const violationCount = ipViolationStorage.violations.size;
        message += `当前违规记录: ${violationCount} 个IP\n\n`;

        if (violationCount > 0) {
            // 显示前5个违规IP的简要信息
            let count = 0;
            for (const [ip, record] of ipViolationStorage.violations.entries()) {
                if (count >= 5) break;

                const now = Date.now();
                const status = record.banned ?
                    (record.banExpiry && now < record.banExpiry ?
                        `🚫 已封禁 (${Math.ceil((record.banExpiry - now) / (60 * 60 * 1000))}小时后解封)` :
                        `🚫 已封禁`) :
                    `⚠️ 违规${record.count}次`;

                message += `• \`${ip}\`: ${status}\n`;
                count++;
            }

            if (violationCount > 5) {
                message += `• ... 还有 ${violationCount - 5} 个IP\n`;
            }
            message += `\n`;
        }

        message += `📋 **管理功能:**\n`;
        message += `• 查看完整违规IP列表\n`;
        message += `• 手动封禁IP地址\n`;
        message += `• 解除IP封禁\n`;
        message += `• 清除违规记录\n`;

        // 创建内联键盘
        const keyboard = [
            [
                {
                    text: '📋 查看违规列表',
                    callback_data: 'violations_list'
                },
                {
                    text: '🚫 手动封禁IP',
                    callback_data: 'violations_ban'
                }
            ],
            [
                {
                    text: '✅ 解除封禁',
                    callback_data: 'violations_unban'
                },
                {
                    text: '🗑️ 清除记录',
                    callback_data: 'violations_clear'
                }
            ],
            [
                {
                    text: '🔄 刷新状态',
                    callback_data: 'violations_refresh'
                }
            ]
        ];

        return {
            text: message,
            reply_markup: {
                inline_keyboard: keyboard
            }
        };

    } catch (error) {
        return `❌ 获取违规管理界面失败: ${error.message}`;
    }
}

// 处理违规相关回调
async function handleViolationsCallback(operation, target, env) {
    console.log('🔧 处理违规回调:', { operation, target });

    switch (operation) {
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
                violationList += `\`${violationIp}\`\n${status}\n最后违规: ${lastViolation}\n\n`;
            }

            return violationList;

        case 'ban':
            return await showBanIPInterface(env);

        case 'unban':
            return await showUnbanIPInterface(env);

        case 'clear':
            return await showClearViolationsInterface(env);

        case 'refresh':
            return `🔄 已刷新违规管理状态`;

        default:
            return `❓ 未知操作: ${operation}`;
    }
}

// 显示封禁IP界面
async function showBanIPInterface(env) {
    const message = `🚫 **手动封禁IP**\n\n` +
                   `请使用以下命令封禁IP：\n` +
                   `\`/violations ban [IP地址] [小时数]\`\n\n` +
                   `📝 **示例:**\n` +
                   `• \`/violations ban 192.168.1.100 24\` - 封禁24小时\n` +
                   `• \`/violations ban 10.0.0.1 48\` - 封禁48小时\n\n` +
                   `💡 **说明:**\n` +
                   `• 小时数可选，默认24小时\n` +
                   `• 封禁后立即生效\n` +
                   `• 可以通过解除封禁功能撤销`;

    return {
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🔙 返回违规管理',
                        callback_data: 'violations_refresh'
                    }
                ]
            ]
        }
    };
}

// 显示解除封禁界面
async function showUnbanIPInterface(env) {
    const message = `✅ **解除IP封禁**\n\n` +
                   `请使用以下命令解除封禁：\n` +
                   `\`/violations unban [IP地址]\`\n\n` +
                   `📝 **示例:**\n` +
                   `• \`/violations unban 192.168.1.100\`\n` +
                   `• \`/violations unban 10.0.0.1\`\n\n` +
                   `💡 **说明:**\n` +
                   `• 立即解除指定IP的封禁状态\n` +
                   `• 不会清除违规记录\n` +
                   `• 解除后IP可以正常访问`;

    return {
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🔙 返回违规管理',
                        callback_data: 'violations_refresh'
                    }
                ]
            ]
        }
    };
}

// 显示清除违规记录界面
async function showClearViolationsInterface(env) {
    const message = `🗑️ **清除违规记录**\n\n` +
                   `请使用以下命令清除记录：\n` +
                   `\`/violations clear [IP地址]\`\n\n` +
                   `📝 **示例:**\n` +
                   `• \`/violations clear 192.168.1.100\`\n` +
                   `• \`/violations clear 10.0.0.1\`\n\n` +
                   `⚠️ **注意:**\n` +
                   `• 清除后该IP的所有违规记录将被删除\n` +
                   `• 如果IP当前被封禁，封禁状态也会被解除\n` +
                   `• 此操作不可撤销`;

    return {
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🔙 返回违规管理',
                        callback_data: 'violations_refresh'
                    }
                ]
            ]
        }
    };
}

// 编辑UA路径限制
async function editUAPathLimit(args, env) {
    const [name, path, newLimit] = args;

    if (!name || !path || !newLimit) {
        return `❌ 使用格式: /ua_edit_path [名称] [路径] [新限制]\n\n` +
               `📝 示例: /ua_edit_path MisakaTest "/api/v2/comment" 20`;
    }

    const limitNumber = parseInt(newLimit);
    if (isNaN(limitNumber) || limitNumber <= 0) {
        return `❌ 路径限制必须是大于0的数字`;
    }

    try {
        const currentLimits = JSON.parse(env.USER_AGENT_LIMITS_CONFIG || '{}');

        if (!currentLimits[name]) {
            return `❌ UA配置 ${name} 不存在`;
        }

        // 初始化路径限制对象
        if (!currentLimits[name].pathSpecificLimits) {
            currentLimits[name].pathSpecificLimits = {};
        }

        const oldLimit = currentLimits[name].pathSpecificLimits[path];
        currentLimits[name].pathSpecificLimits[path] = limitNumber;

        // 调用Cloudflare API更新环境变量
        const updateResult = await updateCloudflareEnvVar(env, 'USER_AGENT_LIMITS_CONFIG', JSON.stringify(currentLimits));

        logToBot('info', 'UA路径限制编辑请求', {
            name,
            path,
            oldLimit,
            newLimit: limitNumber,
            cloudflareResult: updateResult
        });

        return updateResult.success ?
            `✅ 已更新 ${name} 的路径限制\n• 路径: ${path}\n• 旧值: ${oldLimit || '无'}\n• 新值: ${limitNumber}` :
            `❌ 更新失败: ${updateResult.error}`;

    } catch (error) {
        return `❌ 编辑UA路径限制失败: ${error.message}`;
    }
}

// 获取IP详细信息
async function getIPDetails(ip, env) {
    try {
        let details = `📊 **IP ${ip} 详细信息**\n\n`;

        // 检查是否在黑名单中
        const blacklist = getIpBlacklistFromEnv(env);
        const inBlacklist = blacklist.includes(ip);
        details += `🚫 黑名单状态: ${inBlacklist ? '✅ 已加入' : '❌ 未加入'}\n`;

        // 检查UA限制配置
        const uaLimits = getUserAgentLimitsFromEnv(env);
        const uaCount = Object.keys(uaLimits).length;
        details += `👤 UA配置数量: ${uaCount} 个\n`;

        // 显示当前时间信息
        const now = new Date();
        details += `⏰ 查询时间: ${now.toLocaleString('zh-CN')}\n`;
        details += `📅 当前小时: ${now.getHours()}:00-${now.getHours()}:59\n`;

        // 添加操作建议
        details += `\n💡 **可用操作:**\n`;
        if (inBlacklist) {
            details += `• 使用 /blacklist_remove ${ip} 移除黑名单\n`;
        } else {
            details += `• 使用 /blacklist_add ${ip} 添加到黑名单\n`;
        }
        details += `• 使用 /violations check ${ip} 查看违规记录\n`;
        details += `• 使用 /pathload check ${ip} 查看路径使用情况`;

        return details;

    } catch (error) {
        return `❌ 获取IP详情失败: ${error.message}`;
    }
}

// 显示添加IP界面
async function showAddIPInterface(env) {
    const message = `➕ **添加IP到黑名单**\n\n` +
                   `请使用以下命令添加IP：\n` +
                   `\`/blacklist_add [IP地址]\`\n\n` +
                   `📝 **示例:**\n` +
                   `• \`/blacklist_add 192.168.1.100\`\n` +
                   `• \`/blacklist_add 10.0.0.1\`\n\n` +
                   `💡 **提示:**\n` +
                   `• IP地址格式会自动验证\n` +
                   `• 重复IP会被自动忽略\n` +
                   `• 添加后立即生效`;

    return {
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🔙 返回黑名单管理',
                        callback_data: 'blacklist_refresh_'
                    }
                ]
            ]
        }
    };
}

// 显示添加UA界面
async function showAddUAInterface(env) {
    const message = `➕ **添加新UA配置**\n\n` +
                   `请使用以下命令添加UA配置：\n` +
                   `\`/ua_add [名称] [UA字符串] [小时限制]\`\n\n` +
                   `📝 **示例:**\n` +
                   `• \`/ua_add TestUA "Mozilla/5.0 Test" 50\`\n` +
                   `• \`/ua_add MobileUA "Mobile App/1.0" 100\`\n\n` +
                   `💡 **参数说明:**\n` +
                   `• **名称**: 配置的唯一标识符\n` +
                   `• **UA字符串**: User-Agent字符串（用引号包围）\n` +
                   `• **小时限制**: 每小时请求限制（可选，默认100）\n\n` +
                   `⚠️ **注意:**\n` +
                   `• 名称不能重复\n` +
                   `• 配置添加后立即生效`;

    return {
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🔙 返回UA管理',
                        callback_data: 'ua_refresh_'
                    }
                ]
            ]
        }
    };
}
