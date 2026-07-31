"""
IP 请求统计查询接口（S5）

- /ip-stats/current   当前累计（按违规/请求量排序，支持时间范围过滤）
- /ip-stats/snapshots 周期快照（趋势，支持时间范围过滤）

时间过滤说明：
- current 按 last_access_at（最近访问时间）过滤，回答"这段时间内活跃的 IP"
- snapshots 按 snapshot_at（快照时间）过滤
两列均已建索引，过滤能走索引，不引入额外开销。
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user
from src.api.v2.pagination import build_cache_key, compute_total
from src.api.v2.schemas import PageResult
from src.database import get_db_sync
from src.models_v2 import IpRequestStatCurrent, IpRequestStatSnapshot, LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    """解析前端传入的时间字符串为 naive datetime；无法解析返回 None（等于不过滤）

    兼容 ISO 8601（含末尾 Z）与 'YYYY-MM-DD HH:MM:SS'、'YYYY-MM-DD'。
    """
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        # fromisoformat 不认末尾 Z，替换为 +00:00 后再去掉时区（库内统一存本地 naive）
        normalized = raw.replace("Z", "+00:00").replace("T", " ")
        dt = datetime.fromisoformat(normalized)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except Exception:
        logger.debug(f"ℹ️ 无法解析时间参数，忽略该过滤: {raw}")
        return None


@router.get("/current")
async def list_current(
    worker_id: Optional[str] = None,
    keyword: Optional[str] = None,
    order_by: str = "total_count",
    start: Optional[str] = Query(None, description="起始时间（按最近访问时间过滤）"),
    end: Optional[str] = Query(None, description="结束时间（按最近访问时间过滤）"),
    with_total: bool = True,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """当前 IP 请求统计累计（支持按最近访问时间范围过滤）"""
    return await asyncio.to_thread(
        _query_current, worker_id, keyword, order_by,
        start, end, with_total, page, page_size,
    )


def _query_current(worker_id, keyword, order_by, start, end,
                   with_total, page, page_size) -> PageResult:
    """当前累计分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(IpRequestStatCurrent)
        if worker_id:
            q = q.filter(IpRequestStatCurrent.worker_id == worker_id)
        if keyword:
            q = q.filter(IpRequestStatCurrent.ip.like(f"%{keyword}%"))
        # 时间范围：按最近访问时间（该列已建索引）
        dt_start = _parse_dt(start)
        dt_end = _parse_dt(end)
        if dt_start:
            q = q.filter(IpRequestStatCurrent.last_access_at >= dt_start)
        if dt_end:
            q = q.filter(IpRequestStatCurrent.last_access_at <= dt_end)

        order_col = IpRequestStatCurrent.violation_count \
            if order_by == "violation_count" else IpRequestStatCurrent.total_count

        ck = build_cache_key("ip_stats_current", worker_id, keyword,
                             dt_start, dt_end)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(order_col.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "ip": r.ip, "worker_id": r.worker_id,
            "total_count": r.total_count, "violation_count": r.violation_count,
            "path_stats": r.path_stats_json or {},
            "last_access_at": r.last_access_at.isoformat() if r.last_access_at else None,
        } for r in rows]
        return PageResult(total=total, items=items, total_estimated=estimated)
    finally:
        db.close()


@router.get("/snapshots")
async def list_snapshots(
    ip: Optional[str] = None,
    worker_id: Optional[str] = None,
    start: Optional[str] = Query(None, description="起始时间（按快照时间过滤）"),
    end: Optional[str] = Query(None, description="结束时间（按快照时间过滤）"),
    with_total: bool = True,
    page: int = 1, page_size: int = Query(100, le=500),
    _: LocalUser = Depends(get_current_user),
):
    """IP 请求统计周期快照（用于趋势，支持按快照时间范围过滤）"""
    return await asyncio.to_thread(
        _query_snapshots, ip, worker_id, start, end,
        with_total, page, page_size,
    )


def _query_snapshots(ip, worker_id, start, end,
                     with_total, page, page_size) -> PageResult:
    """快照分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(IpRequestStatSnapshot)
        if ip:
            q = q.filter(IpRequestStatSnapshot.ip == ip)
        if worker_id:
            q = q.filter(IpRequestStatSnapshot.worker_id == worker_id)
        dt_start = _parse_dt(start)
        dt_end = _parse_dt(end)
        if dt_start:
            q = q.filter(IpRequestStatSnapshot.snapshot_at >= dt_start)
        if dt_end:
            q = q.filter(IpRequestStatSnapshot.snapshot_at <= dt_end)

        ck = build_cache_key("ip_stats_snapshots", ip, worker_id, dt_start, dt_end)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(IpRequestStatSnapshot.snapshot_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "ip": r.ip, "worker_id": r.worker_id,
            "total_count": r.total_count, "violation_count": r.violation_count,
            "top_paths": r.top_paths_json or {},
            "snapshot_at": r.snapshot_at.isoformat() if r.snapshot_at else None,
        } for r in rows]
        return PageResult(total=total, items=items, total_estimated=estimated)
    finally:
        db.close()
