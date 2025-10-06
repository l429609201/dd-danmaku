"""
Web界面配置管理API端点
"""
import secrets
import string
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from src.services.web_config_service import WebConfigService
from src.api.v1.endpoints.auth import get_current_user
from src.models.auth import User

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

class WorkerConfig(BaseModel):
    id: str
    name: str
    endpoint: str
    api_key: str
    status: str = "offline"
    last_sync: str = None

class WorkerConfigCreate(BaseModel):
    name: str
    endpoint: str
    description: str = None

class WorkerConfigUpdate(BaseModel):
    name: str = None
    endpoint: str = None
    api_key: str = None

# 依赖注入
def get_web_config_service() -> WebConfigService:
    return WebConfigService()

@router.get("/system-settings", response_model=Dict[str, Any])
async def get_system_settings(
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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

def generate_api_key(length: int = 32) -> str:
    """生成随机API密钥"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

@router.get("/workers", response_model=List[Dict])
async def get_workers(
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取所有Worker配置"""
    try:
        # 从系统设置中获取worker配置
        settings = await web_config_service.get_system_settings()
        if not settings:
            return []

        # 只返回单个Worker配置
        worker_endpoint = settings.worker_endpoints or ""
        worker_api_key = settings.worker_api_key or ""

        if worker_endpoint:
            # 只取第一个端点作为主Worker
            endpoint = worker_endpoint.split(',')[0].strip() if ',' in worker_endpoint else worker_endpoint.strip()
            if endpoint:
                return [{
                    "id": "worker_1",
                    "name": "主Worker",
                    "endpoint": endpoint,
                    "api_key": worker_api_key,
                    "status": "offline",
                    "last_sync": None
                }]

        return []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/workers", response_model=ConfigResponse)
async def update_worker(
    worker_data: WorkerConfigCreate,
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """更新Worker配置"""
    try:
        settings = await web_config_service.get_system_settings()
        if not settings:
            settings = await web_config_service.create_default_system_settings()

        # 直接设置单个Worker端点
        success = await web_config_service.update_system_settings({
            "worker_endpoints": worker_data.endpoint.strip()
        })

        if success:
            return ConfigResponse(
                success=True,
                message="Worker配置更新成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="Worker配置更新失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/workers/{worker_id}", response_model=ConfigResponse)
async def update_worker(
    worker_id: str,
    worker_data: WorkerConfigUpdate,
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """更新Worker配置"""
    try:
        settings = await web_config_service.get_system_settings()
        if not settings:
            return ConfigResponse(success=False, message="系统设置不存在")

        current_endpoints = settings.worker_endpoints or ""
        endpoints = [ep.strip() for ep in current_endpoints.split(',') if ep.strip()]

        # 解析worker_id获取索引
        try:
            worker_index = int(worker_id.split('_')[1]) - 1
        except (IndexError, ValueError):
            return ConfigResponse(success=False, message="无效的Worker ID")

        if 0 <= worker_index < len(endpoints):
            # 更新endpoint
            if worker_data.endpoint:
                endpoints[worker_index] = worker_data.endpoint

            update_data = {"worker_endpoints": ','.join(endpoints)}

            # 如果需要重新生成API密钥
            if worker_data.api_key == "regenerate":
                update_data["worker_api_key"] = generate_api_key()

            success = await web_config_service.update_system_settings(update_data)

            if success:
                return ConfigResponse(
                    success=True,
                    message="Worker配置更新成功",
                    data={"api_key": update_data.get("worker_api_key")}
                )
            else:
                return ConfigResponse(success=False, message="Worker配置更新失败")
        else:
            return ConfigResponse(success=False, message="Worker不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/workers/{worker_id}", response_model=ConfigResponse)
async def delete_worker(
    worker_id: str,
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """清空Worker配置"""
    try:
        # 清空Worker端点配置
        success = await web_config_service.update_system_settings({
            "worker_endpoints": ""
        })

        if success:
            return ConfigResponse(success=True, message="Worker配置已清空")
        else:
            return ConfigResponse(success=False, message="Worker配置清空失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/workers/generate-api-key", response_model=ConfigResponse)
async def generate_new_api_key(
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """生成新的API密钥"""
    try:
        new_api_key = generate_api_key()

        success = await web_config_service.update_system_settings({
            "worker_api_key": new_api_key
        })

        if success:
            return ConfigResponse(
                success=True,
                message="API密钥生成成功",
                data={"api_key": new_api_key}
            )
        else:
            return ConfigResponse(success=False, message="API密钥生成失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ua-configs")
async def get_ua_configs(
    current_user: User = Depends(get_current_user)
):
    """获取UA配置"""
    try:
        from src.services.config_service import ConfigService
        config_service = ConfigService()

        # 获取UA配置
        ua_configs = await config_service.get_ua_configs()
        return ua_configs or []

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ua-configs")
async def save_ua_configs(
    ua_configs: List[Dict[str, Any]],
    current_user: User = Depends(get_current_user)
):
    """保存UA配置"""
    try:
        from src.services.config_service import ConfigService
        config_service = ConfigService()

        # 保存UA配置
        success = await config_service.save_ua_configs(ua_configs)

        if success:
            return {"success": True, "message": "UA配置保存成功"}
        else:
            return {"success": False, "message": "UA配置保存失败"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ip-blacklist")
async def get_ip_blacklist(
    current_user: User = Depends(get_current_user)
):
    """获取IP黑名单"""
    try:
        from src.services.config_service import ConfigService
        config_service = ConfigService()

        # 获取IP黑名单
        ip_blacklist = await config_service.get_ip_blacklist()
        # 转换为字符串列表
        return [ip.ip_address for ip in ip_blacklist if ip.enabled] if ip_blacklist else []

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ip-blacklist")
async def save_ip_blacklist(
    ip_blacklist: List[str],
    current_user: User = Depends(get_current_user)
):
    """保存IP黑名单"""
    try:
        from src.services.config_service import ConfigService
        config_service = ConfigService()

        # 保存IP黑名单
        success = await config_service.save_ip_blacklist(ip_blacklist)

        if success:
            return {"success": True, "message": "IP黑名单保存成功"}
        else:
            return {"success": False, "message": "IP黑名单保存失败"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
