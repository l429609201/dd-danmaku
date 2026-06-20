"""
IP 请求统计服务（S5）

接收 Worker stats.report 上报：
- upsert 到 ip_request_stats_current（当前累计）
- 追加到 ip_request_stats_snapshot（周期快照，用于趋势）
"""
import logging
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import IpRequestStatCurrent, IpRequestStatSnapshot
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class IpStatsService:
    """IP 请求统计落库服务"""

    def ingest_report(self, worker_id: str, ip_stats: List[Dict[str, Any]]) -> int:
        """落库一次 stats.report；返回处理条数"""
        if not ip_stats:
            return 0
        db = get_db_sync()
        current = now()
        count = 0
        try:
            for item in ip_stats:
                ip = str(item.get("ip", "")).strip()
                if not ip:
                    continue
                total = int(item.get("total_count", 0) or 0)
                violations = int(item.get("violations", 0) or 0)
                paths = item.get("paths") or {}

                row = db.query(IpRequestStatCurrent).filter(
                    IpRequestStatCurrent.ip == ip,
                    IpRequestStatCurrent.worker_id == worker_id,
                ).first()
                if not row:
                    row = IpRequestStatCurrent(ip=ip, worker_id=worker_id)
                    db.add(row)
                row.total_count = total
                row.violation_count = violations
                row.path_stats_json = paths
                row.last_access_at = current
                row.updated_at = current

                # 同步写一条快照用于趋势
                top_paths = dict(sorted(
                    paths.items(), key=lambda kv: kv[1], reverse=True
                )[:10]) if isinstance(paths, dict) else {}
                db.add(IpRequestStatSnapshot(
                    worker_id=worker_id, snapshot_at=current, ip=ip,
                    total_count=total, violation_count=violations,
                    top_paths_json=top_paths,
                ))
                count += 1
            db.commit()
            return count
        except Exception as e:
            db.rollback()
            logger.error(f"❌ IP 统计落库失败: {e}")
            return 0
        finally:
            db.close()


ip_stats_service = IpStatsService()
