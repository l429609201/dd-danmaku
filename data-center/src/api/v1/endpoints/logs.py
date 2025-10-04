"""
日志管理API端点
"""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from src.services.stats_service import StatsService

router = APIRouter()

# Pydantic模型
class LogResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

class SystemLogCreate(BaseModel):
    level: str
    message: str
    details: Dict[str, Any] = {}
    category: str = None
    source: str = None

# 依赖注入
def get_stats_service() -> StatsService:
    return StatsService()

@router.get("/system", response_model=List[Dict])
async def get_system_logs(
    limit: int = Query(50, description="返回记录数量"),
    level: str = Query(None, description="日志级别过滤"),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取系统日志"""
    try:
        if level:
            logs = await stats_service.get_logs_by_level(level.upper(), limit)
        else:
            logs = await stats_service.get_recent_logs(limit)
        
        return [log.to_dict() for log in logs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/telegram", response_model=List[Dict])
async def get_telegram_logs(
    limit: int = Query(50, description="返回记录数量"),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取Telegram机器人日志"""
    try:
        logs = await stats_service.get_telegram_logs(limit)
        return [log.to_dict() for log in logs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync", response_model=List[Dict])
async def get_sync_logs(
    limit: int = Query(50, description="返回记录数量"),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取同步日志"""
    try:
        logs = await stats_service.get_sync_logs(limit)
        return [log.to_dict() for log in logs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/system", response_model=LogResponse)
async def create_system_log(
    log_data: SystemLogCreate,
    stats_service: StatsService = Depends(get_stats_service)
):
    """创建系统日志"""
    try:
        success = await stats_service.record_system_log(
            level=log_data.level,
            message=log_data.message,
            details=log_data.details,
            category=log_data.category,
            source=log_data.source
        )
        
        if success:
            return LogResponse(
                success=True,
                message="系统日志记录成功"
            )
        else:
            return LogResponse(
                success=False,
                message="系统日志记录失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export", response_model=Dict[str, Any])
async def export_logs(
    limit: int = Query(1000, description="导出记录数量"),
    stats_service: StatsService = Depends(get_stats_service)
):
    """导出日志数据"""
    try:
        # 获取各种日志
        system_logs = await stats_service.get_recent_logs(limit)
        telegram_logs = await stats_service.get_telegram_logs(limit)
        sync_logs = await stats_service.get_sync_logs(limit)
        
        return {
            "system_logs": [log.to_dict() for log in system_logs],
            "telegram_logs": [log.to_dict() for log in telegram_logs],
            "sync_logs": [log.to_dict() for log in sync_logs],
            "export_time": "now",
            "total_records": len(system_logs) + len(telegram_logs) + len(sync_logs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
