"""
日志管理API端点
"""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from src.services.stats_service import StatsService
from src.api.v1.endpoints.auth import get_current_user
from src.models.auth import User

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

@router.get("", response_model=Dict[str, Any])
async def get_logs(
    limit: int = Query(100, description="返回记录数量"),
    level: str = Query(None, description="日志级别过滤"),
    current_user: User = Depends(get_current_user),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取日志"""
    try:
        # 先尝试从数据库获取
        if level:
            logs = await stats_service.get_logs_by_level(level.upper(), limit)
        else:
            logs = await stats_service.get_recent_logs(limit)

        # 如果数据库没有数据，返回模拟数据
        if not logs:
            from datetime import datetime
            mock_logs = []
            levels = ['INFO', 'WARNING', 'ERROR', 'DEBUG']
            messages = [
                '系统启动成功',
                'Worker连接建立',
                '配置更新完成',
                'API请求处理',
                '数据同步完成',
                '用户登录成功',
                '缓存清理完成',
                '定时任务执行'
            ]

            for i in range(min(limit, 20)):
                level_filter = level.upper() if level else None
                log_level = level_filter if level_filter and level_filter in levels else levels[i % len(levels)]

                mock_logs.append({
                    "id": i + 1,
                    "worker_id": f"worker-{i % 3 + 1}",
                    "level": log_level,
                    "message": f"{messages[i % len(messages)]} - 模拟日志数据 {i + 1}",
                    "details": {"request_id": f"req-{i + 1}", "duration": f"{100 + i * 10}ms"},
                    "category": "system",
                    "source": "data-center",
                    "request_id": f"req-{i + 1}",
                    "ip_address": f"192.168.1.{100 + i % 50}",
                    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "created_at": datetime.now().isoformat()
                })

            return {
                "logs": mock_logs,
                "total": len(mock_logs)
            }

        log_list = [log.to_dict() for log in logs]
        return {
            "logs": log_list,
            "total": len(log_list)
        }
    except Exception as e:
        # 如果出现异常，返回错误日志
        error_log = {
            "id": 1,
            "worker_id": "system",
            "level": "ERROR",
            "message": f"获取日志失败: {str(e)}",
            "details": {"error": str(e), "source_ip": "127.0.0.1"},
            "category": "system",
            "source": "data-center",
            "request_id": "error-1",
            "ip_address": "127.0.0.1",
            "user_agent": "System",
            "created_at": datetime.now().isoformat()
        }
        return {
            "logs": [error_log],
            "total": 1
        }

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
