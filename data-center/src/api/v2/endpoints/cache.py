"""
缓存查询管理：响应缓存、访问日志、刷新任务
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.pagination import build_cache_key, compute_total, invalidate_total_cache
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
        "client_ip": row.client_ip,
        "body_size": row.body_size, "storage_mode": row.storage_mode,
        "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
        "refresh_after": row.refresh_after.isoformat() if row.refresh_after else None,
        "expire_at": row.expire_at.isoformat() if row.expire_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "hit_count": row.hit_count, "stale_hit_count": row.stale_hit_count,
        "upstream_429_count": row.upstream_429_count,
        "refresh_pending": row.refresh_pending,
        "is_empty": row.is_empty,
    }


@router.get("/stats")
def cache_stats(_: LocalUser = Depends(get_current_user)):
    """响应缓存概览统计：总数 / 待刷新 / 存储分布 / 总体积"""
    from sqlalchemy import func
    db = get_db_sync()
    try:
        total = db.query(func.count(ApiResponseCache.id)).scalar() or 0
        pending = db.query(func.count(ApiResponseCache.id)).filter(
            ApiResponseCache.refresh_pending == True  # noqa: E712
        ).scalar() or 0
        redis_cnt = db.query(func.count(ApiResponseCache.id)).filter(
            ApiResponseCache.storage_mode == "redis"
        ).scalar() or 0
        total_bytes = db.query(func.coalesce(func.sum(ApiResponseCache.body_size), 0)).scalar() or 0
        # 已过期数量（expire_at 早于当前时间）
        expired = db.query(func.count(ApiResponseCache.id)).filter(
            ApiResponseCache.expire_at < now()
        ).scalar() or 0
        return ApiResult(data={
            "total": total, "refresh_pending": pending,
            "redis_count": redis_cnt, "sql_count": total - redis_cnt,
            "total_bytes": int(total_bytes), "expired": expired,
        })
    finally:
        db.close()


@router.get("/responses")
async def list_responses(
    api_path: Optional[str] = None, keyword: Optional[str] = None,
    client_ip: Optional[str] = None,
    refresh_pending: Optional[bool] = None,
    is_empty: Optional[bool] = None,
    with_total: bool = True,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """响应缓存列表（is_empty=true 只看空结果负缓存）

    total 走截断 COUNT + 短 TTL 缓存；整体放线程池避免阻塞事件循环。
    """
    return await asyncio.to_thread(
        _query_responses, api_path, keyword, client_ip,
        refresh_pending, is_empty, with_total, page, page_size,
    )


def _query_responses(api_path, keyword, client_ip, refresh_pending,
                     is_empty, with_total, page, page_size) -> PageResult:
    """响应缓存分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(ApiResponseCache)
        if api_path:
            q = q.filter(ApiResponseCache.api_path.like(f"%{api_path}%"))
        if keyword:
            q = q.filter(ApiResponseCache.cache_key.like(f"%{keyword}%"))
        if client_ip:
            q = q.filter(ApiResponseCache.client_ip.like(f"%{client_ip}%"))
        if refresh_pending is not None:
            q = q.filter(ApiResponseCache.refresh_pending == refresh_pending)
        # 空结果分页：is_empty 显式传 true/false 时过滤；不传则全部
        if is_empty is not None:
            q = q.filter(ApiResponseCache.is_empty == is_empty)

        ck = build_cache_key("api_cache", api_path, keyword, client_ip,
                             refresh_pending, is_empty)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(ApiResponseCache.fetched_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[_cache_brief(r) for r in rows],
                          total_estimated=estimated)
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
        # 删除后失效 total 缓存，避免列表总数长时间不变
        invalidate_total_cache("total:api_cache:")
        return ApiResult(message="删除成功")
    finally:
        db.close()


@router.post("/responses/{cache_id}/mark-refresh")
def mark_refresh(cache_id: int, _: LocalUser = Depends(require_operator)):
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


@router.post("/responses/{cache_id}/ttl")
def set_ttl(cache_id: int, body: dict = Body(...),
            _: LocalUser = Depends(require_operator)):
    """调整缓存过期时间：body { ttl_seconds } 从当前时间起算，主要用于空结果负缓存"""
    ttl = int(body.get("ttl_seconds") or 0)
    if ttl <= 0:
        raise HTTPException(status_code=400, detail="ttl_seconds 必须为正整数")
    from datetime import timedelta
    db = get_db_sync()
    try:
        row = db.query(ApiResponseCache).filter(ApiResponseCache.id == cache_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="缓存不存在")
        row.expire_at = now() + timedelta(seconds=ttl)
        db.commit()
        return ApiResult(message=f"已设置过期时间为 {ttl} 秒后",
                         data={"expire_at": row.expire_at.isoformat()})
    finally:
        db.close()


@router.get("/access-logs")
async def list_access_logs(
    cache_key: Optional[str] = None, access_type: Optional[str] = None,
    with_total: bool = True,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """缓存访问日志（含 429 兜底记录）

    所有访问类型全量保存；total 走截断 COUNT + 短 TTL 缓存，查询放线程池。
    """
    return await asyncio.to_thread(
        _query_access_logs, cache_key, access_type, with_total, page, page_size,
    )


def _query_access_logs(cache_key, access_type, with_total,
                       page, page_size) -> PageResult:
    """访问日志分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(ApiCacheAccessLog)
        if cache_key:
            q = q.filter(ApiCacheAccessLog.cache_key.like(f"%{cache_key}%"))
        if access_type:
            q = q.filter(ApiCacheAccessLog.access_type == access_type)

        ck = build_cache_key("access_logs", cache_key, access_type)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(ApiCacheAccessLog.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[{
            "id": r.id, "cache_key": r.cache_key, "api_path": r.api_path,
            "access_type": r.access_type, "upstream_status": r.upstream_status,
            "served_status": r.served_status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows], total_estimated=estimated)
    finally:
        db.close()
