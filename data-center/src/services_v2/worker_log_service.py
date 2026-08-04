"""
Worker 请求日志服务（S7）

接收 Worker log.report 上报，写入轮转 JSONL 文件（见 worker_log_file_service），
并通过内存订阅广播给 SSE 客户端（单进程 uvicorn 下有效）。

存储从 worker_request_logs 表改为文件：该表现网涨到 3.2 GB / 58 万行，
大字段（request_body / response_body）撑爆数据库且清理跟不上写入。
"""
import asyncio
import logging
from typing import Any, Dict, List

from src.models_v2.base import now
from src.services_v2.worker_log_file_service import worker_log_file_service
from src.services_v2.worker_log_stats_service import worker_log_stats_service

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
        """接收一次 log.report：写入轮转文件 + SSE 广播；返回处理条数。

        不再落库 worker_request_logs——该表在现网涨到 3.2 GB / 58 万行，
        每行带 request_body / response_body 两个 4 KB 大字段，
        按行数清理跟不上写入速度。改为 JSONL 轮转文件（20 MB × 10），
        体积恒定在 200 MB 以内，且不再占用数据库写入与磁盘。

        SSE 广播保持不变：它走内存队列，与持久化方式无关。
        """
        if not logs:
            return 0
        rows: List[Dict[str, Any]] = []
        for item in logs[-200:]:
            data = item.get("data") or {}
            # 字段名与原 SQL 列保持一致，前端与 MCP 工具无需改字段映射
            row = {
                "created_at": now().isoformat(),
                "worker_id": worker_id,
                "level": str(item.get("level", "INFO")).upper(),
                "message": item.get("message", ""),
                "client_ip": data.get("ip") or item.get("ip"),
                "method": data.get("method"),
                "path": data.get("path"),
                # URL 参数里的搜索词/episodeId（GET 请求参数不在 body 里）
                "query": data.get("query"),
                "status": data.get("responseStatus") or data.get("status"),
                "ua_type": data.get("userAgent") or data.get("ua_type"),
                "client_user_id": data.get("userId"),
                "cache_source": data.get("cacheSource"),
                "upstream_status": data.get("upstreamStatus"),
                "key_id": data.get("keyId"),
                "duration_ms": data.get("durationMs"),
                "response_bytes": data.get("responseBytes"),
                # 请求/响应体（Worker 侧已截断至 4 KB）；
                # 文件存储无列宽限制，不再需要 _clip
                "request_body": data.get("requestBody"),
                "response_body": data.get("responseBody"),
            }
            rows.append(row)
            self._broadcast(row)
        # 聚合计数（纯内存累加，周期落库）：明细在文件里，
        # 仪表盘洞察靠这张按日计数表，避免每次扫上百 MB 文件
        try:
            worker_log_stats_service.record(rows)
        except Exception as e:
            logger.warning(f"⚠️ Worker 日志聚合累加失败（不影响写入）: {e}")
        return worker_log_file_service.append_many(rows)


worker_log_service = WorkerLogService()
