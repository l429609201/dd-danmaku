"""
Dashboard 概览接口：聚合关键指标
"""
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import ApiResult
from src.database import get_db_sync
from src.models_v2 import (
    ApiResponseCache, ApiCacheAccessLog, ApiCacheRefreshTask,
    ControlNode, EpisodeLink, RuntimeEvent, LocalUser,
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
