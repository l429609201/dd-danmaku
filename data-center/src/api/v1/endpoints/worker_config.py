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
