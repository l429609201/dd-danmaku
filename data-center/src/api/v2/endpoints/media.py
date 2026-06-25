"""
媒体库聚合查询接口

以番剧为单位聚合展示库内现有媒体信息，并标识缺失情况（弹幕/链接）。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import ApiResult, PageResult
from src.models_v2 import LocalUser
from src.services_v2.media_service import media_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/library")
async def list_library(
    keyword: Optional[str] = None,
    only_missing: bool = False,
    page: int = 1, page_size: int = Query(12, le=60),
    _: LocalUser = Depends(get_current_user),
):
    """媒体库：按番剧聚合（集数/弹幕覆盖/缺失），支持搜索与仅看缺失"""
    result = await asyncio.to_thread(
        media_service.list_library, keyword, only_missing, page, page_size)
    return PageResult(total=result["total"], items=result["items"])


@router.get("/{anime_id}")
async def get_media_detail(anime_id: str, _: LocalUser = Depends(get_current_user)):
    """番剧详情：每集弹幕/链接状态 + 封面简介元数据"""
    data = await asyncio.to_thread(media_service.get_detail, anime_id)
    if not data:
        raise HTTPException(status_code=404, detail="未找到该番剧")
    return ApiResult(data=data)
