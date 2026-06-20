"""
IP 请求统计查询接口（S5）

- /ip-stats/current   当前累计（按违规/请求量排序）
- /ip-stats/snapshots 周期快照（趋势）
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import PageResult
from src.database import get_db_sync
from src.models_v2 import IpRequestStatCurrent, IpRequestStatSnapshot, LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/current")
async def list_current(
    worker_id: Optional[str] = None,
    keyword: Optional[str] = None,
    order_by: str = "total_count",
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """当前 IP 请求统计累计"""
    db = get_db_sync()
    try:
        q = db.query(IpRequestStatCurrent)
        if worker_id:
            q = q.filter(IpRequestStatCurrent.worker_id == worker_id)
        if keyword:
            q = q.filter(IpRequestStatCurrent.ip.like(f"%{keyword}%"))
        order_col = IpRequestStatCurrent.violation_count \
            if order_by == "violation_count" else IpRequestStatCurrent.total_count
        total = q.count()
        rows = q.order_by(order_col.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "ip": r.ip, "worker_id": r.worker_id,
            "total_count": r.total_count, "violation_count": r.violation_count,
            "path_stats": r.path_stats_json or {},
            "last_access_at": r.last_access_at.isoformat() if r.last_access_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()


@router.get("/snapshots")
async def list_snapshots(
    ip: Optional[str] = None,
    worker_id: Optional[str] = None,
    page: int = 1, page_size: int = Query(100, le=500),
    _: LocalUser = Depends(get_current_user),
):
    """IP 请求统计周期快照（用于趋势）"""
    db = get_db_sync()
    try:
        q = db.query(IpRequestStatSnapshot)
        if ip:
            q = q.filter(IpRequestStatSnapshot.ip == ip)
        if worker_id:
            q = q.filter(IpRequestStatSnapshot.worker_id == worker_id)
        total = q.count()
        rows = q.order_by(IpRequestStatSnapshot.snapshot_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "ip": r.ip, "worker_id": r.worker_id,
            "total_count": r.total_count, "violation_count": r.violation_count,
            "top_paths": r.top_paths_json or {},
            "snapshot_at": r.snapshot_at.isoformat() if r.snapshot_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()
