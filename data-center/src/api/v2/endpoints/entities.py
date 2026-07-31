"""
响应实体索引查询（anime/bangumi/episode）
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user
from src.api.v2.pagination import build_cache_key, compute_total
from src.api.v2.schemas import ApiResult, PageResult
from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_entities(
    type: Optional[str] = Query(None, description="anime/bangumi/episode"),
    keyword: Optional[str] = None,
    with_total: bool = True,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """实体索引列表（total 走截断 COUNT + 短 TTL 缓存，查询放线程池）"""
    return await asyncio.to_thread(
        _query_entities, type, keyword, with_total, page, page_size,
    )


def _query_entities(type_, keyword, with_total, page, page_size) -> PageResult:
    """实体索引分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(ApiResponseEntity)
        if type_:
            q = q.filter(ApiResponseEntity.entity_type == type_)
        if keyword:
            q = q.filter(ApiResponseEntity.title.like(f"%{keyword}%"))

        ck = build_cache_key("entities", type_, keyword)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(ApiResponseEntity.last_seen_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "title": r.title, "episode_title": r.episode_title,
            "api_path": r.api_path, "cache_key": r.cache_key,
            "first_seen_at": r.first_seen_at.isoformat() if r.first_seen_at else None,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
        } for r in rows]
        return PageResult(total=total, items=items, total_estimated=estimated)
    finally:
        db.close()


@router.get("/stats")
def entity_stats(_: LocalUser = Depends(get_current_user)):
    """实体索引概览：总数 + 各类型分布"""
    from sqlalchemy import func
    db = get_db_sync()
    try:
        total = db.query(func.count(ApiResponseEntity.id)).scalar() or 0
        rows = db.query(ApiResponseEntity.entity_type, func.count(ApiResponseEntity.id)) \
            .group_by(ApiResponseEntity.entity_type).all()
        types = {t or "unknown": cnt for t, cnt in rows}
        return ApiResult(data={"total": total, "types": types})
    finally:
        db.close()


@router.get("/{entity_id}")
def get_entity(entity_id: int, _: LocalUser = Depends(get_current_user)):
    """实体详情（含上游原始 raw_json，用于溯源）"""
    db = get_db_sync()
    try:
        r = db.query(ApiResponseEntity).filter(ApiResponseEntity.id == entity_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="实体不存在")
        return ApiResult(data={
            "id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "title": r.title, "episode_title": r.episode_title,
            "api_path": r.api_path, "cache_key": r.cache_key,
            "raw_json": r.raw_json,
            "first_seen_at": r.first_seen_at.isoformat() if r.first_seen_at else None,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
        })
    finally:
        db.close()
