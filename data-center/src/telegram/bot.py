"""
Telegram机器人核心类 - 轮询模式
参考MoviePilot项目的实现优化
"""
import asyncio
import logging
import threading
from datetime import datetime
from typing import Optional

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler, ContextTypes,
    ConversationHandler, MessageHandler, filters
)
from telegram.error import TelegramError

# 会话状态常量
(
    UA_NAME_INPUT,      # 等待输入UA名称
    UA_STRING_INPUT,    # 等待输入User-Agent字符串
    UA_LIMIT_SELECT,    # 等待选择小时限制
    IP_ADDRESS_INPUT,   # 等待输入IP地址
    IP_REASON_INPUT,    # 等待输入封禁原因
) = range(5)

from src.config import settings
from src.database import get_db_sync
from src.services.config_service import ConfigService
from src.services.stats_service import StatsService
from src.models.logs import TelegramLog

logger = logging.getLogger(__name__)

# 禁用httpx的INFO日志，避免暴露API密钥
logging.getLogger("httpx").setLevel(logging.WARNING)

class TelegramBot:
    """Telegram机器人类 - 使用轮询模式，无需公网地址"""

    def __init__(self, token: str, admin_user_ids: list):
        self.token = token
        self.admin_user_ids = admin_user_ids if isinstance(admin_user_ids, list) else [admin_user_ids]
        self.application: Optional[Application] = None
        self.config_service = ConfigService()
        self.stats_service = StatsService()
        self._polling_thread = None
        self._stop_event = threading.Event()
        # 用于存储会话数据（添加UA/IP时的临时数据）
        self._user_data = {}

        logger.info(f"🤖 初始化TG机器人，管理员ID: {self.admin_user_ids}")

    async def start(self):
        """启动机器人 - 轮询模式（参考MoviePilot实现）"""
        try:
            logger.info("🚀 启动Telegram机器人轮询模式...")

            # 创建应用（仅用于注册处理器和设置命令）
            self.application = Application.builder().token(self.token).build()

            # 注册命令处理器
            await self._register_handlers()

            # 设置机器人命令菜单
            await self._setup_bot_commands()

            # 在独立线程中运行轮询
            def run_polling():
                """在独立线程中运行轮询"""
                try:
                    logger.info("🔄 开始轮询Telegram API...")

                    # 创建新的事件循环用于轮询线程
                    import asyncio
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                    # 启动轮询
                    async def start_polling_async():
                        # 在子线程中重新创建完整的Application（避免事件循环绑定问题）
                        thread_app = Application.builder().token(self.token).build()

                        # 复制处理器到新的application
                        for handler in self.application.handlers[0]:  # 默认组
                            thread_app.add_handler(handler)

                        # 复制错误处理器
                        for error_handler in self.application.error_handlers.values():
                            thread_app.add_error_handler(error_handler)

                        # 初始化application
                        await thread_app.initialize()
                        await thread_app.start()

                        # 启动updater的轮询
                        await thread_app.updater.start_polling(
                            poll_interval=1.0,
                            timeout=10,
                            bootstrap_retries=5,
                            drop_pending_updates=True,
                            allowed_updates=Update.ALL_TYPES
                        )
                        logger.info("✅ Telegram轮询已启动")

                        # 保持运行直到收到停止信号
                        while not self._stop_event.is_set():
                            await asyncio.sleep(1)

                        # 停止轮询
                        await thread_app.updater.stop()
                        await thread_app.stop()
                        await thread_app.shutdown()

                    loop.run_until_complete(start_polling_async())

                except Exception as err:
                    logger.error(f"❌ Telegram轮询异常: {err}", exc_info=True)
                finally:
                    try:
                        loop.close()
                    except:
                        pass

            # 启动轮询线程
            self._polling_thread = threading.Thread(target=run_polling, daemon=True)
            self._polling_thread.start()
            logger.info("✅ Telegram机器人轮询线程已启动")

        except Exception as e:
            logger.error(f"❌ TG机器人启动失败: {e}")
            raise

    async def stop(self):
        """停止机器人（参考MoviePilot实现）"""
        if self.application:
            logger.info("🛑 停止Telegram机器人...")

            # 设置停止事件
            self._stop_event.set()

            # 停止轮询
            if self.application.updater:
                await self.application.updater.stop()

            # 停止应用
            await self.application.stop()
            await self.application.shutdown()

            # 等待轮询线程结束
            if self._polling_thread and self._polling_thread.is_alive():
                self._polling_thread.join(timeout=5)

            logger.info("✅ Telegram机器人已停止")

    async def _register_handlers(self):
        """注册命令处理器（参考MoviePilot的处理器注册）"""
        handlers = [
            CommandHandler("start", self.start_command),
            CommandHandler("status", self.status_command),
            CommandHandler("ua", self.ua_command),
            CommandHandler("blacklist", self.blacklist_command),
            CommandHandler("logs", self.logs_command),
            CommandHandler("help", self.help_command),
            # 消息处理器 - 用于处理用户输入（添加UA/IP时的文本输入）
            MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_text_input),
            CallbackQueryHandler(self.handle_callback)
        ]

        for handler in handlers:
            self.application.add_handler(handler)

        # 添加错误处理器（参考MoviePilot）
        async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
            """全局错误处理器"""
            logger.error(f"❌ TG机器人错误: {context.error}")
            if update and update.effective_message:
                try:
                    await update.effective_message.reply_text(
                        f"❌ 处理消息时出错: {str(context.error)[:100]}"
                    )
                except:
                    pass

        self.application.add_error_handler(error_handler)

        logger.info(f"✅ 注册了 {len(handlers)} 个命令处理器和1个错误处理器")

    async def _setup_bot_commands(self):
        """设置机器人命令菜单"""
        commands = [
            ("start", "🏠 开始使用机器人"),
            ("status", "📊 查看系统状态"),
            ("ua", "👤 UA配置管理"),
            ("blacklist", "🚫 IP黑名单管理"),
            ("logs", "📝 查看系统日志"),
            ("help", "❓ 帮助信息")
        ]

        try:
            await self.application.bot.set_my_commands(commands)
            logger.info("✅ 机器人命令菜单设置成功")
        except Exception as e:
            logger.error(f"❌ 设置机器人命令菜单失败: {e}")

    def _is_authorized(self, user_id: int) -> bool:
        """检查用户是否有权限"""
        return user_id in self.admin_user_ids

    async def _log_command(self, user_id: int, username: str, command: str, response: str, status: str = "success", error: str = None):
        """记录命令执行日志"""
        try:
            db = get_db_sync()
            log = TelegramLog(
                user_id=user_id,
                username=username,
                command=command,
                response=response[:1000] if response else None,  # 限制长度
                status=status,
                error_message=error
            )
            db.add(log)
            db.commit()
            db.close()
        except Exception as e:
            logger.error(f"记录TG命令日志失败: {e}")

    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """开始命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        message = f"""🤖 **DanDanPlay API 数据交互中心**

