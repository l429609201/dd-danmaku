"""
API v2 路由聚合

新业务接口统一挂载在 /api/v2 下，旧 /api v1 已废弃。
"""
from fastapi import APIRouter

from src.api.v2.endpoints import (
    auth, users, cache, episodes, entities, control,
    settings as settings_ep, runtime_events, dashboard,
    ip_rules, ip_stats, worker_logs, ua_rules,
)

api_v2_router = APIRouter()
api_v2_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_v2_router.include_router(dashboard.router, prefix="/dashboard", tags=["概览"])
api_v2_router.include_router(control.router, prefix="/control", tags=["Worker控制"])
api_v2_router.include_router(cache.router, prefix="/cache", tags=["响应缓存"])
api_v2_router.include_router(episodes.router, prefix="/episodes", tags=["集数链接"])
api_v2_router.include_router(entities.router, prefix="/entities", tags=["实体索引"])
api_v2_router.include_router(users.router, prefix="/users", tags=["用户管理"])
api_v2_router.include_router(settings_ep.router, prefix="/settings", tags=["系统设置"])
api_v2_router.include_router(runtime_events.router, prefix="/runtime-events", tags=["运行日志"])
api_v2_router.include_router(ip_rules.router, prefix="/ip-rules", tags=["IP黑白名单"])
api_v2_router.include_router(ua_rules.router, prefix="/ua-rules", tags=["UA限流"])
api_v2_router.include_router(ip_stats.router, prefix="/ip-stats", tags=["IP请求统计"])
api_v2_router.include_router(worker_logs.router, prefix="/worker-logs", tags=["Worker日志"])
