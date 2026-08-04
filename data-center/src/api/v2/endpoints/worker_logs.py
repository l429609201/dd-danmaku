"""
Worker 请求日志接口（S7）

- GET /worker-logs          历史日志分页
- GET /worker-logs/{log_id} 单条详情（含请求/响应体）
- GET /worker-logs/stream   SSE 实时日志（单进程 uvicorn 下有效）
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from src.api.v2.deps import get_current_user
from src.api.v2.pagination import build_cache_key, compute_total
from src.api.v2.schemas import ApiResult, PageResult
from src.database import get_db_sync
from src.models_v2 import WorkerRequestLog, LocalUser
from src.services_v2.worker_log_service import worker_log_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_logs(
    worker_id: Optional[str] = None,
    level: Optional[str] = None,
    keyword: Optional[str] = None,
    ip: Optional[str] = None,
    ua: Optional[str] = None,
    user_id: Optional[str] = None,
    with_total: bool = True,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """Worker 请求日志分页查询（支持按 path 关键词、client_ip、X-UA、用户ID 过滤）

    性能说明：
    - total 走截断 COUNT + 短 TTL 缓存，翻页不再重复全表扫描；
      前端翻页时可传 with_total=false 完全跳过。
    - 列表不返回 request_body / response_body（Text 大字段），
      展开行时调 GET /worker-logs/{id} 按需拉取。
    - 同步 DB 查询整体放线程池，避免阻塞事件循环。
    """
    return await asyncio.to_thread(
        _query_logs, worker_id, level, keyword, ip, ua, user_id,
        with_total, page, page_size,
    )


def _query_logs(worker_id, level, keyword, ip, ua, user_id,
                with_total, page, page_size) -> PageResult:
    """日志分页查询（同步，供线程池调用）"""
    db = get_db_sync()
    try:
        q = db.query(WorkerRequestLog)
        if worker_id:
            q = q.filter(WorkerRequestLog.worker_id == worker_id)
        if level:
            q = q.filter(WorkerRequestLog.level == level.upper())
        if keyword:
            q = q.filter(WorkerRequestLog.path.like(f"%{keyword}%"))
        # 按客户端 IP 模糊搜索，支持部分匹配（如网段前缀）
        if ip:
            q = q.filter(WorkerRequestLog.client_ip.like(f"%{ip}%"))
        # 按 X-UA（客户端 X-User-Agent，存于 ua_type 列）模糊搜索
        if ua:
            q = q.filter(WorkerRequestLog.ua_type.like(f"%{ua}%"))
        # 按客户端用户标识（X-Ddd-User）模糊搜索
        if user_id:
            q = q.filter(WorkerRequestLog.client_user_id.like(f"%{user_id}%"))

        ck = build_cache_key("worker_logs", worker_id, level, keyword, ip, ua, user_id)
        total, estimated = compute_total(db, q, ck, with_total)

        rows = q.order_by(WorkerRequestLog.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "worker_id": r.worker_id, "client_ip": r.client_ip,
            "method": r.method, "path": r.path, "query": r.query,
            "status": r.status,
            "ua_type": r.ua_type, "level": r.level, "message": r.message,
            "cache_source": r.cache_source, "upstream_status": r.upstream_status,
            "key_id": r.key_id, "client_user_id": r.client_user_id,
            "duration_ms": r.duration_ms,
            "response_bytes": r.response_bytes,
            # 是否有请求/响应体（前端据此决定要不要拉详情）；
            # 体本身不在列表返回，避免单次响应几 MB 拖慢页面。
            # query 已直接返回，不计入此判断——只有 query 的行也应可展开查看
            "has_body": bool(r.request_body or r.response_body),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return PageResult(total=total, items=items, total_estimated=estimated)
    finally:
        db.close()


@router.get("/detail/{log_id}")
async def get_log_detail(log_id: int, _: LocalUser = Depends(get_current_user)):
    """单条日志详情：返回请求体与响应体（列表已剔除大字段，展开行时调用）

    注意路径为 /detail/{id} 而非 /{id}，避免与 /stream 静态路径冲突。
    """
    def _fetch():
        db = get_db_sync()
        try:
            r = db.query(WorkerRequestLog).filter(
                WorkerRequestLog.id == log_id
            ).first()
            if not r:
                return None
            return {
                "id": r.id,
                "request_body": r.request_body,
                "response_body": r.response_body,
                "response_bytes": r.response_bytes,
            }
        finally:
            db.close()

    data = await asyncio.to_thread(_fetch)
    if data is None:
        raise HTTPException(status_code=404, detail="日志不存在")
    return ApiResult(data=data)


@router.get("/stream")
async def stream_logs(request: Request, _: LocalUser = Depends(get_current_user)):
    """SSE 实时推送 Worker 日志（单进程 uvicorn 下有效）"""
    queue = worker_log_service.subscribe()

    async def event_gen():
        try:
            # 首次连接发送注释行，建立连接
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # 心跳，避免反代/中间层断开空闲连接
                    yield ": heartbeat\n\n"
        finally:
            worker_log_service.unsubscribe(queue)

    return StreamingResponse(event_gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })
