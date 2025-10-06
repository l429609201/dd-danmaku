"""
统计数据API端点
"""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from src.services.stats_service import StatsService
from src.services.auth_service import get_current_user
from src.models.auth import User

router = APIRouter()

# Pydantic模型
class WorkerStatsData(BaseModel):
    worker_id: str
    total_requests: int = 0
    successful_requests: int = 0
    blocked_requests: int = 0
    error_requests: int = 0
    avg_response_time: float = 0
    max_response_time: float = 0
    min_response_time: float = 0
    total_bytes_sent: int = 0
    total_bytes_received: int = 0

class StatsResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

# 依赖注入
def get_stats_service() -> StatsService:
    return StatsService()

@router.get("/overview", response_model=Dict[str, Any])
async def get_system_overview(
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取系统概览统计"""
    try:
        overview = await stats_service.get_system_overview()
        return overview
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/performance", response_model=Dict[str, Any])
async def get_performance_metrics(
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取性能指标"""
    try:
        metrics = await stats_service.get_performance_metrics()
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/requests", response_model=List[Dict])
async def get_request_stats(
    hours: int = Query(24, description="统计时间范围（小时）"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取请求统计数据"""
    try:
        stats = await stats_service.get_request_stats_by_hour(hours)
        return [stat.to_dict() for stat in stats]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/violations", response_model=List[Dict[str, Any]])
async def get_violation_stats(
    limit: int = Query(10, description="返回记录数量"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取违规IP统计"""
    try:
        violations = await stats_service.get_top_violation_ips(limit)
        return violations
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ua-usage", response_model=List[Dict[str, Any]])
async def get_ua_usage_stats(
    hours: int = Query(24, description="统计时间范围（小时）"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取UA使用统计"""
    try:
        usage_stats = await stats_service.get_ua_usage_stats(hours)
        return usage_stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/worker", response_model=StatsResponse)
async def record_worker_stats(
    stats_data: WorkerStatsData,
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """记录Worker统计数据"""
    try:
        success = await stats_service.record_worker_stats(
            worker_id=stats_data.worker_id,
            stats_data=stats_data.dict(exclude={"worker_id"})
        )
        
        if success:
            return StatsResponse(
                success=True,
                message="Worker统计数据记录成功"
            )
        else:
            return StatsResponse(
                success=False,
                message="Worker统计数据记录失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export", response_model=Dict[str, Any])
async def export_stats_data(
    hours: int = Query(24, description="导出时间范围（小时）"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """导出统计数据"""
    try:
        # 获取各种统计数据
        overview = await stats_service.get_system_overview()
        request_stats = await stats_service.get_request_stats_by_hour(hours)
        violations = await stats_service.get_top_violation_ips(50)
        ua_usage = await stats_service.get_ua_usage_stats(hours)
        performance = await stats_service.get_performance_metrics()
        
        return {
            "overview": overview,
            "request_stats": [stat.to_dict() for stat in request_stats],
            "violations": violations,
            "ua_usage": ua_usage,
            "performance": performance,
            "export_time": "now",
            "time_range_hours": hours
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup", response_model=StatsResponse)
async def cleanup_old_data(
    days: int = Query(30, description="清理多少天前的数据"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """清理旧统计数据"""
    try:
        success = await stats_service.cleanup_old_data(days)
        
        if success:
            return StatsResponse(
                success=True,
                message=f"成功清理{days}天前的旧数据"
            )
        else:
            return StatsResponse(
                success=False,
                message="清理旧数据失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
async def get_stats_summary(
    stats_service: StatsService = Depends(get_stats_service),
    current_user: User = Depends(get_current_user)
):
    """获取统计数据摘要"""
    try:

        # 获取基础统计数据
        summary = await stats_service.get_summary()

        return {
            "todayRequests": summary.get("today_requests", 0),
            "totalRequests": summary.get("total_requests", 0),
            "successRate": summary.get("success_rate", 0),
            "onlineWorkers": summary.get("online_workers", 0),
            "totalWorkers": summary.get("total_workers", 0),
            "avgResponseTime": summary.get("avg_response_time", 0),
            "blockedIPs": summary.get("blocked_ips", 0),
            "todayBlocked": summary.get("today_blocked", 0),
            "violationRequests": summary.get("violation_requests", 0),
            "memoryUsage": summary.get("memory_usage", 0),
            "cpuUsage": summary.get("cpu_usage", 0),
            "uptime": summary.get("uptime", "0分钟")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