🌐 欢迎使用管理机器人！

📋 **主要功能**
📊 系统监控 - 实时查看系统状态和统计
👤 UA管理 - 用户代理配置管理
🚫 IP管理 - 黑名单和违规记录管理
📝 日志查询 - 系统日志查看和分析

🔧 使用 /help 查看所有可用命令
"""

        keyboard = [
            [
                InlineKeyboardButton("📊 系统状态", callback_data="status"),
                InlineKeyboardButton("👤 UA管理", callback_data="ua_list")
            ],
            [
                InlineKeyboardButton("🚫 IP管理", callback_data="blacklist_list"),
                InlineKeyboardButton("📝 系统日志", callback_data="logs_recent")
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await update.message.reply_text(message, parse_mode='Markdown', reply_markup=reply_markup)
        await self._log_command(user_id, username, "/start", message)

    async def status_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """系统状态命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        try:
            # 获取系统统计信息
            stats = await self.stats_service.get_system_overview()

            message = f"""📊 **系统状态报告**

🕐 当前时间: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}

📈 **请求统计**
• 总请求数: {stats.get('total_requests', 0):,} 次
• 成功请求: {stats.get('successful_requests', 0):,} 次
• 被阻止请求: {stats.get('blocked_requests', 0):,} 次

🚫 **安全统计**
• IP黑名单: {stats.get('blacklist_count', 0)} 个
• 违规IP数: {stats.get('violation_ips', 0)} 个
• 临时封禁: {stats.get('temp_banned', 0)} 个

👤 **配置统计**
• UA配置数: {stats.get('ua_configs', 0)} 个
• 启用配置: {stats.get('enabled_ua_configs', 0)} 个

🤖 **系统状态**: 正常运行
"""

            keyboard = [
                [InlineKeyboardButton("🔄 刷新状态", callback_data="status")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='Markdown', reply_markup=reply_markup)
            await self._log_command(user_id, username, "/status", "系统状态查询成功")

        except Exception as e:
            error_msg = f"获取系统状态失败: {str(e)}"
            await update.message.reply_text(f"❌ {error_msg}")
            await self._log_command(user_id, username, "/status", error_msg, "error", str(e))

    async def ua_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """UA管理命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        try:
            # 获取UA配置列表
            ua_configs = await self.config_service.get_ua_configs()

            message = "👤 <b>UA配置管理</b>\n\n"

            if not ua_configs:
                message += "📝 暂无UA配置"
            else:
                import html
                for i, config in enumerate(ua_configs[:10], 1):  # 限制显示前10个
                    status = "✅" if config.enabled else "❌"
                    # HTML转义特殊字符
                    name = html.escape(config.name)
                    ua = html.escape(config.user_agent[:50])

                    # 显示限制（-1显示为∞）
                    limit_display = "∞" if config.hourly_limit == -1 else str(config.hourly_limit)

                    message += f"{i}. {status} <b>{name}</b>\n"
                    message += f"   UA: <code>{ua}...</code>\n"
                    message += f"   限制: {limit_display}/小时\n"

                    # 显示路径限制
                    if config.path_specific_limits:
                        message += f"   路径限制:\n"
                        for path, limit_data in list(config.path_specific_limits.items())[:3]:  # 最多显示3个
                            path_escaped = html.escape(path)
                            path_limit = limit_data.get("maxRequestsPerHour", 50)
                            path_limit_display = "∞" if path_limit == -1 else str(path_limit)
                            message += f"     • {path_escaped}: {path_limit_display}/h\n"
                        if len(config.path_specific_limits) > 3:
                            message += f"     • ...还有{len(config.path_specific_limits) - 3}个\n"

                    message += "\n"

            keyboard = [
                [
                    InlineKeyboardButton("➕ 添加配置", callback_data="ua_add"),
                    InlineKeyboardButton("🔄 刷新列表", callback_data="ua_list")
                ]
            ]

            # 为每个配置添加操作按钮
            for i, config in enumerate(ua_configs[:5], 1):  # 限制前5个配置
                row = [
                    InlineKeyboardButton(f"✏️ 编辑{i}", callback_data=f"ua_edit_{config.name}"),
                    InlineKeyboardButton(f"🔄 切换{i}", callback_data=f"ua_toggle_{config.name}"),
                    InlineKeyboardButton(f"🗑️ 删除{i}", callback_data=f"ua_delete_{config.name}")
                ]
                keyboard.append(row)

            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)
            await self._log_command(user_id, username, "/ua", "UA配置列表查询成功")

        except Exception as e:
            error_msg = f"获取UA配置失败: {str(e)}"
            await update.message.reply_text(f"❌ {error_msg}")
            await self._log_command(user_id, username, "/ua", error_msg, "error", str(e))

    async def blacklist_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """黑名单管理命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        try:
            # 获取黑名单列表
            blacklist = await self.config_service.get_ip_blacklist()

            message = "🚫 <b>IP黑名单管理</b>\n\n"

            if not blacklist:
                message += "📝 暂无黑名单记录"
            else:
                import html
                for i, ip_record in enumerate(blacklist[:10], 1):  # 限制显示前10个
                    status = "✅" if ip_record.enabled else "❌"
                    ip_addr = html.escape(ip_record.ip_address)
                    message += f"{i}. {status} <code>{ip_addr}</code>\n"
                    if ip_record.reason:
                        reason = html.escape(ip_record.reason)
                        message += f"   原因: {reason}\n"
                    message += f"   时间: {ip_record.created_at.strftime('%m-%d %H:%M')}\n\n"

            keyboard = [
                [
                    InlineKeyboardButton("➕ 添加IP", callback_data="blacklist_add"),
                    InlineKeyboardButton("🔄 刷新列表", callback_data="blacklist_list")
                ]
            ]

            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)
            await self._log_command(user_id, username, "/blacklist", "黑名单列表查询成功")

        except Exception as e:
            error_msg = f"获取黑名单失败: {str(e)}"
            await update.message.reply_text(f"❌ {error_msg}")
            await self._log_command(user_id, username, "/blacklist", error_msg, "error", str(e))

    async def logs_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """日志查询命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        try:
            # 获取最近的日志
            logs = await self.stats_service.get_recent_logs(limit=10)

            message = "📝 **系统日志**\n\n"

            if not logs:
                message += "📝 暂无日志记录"
            else:
                for log in logs:
                    level_emoji = {"INFO": "ℹ️", "WARN": "⚠️", "ERROR": "❌"}.get(log.level, "📝")
                    message += f"{level_emoji} **{log.level}** - {log.created_at.strftime('%H:%M:%S')}\n"
                    message += f"   {log.message[:100]}...\n\n"

            keyboard = [
                [
                    InlineKeyboardButton("🔄 刷新日志", callback_data="logs_recent"),
                    InlineKeyboardButton("⚠️ 错误日志", callback_data="logs_error")
                ]
            ]

            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='Markdown', reply_markup=reply_markup)
            await self._log_command(user_id, username, "/logs", "系统日志查询成功")

        except Exception as e:
            error_msg = f"获取系统日志失败: {str(e)}"
            await update.message.reply_text(f"❌ {error_msg}")
            await self._log_command(user_id, username, "/logs", error_msg, "error", str(e))

    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """帮助命令"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            await update.message.reply_text("❌ 权限不足")
            return

        help_text = """❓ **帮助信息**

📋 **可用命令**
/start - 🏠 开始使用机器人
/status - 📊 查看系统状态
/ua - 👤 UA配置管理
/blacklist - 🚫 IP黑名单管理
/logs - 📝 查看系统日志
/help - ❓ 显示此帮助信息

🔧 **使用说明**
• 所有命令都支持内联键盘操作
• 点击按钮可以快速执行相关操作
• 系统会自动记录所有操作日志

💡 **提示**
• 使用内联键盘比输入命令更方便
• 系统状态会实时更新
• 如有问题请联系管理员
"""

        await update.message.reply_text(help_text, parse_mode='Markdown')
        await self._log_command(user_id, username, "/help", "帮助信息")

    async def handle_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理内联键盘回调（参考MoviePilot的回调处理机制）"""
        query = update.callback_query
        user_id = query.from_user.id
        username = query.from_user.username or query.from_user.first_name

        if not self._is_authorized(user_id):
            await query.answer("❌ 权限不足", show_alert=True)
            return

        # 根据回调数据处理不同操作
        callback_data = query.data

        try:
            # 先确认回调（避免Telegram显示加载动画）
            await query.answer()

            # 路由到不同的处理函数
            if callback_data == "main_menu":
                await self._handle_main_menu_callback(query)
            elif callback_data == "status":
                await self._handle_status_callback(query)
            elif callback_data.startswith("ua_"):
                await self._handle_ua_callback(query, callback_data)
            elif callback_data.startswith("blacklist_"):
                await self._handle_blacklist_callback(query, callback_data)
            elif callback_data.startswith("logs_"):
                await self._handle_logs_callback(query, callback_data)
            else:
                # 未知的回调数据
                await query.answer("⚠️ 未知的操作", show_alert=True)
                return

            await self._log_command(user_id, username, f"callback:{callback_data}", "回调处理成功")

        except Exception as e:
            error_msg = f"处理回调失败: {str(e)}"
            logger.error(f"❌ {error_msg}")

            # 尝试编辑消息显示错误
            try:
                await query.edit_message_text(f"❌ {error_msg}")
            except:
                # 如果编辑失败，发送新消息
                await query.message.reply_text(f"❌ {error_msg}")

            await self._log_command(user_id, username, f"callback:{callback_data}", error_msg, "error", str(e))

    async def handle_text_input(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理用户文本输入（用于添加UA/IP的会话流程）"""
        user_id = update.effective_user.id
        username = update.effective_user.username or update.effective_user.first_name

        if not self._is_authorized(user_id):
            return  # 非授权用户的消息直接忽略

        # 检查用户是否在会话中
        if user_id not in self._user_data:
            return  # 没有进行中的会话，忽略消息

        user_session = self._user_data[user_id]
        action = user_session.get("action")
        step = user_session.get("step")
        text = update.message.text.strip()

        try:
            if action == "add_ua":
                await self._handle_ua_text_input(update, user_id, step, text)
            elif action == "add_ip":
                await self._handle_ip_text_input(update, user_id, step, text)
        except Exception as e:
            logger.error(f"处理文本输入失败: {e}")
            await update.message.reply_text(f"❌ 处理输入失败: {str(e)}")

    async def _handle_ua_text_input(self, update: Update, user_id: int, step: str, text: str):
        """处理添加UA的文本输入"""
        if step == "name":
            # 验证名称
            if len(text) < 2:
                await update.message.reply_text("❌ 名称太短，请输入至少2个字符")
                return
            if len(text) > 50:
                await update.message.reply_text("❌ 名称太长，请输入不超过50个字符")
                return

            # 检查是否已存在
            existing = await self.config_service.get_ua_config_by_name(text)
            if existing:
                await update.message.reply_text(f"❌ 已存在同名配置: {text}，请输入其他名称")
                return

            # 保存名称，进入下一步
            self._user_data[user_id]["name"] = text
            self._user_data[user_id]["step"] = "user_agent"

            message = f"""✅ 名称已设置: <code>{text}</code>

请输入 User-Agent 字符串：

<i>💡 示例: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...</i>"""

            keyboard = [
                [InlineKeyboardButton("❌ 取消", callback_data="ua_cancel")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif step == "user_agent":
            # 验证User-Agent
            if len(text) < 10:
                await update.message.reply_text("❌ User-Agent太短，请输入有效的UA字符串")
                return
            if len(text) > 500:
                await update.message.reply_text("❌ User-Agent太长，请输入不超过500个字符")
                return

            # 保存User-Agent，进入选择限制步骤
            self._user_data[user_id]["user_agent"] = text
            self._user_data[user_id]["step"] = "limit"

            ua_name = self._user_data[user_id].get("name", "")

            message = f"""✅ User-Agent 已设置

📋 <b>当前配置</b>
• 名称: <code>{ua_name}</code>
• UA: <code>{text[:60]}...</code>

请选择每小时请求限制："""

            keyboard = [
                [
                    InlineKeyboardButton("50/小时", callback_data="ua_limit_50"),
                    InlineKeyboardButton("100/小时", callback_data="ua_limit_100")
                ],
                [
                    InlineKeyboardButton("200/小时", callback_data="ua_limit_200"),
                    InlineKeyboardButton("500/小时", callback_data="ua_limit_500")
                ],
                [
                    InlineKeyboardButton("∞ 无限制", callback_data="ua_limit_unlimited")
                ],
                [InlineKeyboardButton("❌ 取消", callback_data="ua_cancel")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)

    async def _handle_ip_text_input(self, update: Update, user_id: int, step: str, text: str):
        """处理添加IP黑名单的文本输入"""
        if step == "ip_address":
            # 简单验证IP格式
            import re
            ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
            if not re.match(ip_pattern, text):
                await update.message.reply_text("❌ IP地址格式不正确，请输入有效的IPv4地址（如: 192.168.1.100）")
                return

            # 验证IP范围
            parts = text.split('.')
            for part in parts:
                if int(part) > 255:
                    await update.message.reply_text("❌ IP地址格式不正确，每段数字应在0-255之间")
                    return

            # 保存IP地址，进入下一步
            self._user_data[user_id]["ip_address"] = text
            self._user_data[user_id]["step"] = "reason"

            message = f"""✅ IP地址已设置: <code>{text}</code>

请输入封禁原因（可选，直接点击跳过）：

<i>💡 示例: 恶意爬虫、频繁请求、异常访问等</i>"""

            keyboard = [
                [InlineKeyboardButton("⏭️ 跳过（无原因）", callback_data="ip_reason_skip")],
                [InlineKeyboardButton("❌ 取消", callback_data="blacklist_cancel")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif step == "reason":
            # 保存原因并创建黑名单记录
            ip_address = self._user_data[user_id].get("ip_address", "")
            reason = text if text else None

            await self._create_ip_blacklist(update, user_id, ip_address, reason)

    async def _create_ip_blacklist(self, update_or_query, user_id: int, ip_address: str, reason: str = None):
        """创建IP黑名单记录"""
        try:
            success = await self.config_service.add_ip_to_blacklist(ip_address, reason)

            if success:
                reason_display = reason if reason else "无"
                message = f"""✅ <b>IP已添加到黑名单！</b>

📋 <b>详情</b>
• IP地址: <code>{ip_address}</code>
• 原因: {reason_display}
• 状态: 🚫 已封禁"""
            else:
                message = f"❌ 添加失败，IP可能已在黑名单中: {ip_address}"

        except Exception as e:
            message = f"❌ 添加失败: {str(e)}"

        # 清理会话数据
        if user_id in self._user_data:
            del self._user_data[user_id]

        keyboard = [
            [InlineKeyboardButton("📋 查看黑名单", callback_data="blacklist_list")],
            [InlineKeyboardButton("➕ 继续添加", callback_data="blacklist_add")],
            [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        # 判断是消息还是回调查询
        if hasattr(update_or_query, 'message') and update_or_query.message:
            await update_or_query.message.reply_text(message, parse_mode='HTML', reply_markup=reply_markup)
        else:
            await update_or_query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

    async def _handle_status_callback(self, query):
        """处理状态回调"""
        try:
            stats = await self.stats_service.get_system_overview()

            message = f"""📊 **系统状态详情**

🕐 当前时间: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}

📈 **请求统计**
• 总请求数: {stats.get('total_requests', 0):,} 次
• 成功请求: {stats.get('successful_requests', 0):,} 次
• 被阻止请求: {stats.get('blocked_requests', 0):,} 次

🚫 **安全统计**
• IP黑名单: {stats.get('blacklist_count', 0)} 个
• 违规IP数: {stats.get('violation_ips', 0)} 个

🤖 **系统状态**: 正常运行
"""

            keyboard = [
                [InlineKeyboardButton("🔄 刷新状态", callback_data="status")],
                [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

        except Exception as e:
            await query.edit_message_text(f"❌ 获取状态失败: {str(e)}")

    async def _handle_main_menu_callback(self, query):
        """处理返回主菜单回调"""
        try:
            message = """🌐 <b>欢迎使用管理机器人！</b>

📋 <b>主要功能</b>
• 📊 系统监控 - 实时查看系统状态和统计
• 👤 UA管理 - 用户代理配置管理
• 🚫 IP管理 - 黑名单和违规记录管理
• 📝 日志查询 - 系统日志查看和分析

🔧 使用 /help 查看所有可用命令"""

            keyboard = [
                [
                    InlineKeyboardButton("📊 系统状态", callback_data="status"),
                    InlineKeyboardButton("👤 UA管理", callback_data="ua_list")
                ],
                [
                    InlineKeyboardButton("🚫 IP管理", callback_data="blacklist_list"),
                    InlineKeyboardButton("📝 系统日志", callback_data="logs_recent")
                ]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

        except Exception as e:
            await query.edit_message_text(f"❌ 返回主菜单失败: {str(e)}")

    async def _handle_ua_callback(self, query, callback_data):
        """处理UA相关回调"""
        if callback_data == "ua_list":
            try:
                ua_configs = await self.config_service.get_ua_configs()

                message = "👤 <b>UA配置列表</b>\n\n"

                if not ua_configs:
                    message += "📝 暂无UA配置"
                else:
                    import html
                    for i, config in enumerate(ua_configs[:10], 1):
                        status = "✅" if config.enabled else "❌"
                        name = html.escape(config.name)
                        ua = html.escape(config.user_agent[:50])

                        # 显示限制（-1显示为∞）
                        limit_display = "∞" if config.hourly_limit == -1 else str(config.hourly_limit)

                        message += f"{i}. {status} <b>{name}</b>\n"
                        message += f"   UA: <code>{ua}...</code>\n"
                        message += f"   限制: {limit_display}/小时\n"

                        # 显示路径限制
                        if config.path_specific_limits:
                            message += f"   路径限制:\n"
                            for path, limit_data in list(config.path_specific_limits.items())[:3]:
                                path_escaped = html.escape(path)
                                path_limit = limit_data.get("maxRequestsPerHour", 50)
                                path_limit_display = "∞" if path_limit == -1 else str(path_limit)
                                message += f"     • {path_escaped}: {path_limit_display}/h\n"
                            if len(config.path_specific_limits) > 3:
                                message += f"     • ...还有{len(config.path_specific_limits) - 3}个\n"

                        message += "\n"

                # 添加刷新时间
                from datetime import datetime
                message += f"\n<i>刷新时间: {datetime.now().strftime('%H:%M:%S')}</i>"

                keyboard = [
                    [
                        InlineKeyboardButton("➕ 添加配置", callback_data="ua_add"),
                        InlineKeyboardButton("🔄 刷新列表", callback_data="ua_list")
                    ],
                    [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                try:
                    await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)
                except Exception as edit_error:
                    # 如果消息内容相同，忽略错误
                    if "message is not modified" not in str(edit_error).lower():
                        raise

            except Exception as e:
                await query.edit_message_text(f"❌ 获取UA配置失败: {str(e)}")

        elif callback_data == "ua_add":
            # 开始添加UA配置的会话流程
            user_id = query.from_user.id
            self._user_data[user_id] = {"action": "add_ua", "step": "name"}

            message = """➕ <b>添加UA配置</b>

请输入UA配置名称（例如：emby-client、jellyfin-app）：

<i>💡 名称用于标识不同的客户端类型</i>"""

            keyboard = [
                [InlineKeyboardButton("❌ 取消", callback_data="ua_cancel")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif callback_data == "ua_cancel":
            # 取消添加UA配置
            user_id = query.from_user.id
            if user_id in self._user_data:
                del self._user_data[user_id]

            message = "❌ 已取消添加UA配置"
            keyboard = [
                [InlineKeyboardButton("🔙 返回UA管理", callback_data="ua_list")],
                [InlineKeyboardButton("� 返回主菜单", callback_data="main_menu")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif callback_data.startswith("ua_limit_"):
            # 选择小时限制
            user_id = query.from_user.id
            if user_id not in self._user_data or self._user_data[user_id].get("action") != "add_ua":
                await query.answer("⚠️ 会话已过期，请重新开始", show_alert=True)
                return

            limit_value = callback_data.replace("ua_limit_", "")
            hourly_limit = -1 if limit_value == "unlimited" else int(limit_value)

            # 获取之前保存的数据
            ua_name = self._user_data[user_id].get("name", "")
            ua_string = self._user_data[user_id].get("user_agent", "")

            # 创建UA配置
            try:
                config = await self.config_service.create_ua_config(
                    name=ua_name,
                    user_agent=ua_string,
                    hourly_limit=hourly_limit,
                    enabled=True
                )

                if config:
                    limit_display = "无限制" if hourly_limit == -1 else f"{hourly_limit}/小时"
                    message = f"""✅ <b>UA配置添加成功！</b>

📋 <b>配置详情</b>
• 名称: <code>{ua_name}</code>
• User-Agent: <code>{ua_string[:50]}...</code>
• 小时限制: {limit_display}
• 状态: ✅ 已启用"""
                else:
                    message = f"❌ 添加失败，可能已存在同名配置: {ua_name}"

            except Exception as e:
                message = f"❌ 添加失败: {str(e)}"

            # 清理会话数据
            if user_id in self._user_data:
                del self._user_data[user_id]

            keyboard = [
                [InlineKeyboardButton("� 查看UA列表", callback_data="ua_list")],
                [InlineKeyboardButton("➕ 继续添加", callback_data="ua_add")],
                [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

    async def _handle_blacklist_callback(self, query, callback_data):
        """处理黑名单相关回调"""
        if callback_data == "blacklist_list":
            try:
                blacklist = await self.config_service.get_ip_blacklist()

                message = "🚫 <b>IP黑名单列表</b>\n\n"

                if not blacklist:
                    message += "📝 暂无黑名单记录"
                else:
                    import html
                    for i, ip_record in enumerate(blacklist[:10], 1):
                        status = "✅" if ip_record.enabled else "❌"
                        ip_addr = html.escape(ip_record.ip_address)
                        message += f"{i}. {status} <code>{ip_addr}</code>\n"
                        if ip_record.reason:
                            reason = html.escape(ip_record.reason)
                            message += f"   原因: {reason}\n"
                        message += f"   时间: {ip_record.created_at.strftime('%m-%d %H:%M')}\n\n"

                # 添加刷新时间
                from datetime import datetime
                message += f"\n<i>刷新时间: {datetime.now().strftime('%H:%M:%S')}</i>"

                keyboard = [
                    [
                        InlineKeyboardButton("➕ 添加IP", callback_data="blacklist_add"),
                        InlineKeyboardButton("🔄 刷新列表", callback_data="blacklist_list")
                    ],
                    [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                try:
                    await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)
                except Exception as edit_error:
                    # 如果消息内容相同，忽略错误
                    if "message is not modified" not in str(edit_error).lower():
                        raise

            except Exception as e:
                await query.edit_message_text(f"❌ 获取黑名单失败: {str(e)}")

        elif callback_data == "blacklist_add":
            # 开始添加IP黑名单的会话流程
            user_id = query.from_user.id
            self._user_data[user_id] = {"action": "add_ip", "step": "ip_address"}

            message = """➕ <b>添加IP到黑名单</b>

请输入要封禁的IP地址：

<i>💡 示例: 192.168.1.100</i>"""

            keyboard = [
                [InlineKeyboardButton("❌ 取消", callback_data="blacklist_cancel")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif callback_data == "blacklist_cancel":
            # 取消添加IP
            user_id = query.from_user.id
            if user_id in self._user_data:
                del self._user_data[user_id]

            message = "❌ 已取消添加IP到黑名单"
            keyboard = [
                [InlineKeyboardButton("🔙 返回IP管理", callback_data="blacklist_list")],
                [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)

        elif callback_data == "ip_reason_skip":
            # 跳过原因，直接创建黑名单记录
            user_id = query.from_user.id
            if user_id not in self._user_data or self._user_data[user_id].get("action") != "add_ip":
                await query.answer("⚠️ 会话已过期，请重新开始", show_alert=True)
                return

            ip_address = self._user_data[user_id].get("ip_address", "")
            await self._create_ip_blacklist(query, user_id, ip_address, None)

    async def _handle_logs_callback(self, query, callback_data):
        """处理日志相关回调"""
        if callback_data == "logs_recent":
            try:
                logs = await self.stats_service.get_recent_logs(limit=10)

                message = "📝 <b>最近日志</b>\n\n"

                if not logs:
                    message += "📝 暂无日志记录"
                else:
                    import html
                    for log in logs:
                        level_emoji = {"INFO": "ℹ️", "WARN": "⚠️", "ERROR": "❌"}.get(log.level, "📝")
                        log_msg = html.escape(log.message[:100])
                        message += f"{level_emoji} <b>{log.level}</b> - {log.created_at.strftime('%H:%M:%S')}\n"
                        message += f"   {log_msg}...\n\n"

                # 添加刷新时间
                from datetime import datetime
                message += f"\n<i>刷新时间: {datetime.now().strftime('%H:%M:%S')}</i>"

                keyboard = [
                    [
                        InlineKeyboardButton("🔄 刷新日志", callback_data="logs_recent"),
                        InlineKeyboardButton("⚠️ 错误日志", callback_data="logs_error")
                    ],
                    [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                try:
                    await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)
                except Exception as edit_error:
                    # 如果消息内容相同，忽略错误
                    if "message is not modified" not in str(edit_error).lower():
                        raise

            except Exception as e:
                await query.edit_message_text(f"❌ 获取日志失败: {str(e)}")

        elif callback_data == "logs_error":
            try:
                logs = await self.stats_service.get_logs_by_level(level="ERROR", limit=10)

                message = "⚠️ <b>错误日志</b>\n\n"

                if not logs:
                    message += "📝 暂无错误日志记录"
                else:
                    import html
                    for log in logs:
                        log_msg = html.escape(log.message[:100])
                        message += f"❌ <b>ERROR</b> - {log.created_at.strftime('%H:%M:%S')}\n"
                        message += f"   {log_msg}...\n\n"

                # 添加刷新时间
                from datetime import datetime
                message += f"\n<i>刷新时间: {datetime.now().strftime('%H:%M:%S')}</i>"

                keyboard = [
                    [
                        InlineKeyboardButton("🔄 刷新错误日志", callback_data="logs_error"),
                        InlineKeyboardButton("📝 全部日志", callback_data="logs_recent")
                    ],
                    [InlineKeyboardButton("🏠 返回主菜单", callback_data="main_menu")]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                try:
                    await query.edit_message_text(message, parse_mode='HTML', reply_markup=reply_markup)
                except Exception as edit_error:
                    # 如果消息内容相同，忽略错误
                    if "message is not modified" not in str(edit_error).lower():
                        raise

            except Exception as e:
                await query.edit_message_text(f"❌ 获取错误日志失败: {str(e)}")
