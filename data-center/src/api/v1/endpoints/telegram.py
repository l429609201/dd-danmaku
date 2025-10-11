"""
Telegram机器人管理API端点
"""
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx
import logging
import asyncio

from src.models.auth import User
from src.api.v1.endpoints.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()

class BotMenuRequest(BaseModel):
    bot_token: str

class BotMenuResponse(BaseModel):
    success: bool
    message: str

@router.post("/create-menu", response_model=BotMenuResponse)
async def create_bot_menu(
    request: BotMenuRequest,
    current_user: User = Depends(get_current_user)
):
    """创建Telegram机器人菜单"""
    try:
        # 定义机器人菜单命令
        menu_commands = [
            {
                "command": "start",
                "description": "开始使用机器人"
            },
            {
                "command": "help",
                "description": "查看帮助信息"
            },
            {
                "command": "status",
                "description": "查看系统状态"
            },
            {
                "command": "stats",
                "description": "查看统计数据"
            },
            {
                "command": "config",
                "description": "查看配置信息"
            },
            {
                "command": "logs",
                "description": "查看最近日志"
            }
        ]

        # 调用Telegram Bot API设置菜单
        telegram_api_url = f"https://api.telegram.org/bot{request.bot_token}/setMyCommands"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                telegram_api_url,
                json={"commands": menu_commands}
            )

            if response.status_code == 200:
                result = response.json()
                if result.get("ok"):
                    logger.info(f"✅ Telegram机器人菜单创建成功")
                    return BotMenuResponse(
                        success=True,
                        message="机器人菜单创建成功！用户现在可以在聊天中看到命令菜单。"
                    )
                else:
                    error_msg = result.get("description", "未知错误")
                    logger.error(f"❌ Telegram API返回错误: {error_msg}")
                    return BotMenuResponse(
                        success=False,
                        message=f"Telegram API错误: {error_msg}"
                    )
            else:
                logger.error(f"❌ Telegram API请求失败: HTTP {response.status_code}")
                return BotMenuResponse(
                    success=False,
                    message=f"请求失败: HTTP {response.status_code}"
                )

    except httpx.TimeoutException:
        logger.error("❌ Telegram API请求超时")
        return BotMenuResponse(
            success=False,
            message="请求超时，请检查网络连接"
        )
    except Exception as e:
        logger.error(f"❌ 创建机器人菜单失败: {e}")
        return BotMenuResponse(
            success=False,
            message=f"创建失败: {str(e)}"
        )

@router.post("/restart", response_model=Dict[str, Any])
async def restart_telegram_bot(
    current_user: User = Depends(get_current_user)
):
    """重启Telegram机器人"""
    try:
        from src.main import telegram_bot
        from src.services.web_config_service import WebConfigService

        logger.info("🔄 开始重启Telegram机器人...")

        # 1. 停止现有机器人
        if telegram_bot:
            logger.info("🛑 停止现有机器人...")
            try:
                await telegram_bot.stop()
                logger.info("✅ 现有机器人已停止")
            except Exception as e:
                logger.warning(f"停止机器人时出现警告: {e}")

        # 2. 等待一小段时间确保资源释放
        await asyncio.sleep(2)

        # 3. 从数据库重新加载配置
        web_config_service = WebConfigService()
        settings_data = await web_config_service.get_system_settings()

        if not settings_data or not settings_data.tg_bot_token or not settings_data.tg_admin_user_ids:
            return {
                "success": False,
                "message": "TG机器人配置不完整，请先配置Bot Token和管理员ID"
            }

        # 4. 创建新的机器人实例
        from src.telegram.bot import TelegramBot

        # 将管理员ID字符串转换为整数列表
        admin_ids = []
        if settings_data.tg_admin_user_ids:
            admin_ids = [int(uid.strip()) for uid in settings_data.tg_admin_user_ids.split(',') if uid.strip()]

        logger.info(f"🤖 使用新配置创建机器人实例...")
        logger.info(f"   - Token: {settings_data.tg_bot_token[:8]}...")
        logger.info(f"   - Admin IDs: {admin_ids}")

        new_bot = TelegramBot(
            token=settings_data.tg_bot_token,
            admin_user_ids=admin_ids
        )

        # 5. 启动新机器人
        logger.info("🚀 启动新机器人...")
        bot_task = asyncio.create_task(new_bot.start())

        # 6. 更新全局变量
        import src.main
        src.main.telegram_bot = new_bot

        logger.info("✅ Telegram机器人重启成功")

        return {
            "success": True,
            "message": "Telegram机器人重启成功"
        }

    except Exception as e:
        logger.error(f"❌ 重启Telegram机器人失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"重启失败: {str(e)}"
        }
