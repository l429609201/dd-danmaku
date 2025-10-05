"""
同步管理API端点
"""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from src.services.worker_sync import WorkerSyncService
from src.services.config_service import ConfigService

router = APIRouter()

# Pydantic模型
class SyncResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

class WorkerEndpoint(BaseModel):
    endpoint: str

class StatsData(BaseModel):
    worker_id: str
    stats: Dict[str, Any]

# 依赖注入
def get_worker_sync_service() -> WorkerSyncService:
    return WorkerSyncService()

def get_config_service() -> ConfigService:
    return ConfigService()

@router.post("/push-config", response_model=SyncResponse)
async def push_config_to_worker(
    worker_data: WorkerEndpoint,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    config_service: ConfigService = Depends(get_config_service)
):
    """推送配置到指定Worker"""
    try:
        # 导出当前配置
        config_data = await config_service.export_config_for_worker()
        
        # 推送到Worker
        success = await worker_sync.push_config_to_worker(
            worker_data.endpoint, 
            config_data
        )
        
        if success:
            return SyncResponse(
                success=True,
                message=f"配置推送到 {worker_data.endpoint} 成功"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"配置推送到 {worker_data.endpoint} 失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/push-config-all", response_model=SyncResponse)
async def push_config_to_all_workers(
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    config_service: ConfigService = Depends(get_config_service)
):
    """推送配置到所有Worker"""
    try:
        # 导出当前配置
        config_data = await config_service.export_config_for_worker()
        
        # 同步到所有Worker
        results = await worker_sync.sync_all_workers(config_data)
        
        return SyncResponse(
            success=True,
            message=f"配置同步完成: {results['success_count']}/{results['total_workers']} 成功",
            data=results
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stats", response_model=SyncResponse)
async def receive_worker_stats(
    stats_data: StatsData,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service)
):
    """接收Worker推送的统计数据"""
    try:
        # 处理Worker推送的统计数据
        success = await worker_sync.process_worker_stats(
            stats_data.worker_id,
            stats_data.stats
        )

        if success:
            return SyncResponse(
                success=True,
                message=f"接收Worker {stats_data.worker_id} 统计数据成功"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"处理Worker {stats_data.worker_id} 统计数据失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pull-stats", response_model=SyncResponse)
async def pull_stats_from_worker(
    worker_data: WorkerEndpoint,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service)
):
    """从指定Worker拉取统计数据"""
    try:
        stats_data = await worker_sync.pull_stats_from_worker(worker_data.endpoint)
        
        if stats_data:
            return SyncResponse(
                success=True,
                message=f"从 {worker_data.endpoint} 拉取统计数据成功",
                data=stats_data
            )
        else:
            return SyncResponse(
                success=False,
                message=f"从 {worker_data.endpoint} 拉取统计数据失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/worker-health", response_model=List[Dict[str, Any]])
async def get_all_workers_health(
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service)
):
    """获取所有Worker的健康状态"""
    try:
        from src.config import settings
        
        worker_endpoints = settings.WORKER_ENDPOINTS
        if not worker_endpoints:
            return []
        
        health_results = []
        for endpoint in worker_endpoints:
            health_status = await worker_sync.get_worker_health_status(endpoint)
            health_results.append(health_status)
        
        return health_results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/worker-health/{endpoint:path}", response_model=Dict[str, Any])
async def get_worker_health(
    endpoint: str,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service)
):
    """获取指定Worker的健康状态"""
    try:
        # 确保endpoint包含协议
        if not endpoint.startswith(('http://', 'https://')):
            endpoint = f"https://{endpoint}"
        
        health_status = await worker_sync.get_worker_health_status(endpoint)
        return health_status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
