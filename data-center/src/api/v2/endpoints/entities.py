"""
响应实体索引查询（anime/bangumi/episode）
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import PageResult
from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
def list_entities(
    type: Optional[str] = Query(None, description="anime/bangumi/episode"),
    keyword: Optional[str] = None,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """实体索引列表"""
    db = get_db_sync()
    try:
        q = db.query(ApiResponseEntity)
        if type:
            q = q.filter(ApiResponseEntity.entity_type == type)
        if keyword:
            q = q.filter(ApiResponseEntity.title.like(f"%{keyword}%"))
        total = q.count()
        rows = q.order_by(ApiResponseEntity.last_seen_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "title": r.title, "episode_title": r.episode_title,
            "api_path": r.api_path, "cache_key": r.cache_key,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()
