"""
集数链接与实体索引查询
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import (
    ApiResult, EpisodeLinkCreate, EpisodeLinkUpdate, PageResult,
)
from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, EpisodeLink, LocalUser
from src.services_v2.entity_service import episode_link_service

logger = logging.getLogger(__name__)
router = APIRouter()


def _link_dict(r: EpisodeLink) -> dict:
    return {
        "id": r.id, "local_title": r.local_title,
        "season_number": r.season_number, "episode_number": r.episode_number,
        "episode_title": r.episode_title, "anime_title": r.anime_title,
        "dandan_anime_id": r.dandan_anime_id,
        "dandan_bangumi_id": r.dandan_bangumi_id,
        "dandan_episode_id": r.dandan_episode_id,
        "match_source": r.match_source, "confidence": r.confidence,
        "is_manual": r.is_manual,
        "source_cache_key": r.source_cache_key,
        "bangumi_cache_key": r.bangumi_cache_key,
        "comment_api_path": r.comment_api_path,
        "comment_cache_key": r.comment_cache_key,
        "verified_by_user_id": r.verified_by_user_id,
        "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
    }


@router.get("/links")
def list_links(
    keyword: Optional[str] = None, anime_id: Optional[str] = None,
    bangumi_id: Optional[str] = None, episode_id: Optional[str] = None,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """集数链接列表"""
    total, items = episode_link_service.list_links(
        keyword=keyword, anime_id=anime_id, bangumi_id=bangumi_id,
        episode_id=episode_id, page=page, page_size=page_size,
    )
    return PageResult(total=total, items=[_link_dict(r) for r in items])


@router.get("/links/{link_id}")
def get_link(link_id: int, _: LocalUser = Depends(get_current_user)):
    """集数链接详情"""
    db = get_db_sync()
    try:
        row = db.query(EpisodeLink).filter(EpisodeLink.id == link_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="链接不存在")
        return ApiResult(data=_link_dict(row))
    finally:
        db.close()


@router.post("/links")
def create_link(body: EpisodeLinkCreate,
                      _: LocalUser = Depends(require_operator)):
    """手动创建集数链接"""
    row = episode_link_service.create_link(body.model_dump())
    return ApiResult(message="创建成功", data=_link_dict(row))


@router.put("/links/{link_id}")
def update_link(link_id: int, body: EpisodeLinkUpdate,
                      current: LocalUser = Depends(require_operator)):
    """人工修正集数链接"""
    row = episode_link_service.update_link(
        link_id, body.model_dump(exclude_none=True), user_id=current.id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="链接不存在")
    return ApiResult(message="修正成功", data=_link_dict(row))
