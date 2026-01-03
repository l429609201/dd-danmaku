"""
同步管理API端点
"""
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel

from src.services.worker_sync import WorkerSyncService
from src.services.config_service import ConfigService
from src.config import settings
from src.api.v1.endpoints.auth import get_current_user
from src.models.auth import User

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
    timestamp: int
    stats: Dict[str, Any]
    config_status: Optional[Dict[str, Any]] = None
    logs: Optional[List[Dict[str, Any]]] = None

# 新增：配置数据模型
class ConfigData(BaseModel):
    worker_id: str
    timestamp: int
    data: Dict[str, Any]

# 新增：日志数据模型
class LogsData(BaseModel):
    worker_id: str
    timestamp: int
    logs: List[Dict[str, Any]]

# 新增：IP 请求统计数据模型
class RequestStatsData(BaseModel):
    worker_id: str
    timestamp: int
    stats: Dict[str, Any]

# 依赖注入
def get_worker_sync_service() -> WorkerSyncService:
    return WorkerSyncService()

def get_config_service() -> ConfigService:
    return ConfigService()

# API Key认证依赖项
async def verify_api_key(x_api_key: str = Header(None)):
    """验证API Key"""
    from src.services.web_config_service import WebConfigService
    import logging

    logger = logging.getLogger(__name__)

    logger.info(f"🔐 Worker API Key验证开始")
    logger.info(f"   - 提供的Key: {x_api_key[:8] + '...' if x_api_key else '未提供'}")

    # 如果没有提供API Key
    if not x_api_key:
        logger.warning("❌ Worker请求缺少X-API-Key头部")
        raise HTTPException(status_code=401, detail="缺少API Key")

    # 从配置管理器获取API Key
    from src.services.config_manager import config_manager
    configured_api_key = config_manager.get_data_center_api_key()

    logger.info(f"   - 配置的Key: {configured_api_key[:8] + '...' if configured_api_key else '未配置'}")

    # 如果没有配置API Key，记录警告但允许通过（兼容模式）
    if not configured_api_key:
        logger.warning("⚠️ 服务器未配置Worker API Key，允许通过（兼容模式）")
        return x_api_key

    # 验证API Key
    if x_api_key != configured_api_key:
        logger.error(f"❌ API Key验证失败:")
        logger.error(f"   - 提供的Key: {x_api_key[:8]}...")
        logger.error(f"   - 配置的Key: {configured_api_key[:8]}...")
        logger.error(f"   - Key长度: 提供={len(x_api_key)}, 配置={len(configured_api_key)}")
        raise HTTPException(status_code=401, detail="无效的API Key")

    logger.info("✅ API Key验证成功")
    return x_api_key

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
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    api_key: str = Depends(verify_api_key)
):
    """接收Worker推送的统计数据和日志"""
    try:
        # 处理Worker推送的统计数据
        success = await worker_sync.process_worker_stats(
            stats_data.worker_id,
            stats_data.stats
        )

        # 处理Worker推送的日志数据
        if stats_data.logs:
            log_success = await worker_sync.process_worker_logs(
                stats_data.worker_id,
                stats_data.logs
            )
            success = success and log_success

        # 处理配置状态
        if stats_data.config_status:
            config_success = await worker_sync.process_worker_config_status(
                stats_data.worker_id,
                stats_data.config_status
            )
            success = success and config_success

        if success:
            log_count = len(stats_data.logs) if stats_data.logs else 0
            return SyncResponse(
                success=True,
                message=f"接收Worker {stats_data.worker_id} 数据成功 (统计+{log_count}条日志)"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"处理Worker {stats_data.worker_id} 数据失败"
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

@router.get("/stats/restore", response_model=Dict[str, Any])
async def restore_worker_stats(
    x_worker_id: str = Header(None, alias="X-Worker-ID"),
    api_key: str = Depends(verify_api_key)
):
    """恢复Worker计数状态（Worker启动时调用）"""
    import logging
    from src.services.stats_service import StatsService
    from datetime import datetime

    logger = logging.getLogger(__name__)

    try:
        worker_id = x_worker_id or "worker-1"
        logger.info(f"🔄 Worker请求恢复计数状态: {worker_id}")

        # 从数据库获取最近的统计数据
        stats_service = StatsService()

        # 获取当前小时的统计数据
        from src.models.stats import RequestStats
        from src.database import get_db

        db = next(get_db())
        current_hour = datetime.now().replace(minute=0, second=0, microsecond=0)

        # 查找最近的统计记录
        recent_stats = db.query(RequestStats).filter(
            RequestStats.worker_id == worker_id
        ).order_by(RequestStats.date_hour.desc()).first()

        if recent_stats:
            counters = {
                "secret1_count": recent_stats.secret1_count or 0,
                "secret2_count": recent_stats.secret2_count or 0,
                "current_secret": recent_stats.current_secret or "1",
                "total_requests": recent_stats.total_requests or 0  # 修正：使用正确的字段名
            }

            logger.info(f"✅ 找到Worker计数状态: {worker_id}")
            logger.info(f"   - Secret1计数: {counters['secret1_count']}")
            logger.info(f"   - Secret2计数: {counters['secret2_count']}")
            logger.info(f"   - 总请求数: {counters['total_requests']}")

            return {
                "success": True,
                "message": "计数状态恢复成功",
                "counters": counters
            }
        else:
            logger.info(f"ℹ️ 没有找到Worker的历史计数状态: {worker_id}")
            return {
                "success": False,
                "message": "没有可恢复的计数状态",
                "counters": None
            }

    except Exception as e:
        logger.error(f"❌ 恢复Worker计数状态失败: {e}")
        return {
            "success": False,
            "message": f"恢复失败: {str(e)}",
            "counters": None
        }

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

# 新增：接收配置数据
@router.post("/config", response_model=SyncResponse)
async def receive_worker_config(
    config_data: ConfigData,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    api_key: str = Depends(verify_api_key)
):
    """接收Worker推送的配置数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📋 接收Worker {config_data.worker_id} 的配置数据")

        # 处理配置数据
        success = await worker_sync.process_worker_config(
            config_data.worker_id,
            config_data.data
        )

        if success:
            return SyncResponse(
                success=True,
                message=f"接收Worker {config_data.worker_id} 配置数据成功"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"处理Worker {config_data.worker_id} 配置数据失败"
            )
    except Exception as e:
        logger.error(f"❌ 接收配置数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：接收日志数据
@router.post("/logs", response_model=SyncResponse)
async def receive_worker_logs(
    logs_data: LogsData,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    api_key: str = Depends(verify_api_key)
):
    """接收Worker推送的日志数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📝 接收Worker {logs_data.worker_id} 的日志数据，共 {len(logs_data.logs)} 条")

        # 处理日志数据
        success = await worker_sync.process_worker_logs(
            logs_data.worker_id,
            logs_data.logs
        )

        if success:
            return SyncResponse(
                success=True,
                message=f"接收Worker {logs_data.worker_id} 日志数据成功 ({len(logs_data.logs)}条)"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"处理Worker {logs_data.worker_id} 日志数据失败"
            )
    except Exception as e:
        logger.error(f"❌ 接收日志数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：接收 IP 请求统计数据
@router.post("/request-stats", response_model=SyncResponse)
async def receive_worker_request_stats(
    stats_data: RequestStatsData,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    api_key: str = Depends(verify_api_key)
):
    """接收Worker推送的 IP 请求统计数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📊 接收Worker {stats_data.worker_id} 的 IP 请求统计数据")

        # 处理 IP 请求统计数据
        success = await worker_sync.process_worker_request_stats(
            stats_data.worker_id,
            stats_data.stats
        )

        if success:
            return SyncResponse(
                success=True,
                message=f"接收Worker {stats_data.worker_id} IP 请求统计数据成功"
            )
        else:
            return SyncResponse(
                success=False,
                message=f"处理Worker {stats_data.worker_id} IP 请求统计数据失败"
            )
    except Exception as e:
        logger.error(f"❌ 接收 IP 请求统计数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：查询日志数据（Web前端使用，需要JWT认证）
@router.get("/logs", response_model=Dict[str, Any])
async def query_worker_logs(
    worker_id: str = None,
    limit: int = 100,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    current_user: User = Depends(get_current_user)
):
    """查询Worker推送的日志数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📝 查询Worker {worker_id} 的日志数据 (用户: {current_user.username})")

        # 查询日志数据
        logs = await worker_sync.query_worker_logs(worker_id, limit)

        return {
            "success": True,
            "logs": logs,
            "count": len(logs)
        }
    except Exception as e:
        logger.error(f"❌ 查询日志数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：查询 IP 请求统计数据（Web前端使用，需要JWT认证）
@router.get("/request-stats", response_model=Dict[str, Any])
async def query_worker_request_stats(
    worker_id: str = None,
    limit: int = 100,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    current_user: User = Depends(get_current_user)
):
    """查询Worker推送的 IP 请求统计数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📊 查询Worker {worker_id} 的 IP 请求统计数据 (用户: {current_user.username})")

        # 查询 IP 请求统计数据
        stats = await worker_sync.query_worker_request_stats(worker_id, limit)

        return {
            "success": True,
            "stats": stats,
            "count": len(stats)
        }
    except Exception as e:
        logger.error(f"❌ 查询 IP 请求统计数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 新增：主动拉取 Worker 的 IP 请求统计数据
@router.post("/pull-request-stats", response_model=Dict[str, Any])
async def pull_worker_request_stats(
    worker_data: WorkerEndpoint,
    worker_sync: WorkerSyncService = Depends(get_worker_sync_service),
    current_user: User = Depends(get_current_user)
):
    """主动从Worker拉取 IP 请求统计数据"""
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"📊 主动拉取Worker {worker_data.endpoint} 的 IP 请求统计数据 (用户: {current_user.username})")

        # 从Worker拉取统计数据
        stats_data = await worker_sync.pull_stats_from_worker(worker_data.endpoint)

        if stats_data:
            # 处理拉取到的统计数据
            by_ip = stats_data.get("stats", {}).get("by_ip", {})

            # 保存到数据库
            success = await worker_sync.process_worker_request_stats(
                stats_data.get("worker_id", "unknown"),
                {"by_ip": by_ip}
            )

            if success:
                return {
                    "success": True,
                    "message": f"成功从 {worker_data.endpoint} 拉取并保存 IP 请求统计数据",
                    "data": stats_data
                }
            else:
                return {
                    "success": False,
                    "message": f"从 {worker_data.endpoint} 拉取数据成功，但保存到数据库失败"
                }
        else:
            return {
                "success": False,
                "message": f"从 {worker_data.endpoint} 拉取 IP 请求统计数据失败"
            }
    except Exception as e:
        logger.error(f"❌ 主动拉取 IP 请求统计数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
