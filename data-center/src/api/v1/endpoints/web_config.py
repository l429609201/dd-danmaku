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
        from src.services.config_manager import config_manager

        # 从系统设置中获取worker配置
        settings = await web_config_service.get_system_settings()
        if not settings:
            return []

        # 只返回单个Worker配置
        worker_endpoint = settings.worker_endpoints or ""
        # 使用config_manager统一获取API Key
        worker_api_key = config_manager.get_data_center_api_key() or ""

        if worker_endpoint:
            # 只取第一个端点作为主Worker
            endpoint = worker_endpoint.split(',')[0].strip() if ',' in worker_endpoint else worker_endpoint.strip()
            if endpoint:
                return [{
                    "id": "worker_1",
                    "name": "主Worker节点 (Primary Worker Node)",
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
            new_api_key = None
            if worker_data.api_key == "regenerate":
                from src.services.config_manager import config_manager
                new_api_key = generate_api_key()
                config_manager.set_data_center_api_key(new_api_key)

            success = await web_config_service.update_system_settings(update_data)

            if success:
                return ConfigResponse(
                    success=True,
                    message="Worker配置更新成功",
                    data={"api_key": new_api_key} if new_api_key else {}
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

@router.get("/workers/current-api-key", response_model=ConfigResponse)
async def get_current_api_key(
    current_user: User = Depends(get_current_user)
):
    """获取当前的API密钥"""
    try:
        from src.services.config_manager import config_manager

        current_api_key = config_manager.get_data_center_api_key() or ""

        return ConfigResponse(
            success=True,
            message="API密钥获取成功",
            data={"api_key": current_api_key}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/workers/generate-api-key", response_model=ConfigResponse)
async def generate_new_api_key(
    current_user: User = Depends(get_current_user)
):
    """生成新的API密钥"""
    try:
        from src.services.config_manager import config_manager

        new_api_key = generate_api_key()

        # 使用config_manager统一管理API Key
        success = config_manager.set_data_center_api_key(new_api_key)

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

        # 转换为前端期望的格式
        result = []
        for config in ua_configs:
            # 转换pathLimits格式
            path_limits = []
            if config.path_specific_limits:
                for path, limit_data in config.path_specific_limits.items():
                    path_limits.append({
                        "path": path,
                        "maxRequestsPerHour": limit_data.get("maxRequestsPerHour", 50)
                    })

            result.append({
                "name": config.name,
                "userAgent": config.user_agent,
                "enabled": config.enabled,
                "maxRequestsPerHour": config.hourly_limit,
                "maxRequestsPerDay": 1000,  # 默认值，因为数据库中没有这个字段
                "description": "",  # 默认值，因为数据库中没有这个字段
                "pathLimits": path_limits
            })

        return result

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

@router.get("/worker/stats")
async def get_worker_stats(
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取Worker统计数据"""
    try:
        import httpx

        # 获取Worker配置
        system_settings = await web_config_service.get_system_settings()
        if not system_settings or not system_settings.worker_endpoints:
            return {"success": False, "message": "未配置Worker端点"}

        worker_endpoint = system_settings.worker_endpoints.strip()
        if not worker_endpoint:
            return {"success": False, "message": "Worker端点为空"}

        # 请求Worker统计数据
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                stats_url = f"{worker_endpoint.rstrip('/')}/worker-api/stats"
                headers = {}
                if system_settings.worker_api_key:
                    headers['X-API-Key'] = system_settings.worker_api_key

                response = await client.get(stats_url, headers=headers)

                if response.status_code == 200:
                    stats_data = response.json()
                    return {
                        "success": True,
                        "stats": stats_data,
                        "worker_endpoint": worker_endpoint
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Worker响应错误: HTTP {response.status_code}",
                        "worker_endpoint": worker_endpoint
                    }

            except httpx.TimeoutException:
                return {
                    "success": False,
                    "message": "Worker请求超时",
                    "worker_endpoint": worker_endpoint
                }
            except Exception as e:
                return {
                    "success": False,
                    "message": f"请求Worker失败: {str(e)}",
                    "worker_endpoint": worker_endpoint
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/worker/realtime-stats", response_model=Dict[str, Any])
async def get_worker_realtime_stats(
    current_user: User = Depends(get_current_user),
    web_config_service: WebConfigService = Depends(get_web_config_service)
):
    """获取Worker实时统计数据（用于弹窗显示）"""
    try:
        import httpx
        import asyncio

        # 从系统设置中获取worker配置
        settings = await web_config_service.get_system_settings()
        if not settings or not settings.worker_endpoints:
            return {
                "success": False,
                "message": "未配置Worker端点"
            }

        # 获取第一个Worker端点
        worker_endpoint = settings.worker_endpoints.split(',')[0].strip()
        if not worker_endpoint.startswith('http'):
            worker_endpoint = f"https://{worker_endpoint}"

        # 获取数据中心API Key（统一使用同一个密钥进行双向认证）
        from src.services.config_manager import config_manager
        worker_api_key = config_manager.get_data_center_api_key()

        # 准备请求头
        headers = {}
        if worker_api_key:
            headers['X-API-Key'] = worker_api_key

        # 直接从Worker获取实时统计数据
        async with httpx.AsyncClient(timeout=10.0) as client:
            stats_url = f"{worker_endpoint}/worker-api/stats"
            logger.info(f"📊 数据中心请求Worker实时统计:")
            logger.info(f"   - 请求URL: {stats_url}")
            logger.info(f"   - 请求头: {headers}")

            response = await client.get(stats_url, headers=headers)
            logger.info(f"   - 响应状态: {response.status_code}")

            if response.status_code == 200:
                stats_data = response.json()
                logger.info(f"📊 Worker实时统计数据获取成功:")
                logger.info(f"   - Worker ID: {stats_data.get('worker_id', '未知')}")
                logger.info(f"   - 时间戳: {stats_data.get('timestamp', '未知')}")
                logger.info(f"   - 总请求数: {stats_data.get('requests_total', 0)}")
                logger.info(f"   - 日志数量: {stats_data.get('logs_count', 0)}")
                logger.info(f"   - 频率限制统计: {bool(stats_data.get('rate_limit_stats'))}")

                # 检查路径限制统计
                rate_limit_stats = stats_data.get('rate_limit_stats', {})
                path_limit_stats = rate_limit_stats.get('path_limit_stats', {})
                logger.info(f"   - 路径限制数量: {len(path_limit_stats)}")
                if path_limit_stats:
                    for path, stats in path_limit_stats.items():
                        logger.info(f"     * {path}: 活跃IP={stats.get('active_ips', 0)}, 总请求={stats.get('total_requests', 0)}")

                return {
                    "success": True,
                    "stats": stats_data,
                    "worker_endpoint": worker_endpoint,
                    "timestamp": stats_data.get("timestamp"),
                    "last_update": "实时数据"
                }
            else:
                error_text = response.text if response.status_code != 200 else "Unknown error"
                logger.error(f"❌ Worker响应错误: HTTP {response.status_code} - {error_text}")
                return {
                    "success": False,
                    "message": f"Worker响应错误: HTTP {response.status_code} - {error_text}",
                    "worker_endpoint": worker_endpoint
                }

    except asyncio.TimeoutError:
        return {
            "success": False,
            "message": "Worker响应超时",
            "worker_endpoint": worker_endpoint
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"获取实时统计数据失败: {str(e)}",
            "worker_endpoint": worker_endpoint
        }
