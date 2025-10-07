"""
API v1 路由聚合
"""
from fastapi import APIRouter

from src.api.v1.endpoints import config, stats, sync, logs, web_config, auth, worker_config, telegram, system_config

# Web界面API路由 - 需要JWT认证
web_api_router = APIRouter()
web_api_router.include_router(auth.router, prefix="/auth", tags=["用户认证"])
web_api_router.include_router(logs.router, prefix="/logs", tags=["日志管理"])
web_api_router.include_router(stats.router, prefix="/stats", tags=["统计数据"])
web_api_router.include_router(web_config.router, prefix="/web-config", tags=["Web界面配置"])
web_api_router.include_router(worker_config.router, prefix="/worker", tags=["Worker管理"])
web_api_router.include_router(telegram.router, prefix="/telegram", tags=["Telegram机器人"])
web_api_router.include_router(system_config.router, prefix="/system-config", tags=["系统配置管理"])

# CF Worker API路由 - 需要API Key认证
worker_api_router = APIRouter()
worker_api_router.include_router(config.router, prefix="/config", tags=["配置管理"])
worker_api_router.include_router(sync.router, prefix="/sync", tags=["同步管理"])

# 兼容性：保持原有的api_router
api_router = web_api_router
