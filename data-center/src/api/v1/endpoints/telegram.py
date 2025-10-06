"""
Telegram机器人管理API端点
"""
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx
import logging

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
