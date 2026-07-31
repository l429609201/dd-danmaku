"""
运行事件接口：查询 runtime_events
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user
from src.api.v2.pagination import build_cache_key, compute_total
from src.api.v2.schemas import PageResult
from src.database import get_db_sync
from src.models_v2 import RuntimeEvent, LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_events(
    level: Optional[str] = None,
    category: Optional[str] = None,
    event: Optional[str] = None,
    with_total: bool = True,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """分页查询运行事件（total 走截断 COUNT + 短 TTL 缓存，查询放线程池）"""
    return await asyncio.to_thread(
        _query_events, level, category, event, with_total, page, page_size,
    )


def _query_events(level, category, event, with_total, page, page_size) -> PageResult:
    """运行事件分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(RuntimeEvent)
        if level:
            q = q.filter(RuntimeEvent.level == level.upper())
        if category:
            q = q.filter(RuntimeEvent.category == category)
        if event:
            q = q.filter(RuntimeEvent.event == event)

        ck = build_cache_key("runtime_events", level, category, event)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(RuntimeEvent.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "level": r.level, "category": r.category,
            "event": r.event, "message": r.message,
            "details_json": r.details_json,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return PageResult(total=total, items=items, total_estimated=estimated)
    finally:
        db.close()
