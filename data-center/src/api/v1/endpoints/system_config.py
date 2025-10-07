"""
系统配置管理API端点
"""
import secrets
import string
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from src.services.config_manager import config_manager
from src.middleware.auth_middleware import get_current_user
from src.models.user import User

router = APIRouter()


class ConfigItem(BaseModel):
    key: str
    value: str
    description: str = ""
    config_type: str = "string"


class ConfigUpdate(BaseModel):
    value: str
    description: str = ""
    config_type: str = "string"


class ApiKeyGenerate(BaseModel):
    length: int = 32


class ApiKeySet(BaseModel):
    api_key: str


@router.get("/configs", response_model=List[Dict[str, Any]])
async def get_all_configs(current_user: User = Depends(get_current_user)):
    """获取所有系统配置"""
    try:
        configs = config_manager.get_configs_list()
        return configs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/{key}")
async def get_config(key: str, current_user: User = Depends(get_current_user)):
    """获取指定配置"""
    try:
        value = config_manager.get_config(key)
        if value is None:
            raise HTTPException(status_code=404, detail="配置不存在")
        
        return {
            "key": key,
            "value": value
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
async def create_config(
    config: ConfigItem,
    current_user: User = Depends(get_current_user)
):
    """创建新配置"""
    try:
        success = config_manager.set_config(
            config.key,
            config.value,
            config.description,
            config.config_type
        )
        
        if success:
            return {"message": "配置创建成功", "key": config.key}
        else:
            raise HTTPException(status_code=500, detail="配置创建失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config/{key}")
async def update_config(
    key: str,
    config: ConfigUpdate,
    current_user: User = Depends(get_current_user)
):
    """更新配置"""
    try:
        success = config_manager.set_config(
            key,
            config.value,
            config.description,
            config.config_type
        )
        
        if success:
            return {"message": "配置更新成功", "key": key}
        else:
            raise HTTPException(status_code=500, detail="配置更新失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/config/{key}")
async def delete_config(key: str, current_user: User = Depends(get_current_user)):
    """删除配置"""
    try:
        success = config_manager.delete_config(key)
        
        if success:
            return {"message": "配置删除成功", "key": key}
        else:
            raise HTTPException(status_code=404, detail="配置不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-api-key")
async def generate_api_key(
    params: ApiKeyGenerate = ApiKeyGenerate(),
    current_user: User = Depends(get_current_user)
):
    """生成API密钥"""
    try:
        # 生成随机API密钥
        chars = string.ascii_letters + string.digits
        api_key = ''.join(secrets.choice(chars) for _ in range(params.length))
        
        return {
            "api_key": api_key,
            "length": params.length,
            "message": "API密钥生成成功"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/set-data-center-api-key")
async def set_data_center_api_key(
    request: ApiKeySet,
    current_user: User = Depends(get_current_user)
):
    """设置数据中心API密钥"""
    try:
        success = config_manager.set_data_center_api_key(request.api_key)

        if success:
            return {"message": "数据中心API密钥设置成功"}
        else:
            raise HTTPException(status_code=500, detail="API密钥设置失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data-center-api-key")
async def get_data_center_api_key(current_user: User = Depends(get_current_user)):
    """获取数据中心API密钥（脱敏显示）"""
    try:
        api_key = config_manager.get_data_center_api_key()
        
        if api_key:
            # 脱敏显示：只显示前8位和后4位
            masked_key = f"{api_key[:8]}...{api_key[-4:]}" if len(api_key) > 12 else "***"
            return {
                "api_key_masked": masked_key,
                "has_key": True,
                "key_length": len(api_key)
            }
        else:
            return {
                "api_key_masked": None,
                "has_key": False,
                "key_length": 0
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/set-telegram-config")
async def set_telegram_config(
    bot_token: str,
    admin_user_ids: List[int],
    current_user: User = Depends(get_current_user)
):
    """设置Telegram配置"""
    try:
        # 设置Bot Token
        token_success = config_manager.set_telegram_bot_token(bot_token)
        
        # 设置管理员用户ID
        admin_success = config_manager.set_telegram_admin_users(admin_user_ids)
        
        if token_success and admin_success:
            return {"message": "Telegram配置设置成功"}
        else:
            raise HTTPException(status_code=500, detail="Telegram配置设置失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/telegram-config")
async def get_telegram_config(current_user: User = Depends(get_current_user)):
    """获取Telegram配置"""
    try:
        bot_token = config_manager.get_telegram_bot_token()
        admin_users = config_manager.get_telegram_admin_users()
        
        # 脱敏显示Bot Token
        masked_token = None
        if bot_token:
            masked_token = f"{bot_token[:8]}...{bot_token[-8:]}" if len(bot_token) > 16 else "***"
        
        return {
            "bot_token_masked": masked_token,
            "has_bot_token": bool(bot_token),
            "admin_user_ids": admin_users
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
