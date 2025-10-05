"""
API v1 路由聚合
"""
from fastapi import APIRouter

from src.api.v1.endpoints import config, stats, sync, logs, web_config, auth, worker_config

api_router = APIRouter()

# 包含各个端点路由
api_router.include_router(auth.router, prefix="/auth", tags=["用户认证"])
api_router.include_router(config.router, prefix="/config", tags=["配置管理"])
api_router.include_router(stats.router, prefix="/stats", tags=["统计数据"])
api_router.include_router(sync.router, prefix="/sync", tags=["同步管理"])
api_router.include_router(logs.router, prefix="/logs", tags=["日志管理"])
api_router.include_router(web_config.router, prefix="/web-config", tags=["Web界面配置"])
api_router.include_router(worker_config.router, prefix="/worker", tags=["Worker管理"])
