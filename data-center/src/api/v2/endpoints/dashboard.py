"""
Dashboard 概览接口：聚合关键指标
"""
import logging
from datetime import timedelta

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


@router.get("/summary")
async def dashboard_summary(_: LocalUser = Depends(get_current_user)):
    """Dashboard 汇总数据"""
    db = get_db_sync()
    try:
        today_start = now() - timedelta(days=1)

        # Worker 连接状态
        node = db.query(ControlNode).order_by(
            ControlNode.last_seen_at.desc()
        ).first()

        # 今日 429 兜底命中数
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
        return ApiResult(data=data)
    finally:
        db.close()


@router.get("/trends")
async def dashboard_trends(days: int = 7, _: LocalUser = Depends(get_current_user)):
    """近 N 天缓存命中 / 429 兜底 / 未命中趋势（基于访问日志按天聚合）"""
    days = max(1, min(days, 30))
    db = get_db_sync()
    try:
        start = now() - timedelta(days=days - 1)
        rows = db.query(ApiCacheAccessLog).filter(
            ApiCacheAccessLog.created_at >= start.replace(hour=0, minute=0, second=0, microsecond=0)
        ).all()
        # 初始化日期桶
        buckets = {}
        for i in range(days):
            d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {"hit": 0, "stale_hit": 0, "miss": 0}
        for r in rows:
            if not r.created_at:
                continue
            d = r.created_at.strftime("%Y-%m-%d")
            if d not in buckets:
                continue
            t = r.access_type
            if t == "hit":
                buckets[d]["hit"] += 1
            elif t == "stale_hit":
                buckets[d]["stale_hit"] += 1
            elif t in ("miss", "expired"):
                buckets[d]["miss"] += 1
        labels = list(buckets.keys())
        return ApiResult(data={
            "labels": labels,
            "hit": [buckets[d]["hit"] for d in labels],
            "fallback": [buckets[d]["stale_hit"] for d in labels],
            "miss": [buckets[d]["miss"] for d in labels],
        })
    finally:
        db.close()


@router.get("/metrics-trends")
async def dashboard_metrics_trends(days: int = 7, _: LocalUser = Depends(get_current_user)):
    """近 N 天 Worker 运行指标趋势（请求量/命中/拦截/流量，按天聚合）"""
    days = max(1, min(days, 30))
    db = get_db_sync()
    try:
        start = now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
        rows = db.query(WorkerMetricsSnapshot).filter(
            WorkerMetricsSnapshot.snapshot_at >= start
        ).all()
        # 初始化日期桶
        buckets = {}
        for i in range(days):
            d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[d] = {"requests": 0, "hits": 0, "miss": 0, "blocked": 0, "bytes_out": 0}
        for r in rows:
            if not r.snapshot_at:
                continue
            d = r.snapshot_at.strftime("%Y-%m-%d")
            if d not in buckets:
                continue
            b = buckets[d]
            b["requests"] += r.total_requests or 0
            b["hits"] += (r.mem_cache_hits or 0) + (r.r2_cache_hits or 0)
            b["miss"] += r.cache_miss or 0
            b["blocked"] += (r.blocked_ip or 0) + (r.blocked_ua or 0) + (r.blocked_abuse or 0)
            b["bytes_out"] += r.bytes_out or 0
        labels = list(buckets.keys())
        return ApiResult(data={
            "labels": labels,
            "requests": [buckets[d]["requests"] for d in labels],
            "hits": [buckets[d]["hits"] for d in labels],
            "miss": [buckets[d]["miss"] for d in labels],
            "blocked": [buckets[d]["blocked"] for d in labels],
            "bytes_out": [buckets[d]["bytes_out"] for d in labels],
        })
    finally:
        db.close()


@router.get("/db-stats")
async def dashboard_db_stats(_: LocalUser = Depends(get_current_user)):
    """数据库与 Redis 状态：SQL 表统计/占用/连接池 + Redis INFO + 弹幕兜底存储"""
    from src.services_v2.db_stats_service import (
        collect_sql_stats, collect_redis_stats, collect_comment_store_stats,
        collect_engine_perf,
    )
    sql = collect_sql_stats()
    redis_info = await collect_redis_stats()
    comment_store = collect_comment_store_stats()
    engine_perf = collect_engine_perf()
    return ApiResult(data={"sql": sql, "redis": redis_info,
                           "comment_store": comment_store, "engine_perf": engine_perf})


@router.get("/ip-geo")
async def dashboard_ip_geo(_: LocalUser = Depends(get_current_user)):
    """请求来源地图：解析 IP 统计为城市级散点（GeoLite2，库缺失时降级）"""
    import asyncio
    from src.services_v2.geoip_service import geoip_service
    # 解析可能涉及大量 IP，放线程池避免阻塞事件循环
    data = await asyncio.to_thread(geoip_service.aggregate_points)
    return ApiResult(data=data)
