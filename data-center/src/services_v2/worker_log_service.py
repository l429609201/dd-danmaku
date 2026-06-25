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
                    client_ip=data.get("ip") or item.get("ip"),
                    method=data.get("method"),
                    path=data.get("path"),
                    status=data.get("responseStatus") or data.get("status"),
                    ua_type=data.get("userAgent") or data.get("ua_type"),
                    cache_source=data.get("cacheSource"),
                    upstream_status=data.get("upstreamStatus"),
                    key_id=data.get("keyId"),
                    duration_ms=data.get("durationMs"),
                    # 级别统一大写，兼容 Worker 端小写 warn/info，避免前端筛选失配
                    level=str(item.get("level", "INFO")).upper(),
                    message=item.get("message", ""),
                )
                db.add(row)
                count += 1
                self._broadcast({
                    "worker_id": worker_id,
                    "level": row.level, "message": row.message,
                    "client_ip": row.client_ip, "method": row.method,
                    "path": row.path, "status": row.status,
                    "cache_source": row.cache_source,
                    "upstream_status": row.upstream_status,
                    "key_id": row.key_id, "duration_ms": row.duration_ms,
                    "created_at": now().isoformat(),
                })
            db.commit()
            return count
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Worker 日志落库失败: {e}")
            return 0
        finally:
            db.close()


worker_log_service = WorkerLogService()
