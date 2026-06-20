"""
Worker 请求日志接口（S7）

- GET /worker-logs          历史日志分页
- GET /worker-logs/stream   SSE 实时日志（单进程 uvicorn 下有效）
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import PageResult
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
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """Worker 请求日志分页查询"""
    db = get_db_sync()
    try:
        q = db.query(WorkerRequestLog)
        if worker_id:
            q = q.filter(WorkerRequestLog.worker_id == worker_id)
        if level:
            q = q.filter(WorkerRequestLog.level == level.upper())
        if keyword:
            q = q.filter(WorkerRequestLog.path.like(f"%{keyword}%"))
        total = q.count()
        rows = q.order_by(WorkerRequestLog.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "worker_id": r.worker_id, "client_ip": r.client_ip,
            "method": r.method, "path": r.path, "status": r.status,
            "ua_type": r.ua_type, "level": r.level, "message": r.message,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()


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
