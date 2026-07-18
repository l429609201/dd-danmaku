"""
外部控制 API（External Control API）

统一供 MCP / 外部诊断工具调用，独立密钥鉴权（X-External-Token）。
只读诊断为主，用于实时观测本地端运行健康度、定位高并发瓶颈。

所有端点均依赖 verify_external_token，与用户登录 JWT 完全隔离。
"""
import asyncio
import logging

from fastapi import APIRouter, Depends

from src.api.v2.deps import verify_external_token, require_admin
from src.api.v2.schemas import ApiResult
from src.database import engine
from src.models_v2 import LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


# ========== 密钥管理（走用户 JWT admin，供前端查看/生成/轮换） ==========
@router.get("/token")
async def get_external_token(_: LocalUser = Depends(require_admin)):
    """查看当前外部控制密钥明文（admin 专用；无则自动生成）"""
    from src.services_v2.external_control_service import external_control_auth
    token = await asyncio.to_thread(external_control_auth.get_token)
    return ApiResult(data={"token": token})


@router.post("/token/rotate")
async def rotate_external_token(_: LocalUser = Depends(require_admin)):
    """轮换外部控制密钥（生成新值，旧密钥立即失效）"""
    from src.services_v2.external_control_service import external_control_auth
    token = await asyncio.to_thread(external_control_auth.rotate)
    return ApiResult(message="已轮换，请更新 MCP 配置", data={"token": token})


@router.get("/diag/system")
async def diag_system(_: bool = Depends(verify_external_token)):
    """系统资源：CPU/内存/负载/线程数/FD/事件循环延迟"""
    from src.services_v2.system_stats_service import collect_system_stats
    data = await asyncio.to_thread(collect_system_stats)
    return ApiResult(data=data)


@router.get("/diag/queues")
async def diag_queues(_: bool = Depends(verify_external_token)):
    """削峰队列健康度：实体解析队列 + 访问日志缓冲的深度/丢弃/落库计数"""
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    return ApiResult(data={
        "entity_ingest": entity_ingest_queue.stats(),
        "access_log": access_log_buffer.stats(),
    })


@router.get("/diag/db-pool")
async def diag_db_pool(_: bool = Depends(verify_external_token)):
    """SQLAlchemy 连接池水位：判断 DB 是否成为瓶颈"""
    def _pool_stats():
        pool = engine.pool
        info = {"dialect": engine.dialect.name}
        # QueuePool 才有这些方法；StaticPool(SQLite) 没有
        for attr in ("size", "checkedin", "checkedout", "overflow"):
            fn = getattr(pool, attr, None)
            if callable(fn):
                try:
                    info[attr] = fn()
                except Exception:
                    info[attr] = None
        return info
    data = await asyncio.to_thread(_pool_stats)
    return ApiResult(data=data)


@router.get("/diag/control")
async def diag_control(_: bool = Depends(verify_external_token)):
    """control_client 长连接健康度：连接状态/pending RPC/消息处理速率"""
    from src.services_v2.control_client import control_client
    return ApiResult(data=control_client.stats())


@router.get("/diag/eventloop")
async def diag_eventloop(_: bool = Depends(verify_external_token)):
    """事件循环延迟：lag 高说明存在同步阻塞（高并发诊断关键）"""
    from src.services_v2.system_stats_service import get_loop_lag_ms
    running = len([t for t in asyncio.all_tasks() if not t.done()])
    return ApiResult(data={
        "loop_lag_ms": get_loop_lag_ms(),
        "running_tasks": running,
    })


@router.get("/diag/snapshot")
async def diag_snapshot(_: bool = Depends(verify_external_token)):
    """一次性聚合全部诊断指标（MCP 一键抓取，定位瓶颈）"""
    from src.services_v2.system_stats_service import collect_system_stats, get_loop_lag_ms
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    from src.services_v2.control_client import control_client

    def _pool_stats():
        pool = engine.pool
        info = {"dialect": engine.dialect.name}
        for attr in ("size", "checkedin", "checkedout", "overflow"):
            fn = getattr(pool, attr, None)
            if callable(fn):
                try:
                    info[attr] = fn()
                except Exception:
                    info[attr] = None
        return info

    system = await asyncio.to_thread(collect_system_stats)
    db_pool = await asyncio.to_thread(_pool_stats)
    return ApiResult(data={
        "system": system,
        "eventloop": {
            "loop_lag_ms": get_loop_lag_ms(),
            "running_tasks": len([t for t in asyncio.all_tasks() if not t.done()]),
        },
        "queues": {
            "entity_ingest": entity_ingest_queue.stats(),
            "access_log": access_log_buffer.stats(),
        },
        "db_pool": db_pool,
        "control": control_client.stats(),
    })
