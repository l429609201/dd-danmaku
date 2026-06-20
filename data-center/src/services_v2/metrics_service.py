"""
Worker 运行指标服务

接收 Worker metrics.report 上报，落库到 worker_metrics_snapshot（每窗口一条/实例）。
指标为"上报窗口内增量"，按时间桶聚合即得趋势；瞬时态单独保存。
"""
import logging
from typing import Any, Dict

from src.database import get_db_sync
from src.models_v2 import WorkerMetricsSnapshot
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class MetricsService:
    """Worker 指标快照落库"""

    def ingest_report(self, worker_id: str, metrics: Dict[str, Any],
                      total_lifetime: int = 0, api_cache_size: int = 0) -> bool:
        """落库一次 metrics.report 快照"""
        if metrics is None:
            return False
        db = get_db_sync()
        try:
            def _int(key: str) -> int:
                try:
                    return int(metrics.get(key, 0) or 0)
                except (TypeError, ValueError):
                    return 0

            row = WorkerMetricsSnapshot(
                worker_id=worker_id,
                snapshot_at=now(),
                total_requests=_int("totalRequests"),
                total_responses=_int("totalResponses"),
                bytes_in=_int("bytesIn"),
                bytes_out=_int("bytesOut"),
                mem_cache_hits=_int("memCacheHits"),
                r2_cache_hits=_int("r2CacheHits"),
                cache_miss=_int("cacheMiss"),
                blocked_ip=_int("blockedIp"),
                blocked_ua=_int("blockedUa"),
                blocked_abuse=_int("blockedAbuse"),
                invalid_route=_int("invalidRoute"),
                upstream_429=_int("upstream429"),
                status_2xx=_int("status2xx"),
                status_4xx=_int("status4xx"),
                status_5xx=_int("status5xx"),
                total_requests_lifetime=int(total_lifetime or 0),
                api_cache_size=int(api_cache_size or 0),
            )
            db.add(row)
            db.commit()
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Worker 指标落库失败: {e}")
            return False
        finally:
            db.close()


metrics_service = MetricsService()
