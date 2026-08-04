"""
Dashboard 概览接口：聚合关键指标
"""
import asyncio
import logging
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from sqlalchemy import func

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import ApiResult
from src.database import get_db_sync
from src.models_v2 import (
    ApiResponseCache, ApiCacheAccessLog, ApiCacheRefreshTask,
    ControlNode, EpisodeLink, RuntimeEvent, LocalUser,
    WorkerMetricsSnapshot,
)
from src.models_v2.base import now

logger = logging.getLogger(__name__)
router = APIRouter()

# 聚合接口 Redis 短 TTL 缓存：前端轮询频繁，30~60 秒内直接复用上次聚合结果，
# 避免每次都跑全表 count / GROUP BY，显著降低 DB 压力。Redis 不可用则自动回退实时算。
import json as _json
from src.services_v2.redis_cache import redis_cache

_SUMMARY_TTL = 30      # summary 缓存 30 秒
_TRENDS_TTL = 300      # 趋势按天聚合，缓存 5 分钟足够


async def _cache_get_json(key: str):
    """从 Redis 读缓存的聚合结果；miss/异常返回 None"""
    try:
        raw = await redis_cache.get(key)
        return _json.loads(raw) if raw else None
    except Exception:
        return None


async def _cache_set_json(key: str, data, ttl: int):
    """把聚合结果写入 Redis（失败静默，不影响主流程）"""
    try:
        await redis_cache.set(key, _json.dumps(data, ensure_ascii=False), ttl=ttl)
    except Exception:
        pass


@router.get("/summary")
async def dashboard_summary(_: LocalUser = Depends(get_current_user)):
    """Dashboard 汇总数据（Redis 短 TTL 缓存，避免全表 count 重复执行）"""
    cache_key = "dashboard:summary"
    cached = await _cache_get_json(cache_key)
    if cached is not None:
        return ApiResult(data=cached)
    # 同步聚合（含全表 count / SUM）放线程池，避免阻塞事件循环
    import asyncio
    data = await asyncio.to_thread(_build_summary)
    await _cache_set_json(cache_key, data, _SUMMARY_TTL)
    return ApiResult(data=data)


