"""
媒体库聚合查询接口

以番剧为单位聚合展示库内现有媒体信息（海报/类型/简介），并标识缺失情况。
海报通过本地代理回源，绕开 dandanplay 防盗链。
"""
import asyncio
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response

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


@router.get("/poster")
async def poster_proxy(url: str = Query(..., description="上游海报原始 URL")):
    """海报代理：服务端回源拉取图片返回，绕开防盗链（Referer 限制）。
    仅允许白名单域名，避免 SSRF / 开放代理滥用。"""
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="非法 URL")
    # 域名白名单：仅代理 dandanplay 相关图床
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").lower()
    allowed = ("dandanplay.com", "dandanplay.net", "acplay.net")
    if not any(host == d or host.endswith("." + d) for d in allowed):
        raise HTTPException(status_code=403, detail="不允许代理该域名")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            # 带 dandanplay Referer，规避防盗链
            resp = await client.get(url, headers={
                "Referer": "https://www.dandanplay.com/",
                "User-Agent": "Mozilla/5.0",
            })
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="海报获取失败")
        content_type = resp.headers.get("content-type", "image/jpeg")
        # 缓存 1 天，减少回源
        return Response(content=resp.content, media_type=content_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"⚠️ 海报代理失败 {url}: {e}")
        raise HTTPException(status_code=502, detail="海报回源失败")


@router.get("/{anime_id}")
async def get_media_detail(anime_id: str, _: LocalUser = Depends(get_current_user)):
    """番剧详情：每集弹幕/链接状态 + 封面简介元数据"""
    data = await asyncio.to_thread(media_service.get_detail, anime_id)
    if not data:
        raise HTTPException(status_code=404, detail="未找到该番剧")
    return ApiResult(data=data)