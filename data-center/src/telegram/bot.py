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
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.error import TelegramError

from src.config import settings
from src.database import get_db_sync
from src.services.config_service import ConfigService
from src.services.stats_service import StatsService
from src.models.logs import TelegramLog

logger = logging.getLogger(__name__)

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

        logger.info(f"🤖 初始化TG机器人，管理员ID: {self.admin_user_ids}")

    async def start(self):
        """启动机器人 - 轮询模式（参考MoviePilot实现）"""
        try:
            logger.info("🚀 启动Telegram机器人轮询模式...")

            # 创建应用
            self.application = Application.builder().token(self.token).build()

            # 注册命令处理器
            await self._register_handlers()

            # 设置机器人命令菜单
            await self._setup_bot_commands()

            # 初始化应用（重要：在轮询前必须初始化）
            await self.application.initialize()
            await self.application.start()

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
                        await self.application.initialize()
                        await self.application.start()
                        await self.application.updater.start_polling(
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
                        await self.application.updater.stop()
                        await self.application.stop()
                        await self.application.shutdown()

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

            message = "👤 **UA配置管理**\n\n"

            if not ua_configs:
                message += "📝 暂无UA配置"
            else:
                for i, config in enumerate(ua_configs[:10], 1):  # 限制显示前10个
                    status = "✅" if config.enabled else "❌"
                    message += f"{i}. {status} **{config.name}**\n"
                    message += f"   UA: `{config.user_agent[:50]}...`\n"
                    message += f"   限制: {config.hourly_limit}/小时\n\n"

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

            await update.message.reply_text(message, parse_mode='Markdown', reply_markup=reply_markup)
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

            message = "🚫 **IP黑名单管理**\n\n"

            if not blacklist:
                message += "📝 暂无黑名单记录"
            else:
                for i, ip_record in enumerate(blacklist[:10], 1):  # 限制显示前10个
                    status = "✅" if ip_record.enabled else "❌"
                    message += f"{i}. {status} `{ip_record.ip_address}`\n"
                    if ip_record.reason:
                        message += f"   原因: {ip_record.reason}\n"
                    message += f"   时间: {ip_record.created_at.strftime('%m-%d %H:%M')}\n\n"

            keyboard = [
                [
                    InlineKeyboardButton("➕ 添加IP", callback_data="blacklist_add"),
                    InlineKeyboardButton("🔄 刷新列表", callback_data="blacklist_list")
                ]
            ]

            reply_markup = InlineKeyboardMarkup(keyboard)

            await update.message.reply_text(message, parse_mode='Markdown', reply_markup=reply_markup)
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
            if callback_data == "status":
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

            keyboard = [[InlineKeyboardButton("🔄 刷新状态", callback_data="status")]]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

        except Exception as e:
            await query.edit_message_text(f"❌ 获取状态失败: {str(e)}")

    async def _handle_ua_callback(self, query, callback_data):
        """处理UA相关回调"""
        if callback_data == "ua_list":
            try:
                ua_configs = await self.config_service.get_ua_configs()

                message = "👤 **UA配置列表**\n\n"

                if not ua_configs:
                    message += "📝 暂无UA配置"
                else:
                    for i, config in enumerate(ua_configs[:10], 1):
                        status = "✅" if config.enabled else "❌"
                        message += f"{i}. {status} **{config.name}**\n"
                        message += f"   UA: `{config.user_agent[:50]}...`\n"
                        message += f"   限制: {config.hourly_limit}/小时\n\n"

                keyboard = [
                    [
                        InlineKeyboardButton("➕ 添加配置", callback_data="ua_add"),
                        InlineKeyboardButton("🔄 刷新列表", callback_data="ua_list")
                    ]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

            except Exception as e:
                await query.edit_message_text(f"❌ 获取UA配置失败: {str(e)}")

        elif callback_data == "ua_add":
            message = """➕ **添加UA配置**

请通过Web界面添加新的UA配置：
🌐 http://localhost:7759

**配置项目：**
• UA名称
• User-Agent字符串
• 小时限制
• 路径特定限制
"""
            keyboard = [[InlineKeyboardButton("🔙 返回UA管理", callback_data="ua_list")]]
            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

    async def _handle_blacklist_callback(self, query, callback_data):
        """处理黑名单相关回调"""
        if callback_data == "blacklist_list":
            try:
                blacklist = await self.config_service.get_ip_blacklist()

                message = "🚫 **IP黑名单列表**\n\n"

                if not blacklist:
                    message += "📝 暂无黑名单记录"
                else:
                    for i, ip_record in enumerate(blacklist[:10], 1):
                        status = "✅" if ip_record.enabled else "❌"
                        message += f"{i}. {status} `{ip_record.ip_address}`\n"
                        if ip_record.reason:
                            message += f"   原因: {ip_record.reason}\n"
                        message += f"   时间: {ip_record.created_at.strftime('%m-%d %H:%M')}\n\n"

                keyboard = [
                    [
                        InlineKeyboardButton("➕ 添加IP", callback_data="blacklist_add"),
                        InlineKeyboardButton("🔄 刷新列表", callback_data="blacklist_list")
                    ]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

                await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

            except Exception as e:
                await query.edit_message_text(f"❌ 获取黑名单失败: {str(e)}")

    async def _handle_logs_callback(self, query, callback_data):
        """处理日志相关回调"""
        if callback_data == "logs_recent":
            try:
                logs = await self.stats_service.get_recent_logs(limit=10)

                message = "📝 **最近日志**\n\n"

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

                await query.edit_message_text(message, parse_mode='Markdown', reply_markup=reply_markup)

            except Exception as e:
                await query.edit_message_text(f"❌ 获取日志失败: {str(e)}")