def _build_summary() -> dict:
    """构建 summary 数据（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        today_start = now() - timedelta(days=1)

        # Worker 连接状态
        node = db.query(ControlNode).order_by(
            ControlNode.last_seen_at.desc()
        ).first()

        # 今日缓存命中与 429 兜底命中数；访问日志全量保存，直接计数。
        stale_hits = db.query(ApiCacheAccessLog).filter(
            ApiCacheAccessLog.access_type == "stale_hit",
            ApiCacheAccessLog.created_at >= today_start,
        ).count()
        normal_hits = db.query(ApiCacheAccessLog).filter(
            ApiCacheAccessLog.access_type == "hit",
            ApiCacheAccessLog.created_at >= today_start,
        ).count()

        # 最近 10 条 ERROR 事件
        errors = db.query(RuntimeEvent).filter(
            RuntimeEvent.level == "ERROR"
        ).order_by(RuntimeEvent.created_at.desc()).limit(10).all()

        # 今日 Worker 运行指标汇总（按指标列求和）
        m = db.query(
            func.coalesce(func.sum(WorkerMetricsSnapshot.total_requests), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.total_responses), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.bytes_in), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.bytes_out), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.mem_cache_hits), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.r2_cache_hits), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.cache_miss), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_ip), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_ua), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_abuse), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.invalid_route), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.upstream_429), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.status_2xx), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.status_4xx), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.status_5xx), 0),
        ).filter(WorkerMetricsSnapshot.snapshot_at >= today_start).first()
        total_req, total_resp, b_in, b_out, mem_hit, r2_hit, miss, \
            blk_ip, blk_ua, blk_abuse, inv_route, up429, \
            s2xx, s4xx, s5xx = [int(x or 0) for x in m]
        total_hits = mem_hit + r2_hit
        hit_rate = round(total_hits / (total_hits + miss) * 100, 1) if (total_hits + miss) > 0 else 0.0

        data = {
            "worker": {
                "connected": node.connected if node else False,
                "node_id": node.node_id if node else None,
                "last_seen_at": node.last_seen_at.isoformat()
                if node and node.last_seen_at else None,
                "latency_ms": node.latency_ms if node else 0,
            },
            "today": {
                "fallback_hits": stale_hits,
                "cache_hits": normal_hits,
            },
            "worker_metrics_today": {
                "total_requests": total_req,
                "total_responses": total_resp,
                "bytes_in": b_in,
                "bytes_out": b_out,
                "cache_hits": total_hits,
                "mem_cache_hits": mem_hit,
                "r2_cache_hits": r2_hit,
                "cache_miss": miss,
                "hit_rate": hit_rate,
                "blocked_total": blk_ip + blk_ua + blk_abuse,
                "blocked_ip": blk_ip,
                "blocked_ua": blk_ua,
                "blocked_abuse": blk_abuse,
                "invalid_route": inv_route,
                "upstream_429": up429,
                "status_2xx": s2xx,
                "status_4xx": s4xx,
                "status_5xx": s5xx,
            },
            "totals": {
                "cache_count": db.query(ApiResponseCache).count(),
                "episode_links": db.query(EpisodeLink).count(),
                "refresh_pending": db.query(ApiCacheRefreshTask).filter(
                    ApiCacheRefreshTask.status == "pending"
                ).count(),
            },
            "recent_errors": [{
                "event": e.event, "message": e.message,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            } for e in errors],
        }
        return data
    finally:
        db.close()


@router.get("/trends")
async def dashboard_trends(days: int = 7, _: LocalUser = Depends(get_current_user)):
    """近 N 天缓存命中 / 429 兜底 / 未命中趋势（Redis 缓存 + DB 端按天聚合）"""
    days = max(1, min(days, 30))
    cache_key = f"dashboard:trends:{days}"
    cached = await _cache_get_json(cache_key)
    if cached is not None:
        return ApiResult(data=cached)
    import asyncio
    data = await asyncio.to_thread(_build_trends, days)
    await _cache_set_json(cache_key, data, _TRENDS_TTL)
    return ApiResult(data=data)


def _build_trends(days: int) -> dict:
    """构建缓存命中趋势（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        start = now() - timedelta(days=days - 1)
        start_day = start.replace(hour=0, minute=0, second=0, microsecond=0)
        # 数据库端按天 + access_type 分组聚合（避免全表 load 进内存导致 OOM）
        day_col = func.date(ApiCacheAccessLog.created_at)
        grouped = db.query(
            day_col.label("d"),
            ApiCacheAccessLog.access_type,
            func.count().label("cnt"),
        ).filter(
            ApiCacheAccessLog.created_at >= start_day
        ).group_by(day_col, ApiCacheAccessLog.access_type).all()

        # 初始化日期桶
        buckets = {}
        for i in range(days):
            d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {"hit": 0, "stale_hit": 0, "miss": 0}
        for d_val, access_type, cnt in grouped:
            d = str(d_val)[:10]  # 兼容 date/datetime/str 返回
            if d not in buckets:
                continue
            cnt = int(cnt or 0)
            if access_type == "hit":
                buckets[d]["hit"] += cnt
            elif access_type == "stale_hit":
                buckets[d]["stale_hit"] += cnt
            elif access_type in ("miss", "expired"):
                buckets[d]["miss"] += cnt
        labels = list(buckets.keys())
        return {
            "labels": labels,
            "hit": [buckets[d]["hit"] for d in labels],
            "fallback": [buckets[d]["stale_hit"] for d in labels],
            "miss": [buckets[d]["miss"] for d in labels],
        }
    finally:
        db.close()


@router.get("/metrics-trends")
async def dashboard_metrics_trends(days: int = 7, _: LocalUser = Depends(get_current_user)):
    """近 N 天 Worker 运行指标趋势（Redis 缓存 + DB 端按天 SUM 聚合）"""
    days = max(1, min(days, 30))
    cache_key = f"dashboard:metrics-trends:{days}"
    cached = await _cache_get_json(cache_key)
    if cached is not None:
        return ApiResult(data=cached)
    import asyncio
    data = await asyncio.to_thread(_build_metrics_trends, days)
    await _cache_set_json(cache_key, data, _TRENDS_TTL)
    return ApiResult(data=data)


