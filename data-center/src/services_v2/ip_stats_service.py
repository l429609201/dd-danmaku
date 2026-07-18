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

    def __init__(self):
        # 快照节流：worker_id -> 上次写快照时间，避免每分钟每 IP 一条导致表暴涨
        self._last_snapshot_at: Dict[str, Any] = {}
        # 快照最小间隔（秒）与每次最多快照的 Top IP 数
        self._snapshot_interval = 600   # 10 分钟
        self._snapshot_top_n = 20

    def ingest_report(self, worker_id: str, ip_stats: List[Dict[str, Any]]) -> int:
        """落库一次 stats.report；返回处理条数"""
        if not ip_stats:
            return 0
        db = get_db_sync()
        current = now()
        count = 0
        # 是否到达写快照的时间点（按 worker 节流）
        last = self._last_snapshot_at.get(worker_id)
        do_snapshot = last is None or (current - last).total_seconds() >= self._snapshot_interval
        # 仅对 Top N（按 total_count）写快照
        snapshot_ips = set()
        if do_snapshot:
            ranked = sorted(ip_stats, key=lambda x: int(x.get("total_count", 0) or 0), reverse=True)
            snapshot_ips = {str(x.get("ip", "")).strip() for x in ranked[:self._snapshot_top_n]}
            self._last_snapshot_at[worker_id] = current
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

                # 仅在节流窗口到达且属于 Top N 时写快照（大幅降低写入量）
                if do_snapshot and ip in snapshot_ips:
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
