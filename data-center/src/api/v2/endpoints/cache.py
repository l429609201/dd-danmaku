"""
缓存查询管理：响应缓存、访问日志、刷新任务
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, PageResult
from src.database import get_db_sync
from src.models_v2 import (
    ApiCacheAccessLog, ApiCacheRefreshTask, ApiResponseCache,
)
from src.models_v2.base import now
from src.models_v2 import LocalUser
from src.services_v2.redis_cache import redis_cache

logger = logging.getLogger(__name__)
router = APIRouter()


def _cache_brief(row: ApiResponseCache) -> dict:
    return {
        "id": row.id, "cache_key": row.cache_key, "api_path": row.api_path,
        "method": row.method, "status_code": row.status_code,
        "client_ip_hash": row.client_ip_hash,
        "body_size": row.body_size, "storage_mode": row.storage_mode,
        "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
        "refresh_after": row.refresh_after.isoformat() if row.refresh_after else None,
        "expire_at": row.expire_at.isoformat() if row.expire_at else None,
        "hit_count": row.hit_count, "stale_hit_count": row.stale_hit_count,
        "refresh_pending": row.refresh_pending,
    }


@router.get("/responses")
async def list_responses(
    api_path: Optional[str] = None, keyword: Optional[str] = None,
    client_ip_hash: Optional[str] = None,
    refresh_pending: Optional[bool] = None,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """响应缓存列表"""
    db = get_db_sync()
    try:
        q = db.query(ApiResponseCache)
        if api_path:
            q = q.filter(ApiResponseCache.api_path.like(f"%{api_path}%"))
        if keyword:
            q = q.filter(ApiResponseCache.cache_key.like(f"%{keyword}%"))
        if client_ip_hash:
            q = q.filter(ApiResponseCache.client_ip_hash.like(f"%{client_ip_hash}%"))
        if refresh_pending is not None:
            q = q.filter(ApiResponseCache.refresh_pending == refresh_pending)
        total = q.count()
        rows = q.order_by(ApiResponseCache.fetched_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[_cache_brief(r) for r in rows])
    finally:
        db.close()


@router.get("/responses/{cache_id}")
async def get_response(cache_id: int, _: LocalUser = Depends(get_current_user)):
    """响应缓存详情（含 body）"""
    db = get_db_sync()
    try:
        row = db.query(ApiResponseCache).filter(ApiResponseCache.id == cache_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="缓存不存在")
        body = None
        if row.storage_mode == "redis" and row.redis_key:
            body = await redis_cache.get(row.redis_key)
        if body is None:
            body = row.response_body
        data = _cache_brief(row)
        data["body"] = body
        data["headers"] = row.response_headers_json or {}
        return ApiResult(data=data)
    finally:
        db.close()


@router.delete("/responses/{cache_id}")
async def delete_response(cache_id: int, _: LocalUser = Depends(require_operator)):
    """删除缓存（同时清 Redis）"""
    db = get_db_sync()
    try:
        row = db.query(ApiResponseCache).filter(ApiResponseCache.id == cache_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="缓存不存在")
        if row.redis_key:
            await redis_cache.delete(row.redis_key)
        db.delete(row)
        db.commit()
        return ApiResult(message="删除成功")
    finally:
        db.close()


@router.post("/responses/{cache_id}/mark-refresh")
async def mark_refresh(cache_id: int, _: LocalUser = Depends(require_operator)):
    """标记待刷新"""
    db = get_db_sync()
    try:
        row = db.query(ApiResponseCache).filter(ApiResponseCache.id == cache_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="缓存不存在")
        row.refresh_pending = True
        task = db.query(ApiCacheRefreshTask).filter(
            ApiCacheRefreshTask.cache_key == row.cache_key
        ).first()
        if not task:
            db.add(ApiCacheRefreshTask(
                cache_key=row.cache_key, api_path=row.api_path,
                reason="manual", status="pending",
            ))
        db.commit()
        return ApiResult(message="已标记待刷新")
    finally:
        db.close()


@router.get("/access-logs")
async def list_access_logs(
    cache_key: Optional[str] = None, access_type: Optional[str] = None,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """缓存访问日志（含 429 兜底记录）"""
    db = get_db_sync()
    try:
        q = db.query(ApiCacheAccessLog)
        if cache_key:
            q = q.filter(ApiCacheAccessLog.cache_key.like(f"%{cache_key}%"))
        if access_type:
            q = q.filter(ApiCacheAccessLog.access_type == access_type)
        total = q.count()
        rows = q.order_by(ApiCacheAccessLog.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[{
            "id": r.id, "cache_key": r.cache_key, "api_path": r.api_path,
            "access_type": r.access_type, "upstream_status": r.upstream_status,
            "served_status": r.served_status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows])
    finally:
        db.close()
