"""
Worker 请求日志接口（S7）

- GET /worker-logs        日志检索（分页 + 筛选，数据源为轮转 JSONL 文件）
- GET /worker-logs/files  轮转文件列表（供前端切换查看历史文件）
- GET /worker-logs/stream SSE 实时日志（单进程 uvicorn 下有效）

存储从 worker_request_logs 表改为轮转文件：原表现网 3.2 GB / 58 万行，
大字段（request_body / response_body）撑爆数据库且清理跟不上写入。
明细走文件，聚合统计走 worker_log_daily_stats 计数表。
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from src.api.v2.deps import get_current_user
from src.api.v2.schemas import ApiResult, PageResult
from src.models_v2 import LocalUser
from src.services_v2.worker_log_file_service import worker_log_file_service
from src.services_v2.worker_log_service import worker_log_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_logs(
    file: Optional[str] = None,
    level: Optional[str] = None,
    keyword: Optional[str] = None,
    ip: Optional[str] = None,
    ua: Optional[str] = None,
    user_id: Optional[str] = None,
    status: Optional[int] = None,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """Worker 日志检索（数据源为轮转 JSONL 文件，倒序：最新在前）

    与原 SQL 版的差异：
    - file 指定查哪个轮转文件（缺省为当前 worker.log）；
      跨文件需前端切换，避免一次扫完 200 MB。
    - keyword 跨字段搜（path/query/message/请求体/响应体），
      原先只搜 path。
    - total 是本文件内匹配数，扫描超上限时 total_estimated=true。
    - 请求/响应体直接随列表返回：文件里本就带着，不必再走详情接口。
    - 文件 IO 放线程池，避免阻塞事件循环。
    """
    res = await asyncio.to_thread(
        worker_log_file_service.search,
        file, level, keyword, ip, ua, user_id, status, page, page_size,
    )
    items = res["items"]
    for it in items:
        # 前端展开行判断用；文件里已带 body，无需按需加载
        it["has_body"] = bool(it.get("request_body") or it.get("response_body"))
    return PageResult(
        total=res["total"], items=items,
        total_estimated=res["total_estimated"],
    )


@router.get("/files")
async def list_log_files(_: LocalUser = Depends(get_current_user)):
    """轮转文件列表：返回体积、行数与首末时间，供前端单文件切换。

    worker.log 为当前写入文件，worker.log.1 ~ .10 编号越大越旧；
    元信息在服务层按文件身份缓存，当前文件追加时仅扫描新增字节。
    """
    files = await asyncio.to_thread(worker_log_file_service.list_files)
    return ApiResult(data={"files": files})


@router.get("/stats")
async def log_file_stats(_: LocalUser = Depends(get_current_user)):
    """日志文件写入状态：累计写入条数、目录、各轮转文件体积"""
    data = await asyncio.to_thread(worker_log_file_service.stats)
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