def _build_metrics_trends(days: int) -> dict:
    """构建 Worker 指标趋势（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        start = now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
        # 数据库端按天分组 SUM 聚合（避免全表 load 进内存）
        day_col = func.date(WorkerMetricsSnapshot.snapshot_at)
        grouped = db.query(
            day_col.label("d"),
            func.coalesce(func.sum(WorkerMetricsSnapshot.total_requests), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.mem_cache_hits), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.r2_cache_hits), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.cache_miss), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_ip), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_ua), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.blocked_abuse), 0),
            func.coalesce(func.sum(WorkerMetricsSnapshot.bytes_out), 0),
        ).filter(
            WorkerMetricsSnapshot.snapshot_at >= start
        ).group_by(day_col).all()

        # 初始化日期桶
        buckets = {}
        for i in range(days):
            d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {"requests": 0, "hits": 0, "miss": 0, "blocked": 0, "bytes_out": 0}
        for row in grouped:
            d = str(row[0])[:10]
            if d not in buckets:
                continue
            b = buckets[d]
            b["requests"] += int(row[1] or 0)
            b["hits"] += int(row[2] or 0) + int(row[3] or 0)
            b["miss"] += int(row[4] or 0)
            b["blocked"] += int(row[5] or 0) + int(row[6] or 0) + int(row[7] or 0)
            b["bytes_out"] += int(row[8] or 0)
        labels = list(buckets.keys())
        return {
            "labels": labels,
            "requests": [buckets[d]["requests"] for d in labels],
            "hits": [buckets[d]["hits"] for d in labels],
            "miss": [buckets[d]["miss"] for d in labels],
            "blocked": [buckets[d]["blocked"] for d in labels],
            "bytes_out": [buckets[d]["bytes_out"] for d in labels],
        }
    finally:
        db.close()


@router.get("/system")
async def dashboard_system(_: LocalUser = Depends(get_current_user)):
    """本地端运行健康度：系统资源 + 事件循环延迟 + 削峰队列 + 连接池水位"""
    import asyncio
    from src.services_v2.system_stats_service import collect_system_stats, get_loop_lag_ms
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    from src.database import engine
    # 含 cpu_percent 短采样（阻塞约 0.3s），放线程池避免卡事件循环
    data = await asyncio.to_thread(collect_system_stats)

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

    data["eventloop"] = {
        "loop_lag_ms": get_loop_lag_ms(),
        "running_tasks": len([t for t in asyncio.all_tasks() if not t.done()]),
    }
    data["queues"] = {
        "entity_ingest": entity_ingest_queue.stats(),
        "access_log": access_log_buffer.stats(),
    }
    data["db_pool"] = await asyncio.to_thread(_pool_stats)
    return ApiResult(data=data)


@router.get("/db-stats")
async def dashboard_db_stats(_: LocalUser = Depends(get_current_user)):
    """数据库与 Redis 状态：SQL 表统计/占用/连接池 + Redis INFO + 弹幕兜底存储"""
    import asyncio
    from src.services_v2.db_stats_service import (
        collect_sql_stats, collect_redis_stats, collect_comment_store_stats,
        collect_engine_perf,
    )
    # 同步阻塞采集（遍历大表 COUNT/SHOW STATUS）放线程池，避免卡事件循环
    sql = await asyncio.to_thread(collect_sql_stats)
    redis_info = await collect_redis_stats()
    comment_store = await asyncio.to_thread(collect_comment_store_stats)
    engine_perf = await asyncio.to_thread(collect_engine_perf)
    return ApiResult(data={"sql": sql, "redis": redis_info,
                           "comment_store": comment_store, "engine_perf": engine_perf})


@router.get("/insights")
async def dashboard_insights(date: Optional[str] = None,
                             _: LocalUser = Depends(get_current_user)):
    """运维洞察（当日口径）：读 worker_log_daily_stats 按日聚合计数
    - 缓存来源分布（MEM/LOCAL/R2/MISS/限流）
    - 各接口（按 path 前缀归一）429 限流分布
    - UA 来源 Top10

    数据源从 worker_request_logs 明细聚合改为按日计数表：
    明细已迁到轮转 JSONL 文件（原表 3.2 GB 撑爆数据库），
    扫文件做统计要读上百 MB，而这些面板只需要计数。
    口径由「最近 N 小时」改为「当日」（本地时区 0 点起），
    date 参数可选，格式 YYYY-MM-DD，缺省为今天。
    """
    from src.services_v2.worker_log_stats_service import worker_log_stats_service
    data = await asyncio.to_thread(worker_log_stats_service.query_day, date)
    return ApiResult(data=data)


@router.get("/ip-geo")
async def dashboard_ip_geo(_: LocalUser = Depends(get_current_user)):
    """请求来源地图：解析 IP 统计为城市级散点（GeoLite2，库缺失时降级）"""
    import asyncio
    from src.services_v2.geoip_service import geoip_service
    # 解析可能涉及大量 IP，放线程池避免阻塞事件循环
    data = await asyncio.to_thread(geoip_service.aggregate_points)
    return ApiResult(data=data)
