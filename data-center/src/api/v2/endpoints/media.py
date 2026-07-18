"""
媒体库聚合查询接口

以番剧为单位聚合展示库内现有媒体信息（海报/类型/简介），并标识缺失情况。
海报直连上游图床（dandanplay 图床不防盗链），不经本地代理。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
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


@router.post("/rebuild")
async def rebuild_library(_: LocalUser = Depends(require_operator)):
    """从已存储的响应缓存批量回填媒体库（解析历史 search/bangumi 响应）"""
    result = await media_service.rebuild_from_cache()
    return ApiResult(
        message=f"媒体库回填完成：扫描 {result.get('scanned', 0)}，解析 {result.get('parsed', 0)}",
        data=result)


@router.get("/{anime_id}")
async def get_media_detail(anime_id: str, _: LocalUser = Depends(get_current_user)):
    """番剧详情：每集弹幕/链接状态 + 封面简介元数据"""
    data = await asyncio.to_thread(media_service.get_detail, anime_id)
    if not data:
        raise HTTPException(status_code=404, detail="未找到该番剧")
    return ApiResult(data=data)