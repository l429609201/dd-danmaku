"""
媒体库聚合查询接口

以番剧为单位聚合展示库内现有媒体信息（海报/类型/简介），并标识缺失情况。
海报直连上游图床（dandanplay 图床不防盗链），不经本地代理。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, PageResult
from src.database import get_db_sync
from src.models_v2 import LocalUser
from src.services_v2.media_meta_service import media_meta_service
from src.services_v2.media_service import media_service

logger = logging.getLogger(__name__)
router = APIRouter()


class ExternalIdBody(BaseModel):
    """人工填写外部平台 ID。provider 自由文本，新增平台无需改代码。"""
    provider: str
    external_id: Optional[str] = None
    external_url: Optional[str] = None


class AliasBody(BaseModel):
    """人工新增别名，落库即 approved 生效。"""
    alias: str
    lang: Optional[str] = None
    title_type: str = "alias"


class AliasReview(BaseModel):
    """审核 pending 别名：approve=true 转 approved，false 转 rejected。"""
    approve: bool


class AliasReassign(BaseModel):
    """改挂：把别名重新关联到指定番剧。原侧标 rejected 留痕。"""
    target_anime_id: str


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


# ---------- 外部平台 ID 与别名（阶段 4） ----------
# 注意：这些路由必须声明在 `/{anime_id}` 之前，
# 否则 `/meta/...` 会被通配路由当成 anime_id 捕获。

@router.get("/alias/pending")
async def list_pending_aliases(
    status: str = "pending",
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """待校验别名列表（校验页数据源），按命中数降序——先修最热的词"""
    def _load():
        db = get_db_sync()
        try:
            return media_meta_service.list_pending(db, status, page, page_size)
        finally:
            db.close()
    r = await asyncio.to_thread(_load)
    return PageResult(total=r["total"], items=r["items"])


@router.post("/alias/generate")
async def generate_alias_candidates(
    limit: int = Query(200, le=1000),
    min_hit: int = 1,
    _: LocalUser = Depends(require_operator),
):
    """扫空结果负缓存生成候选别名（产出一律 pending，需人工确认）"""
    def _gen():
        db = get_db_sync()
        try:
            s = media_meta_service.generate_candidates(db, limit, min_hit)
            db.commit()
            return s
        finally:
            db.close()
    s = await asyncio.to_thread(_gen)
    return ApiResult(
        message=(f"扫描 {s['scanned']}，新增候选 {s['matched']}，"
                 f"已存在 {s['exists']}，无候选 {s['no_candidate']}"),
        data=s)


@router.post("/alias/ai-score")
async def ai_score_aliases(
    max_calls: Optional[int] = None,
    _: LocalUser = Depends(require_operator),
):
    """让 AI 给低置信度 pending 候选打分（仅写 ai_suggestion 供人工参考）"""
    from src.services_v2.alias_ai_service import alias_ai_service
    s = await alias_ai_service.score_pending(max_calls)
    if s.get("enabled") is False:
        raise HTTPException(status_code=400, detail="AI 辅助未启用或未配置 API Key")
    return ApiResult(
        message=f"已打分 {s.get('scored', 0)} 条，跳过 {s.get('skipped', 0)}，失败 {s.get('failed', 0)}",
        data=s)


@router.post("/alias/external")
async def external_supplement_aliases(
    max_calls: Optional[int] = None,
    _: LocalUser = Depends(require_operator),
):
    """外部源（TMDB/BGM）补充：拿外部别名回本地二次匹配，产出仍是 pending"""
    from src.services_v2.alias_external_service import alias_external_service
    s = await alias_external_service.supplement(max_calls)
    if s.get("enabled") is False:
        raise HTTPException(status_code=400,
                            detail="外部源未启用，或选了 tmdb 但未配 API Key")
    return ApiResult(
        message=(f"扫描 {s.get('scanned', 0)}，新增 {s.get('matched', 0)}，"
                 f"外部无结果 {s.get('no_external', 0)}，"
                 f"本地无对应 {s.get('no_local', 0)}"),
        data=s)


@router.get("/alias/by-anime")
async def list_aliases_by_anime(
    only_pending: bool = True,
    keyword: Optional[str] = None,
    page: int = 1, page_size: int = Query(10, le=50),
    _: LocalUser = Depends(get_current_user),
):
    """以番剧为主的别名视图（校验页主列表）。

    only_pending=true 只列有待确认别名的番剧（待办清单），
    false 列全部有别名记录的番剧（日常别名管理台）。
    """
    def _load():
        db = get_db_sync()
        try:
            return media_meta_service.list_by_anime(
                db, only_pending, keyword, page, page_size)
        finally:
            db.close()
    r = await asyncio.to_thread(_load)
    return PageResult(total=r["total"], items=r["items"])


@router.get("/alias/cached-terms")
async def search_cached_terms(
    keyword: Optional[str] = None,
    only_unlinked: bool = True,
    limit: int = Query(30, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """搜已缓存的响应搜索词，供人工手动挂到番剧下"""
    def _load():
        db = get_db_sync()
        try:
            return media_meta_service.search_cached_terms(
                db, keyword, only_unlinked, limit)
        finally:
            db.close()
    return ApiResult(data=await asyncio.to_thread(_load))


@router.put("/meta/alias/{row_id}/reassign")
async def reassign_alias(row_id: int, body: AliasReassign,
                         user: LocalUser = Depends(require_operator)):
    """改挂别名到指定番剧：目标侧 approved，原侧 rejected 留痕"""
    def _do():
        db = get_db_sync()
        try:
            r = media_meta_service.reassign_alias(
                db, row_id, body.target_anime_id, user.id)
            db.commit()
            return r
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    r = await asyncio.to_thread(_do)
    if not r:
        raise HTTPException(status_code=400, detail="记录不存在或目标番剧与原番剧相同")
    return ApiResult(message=f"已改挂到 {r['to']}", data=r)


@router.get("/meta/{anime_id}")
async def get_media_meta(anime_id: str, _: LocalUser = Depends(get_current_user)):
    """取某番剧的外部平台 ID 与别名列表（媒体库详情页两个区块的数据源）"""
    def _load():
        db = get_db_sync()
        try:
            return {
                "anime_id": anime_id,
                "external_ids": media_meta_service.list_external_ids(db, anime_id),
                "aliases": media_meta_service.list_aliases(db, anime_id),
            }
        finally:
            db.close()
    return ApiResult(data=await asyncio.to_thread(_load))


@router.put("/meta/{anime_id}/external-id")
async def put_external_id(anime_id: str, body: ExternalIdBody,
                          _: LocalUser = Depends(require_operator)):
    """人工新增/修改外部平台 ID（一律标 manual，自动提取不再覆盖）"""
    def _save():
        db = get_db_sync()
        try:
            media_meta_service.save_external_id(
                db, anime_id, body.provider, body.external_id, body.external_url)
            db.commit()
        finally:
            db.close()
    try:
        await asyncio.to_thread(_save)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return ApiResult(message="已保存")


@router.delete("/meta/external-id/{row_id}")
async def del_external_id(row_id: int, _: LocalUser = Depends(require_operator)):
    """删除一条外部平台 ID"""
    def _del():
        db = get_db_sync()
        try:
            ok = media_meta_service.delete_external_id(db, row_id)
            db.commit()
            return ok
        finally:
            db.close()
    if not await asyncio.to_thread(_del):
        raise HTTPException(status_code=404, detail="记录不存在")
    return ApiResult(message="已删除")


@router.put("/meta/{anime_id}/alias")
async def put_alias(anime_id: str, body: AliasBody,
                    user: LocalUser = Depends(require_operator)):
    """人工新增别名，直接 approved 生效"""
    def _save():
        db = get_db_sync()
        try:
            media_meta_service.save_alias(
                db, anime_id, body.alias, body.lang, body.title_type, user.id)
            db.commit()
        finally:
            db.close()
    try:
        await asyncio.to_thread(_save)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return ApiResult(message="已保存")


@router.put("/meta/alias/{row_id}/review")
async def review_alias(row_id: int, body: AliasReview,
                       user: LocalUser = Depends(require_operator)):
    """审核 pending 别名：通过转 approved，拒绝转 rejected"""
    def _review():
        db = get_db_sync()
        try:
            row = media_meta_service.review_alias(db, row_id, body.approve, user.id)
            db.commit()
            return row is not None
        finally:
            db.close()
    if not await asyncio.to_thread(_review):
        raise HTTPException(status_code=404, detail="记录不存在")
    return ApiResult(message="已通过" if body.approve else "已拒绝")


@router.delete("/meta/alias/{row_id}")
async def del_alias(row_id: int, _: LocalUser = Depends(require_operator)):
    """删除一条别名"""
    def _del():
        db = get_db_sync()
        try:
            ok = media_meta_service.delete_alias(db, row_id)
            db.commit()
            return ok
        finally:
            db.close()
    if not await asyncio.to_thread(_del):
        raise HTTPException(status_code=404, detail="记录不存在")
    return ApiResult(message="已删除")


@router.get("/{anime_id}")
async def get_media_detail(anime_id: str, _: LocalUser = Depends(get_current_user)):
    """番剧详情：每集弹幕/链接状态 + 封面简介元数据"""
    data = await asyncio.to_thread(media_service.get_detail, anime_id)
    if not data:
        raise HTTPException(status_code=404, detail="未找到该番剧")
    return ApiResult(data=data)