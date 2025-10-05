"""
Worker配置管理API端点
"""
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx
import logging
import secrets
import string
from datetime import datetime

from src.services.auth_service import AuthService, get_auth_service
from src.models.auth import User
from src.api.v1.endpoints.auth import get_current_user

logger = logging.getLogger(__name__)

# Worker配置模型
class WorkerConfigRequest(BaseModel):
    worker_url: str
    api_key: str

class WorkerPushRequest(BaseModel):
    worker_url: str
    api_key: str
    ua_configs: Dict[str, Any] = {}
    ip_blacklist: List[str] = []

class WorkerResponse(BaseModel):
    success: bool
    message: str
    data: Dict[str, Any] = {}

class ApiKeyResponse(BaseModel):
    success: bool
    api_key: str
    message: str

router = APIRouter()

@router.post("/generate-api-key", response_model=ApiKeyResponse)
async def generate_api_key(
    current_user: User = Depends(get_current_user)
):
    """生成Worker API密钥"""
    try:
        # 生成32位随机API密钥
        alphabet = string.ascii_letters + string.digits
        api_key = ''.join(secrets.choice(alphabet) for _ in range(32))

        logger.info(f"用户 {current_user.username} 生成了新的API密钥")

        return ApiKeyResponse(
            success=True,
            api_key=api_key,
            message="API密钥生成成功"
        )
    except Exception as e:
        logger.error(f"生成API密钥失败: {e}")
        return ApiKeyResponse(
            success=False,
            api_key="",
            message=f"生成失败: {str(e)}"
        )

@router.get("/workers", response_model=Dict[str, Any])
async def get_worker_list(
    current_user: User = Depends(get_current_user)
):
    """获取Worker列表"""
    try:
        # 这里可以从数据库获取已配置的Worker列表
        # 暂时返回空列表，等待实际数据库实现
        workers = []

        return {
            "success": True,
            "workers": workers
        }
    except Exception as e:
        logger.error(f"获取Worker列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test-connection", response_model=WorkerResponse)
