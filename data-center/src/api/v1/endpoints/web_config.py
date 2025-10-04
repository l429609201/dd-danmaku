"""
Web界面配置管理API端点
"""
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from src.services.web_config_service import WebConfigService

router = APIRouter()

# Pydantic模型
class SystemSettingsUpdate(BaseModel):
    project_name: str = None
    project_description: str = None
    database_type: str = None
    sqlite_path: str = None
    mysql_host: str = None
    mysql_port: int = None
    mysql_user: str = None
    mysql_password: str = None
    mysql_database: str = None
    postgres_host: str = None
    postgres_port: int = None
    postgres_user: str = None
    postgres_password: str = None
    postgres_database: str = None
    tg_bot_token: str = None
    tg_admin_user_ids: str = None
    worker_endpoints: str = None
    worker_api_key: str = None
    sync_interval_hours: int = None
    sync_retry_attempts: int = None
    sync_timeout_seconds: int = None
    log_level: str = None
    secret_key: str = None
    access_token_expire_minutes: int = None

class ConfigItem(BaseModel):
    category: str
    key: str
    value: Any
    value_type: str = "string"
    description: str = None
    is_sensitive: bool = False

class ConfigResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

# 依赖注入
def get_web_config_service() -> WebConfigService:
    return WebConfigService()

@router.get("/system-settings", response_model=Dict[str, Any])
async def get_system_settings(
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取系统设置"""
    try:
        settings = await web_config_service.get_system_settings()
        
        if not settings:
            # 如果没有设置，创建默认设置
            settings = await web_config_service.create_default_system_settings()
        
        return settings.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/system-settings/with-secrets", response_model=Dict[str, Any])
async def get_system_settings_with_secrets(
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取系统设置（包含敏感信息）"""
    try:
        settings = await web_config_service.get_system_settings()
        
        if not settings:
            settings = await web_config_service.create_default_system_settings()
        
        return settings.to_dict_with_secrets()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/system-settings", response_model=ConfigResponse)
async def update_system_settings(
    settings_data: SystemSettingsUpdate,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """更新系统设置"""
    try:
        # 过滤None值
        update_data = {k: v for k, v in settings_data.dict().items() if v is not None}
        
        success = await web_config_service.update_system_settings(update_data)
        
        if success:
            return ConfigResponse(
                success=True,
                message="系统设置更新成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="系统设置更新失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/configs", response_model=Dict[str, List[Dict]])
async def get_all_configs(
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取所有配置（按分类分组）"""
    try:
        configs = await web_config_service.get_all_configs()
        return configs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/configs/{category}", response_model=List[Dict])
async def get_configs_by_category(
    category: str,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """根据分类获取配置"""
    try:
        configs = await web_config_service.get_config_by_category(category)
        return [config.to_dict() for config in configs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/configs/{category}/{key}", response_model=Dict[str, Any])
async def get_config_value(
    category: str,
    key: str,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取配置值"""
    try:
        value = await web_config_service.get_config_value(category, key)
        
        if value is None:
            raise HTTPException(status_code=404, detail="配置不存在")
        
        return {
            "category": category,
            "key": key,
            "value": value
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/configs", response_model=ConfigResponse)
async def set_config_value(
    config_item: ConfigItem,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """设置配置值"""
    try:
        success = await web_config_service.set_config_value(
            category=config_item.category,
            key=config_item.key,
            value=config_item.value,
            value_type=config_item.value_type,
            description=config_item.description,
            is_sensitive=config_item.is_sensitive
        )
        
        if success:
            return ConfigResponse(
                success=True,
                message="配置设置成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="配置设置失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/configs/{category}/{key}", response_model=ConfigResponse)
async def update_config_value(
    category: str,
    key: str,
    config_item: ConfigItem,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """更新配置值"""
    try:
        success = await web_config_service.set_config_value(
            category=category,
            key=key,
            value=config_item.value,
            value_type=config_item.value_type,
            description=config_item.description,
            is_sensitive=config_item.is_sensitive
        )
        
        if success:
            return ConfigResponse(
                success=True,
                message="配置更新成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="配置更新失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/configs/{category}/{key}", response_model=ConfigResponse)
async def delete_config(
    category: str,
    key: str,
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """删除配置"""
    try:
        success = await web_config_service.delete_config(category, key)
        
        if success:
            return ConfigResponse(
                success=True,
                message="配置删除成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="配置删除失败，配置不存在"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/init-defaults", response_model=ConfigResponse)
async def init_default_configs(
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """初始化默认配置"""
    try:
        await web_config_service.init_default_configs()
        
        return ConfigResponse(
            success=True,
            message="默认配置初始化成功"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
