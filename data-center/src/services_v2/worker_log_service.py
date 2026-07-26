"""
Worker 请求日志服务（S7）

接收 Worker log.report 上报，落库到 worker_request_logs，
并通过内存订阅广播给 SSE 客户端（单进程 uvicorn 下有效）。
"""
import asyncio
import logging
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import WorkerRequestLog
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class WorkerLogService:
    """Worker 请求日志落库 + SSE 广播"""

    def __init__(self):
        # SSE 订阅者队列集合（单进程内存广播）
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    def _broadcast(self, item: Dict[str, Any]):
        """非阻塞广播；队列满则丢弃，避免拖垮上报"""
        for q in list(self._subscribers):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                pass

    @staticmethod
    def _clip(value: Any, limit: int) -> Any:
        """按列宽截断字符串，防止单条超长值触发 DataError 连坐整批日志丢失。

        曾发生：client_user_id 从原生 GUID 改为上报混淆标识后长度翻倍，
        超出 varchar(64) 导致每批 log.report 全量落库失败。
        """
        if value is None:
            return None
        s = str(value)
        return s[:limit] if len(s) > limit else s

    def ingest_report(self, worker_id: str, logs: List[Dict[str, Any]]) -> int:
        """落库一次 log.report；返回处理条数"""
        if not logs:
            return 0
        db = get_db_sync()
        count = 0
        try:
            for item in logs[-200:]:
                data = item.get("data") or {}
                row = WorkerRequestLog(
                    worker_id=worker_id,
                    client_ip=self._clip(data.get("ip") or item.get("ip"), 64),
                    method=self._clip(data.get("method"), 10),
                    path=self._clip(data.get("path"), 500),
                    status=data.get("responseStatus") or data.get("status"),
                    ua_type=self._clip(data.get("userAgent") or data.get("ua_type"), 100),
                    # 客户端用户标识（X-Ddd-User，混淆值约 96 字符）
                    client_user_id=self._clip(data.get("userId"), 255),
                    cache_source=self._clip(data.get("cacheSource"), 20),
                    upstream_status=data.get("upstreamStatus"),
                    key_id=self._clip(data.get("keyId"), 64),
                    duration_ms=data.get("durationMs"),
                    # responseBytes 由 Worker 上报，单位字节
                    response_bytes=data.get("responseBytes"),
                    # 请求/响应体（Worker 侧已截断至 4 KB）
                    request_body=data.get("requestBody"),
                    response_body=data.get("responseBody"),
                    # 级别统一大写，兼容 Worker 端小写 warn/info，避免前端筛选失配
                    level=self._clip(str(item.get("level", "INFO")).upper(), 20),
                    message=item.get("message", ""),
                )
                db.add(row)
                count += 1
                self._broadcast({
                    "worker_id": worker_id,
                    "level": row.level, "message": row.message,
                    "client_ip": row.client_ip, "method": row.method,
                    "path": row.path, "status": row.status,
                    "ua_type": row.ua_type,
                    "client_user_id": row.client_user_id,
                    "cache_source": row.cache_source,
                    "upstream_status": row.upstream_status,
                    "key_id": row.key_id,
                    "duration_ms": row.duration_ms,
                    "response_bytes": row.response_bytes,
                    "request_body": row.request_body,
                    "response_body": row.response_body,
                    "created_at": now().isoformat(),
                })
            db.commit()
            return count
        except Exception as e:
            db.rollback()
            # 整批失败时降级为逐条提交：坏数据只丢自己，不连坐同批其他日志。
            # 排查场景强依赖日志，宁可慢一次也不能整批丢失。
            logger.warning(f"⚠️ Worker 日志批量落库失败，降级逐条提交: {e}")
            saved = 0
            for item in logs[-200:]:
                try:
                    data = item.get("data") or {}
                    db.add(WorkerRequestLog(
                        worker_id=worker_id,
                        client_ip=self._clip(data.get("ip") or item.get("ip"), 64),
                        method=self._clip(data.get("method"), 10),
                        path=self._clip(data.get("path"), 500),
                        status=data.get("responseStatus") or data.get("status"),
                        ua_type=self._clip(data.get("userAgent") or data.get("ua_type"), 100),
                        client_user_id=self._clip(data.get("userId"), 255),
                        cache_source=self._clip(data.get("cacheSource"), 20),
                        upstream_status=data.get("upstreamStatus"),
                        key_id=self._clip(data.get("keyId"), 64),
                        duration_ms=data.get("durationMs"),
                        response_bytes=data.get("responseBytes"),
                        request_body=data.get("requestBody"),
                        response_body=data.get("responseBody"),
                        level=self._clip(str(item.get("level", "INFO")).upper(), 20),
                        message=item.get("message", ""),
                    ))
                    db.commit()
                    saved += 1
                except Exception as inner:
                    db.rollback()
                    logger.error(f"❌ 单条日志落库失败（丢弃）: {inner}")
            return saved
        finally:
            db.close()


worker_log_service = WorkerLogService()