async def test_worker_connection(
    config: WorkerConfigRequest,
    current_user: User = Depends(get_current_user)
):
    """测试Worker连接"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{config.worker_url}/api/health",
                headers={
                    "X-API-Key": config.api_key,
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                return WorkerResponse(
                    success=True,
                    message="Worker连接成功",
                    data=data
                )
            else:
                return WorkerResponse(
                    success=False,
                    message=f"Worker连接失败: HTTP {response.status_code}"
                )
                
    except httpx.TimeoutException:
        return WorkerResponse(
            success=False,
            message="Worker连接超时"
        )
    except Exception as e:
        logger.error(f"测试Worker连接失败: {e}")
        return WorkerResponse(
            success=False,
            message=f"连接错误: {str(e)}"
        )

@router.post("/push-config", response_model=WorkerResponse)
async def push_config_to_worker(
    push_request: WorkerPushRequest,
    current_user: User = Depends(get_current_user)
):
    """主动推送配置到Worker"""
    try:
        config_data = {
            "ua_configs": push_request.ua_configs,
            "ip_blacklist": push_request.ip_blacklist
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{push_request.worker_url}/api/config/update",
                headers={
                    "X-API-Key": push_request.api_key,
                    "Content-Type": "application/json"
                },
                json=config_data
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"配置推送成功: {result}")
                return WorkerResponse(
                    success=True,
                    message="配置推送成功",
                    data=result
                )
            else:
                error_msg = f"配置推送失败: HTTP {response.status_code}"
                try:
                    error_data = response.json()
                    error_msg += f" - {error_data.get('message', '')}"
                except:
                    pass
                    
                return WorkerResponse(
                    success=False,
                    message=error_msg
                )
                
    except httpx.TimeoutException:
        return WorkerResponse(
            success=False,
            message="配置推送超时"
        )
    except Exception as e:
        logger.error(f"配置推送失败: {e}")
        return WorkerResponse(
            success=False,
            message=f"推送错误: {str(e)}"
        )

@router.get("/stats/{worker_id}", response_model=Dict[str, Any])
async def get_worker_stats(
    worker_id: str,
    current_user: User = Depends(get_current_user)
):
    """获取Worker统计信息"""
    try:
        # 这里可以从数据库获取Worker统计信息
        # 暂时返回空统计数据，等待实际数据库实现
        stats = {
            "worker_id": worker_id,
            "timestamp": 0,
            "requests_total": 0,
            "memory_cache_size": 0,
            "secret_rotation": {
                "secret1_count": 0,
                "secret2_count": 0,
                "current_secret": "1",
                "rotation_limit": 0
            }
        }

        return {
            "success": True,
            "stats": stats
        }
    except Exception as e:
        logger.error(f"获取Worker统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_worker_status(
    current_user: User = Depends(get_current_user)
):
    """获取Worker状态"""
    try:
        # 从环境变量或配置中获取Worker信息
        from src.config import settings
        worker_endpoints = getattr(settings, 'WORKER_ENDPOINTS', '')
        worker_api_keys = getattr(settings, 'WORKER_API_KEYS', [])

        if not worker_endpoints:
            return {
                "worker_id": "unknown",
                "status": "not_configured",
                "last_sync": "从未",
                "data_center_enabled": False,
                "message": "未配置Worker端点"
            }

        # 获取第一个Worker端点进行状态检查
        endpoints = [ep.strip() for ep in worker_endpoints.split(',') if ep.strip()]
        if not endpoints:
            return {
                "worker_id": "unknown",
                "status": "not_configured",
                "last_sync": "从未",
                "data_center_enabled": False
            }

        worker_url = endpoints[0]
        api_key = worker_api_keys[0] if worker_api_keys else ""

        # 调用Worker的健康检查API
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{worker_url}/api/health",
                headers={
                    "X-API-Key": api_key,
                    "Content-Type": "application/json"
                }
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "worker_id": data.get("worker_id", "worker-1"),
                    "status": "healthy",
                    "last_sync": data.get("last_sync", "未知"),
                    "data_center_enabled": True,
                    "uptime": data.get("uptime", 0),
                    "version": data.get("version", "未知")
                }
            else:
                return {
                    "worker_id": "worker-1",
                    "status": "error",
                    "last_sync": "未知",
                    "data_center_enabled": False,
                    "error": f"HTTP {response.status_code}"
                }

    except httpx.TimeoutException:
        return {
            "worker_id": "worker-1",
            "status": "timeout",
            "last_sync": "未知",
            "data_center_enabled": False,
            "error": "连接超时"
        }
    except Exception as e:
        logger.error(f"获取Worker状态失败: {e}")
        return {
            "worker_id": "worker-1",
            "status": "error",
            "last_sync": "未知",
            "data_center_enabled": False,
            "error": str(e)
        }

@router.post("/push-config")
async def push_config_to_worker(
    current_user: User = Depends(get_current_user)
):
    """推送配置到Worker"""
    try:
        from src.config import settings
        from src.services.config_service import ConfigService

        worker_endpoints = getattr(settings, 'WORKER_ENDPOINTS', '')
        worker_api_keys = getattr(settings, 'WORKER_API_KEYS', [])

        if not worker_endpoints:
            raise HTTPException(status_code=400, detail="未配置Worker端点")

        # 获取当前配置
        config_service = ConfigService()
        config_data = await config_service.export_config_for_worker()

        # 推送到所有Worker端点
        endpoints = [ep.strip() for ep in worker_endpoints.split(',') if ep.strip()]
        results = []

        for i, worker_url in enumerate(endpoints):
            api_key = worker_api_keys[i] if i < len(worker_api_keys) else ""

            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        f"{worker_url}/api/config/update",
                        headers={
                            "X-API-Key": api_key,
                            "Content-Type": "application/json"
                        },
                        json=config_data
                    )

                    if response.status_code == 200:
                        results.append({
                            "worker_url": worker_url,
                            "success": True,
                            "message": "配置推送成功"
                        })
                    else:
                        results.append({
                            "worker_url": worker_url,
                            "success": False,
                            "message": f"推送失败: HTTP {response.status_code}"
                        })

            except httpx.TimeoutException:
                results.append({
                    "worker_url": worker_url,
                    "success": False,
                    "message": "推送超时"
                })
            except Exception as e:
                results.append({
                    "worker_url": worker_url,
                    "success": False,
                    "message": f"推送异常: {str(e)}"
                })

        # 统计结果
        success_count = sum(1 for r in results if r["success"])
        total_count = len(results)

        return {
            "success": success_count > 0,
            "message": f"配置推送完成: {success_count}/{total_count} 成功",
            "results": results
        }

    except Exception as e:
        logger.error(f"推送配置失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fetch-stats")
async def fetch_worker_stats(
    current_user: User = Depends(get_current_user)
):
    """从Worker获取统计数据"""
    try:
        from src.config import settings

        worker_endpoints = getattr(settings, 'WORKER_ENDPOINTS', '')
        worker_api_keys = getattr(settings, 'WORKER_API_KEYS', [])

        if not worker_endpoints:
            raise HTTPException(status_code=400, detail="未配置Worker端点")

        # 从所有Worker端点获取统计数据
        endpoints = [ep.strip() for ep in worker_endpoints.split(',') if ep.strip()]
        all_stats = []

        for i, worker_url in enumerate(endpoints):
            api_key = worker_api_keys[i] if i < len(worker_api_keys) else ""

            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.get(
                        f"{worker_url}/api/stats/export",
                        headers={
                            "X-API-Key": api_key,
                            "Content-Type": "application/json"
                        }
                    )

                    if response.status_code == 200:
                        stats_data = response.json()
                        all_stats.append({
                            "worker_url": worker_url,
                            "success": True,
                            "stats": stats_data
                        })
                    else:
                        all_stats.append({
                            "worker_url": worker_url,
                            "success": False,
                            "error": f"HTTP {response.status_code}"
                        })

            except httpx.TimeoutException:
                all_stats.append({
                    "worker_url": worker_url,
                    "success": False,
                    "error": "获取超时"
                })
            except Exception as e:
                all_stats.append({
                    "worker_url": worker_url,
                    "success": False,
                    "error": str(e)
                })

        # 统计结果
        success_count = sum(1 for s in all_stats if s["success"])
        total_count = len(all_stats)

        return {
            "success": success_count > 0,
            "message": f"统计数据获取完成: {success_count}/{total_count} 成功",
            "stats": all_stats
        }

    except Exception as e:
        logger.error(f"获取Worker统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fetch-logs")
async def fetch_worker_logs(
    current_user: User = Depends(get_current_user)
):
    """从Worker获取日志"""
    try:
        from src.config import settings

        worker_endpoints = getattr(settings, 'WORKER_ENDPOINTS', '')
        worker_api_keys = getattr(settings, 'WORKER_API_KEYS', [])

        if not worker_endpoints:
            raise HTTPException(status_code=400, detail="未配置Worker端点")

        # 从所有Worker端点获取日志
        endpoints = [ep.strip() for ep in worker_endpoints.split(',') if ep.strip()]
        all_logs = []

        for i, worker_url in enumerate(endpoints):
            api_key = worker_api_keys[i] if i < len(worker_api_keys) else ""

            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.get(
                        f"{worker_url}/api/logs?limit=100",
                        headers={
                            "X-API-Key": api_key,
                            "Content-Type": "application/json"
                        }
                    )

                    if response.status_code == 200:
                        logs_data = response.json()
                        worker_logs = logs_data.get("logs", [])
                        # 为每条日志添加worker来源信息
                        for log in worker_logs:
                            log["worker_url"] = worker_url
                        all_logs.extend(worker_logs)
                    else:
                        logger.warning(f"从 {worker_url} 获取日志失败: HTTP {response.status_code}")

            except httpx.TimeoutException:
                logger.warning(f"从 {worker_url} 获取日志超时")
            except Exception as e:
                logger.warning(f"从 {worker_url} 获取日志异常: {e}")

        # 按时间戳排序日志
        all_logs.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

        return {
            "success": True,
            "message": f"日志获取成功，共 {len(all_logs)} 条",
            "logs": all_logs[:200]  # 限制返回最新200条
        }

    except Exception as e:
        logger.error(f"获取Worker日志失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/full-sync")
async def full_sync_with_worker(
    current_user: User = Depends(get_current_user)
):
    """与Worker执行完整同步"""
    try:
        # 1. 推送配置
        logger.info("开始完整同步: 推送配置")
        push_result = await push_config_to_worker(current_user)

        # 2. 获取统计数据
        logger.info("完整同步: 获取统计数据")
        stats_result = await fetch_worker_stats(current_user)

        # 3. 获取日志
        logger.info("完整同步: 获取日志")
        logs_result = await fetch_worker_logs(current_user)

        # 统计结果
        operations = {
            "config_push": push_result.get("success", False),
            "stats_fetch": stats_result.get("success", False),
            "logs_fetch": logs_result.get("success", False)
        }

        success_count = sum(1 for success in operations.values() if success)
        total_count = len(operations)

        overall_success = success_count > 0

        return {
            "success": overall_success,
            "message": f"完整同步完成: {success_count}/{total_count} 操作成功",
            "operations": operations,
            "details": {
                "config_push": push_result,
                "stats_fetch": stats_result,
                "logs_fetch": logs_result
            },
            "sync_time": str(datetime.now())
        }

    except Exception as e:
        logger.error(f"完整同步失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
