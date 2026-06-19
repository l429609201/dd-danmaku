"""
运行事件接口：查询 runtime_events
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user
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
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """分页查询运行事件"""
    db = get_db_sync()
    try:
        q = db.query(RuntimeEvent)
        if level:
            q = q.filter(RuntimeEvent.level == level.upper())
        if category:
            q = q.filter(RuntimeEvent.category == category)
        if event:
            q = q.filter(RuntimeEvent.event == event)
        total = q.count()
        rows = q.order_by(RuntimeEvent.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "level": r.level, "category": r.category,
            "event": r.event, "message": r.message,
            "details_json": r.details_json,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()
