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
    """系统资源：CPU%/内存/负载(load1/5/15)/线程数/打开FD数/事件循环延迟。

    注意：本函数的 docstring 会被 mcp_http.py 自动提取为 MCP 工具说明
    （给 AI 看），所以要写清"这个指标怎么读、什么情况算异常"。
    """
    from src.services_v2.system_stats_service import collect_system_stats
    data = await asyncio.to_thread(collect_system_stats)
    return ApiResult(data=data)


@router.get("/diag/queues")
async def diag_queues(_: bool = Depends(verify_external_token)):
    """削峰队列健康度：实体解析队列 + 访问日志缓冲的深度/丢弃/落库计数。

    depth 持续走高或 dropped 增长说明削峰失效，写入跟不上产生速度。
    """
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    return ApiResult(data={
        "entity_ingest": entity_ingest_queue.stats(),
        "access_log": access_log_buffer.stats(),
    })


def _pool_stats() -> dict:
    """SQLAlchemy 连接池水位快照（同步，调用方放线程池）

    QueuePool 才有 size/checkedin/checkedout/overflow；StaticPool(SQLite) 没有，
    故逐个探测可调用性，缺失的键直接不返回。
    """
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


@router.get("/diag/db-pool")
async def diag_db_pool(_: bool = Depends(verify_external_token)):
    """SQLAlchemy 连接池水位(size/checkedin/checkedout/overflow)。

    checkedout 接近 size+overflow 说明连接池将耗尽，DB 成为瓶颈，
    此时请求会卡在等连接上（表现为接口整体变慢）。
    """
    data = await asyncio.to_thread(_pool_stats)
    return ApiResult(data=data)


@router.get("/diag/control")
async def diag_control(_: bool = Depends(verify_external_token)):
    """control_client 长连接健康度：连接状态/pending RPC 数/消息积压/审计缓冲水位。

    msg_backlog 持续增长说明消息处理跟不上接收；
    audit_dropped 增长说明审计日志缓冲溢出（落库太慢）。
    """
    from src.services_v2.control_client import control_client
    return ApiResult(data=control_client.stats())


@router.get("/diag/eventloop")
async def diag_eventloop(_: bool = Depends(verify_external_token)):
    """事件循环延迟(loop_lag_ms)与运行中任务数。

    lag 高（>100ms）说明存在同步阻塞，所有请求会整体变慢——
    通常是某处同步 DB 调用没放线程池。
    """
    from src.services_v2.system_stats_service import get_loop_lag_ms
    running = len([t for t in asyncio.all_tasks() if not t.done()])
    return ApiResult(data={
        "loop_lag_ms": get_loop_lag_ms(),
        "running_tasks": running,
    })


@router.get("/diag/slow-sql")
async def diag_slow_sql(top: int = 20, _: bool = Depends(verify_external_token)):
    """慢 SQL 排行：按累计耗时排序的 Top N 查询指纹 + 最近慢查询明细。

    定位"某个页面加载慢"的直接依据——看哪条 SQL 累计耗时最高、
    平均多少毫秒、执行了几次。每条含 fingerprint(归一化SQL) /
    count / total_ms / max_ms / avg_ms / sample。

    参数：
        top: 返回条数，默认 20
    """
    from src.services_v2 import slow_sql_service
    return ApiResult(data=slow_sql_service.get_stats(top=top))


@router.post("/diag/slow-sql/reset")
async def diag_slow_sql_reset(_: bool = Depends(verify_external_token)):
    """清空慢 SQL 统计，便于针对某次操作单独观测。

    推荐用法：先 reset，让用户操作目标页面，再调 diag_slow_sql，
    这样看到的就是本次操作实际产生的慢查询，不受历史数据干扰。
    """
    from src.services_v2 import slow_sql_service
    slow_sql_service.reset()
    return ApiResult(message="已清空慢 SQL 统计")


@router.get("/diag/snapshot")
async def diag_snapshot(_: bool = Depends(verify_external_token)):
    """一次性抓取全部诊断指标（系统资源/事件循环/队列/连接池/长连接/慢SQL Top5）。

    定位性能问题的首选：一次看全运行健康度，再按可疑项调用对应的细项接口。
    """
    from src.services_v2.system_stats_service import collect_system_stats, get_loop_lag_ms
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    from src.services_v2.control_client import control_client
    from src.services_v2 import slow_sql_service

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
        # 慢 SQL Top 5：快照里只带最关键的几条，明细看 /diag/slow-sql
        "slow_sql": slow_sql_service.get_stats(top=5),
    })
